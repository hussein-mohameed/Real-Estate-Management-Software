import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { cleanupTestData, connection, createFixture } from "./helpers";
import {
  generateCode,
  hashCode,
  issueOtp,
  MAX_ATTEMPTS,
  MAX_REQUESTS_PER_HOUR,
  verifyOtp,
} from "@/lib/services/otp";
import { prisma } from "@/lib/prisma";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  رمز الدخول — الأمان يُقاس لا يُفترَض.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── ⚠️ ما يحرسه هذا الملفّ ──────────────────────────────────────────
 *   • **لا رمز نصّاً في القاعدة** — المخطّط يَعِد بذلك، وهذا يقيسه.
 *   • **مرّة واحدة** — رمزٌ استُعمل لا يُعاد.
 *   • **حدّ المحاولات** — مليون احتمال لا تُخمَّن بثلاث محاولات.
 *   • **حدّ الطلبات** — لا يُستنزف رصيد الواتساب ولا يُزعَج صاحب الرقم.
 *   • **إبطال السابق** — رمزٌ قديم على هاتفٍ فُقد لا يبقى يعمل.
 */

let client: Client;

const PHONE = "+9647701110000";
const OTHER = "+9647701110001";

beforeAll(async () => {
  client = connection();
  await client.connect();
}, 120_000);

beforeEach(async () => {
  await cleanupTestData(client);
  /*
   * ⚠️ الفكسچر يُنشأ ولا يُحفَظ: هذه الحزمة تقيس آلية الرمز لا ارتباطه
   * بمستخدم — والتنظيف يحتاج عالماً متّسقاً لا أكثر.
   */
  await createFixture(client, "otp");
  await client.query(`delete from "OtpCode" where phone in ($1,$2)`, [PHONE, OTHER]);
}, 120_000);

afterAll(async () => {
  await client.query(`delete from "OtpCode" where phone in ($1,$2)`, [PHONE, OTHER]);
  await cleanupTestData(client);
  await client.end();
  await prisma.$disconnect();
});

describe("🔴 الرمز لا يُخزَّن نصّاً", () => {
  it("لا عمود في الصفّ يحمل الرمز الصريح", async () => {
    const issued = await issueOtp(PHONE, "10.0.0.1");
    if (!issued.ok) throw new Error("لم يُصدَر الرمز");

    /*
     * ⚠️ يُقرأ **الصفّ كلّه** لا `codeHash` وحده: عمودٌ جديد يُضاف يوماً
     * ويحمل الرمز سهواً يمرّ لو فحصنا عموداً بعينه.
     */
    const { rows } = await client.query<Record<string, unknown>>(
      `select * from "OtpCode" where phone = $1`,
      [PHONE],
    );
    const serialized = JSON.stringify(rows);
    expect(serialized.includes(issued.code), "الرمز مكتوب نصّاً في القاعدة").toBe(false);

    /* والتهشير هو ما يُطابَق عليه */
    expect(serialized.includes(hashCode(PHONE, issued.code))).toBe(true);
  });

  it("⚠️ والتهشير يشمل الهاتف — رمزٌ لرقم لا يصلح لغيره", async () => {
    const issued = await issueOtp(PHONE, null);
    if (!issued.ok) throw new Error("لم يُصدَر");

    /* نفس الرمز على رقم آخر */
    await issueOtp(OTHER, null);
    const r = await verifyOtp(OTHER, issued.code);
    expect(r.ok, "قُبل رمزُ رقمٍ على رقمٍ آخر").toBe(false);
  });
});

describe("🔴 مرّة واحدة", () => {
  it("الرمز الصحيح يعمل مرّةً ثم يُرفض", async () => {
    const issued = await issueOtp(PHONE, null);
    if (!issued.ok) throw new Error("لم يُصدَر");

    expect((await verifyOtp(PHONE, issued.code)).ok).toBe(true);

    const again = await verifyOtp(PHONE, issued.code);
    expect(again.ok, "أُعيد استعمال رمزٍ مستهلَك").toBe(false);
    if (!again.ok) expect(again.reason).toBe("no-code");
  });

  it("والاستهلاك يُكتب في الصفّ", async () => {
    const issued = await issueOtp(PHONE, null);
    if (!issued.ok) throw new Error("لم يُصدَر");
    await verifyOtp(PHONE, issued.code);

    const { rows } = await client.query<{ consumed: string | null }>(
      `select "consumedAt"::text as consumed from "OtpCode" where phone = $1`,
      [PHONE],
    );
    expect(rows[0]?.consumed).not.toBeNull();
  });
});

