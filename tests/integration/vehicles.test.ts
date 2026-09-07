import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { cleanupTestData, connection, createFixture, testId, type Fixture } from "./helpers";
import {
  addVehicle,
  approveVehicle,
  listVehicles,
  rejectVehicle,
  removeVehicle,
} from "@/lib/actions/vehicles";
import { registerVehicleFor } from "@/lib/services/resident-vehicles";
import { linkResidentToApartment } from "@/lib/actions/residents";
import type { ActorContext } from "@/lib/actions/define-action";
import { prisma } from "@/lib/prisma";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  المركبات — الخطوة 4.1 (بلا الباج).
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── ⚠️ ثلاثة خطوط يحرسها هذا الملفّ ─────────────────────────────────
 *   • `S7` — **لوحة واحدة نشطة في المجمَّع**. كان الفهرس موعوداً في تعليق
 *     المخطّط ولم يوجد، فبقيت اللوحة قابلة للتسجيل مرّتين. والتسجيل صار
 *     ذاتيّاً، فساكنان يسجّلان نفس اللوحة يتركان البوّابة أمام سيارةٍ
 *     لها بيتان.
 *   • **الساكن لا يمنح نفسه اعتماداً** — `status` ليس مُدخَلاً.
 *   • **الرفض لا يُحرّر اللوحة، والرفع يُحرّرها.** الفرق هو ما يمنع
 *     الالتفاف على قرار رفضٍ بتسجيلٍ جديد.
 */

let client: Client;
let f: Fixture;
let admin: ActorContext;
let resident: ActorContext;

const PLATE = "IT 90001";
const OTHER_APT = testId("apt_veh_other");

beforeAll(async () => {
  /*
   * ── 🔴 `connection()` **متزامنة** ولا تفتح الاتصال ────────────────
   * كتبتُها أوّلاً `client = await connection()` بلا `connect()`. و`await`
   * على قيمةٍ ليست وعداً يمرّ صامتاً، فيبقى العميل غير مفتوح — و`pg`
   * **يُطابر** الاستعلام في انتظار اتصالٍ لا يبدأ أبداً.
   *
   * ⚠️ فلا خطأ ولا قفل ولا استعلام في `pg_stat_activity`: ثلاثة عشر
   * اختباراً تنتهي مهلتها في `beforeEach` بلا سببٍ ظاهر، والعطل يبدو في
   * `cleanupTestData` وهو ليس فيها.
   */
  client = connection();
  await client.connect();
}, 120_000);

async function resetWorld(): Promise<void> {
  await cleanupTestData(client);
  f = await createFixture(client, "veh");
  admin = { userId: f.roleUsers.ADMIN, role: "ADMIN", ip: "10.0.0.90", userAgent: "vitest" };

  /* الساكن صاحب العقد — يُربَط بشقّته كي يسجّل عليها */
  resident = { userId: f.holderId, role: "RESIDENT", ip: "10.0.0.91", userAgent: "vitest" };
  const linked = await linkResidentToApartment(
    {
      apartmentId: f.apartmentId,
      userId: f.holderId,
      relationType: "OTHER",
      isContractHolder: false,
    },
    admin,
  );
  /* ⚠️ الفكسچر قد يكون ربطه سلفاً — التعارض مقبول، غيرُه لا */
  if (!linked.ok && !linked.error.message.includes("مرتبط")) {
    throw new Error(linked.error.message);
  }
}

beforeEach(async () => {
  await resetWorld();
}, 120_000);

afterAll(async () => {
  await cleanupTestData(client);
  await client.end();
  await prisma.$disconnect();
});

