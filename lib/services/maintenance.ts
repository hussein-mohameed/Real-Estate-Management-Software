import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { now } from "@/lib/dates";
import { detectBalanceDrift, type BalanceDrift } from "@/lib/ledger/post-entry";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  الصيانة اليومية — الخطوتان 2.8 و`Q40`.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── مهمّتان في مسار واحد، وثالثة محجوبة ────────────────────────────
 *   1. **انتهاء الباجات** (‏Q40) — ثقب في ضبط الوصول الفيزيائي.
 *   2. **كشف انحراف الرصيد** (‏2.8 · R31) — يُنبّه ولا يُصحّح.
 *   3. انتهاء روابط الدفع — محجوبة بـ`B6`، تُذكر في التقرير ولا تُنفَّذ.
 *
 * ── ⚠️ لماذا `Q40` ليس عيب enum ناقصاً ─────────────────────────────
 * لا شيء في المواصفة يقلب الباج من `ISSUED` إلى `EXPIRED`، فباجٌ انتهت
 * صلاحيته **يبقى صالحاً في القاعدة**. وشاشة بوّابة الأمن تقرأ الحالة،
 * فتُدخل سيارته بلا تفتيش. عالجتُ العرض في بوّابة الساكن كي لا يُكذَب
 * عليه، لكن **العرض لا يحرس البوّابة**: الحارس يقرأ من القاعدة.
 * هذا هو الإصلاح الحقيقي.
 *
 * ── وكل مهمّة معزولة عن أختها ──────────────────────────────────────
 * ⚠️ فشل كشف الانحراف يجب ألّا يمنع انتهاء الباجات. مهمّة ليلية تموت في
 * منتصفها تترك نصف عملها غير منفَّذ **بصمت** حتى الليلة التالية — وقد
 * تموت فيها أيضاً. كل مهمّة تُلتقط أخطاؤها وحدها وتُذكر في التقرير.
 */

export interface MaintenanceTaskError {
  task: string;
  message: string;
}

export interface MaintenanceSkip {
  task: string;
  blockedBy: string;
  reason: string;
}

export interface MaintenanceReport {
  ranAt: Date;
  /** عدد الباجات التي انقلبت إلى `EXPIRED` في هذا التشغيل. */
  badgesExpired: number;
  /** الحسابات المنحرفة — **تُبلَّغ ولا تُصحَّح**. */
  drifts: BalanceDrift[];
  skipped: MaintenanceSkip[];
  errors: MaintenanceTaskError[];
}

/**
 * يقلب الباجات المنتهية.
 *
 * ⚠️ **صفّاً صفّاً لا `updateMany`.** الدفعة الواحدة أسرع وتكتب سطر تدقيق
 * واحداً لا سطراً لكل باج — و«متى انتهى باج هذه السيارة» سؤالٌ يُسأل عند
 * حادثة دخول، فيحتاج جواباً لكل باج على حدة.
 *
 * ⚠️ و`actorUserId: null` مقصود: النظام هو الفاعل لا مستخدم. الحقل يقبل
 * `null` في `AuditInput` لهذا بالذات.
 */
async function expireBadges(at: Date): Promise<number> {
  const due = await prisma.badge.findMany({
    where: { status: "ISSUED", expiresAt: { not: null, lt: at } },
    select: { id: true, vehicleId: true, code: true, expiresAt: true },
  });

  for (const b of due) {
    /*
     * ⚠️ الشرط `status: "ISSUED"` مُعاد في `updateMany` لا في `update`:
     * لو ألغى موظفٌ الباج بين القراءة والكتابة، فالكتابة تُصيب صفراً من
     * الصفوف بدل أن تدهس `REVOKED` بـ`EXPIRED`. الإلغاء قرار إنسان،
     * والانتهاء مرور وقت — ولا يجوز أن يمحو الثاني الأول.
     */
    const { count } = await prisma.badge.updateMany({
      where: { id: b.id, status: "ISSUED" },
      data: { status: "EXPIRED" },
    });
    if (count === 0) continue;

    await writeAudit({
      actorUserId: null,
      action: "badge.expire",
      entityType: "Badge",
      entityId: b.id,
      before: { status: "ISSUED", expiresAt: b.expiresAt },
      after: { status: "EXPIRED" },
    });
  }

  return due.length;
}

/**
 * يسجّل الانحراف في التدقيق.
 *
 * ⚠️ **يُنبّه ولا يُصحّح.** التصحيح الصامت يخفي الخلل الذي سبّبه: معاملة
 * ناقصة، أو كتابة مباشرة في الجدول، أو عبث. ولو صُحِّح آلياً لضاع الدليل
 * الوحيد على وجود مشكلة، وبقي السبب يعمل.
 *
 * وصفّ تدقيق **لكل ليلة يستمرّ فيها الانحراف** مقصود: يجعل «منذ متى؟»
 * سؤالاً له جواب.
 */
async function reportDrifts(drifts: readonly BalanceDrift[]): Promise<void> {
  for (const d of drifts) {
    await writeAudit({
      actorUserId: null,
      action: "account.balance.drift",
      entityType: "Account",
      entityId: d.accountId,
      before: { cachedIqd: d.cachedIqd.toString() },
      after: { computedIqd: d.computedIqd.toString(), driftIqd: d.driftIqd.toString() },
    });
  }
}

export async function runDailyMaintenance(): Promise<MaintenanceReport> {
  const ranAt = now();
  const errors: MaintenanceTaskError[] = [];

  let badgesExpired = 0;
  try {
    badgesExpired = await expireBadges(ranAt);
  } catch (e) {
    errors.push({ task: "badge.expire", message: e instanceof Error ? e.message : String(e) });
  }

  let drifts: BalanceDrift[] = [];
  try {
    drifts = await detectBalanceDrift();
    await reportDrifts(drifts);
  } catch (e) {
    errors.push({
      task: "account.balance.drift",
      message: e instanceof Error ? e.message : String(e),
    });
  }

  return {
    ranAt,
    badgesExpired,
    drifts,
    skipped: [
      {
        task: "payment-link.expire",
        blockedBy: "B6",
        reason:
          "§12.4 يطلب انتهاء روابط الدفع، وتكامل Wayl محجوب. تنفيذها الآن " +
          "يعني تخمين شكل الرابط ومدّته — ومسارٌ يقبض مالاً لا يُخمَّن.",
      },
    ],
    errors,
  };
}