describe("🔴 حدّ المحاولات", () => {
  it("ثلاث محاولات خاطئة ثم يُبطَل الرمز", async () => {
    const issued = await issueOtp(PHONE, null);
    if (!issued.ok) throw new Error("لم يُصدَر");

    /* ⚠️ رمزٌ خاطئ مضمون الاختلاف — لا عشوائي قد يُصادف الصحيح */
    const wrong = issued.code === "000000" ? "111111" : "000000";

    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      const r = await verifyOtp(PHONE, wrong);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("mismatch");
    }

    /* وبعد استنفادها لا يعمل حتى **الرمز الصحيح** */
    const correct = await verifyOtp(PHONE, issued.code);
    expect(correct.ok, "قُبل الرمز بعد استنفاد المحاولات").toBe(false);
    if (!correct.ok) expect(correct.reason).toBe("too-many");
  });

  it("والعدّاد في القاعدة لا في الذاكرة", async () => {
    const issued = await issueOtp(PHONE, null);
    if (!issued.ok) throw new Error("لم يُصدَر");
    await verifyOtp(PHONE, issued.code === "000000" ? "111111" : "000000");

    const { rows } = await client.query<{ attempts: number }>(
      `select attempts from "OtpCode" where phone = $1`,
      [PHONE],
    );
    /* عدٌّ في الذاكرة يُصفَّر بإعادة التشغيل ويُلتفّ عليه بالتوازي */
    expect(rows[0]?.attempts).toBe(1);
  });
});

describe("🔴 حدّ الطلبات", () => {
  it("لا رمز جديد قبل انقضاء التهدئة", async () => {
    const first = await issueOtp(PHONE, null);
    expect(first.ok).toBe(true);

    const second = await issueOtp(PHONE, null);
    expect(second.ok, "أُصدر رمزٌ ثانٍ فوراً").toBe(false);
    if (!second.ok) {
      expect(second.reason).toBe("cooldown");
      expect(second.retryAfterSeconds).toBeGreaterThan(0);
    }
  });

  it("وحدٌّ ساعيّ يمنع الاستنزاف", async () => {
    /*
     * ⚠️ تُزاح أوقات الإنشاء إلى الوراء لتخطّي التهدئة — فالمقصود قياس
     * الحدّ الساعيّ لا الانتظار دقائق في اختبار.
     */
    for (let i = 0; i < MAX_REQUESTS_PER_HOUR; i += 1) {
      const r = await issueOtp(PHONE, null);
      expect(r.ok, `رُفض الطلب رقم ${i + 1} قبل بلوغ الحدّ`).toBe(true);
      await client.query(
        `update "OtpCode" set "createdAt" = "createdAt" - interval '2 minutes'
          where phone = $1`,
        [PHONE],
      );
    }

    const blocked = await issueOtp(PHONE, null);
    expect(blocked.ok, "تجاوز الحدّ الساعيّ").toBe(false);
    if (!blocked.ok) expect(blocked.reason).toBe("hourly-limit");
  });
});

describe("🔴 إبطال السابق", () => {
  it("الرمز الجديد يُبطل القديم", async () => {
    const first = await issueOtp(PHONE, null);
    if (!first.ok) throw new Error("لم يُصدَر");

    /* تخطّي التهدئة */
    await client.query(
      `update "OtpCode" set "createdAt" = "createdAt" - interval '2 minutes' where phone = $1`,
      [PHONE],
    );

    const second = await issueOtp(PHONE, null);
    if (!second.ok) throw new Error("لم يُصدَر الثاني");

    /*
     * ⚠️ وهذا هو الغرض: هاتفٌ فُقد وفيه رمزٌ قديم لا يبقى يعمل بعد أن
     * طلب صاحبه رمزاً جديداً.
     */
    const old = await verifyOtp(PHONE, first.code);
    expect(old.ok, "بقي الرمز القديم صالحاً").toBe(false);

    expect((await verifyOtp(PHONE, second.code)).ok).toBe(true);
  });

  it("والمنتهي يُرفض", async () => {
    const issued = await issueOtp(PHONE, null);
    if (!issued.ok) throw new Error("لم يُصدَر");

    await client.query(
      `update "OtpCode" set "expiresAt" = now() - interval '1 minute' where phone = $1`,
      [PHONE],
    );

    const r = await verifyOtp(PHONE, issued.code);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("expired");
  });
});

describe("توليد الرمز", () => {
  it("ستّة أرقام دائماً — بما فيها ما يبدأ بصفر", () => {
    /*
     * ⚠️ `String(randomInt(...))` وحده يُنتج «١٢٣» لخمسة أصفار بادئة.
     * والحشو هو ما يجعل الرمز ستّة خانات دائماً — ورمزٌ بطول متغيّر
     * يُربك من يقرؤه ويكسر حقل الإدخال.
     */
    for (let i = 0; i < 500; i += 1) {
      const c = generateCode();
      expect(c).toMatch(/^\d{6}$/u);
    }
  });
});