describe("تسجيل الساكن", () => {
  it("🔴 يُسجَّل **معلّقاً** — الساكن لا يمنح نفسه دخول البوّابة", async () => {
    const v = await registerVehicleFor(resident.userId, {
      apartmentId: f.apartmentId,
      plateNumber: PLATE,
      plateProvince: "بغداد",
      make: "تويوتا",
    });

    expect(v.status, "سُجّلت بغير PENDING_APPROVAL").toBe("PENDING_APPROVAL");

    const row = await prisma.vehicle.findUnique({
      where: { id: v.id },
      select: { ownerUserId: true, apartmentId: true },
    });
    /* المالك هو المسجِّل — عليه تقوم بوّابته وكل تقرير «مركبات من؟» */
    expect(row?.ownerUserId).toBe(resident.userId);
    expect(row?.apartmentId).toBe(f.apartmentId);
  });

  it("🔴 ولا يسجّل على شقة ليست له", async () => {
    await client.query(
      `insert into "Apartment"
         (id,"buildingId","floorNumber","unitNumber","displayNumber","constructionStatus","occupancyStatus","updatedAt")
       values ($1,$2,9,9,'IT-9-9','COMPLETED','VACANT',now())`,
      [OTHER_APT, f.buildingId],
    );

    await expect(
      registerVehicleFor(resident.userId, {
        apartmentId: OTHER_APT,
        plateNumber: "IT 90002",
      }),
      "سجّل ساكنٌ مركبةً على شقة غيره",
    ).rejects.toThrow(/ليست لك/);
  });

  it("ورقم لوحة قصير مرفوض", async () => {
    await expect(
      registerVehicleFor(resident.userId, { apartmentId: f.apartmentId, plateNumber: "أ" }),
    ).rejects.toThrow(/قصير/);
  });
});

describe("🔴 S7 — لوحة واحدة نشطة", () => {
  /**
   * ── العيب الذي وُجد هذا الفحص من أجله ─────────────────────────────
   * تعليق `Vehicle.plateNumber` في المخطّط يقول حرفياً إن الفهرس «فريد
   * **جزئي** WHERE status <> 'REMOVED' في migration خام» — **ولم يُكتب**.
   * فمرّ الوعد في القراءة ولم يوجد في القاعدة.
   */
  it("لوحة مسجَّلة لا تُسجَّل ثانيةً", async () => {
    await registerVehicleFor(resident.userId, {
      apartmentId: f.apartmentId,
      plateNumber: PLATE,
    });

    await expect(
      registerVehicleFor(resident.userId, {
        apartmentId: f.apartmentId,
        plateNumber: PLATE,
      }),
      "قُبلت لوحة مسجَّلة سلفاً — الفهرس الجزئي غائب",
    ).rejects.toThrow(/مسجَّلة/);
  });

  it("⚠️ ورسالة الساكن **لا تقول لمن** هي", async () => {
    /*
     * وإلا صار النموذج أداةَ استعلام: يُدخل فضوليّ لوحةً فيعرف أنها في
     * المجمَّع، وفي أي شقة لو ذكرناها.
     */
    await registerVehicleFor(resident.userId, {
      apartmentId: f.apartmentId,
      plateNumber: PLATE,
    });

    await expect(
      registerVehicleFor(resident.userId, {
        apartmentId: f.apartmentId,
        plateNumber: PLATE,
      }),
    ).rejects.toThrow(/راجع الإدارة/);
  });

  it("🔴 والمرفوضة **تبقى مانعة** — الرفض لا يُحرّر اللوحة", async () => {
    /*
     * ⚠️ وإلا التفّ التسجيل على الرفض: يُرفَض فيُعاد التسجيل فوراً.
     */
    const v = await registerVehicleFor(resident.userId, {
      apartmentId: f.apartmentId,
      plateNumber: PLATE,
    });
    const rejected = await rejectVehicle(
      { vehicleId: v.id, reason: "اللوحة لا تطابق هوية المركبة." },
      admin,
    );
    expect(rejected.ok, rejected.ok ? "" : rejected.error.message).toBe(true);

    await expect(
      registerVehicleFor(resident.userId, {
        apartmentId: f.apartmentId,
        plateNumber: PLATE,
      }),
      "التفّ التسجيل على قرار رفض",
    ).rejects.toThrow(/مسجَّلة/);
  });

  it("✅ والمرفوعة تُحرّرها — سيارةٌ بيعت تُسجَّل باسم آخر", async () => {
    const v = await registerVehicleFor(resident.userId, {
      apartmentId: f.apartmentId,
      plateNumber: PLATE,
    });
    const removed = await removeVehicle({ vehicleId: v.id, reason: "بيعت" }, admin);
    expect(removed.ok, removed.ok ? "" : removed.error.message).toBe(true);

    const again = await registerVehicleFor(resident.userId, {
      apartmentId: f.apartmentId,
      plateNumber: PLATE,
    });
    expect(again.id).not.toBe(v.id);
  });
});

