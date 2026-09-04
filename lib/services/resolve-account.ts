import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { NotFoundError } from "@/lib/errors";
import { resolvePayerAccount, type PayerResolution } from "@/lib/domain/payer";
import type { PayerType } from "@/lib/domain/enums";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  قارئ `R28` — يجلب ما تحتاجه الدالّة النقيّة ثم يفوّض إليها.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── لماذا طبقتان ───────────────────────────────────────────────────
 * القرار كلّه في `lib/domain/payer.ts` النقيّة، وهنا **قراءةٌ فقط**.
 * الفصل ليس أناقة: الحالات الثماني تُختبَر بجدول في أجزاء الثانية بلا
 * قاعدة بيانات، ولو كان المنطق مبثوثاً في استعلام لصار كل فرع منها
 * يحتاج بناء شقة وعقدين وحسابين.
 *
 * ⚠️ **العقود النشطة وحدها** تُقرأ هنا. المنتهية لها حسابات مغلقة، وهي
 * تاريخ لا وجهةُ قيد — والدالّة النقيّة ترفض المغلق أيضاً حزاماً ثانياً.
 */

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * يحدّد الحساب الذي تُقيَّد عليه خدمةٌ على شقة بعينها.
 *
 * ⚠️ يُمرَّر `tx` حين يكون الحلّ جزءاً من عملية أكبر (تفعيل اشتراك،
 * إصدار باج): الشقة قد تتغيّر عقودها بين القراءة والكتابة.
 */
export async function resolveAccountForApartment(
  apartmentId: string,
  payerType: PayerType,
  db: Db = prisma,
): Promise<PayerResolution> {
  const apartment = await db.apartment.findFirst({
    where: { id: apartmentId, deletedAt: null },
    select: {
      displayNumber: true,
      ownershipStatus: true,
      contracts: {
        where: { status: "ACTIVE", deletedAt: null },
        select: {
          id: true,
          contractNumber: true,
          type: true,
          holderUserId: true,
          account: { select: { id: true, status: true } },
        },
      },
    },
  });

  if (!apartment) throw new NotFoundError("الشقة");

  /**
   * ⚠️ عقد نشط **بلا حساب** حالة لا ينبغي أن توجد: `activateContract`
   * يفتح الحساب في نفس المعاملة (‏R15). لو وُجدت فهي عطبٌ في البيانات،
   * وإسقاطُها هنا صامتاً يُنتج رسالة «لا عقد نشط» وهي كذبة.
   */
  const withAccounts = apartment.contracts.filter((c) => c.account !== null);
  const orphaned = apartment.contracts.length - withAccounts.length;
  if (orphaned > 0) {
    return {
      ok: false,
      messageAr:
        `الشقة «${apartment.displayNumber}» عليها عقد نشط بلا حساب مالي — ` +
        "وهي حالة لا ينبغي أن توجد. راجع مسؤول النظام قبل أي تحميل.",
    };
  }

  return resolvePayerAccount(payerType, {
    apartmentDisplayNumber: apartment.displayNumber,
    ownershipStatus: apartment.ownershipStatus,
    activeContracts: withAccounts.map((c) => ({
      contractId: c.id,
      contractNumber: c.contractNumber,
      type: c.type,
      accountId: c.account!.id,
      accountStatus: c.account!.status,
      holderUserId: c.holderUserId,
    })),
  });
}
