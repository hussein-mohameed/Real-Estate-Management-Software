import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { z } from "zod";
import { cleanupTestData, connection, createFixture, type Fixture } from "./helpers";
import { defineAction, type ActorContext } from "@/lib/actions/define-action";
import { REDACTION_MARK } from "@/lib/audit";
import { USER_ROLES, type UserRole } from "@/lib/auth/roles";
import { prisma } from "@/lib/prisma";

/**
 * تعريف إنجاز الخطوتين 0.10 و0.12:
 *   «اختبار أمني لكل دور × كل Server Action يؤكّد أن غير المصرّح له يستلم
 *    403 — **لا 500 ولا بيانات فارغة**»
 *   «اختبار يؤكّد أن nationalIdImageUrl محجوب في التدقيق»
 *   «اختبار يؤكّد أن OWNER يُمنع من كل action كتابي عملياتي»
 */

let client: Client;
let f: Fixture;

const actorOf = (role: UserRole, userId: string): ActorContext => ({
  userId,
  role,
  ip: "10.0.0.1",
  userAgent: "vitest",
});

/** إجراء كتابي حقيقي: يعدّل ملاحظات الشقة. */
const updateApartmentNotes = defineAction({
  name: "updateApartmentNotes",
  capability: "APARTMENTS",
  kind: "write",
  transactional: true,
  auditAction: "apartment.notes.update",
  auditEntityType: "Apartment",
  schema: z.object({
    id: z.string().min(1, "معرّف الشقة مطلوب"),
    notes: z.string().max(500, "الملاحظة طويلة"),
    // حقول حسّاسة نمرّرها عمداً لنتحقّق من حجبها في التدقيق
    nationalIdImageUrl: z.string().optional(),
  }),
  handler: async ({ input, tx }) => {
    await tx.apartment.update({ where: { id: input.id }, data: { notes: input.notes } });
    return { id: input.id, notes: input.notes, nationalIdImageUrl: input.nationalIdImageUrl };
  },
});

/** إجراء محجوب بقرار — يجب أن يرفض بدل أن يخمّن. */
const issueBadgeStub = defineAction({
  name: "issueBadge",
  capability: "BADGES",
  kind: "write",
  auditAction: "badge.issue",
  blockedBy: "B3",
  blockedDescription: "إصدار الباج مع رسم",
  schema: z.object({ vehicleId: z.string() }),
  handler: async () => {
    throw new Error("لا يجوز أن يُنفَّذ — القرار محجوب");
  },
});

beforeAll(async () => {
  client = connection();
  await client.connect();
  await cleanupTestData(client);
  f = await createFixture(client, "action");
}, 90_000);

afterAll(async () => {
  await cleanupTestData(client);
  await client.end().catch(() => {});
  await prisma.$disconnect().catch(() => {});
}, 90_000);

