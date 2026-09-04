import type { Prisma } from "@/lib/generated/prisma/client";
import { nextNumber } from "@/lib/services/counter";
import { BusinessRuleError, NotFoundError } from "@/lib/errors";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  إصدار الفاتورة — الخطوة 3.1.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── ⚠️ `R33` — الفاتورة للمدفوع لا للمعلَّق ─────────────────────────
 * دفعة `PENDING` **لا فاتورة لها**. الفاتورة إقرارُ استلام: إصدارها قبل
 * الاستلام يعطي الساكن ورقةً يُثبت بها دفعاً لم يقع، ويُغرق الترقيم بأرقام
 * لدفعات فشلت.
 *
 * ── ⚠️ `R35` — حصينة بعد الإصدار ───────────────────────────────────
 * لا تعديل ولا حذف. يفرضه trigger `reject_invoice_mutation` في القاعدة،
 * **عدا `pdfUrl`** الذي يُملأ عند التوليد. التصحيح بقيد معاكس وفاتورة
 * جديدة، لا بتعديل ورقة صدرت.
 *
 * ── ⚠️ والبنود **لقطة** لا استعلام حيّ (‏Q15) ────────────────────────
 * `lines` تُحفظ نصّاً وقت الإصدار. ولا جدول تخصيص «دفعة ↔ قيد» في النظام،
 * فالدفعة العامة تُصدر سطراً واحداً «دفعة على الحساب» مع **الرصيد قبل
 * وبعد** — وهو ما يجعل الفاتورة مفهومة بلا تخصيص.
 *
 * وبناؤها من استعلام حيّ كان يجعل فاتورة العام الماضي تتغيّر بتغيّر
 * الأسعار أو الأرصدة: ورقةٌ صدرت وتغيّر مضمونها.
 */

type Db = Prisma.TransactionClient;

export interface IssuedInvoice {
  invoiceId: string;
  number: string;
  totalIqd: bigint;
}

/**
 * يُصدر فاتورة لدفعة مدفوعة.
 *
 * ⚠️ **يُستدعى داخل معاملة الدفع نفسها.** الرقم يُحجَز من العدّاد، ولو
 * جرى الحجز في معاملة مستقلّة لبقي الرقم محجوزاً عند فشل الدفع — فجوة
 * بلا داعٍ. و`R34` يقبل الفجوات ويمنع التكرار، لكن فجوةً بلا سبب تبقى
 * سؤالاً يُسأل عند التدقيق.
 */
export async function issueInvoiceForPayment(
  db: Db,
  paymentId: string,
  context: { balanceBeforeIqd: bigint; balanceAfterIqd: bigint },
): Promise<IssuedInvoice> {
  const payment = await db.payment.findUnique({
    where: { id: paymentId },
    select: {
      id: true,
      accountId: true,
      amountIqd: true,
      status: true,
      method: true,
      paidAt: true,
      invoice: { select: { id: true, number: true, totalIqd: true } },
    },
  });
  if (!payment) throw new NotFoundError("الدفعة");

  /**
   * ⚠️ `R33` يُفحص هنا **وفي القاعدة**: `Invoice.paymentId` فريد، فمحاولة
   * إصدار ثانية على نفس الدفعة تُرفض من الفهرس أيضاً. الشرط هنا يعطي
   * رسالة عربية مفهومة بدل خطأ فهرس خام.
   */
  if (payment.status !== "PAID") {
    throw new BusinessRuleError(
      "لا تُصدَر فاتورة لدفعة غير مدفوعة. الفاتورة إقرار استلام.",
      "R33",
    );
  }

  if (payment.invoice) {
    throw new BusinessRuleError("للدفعة فاتورة صادرة سلفاً — لا تُصدَر مرّتين.", "R35");
  }

  const number = await nextNumber("INV", db, payment.paidAt ?? undefined);

  /**
   * سطر واحد + الرصيد قبل وبعد (‏Q15).
   *
   * ⚠️ المبالغ **نصوصاً في JSON**. `BigInt` لا يُسلسَل، والعائم يفقد
   * الدقّة فوق 2^53 — ورقمٌ ناقص دينارَين على ورقة رسمية عيبٌ لا يُصلَح
   * بعد الإصدار لأن الفاتورة حصينة.
   */
  const lines = [
    {
      descriptionAr: "دفعة على الحساب",
      amountIqd: payment.amountIqd.toString(),
      balanceBeforeIqd: context.balanceBeforeIqd.toString(),
      balanceAfterIqd: context.balanceAfterIqd.toString(),
      method: payment.method,
    },
  ];

  const invoice = await db.invoice.create({
    data: {
      number,
      paymentId: payment.id,
      accountId: payment.accountId,
      totalIqd: payment.amountIqd,
      lines,
      ...(payment.paidAt ? { issuedAt: payment.paidAt } : {}),
    },
    select: { id: true, number: true, totalIqd: true },
  });

  return { invoiceId: invoice.id, number: invoice.number, totalIqd: invoice.totalIqd };
}