describe("قرار الإدارة", () => {
  it("الاعتماد يفتح البوّابة — والمعلّقة وحدها تُعتمَد", async () => {
    const v = await registerVehicleFor(resident.userId, {
      apartmentId: f.apartmentId,
      plateNumber: PLATE,
    });

    const first = await approveVehicle({ vehicleId: v.id }, admin);
    expect(first.ok, first.ok ? "" : first.error.message).toBe(true);

    const again = await approveVehicle({ vehicleId: v.id }, admin);
    expect(again.ok, "اعتُمدت مركبة معتمَدة").toBe(false);
  });

  it("🔴 والرفض يوجب سبباً — في المخطّط لا في الشاشة", async () => {
    const v = await registerVehicleFor(resident.userId, {
      apartmentId: f.apartmentId,
      plateNumber: PLATE,
    });

    const bare = await rejectVehicle({ vehicleId: v.id, reason: "" }, admin);
    expect(bare.ok, "قُبل رفضٌ بلا سبب").toBe(false);

    const withReason = await rejectVehicle(
      { vehicleId: v.id, reason: "اللوحة لا تطابق هوية المركبة." },
      admin,
    );
    expect(withReason.ok, withReason.ok ? "" : withReason.error.message).toBe(true);

    const row = await prisma.vehicle.findUnique({
      where: { id: v.id },
      select: { status: true, notes: true },
    });
    expect(row?.status).toBe("REJECTED");
    /* والسبب يُحفظ — الساكن يقرؤه ليعرف ما يُصلحه */
    expect(row?.notes).toContain("هوية المركبة");
  });

  it("⚠️ وتسجيل الإدارة **معتمَد فوراً**", async () => {
    const r = await addVehicle(
      { apartmentId: f.apartmentId, plateNumber: "IT 90003", plateProvince: "بغداد" },
      admin,
    );
    if (!r.ok) throw new Error(r.error.message);
    expect(r.data.status).toBe("APPROVED");
  });

  it("🔴 ولا تُرفَع مركبة تحتها باجٌ ساري", async () => {
    /*
     * ⚠️ الرفع يُحرّر اللوحة للتسجيل باسم آخر، والباج الساري يفتح
     * البوّابة. فرفعُها بلا إلغائه يترك بطاقةً تعمل لسيارةٍ صارت لغير
     * صاحبها. وإلغاؤه تلقائياً ممنوع: `B3` لم يُحسم وقد يحمل رسماً مقيَّداً.
     */
    const v = await registerVehicleFor(resident.userId, {
      apartmentId: f.apartmentId,
      plateNumber: PLATE,
    });
    await approveVehicle({ vehicleId: v.id }, admin);

    await client.query(
      `insert into "Badge" (id,"vehicleId",code,status,"issuedAt","expiresAt","issuedByUserId","updatedAt")
       values ($1,$2,'IT-BDG-1','ISSUED',now(),now() + interval '90 days',$3,now())`,
      [testId("bdg_veh"), v.id, f.roleUsers.ADMIN],
    );

    const removed = await removeVehicle({ vehicleId: v.id }, admin);
    expect(removed.ok, "رُفعت مركبة تحتها باجٌ ساري").toBe(false);
  });
});

describe("قائمة الإدارة", () => {
  it("المعلّق يتصدّر وعدّاده على الكل لا على الصفحة", async () => {
    await registerVehicleFor(resident.userId, {
      apartmentId: f.apartmentId,
      plateNumber: PLATE,
    });
    const approved = await addVehicle(
      { apartmentId: f.apartmentId, plateNumber: "IT 90004" },
      admin,
    );
    if (!approved.ok) throw new Error(approved.error.message);

    const listed = await listVehicles({}, admin);
    if (!listed.ok) throw new Error(listed.error.message);

    /* ⚠️ `PENDING_APPROVAL` قبل `APPROVED` أبجدياً — والترتيب مقصود لا صدفة */
    expect(listed.data.rows[0]?.status).toBe("PENDING_APPROVAL");
    expect(listed.data.pendingCount).toBeGreaterThanOrEqual(1);
  });

  it("والبحث يجد اللوحة", async () => {
    await registerVehicleFor(resident.userId, {
      apartmentId: f.apartmentId,
      plateNumber: PLATE,
    });

    const found = await listVehicles({ search: "90001" }, admin);
    if (!found.ok) throw new Error(found.error.message);
    expect(found.data.rows.map((r) => r.plateNumber)).toContain(PLATE);
  });
});