describe("الترخيص — كل دور × إجراء كتابي", () => {
  it("بلا جلسة ← UNAUTHENTICATED لا 500", async () => {
    const r = await updateApartmentNotes({ id: f.apartmentId, notes: "x" }, null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("UNAUTHENTICATED");
  });

  it("مصفوفة الأدوار الأربعة على إجراء كتابي", async () => {
    const outcomes: Record<UserRole, boolean> = {
      ADMIN: true,
      OWNER: false, // D3 — قراءة فقط على العمليات
      STAFF: false, // المصفوفة: R على الشقق لا W
      RESIDENT: false,
    };

    for (const role of USER_ROLES) {
      const r = await updateApartmentNotes(
        { id: f.apartmentId, notes: `ملاحظة من ${role}` },
        actorOf(role, f.roleUsers[role]),
      );
      expect(r.ok, `${role} — النتيجة غير متوقَّعة`).toBe(outcomes[role]);
      if (!r.ok) {
        // ⚠️ 403 صريح لا 500 ولا قائمة فارغة
        expect(r.error.code, role).toBe("FORBIDDEN");
        expect(r.error.message, role).toMatch(/صلاحية/u);
      }
    }
  });

  it("**المالك يُمنع من الكتابة العملياتية** ورسالته عربية مفهومة", async () => {
    const r = await updateApartmentNotes(
      { id: f.apartmentId, notes: "محاولة من المالك" },
      actorOf("OWNER", f.roleUsers.OWNER),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("FORBIDDEN");
      expect(/[A-Z_]{5,}/u.test(r.error.message), "رمز خام ظهر للمستخدم").toBe(false);
    }
  });
});

describe("التحقّق — أخطاء الحقول بالعربية", () => {
  it("مُدخل غير صالح ← VALIDATION مع fieldErrors عربية", async () => {
    const r = await updateApartmentNotes(
      { id: "", notes: "x".repeat(600) },
      actorOf("ADMIN", f.roleUsers.ADMIN),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("VALIDATION");
      expect(r.error.fieldErrors?.["id"]?.[0]).toBe("معرّف الشقة مطلوب");
      expect(r.error.fieldErrors?.["notes"]?.[0]).toBe("الملاحظة طويلة");
    }
  });
});

describe("التدقيق — يُكتب ويُصفّى", () => {
  it("الإجراء الناجح يكتب صفّ تدقيق كاملاً", async () => {
    const r = await updateApartmentNotes(
      { id: f.apartmentId, notes: "ملاحظة مدقَّقة" },
      actorOf("ADMIN", f.roleUsers.ADMIN),
    );
    expect(r.ok).toBe(true);

    const { rows } = await client.query<{
      action: string; entityType: string; entityId: string; after: unknown; ip: string;
    }>(
      `select action, "entityType", "entityId", after, ip from "AuditLog"
       where "entityId" = $1 order by "createdAt" desc limit 1`,
      [f.apartmentId],
    );
    const row = rows[0];
    expect(row, "لم يُكتب صفّ تدقيق").toBeDefined();
    expect(row!.action).toBe("apartment.notes.update");
    expect(row!.entityType).toBe("Apartment");
    expect(row!.ip).toBe("10.0.0.1");
  });

  it("🔴 **صورة الهوية محجوبة في التدقيق** (‏§12.1)", async () => {
    await updateApartmentNotes(
      {
        id: f.apartmentId,
        notes: "مع حقل حسّاس",
        nationalIdImageUrl: "https://storage/ids/سرّي-جداً.jpg",
      },
      actorOf("ADMIN", f.roleUsers.ADMIN),
    );

    const { rows } = await client.query<{ after: Record<string, unknown> }>(
      `select after from "AuditLog" where "entityId" = $1 order by "createdAt" desc limit 1`,
      [f.apartmentId],
    );
    const after = rows[0]!.after;
    expect(after["nationalIdImageUrl"]).toBe(REDACTION_MARK);

    // والأهم: لا أثر للرابط في **الصفّ كلّه**، لا في هذا الحقل وحده
    const wholeRow = await client.query<{ j: string }>(
      `select row_to_json(a)::text j from "AuditLog" a
       where "entityId" = $1 order by "createdAt" desc limit 1`,
      [f.apartmentId],
    );
    expect(wholeRow.rows[0]!.j).not.toContain("سرّي-جداً");
  });

  it("التدقيق **داخل المعاملة** — فشل الإجراء لا يترك صفّ تدقيق", async () => {
    const { rows: before } = await client.query<{ n: string }>(
      `select count(*) n from "AuditLog" where "entityId" = $1`,
      ["itest_missing_apartment"],
    );

    const r = await updateApartmentNotes(
      { id: "itest_missing_apartment", notes: "شقة غير موجودة" },
      actorOf("ADMIN", f.roleUsers.ADMIN),
    );
    expect(r.ok).toBe(false);

    const { rows: after } = await client.query<{ n: string }>(
      `select count(*) n from "AuditLog" where "entityId" = $1`,
      ["itest_missing_apartment"],
    );
    expect(Number(after[0]!.n)).toBe(Number(before[0]!.n));
  });
});

describe("القرارات المحجوبة — رفض صريح لا تخمين", () => {
  it("إجراء محجوب بـB3 ← PENDING_DECISION برسالة تسمّي القرار", async () => {
    const r = await issueBadgeStub(
      { vehicleId: "v1" },
      actorOf("ADMIN", f.roleUsers.ADMIN),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("PENDING_DECISION");
      expect(r.error.message).toContain("B3");
      expect(r.error.message).toContain("إصدار الباج");
    }
  });

  it("الحجب يُفحص **قبل** التحقّق — فلا يُخفيه خطأ مُدخلات", async () => {
    const r = await issueBadgeStub({ nonsense: true }, actorOf("ADMIN", f.roleUsers.ADMIN));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("PENDING_DECISION");
  });
});

describe("الحماية البنيوية", () => {
  it("**إجراء كتابي بلا auditAction لا يُبنى أصلاً**", () => {
    expect(() =>
      defineAction({
        name: "unaudited",
        capability: "APARTMENTS",
        kind: "write",
        schema: z.object({}),
        handler: async () => ({}),
      }),
    ).toThrow(/auditAction/u);
  });
});
