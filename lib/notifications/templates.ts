/**
 * قوالب الإخطارات العربية (‏§7.12) — اثنا عشر قالباً + قالب ملخّص أضافه القرار Q38.
 *
 * ── لماذا النوع يربط القالب بمعاملاته ────────────────────────────────
 * قالب يُرسل بمتغيّر ناقص يصل للساكن هكذا: «قسطك بمبلغ undefined مستحق في».
 * الاعتماد على الانتباه يفشل. هنا كل قالب يعلن معاملاته، والنوع يرفض
 * الاستدعاء الناقص **وقت التصريف**.
 *
 * كل مبلغ يمرّ بـ`formatIqd` وكل تاريخ بـ`formatBaghdadDate` — لا تنسيق
 * موضعي في نصّ قالب.
 */

import { formatIqd } from "@/lib/money";
import { formatBaghdadDate } from "@/lib/dates";

export interface TemplateParams {
  "auth.otp": { code: string };
  "resident.welcome": { fullName: string; compoundName: string };
  "billing.monthly_charge": { serviceName: string; amountIqd: bigint; period: string };
  "billing.monthly_summary": { totalIqd: bigint; itemsCount: number; period: string; balanceIqd: bigint };
  "installment.reminder": { sequence: number; amountIqd: bigint; dueDate: Date; daysBefore: number };
  "installment.due_today": { sequence: number; amountIqd: bigint };
  "installment.overdue": { sequence: number; amountIqd: bigint; dueDate: Date };
  "payment.receipt": { amountIqd: bigint; invoiceNumber: string; balanceIqd: bigint };
  "payment.link": { amountIqd: bigint; url: string; expiresAt: Date };
  "request.assigned": { requestNumber: string; title: string };
  "request.status_changed": { requestNumber: string; statusAr: string };
  "badge.issued": { plateNumber: string; code: string };
  "subscription.approved": { serviceName: string; periodAmountIqd: bigint; cycleAr: string };
}

export type TemplateKey = keyof TemplateParams;

type Renderer<K extends TemplateKey> = (params: TemplateParams[K]) => string;

type Renderers = { [K in TemplateKey]: Renderer<K> };

/**
 * ⚠️ **OTP استثناء وحيد** من قاعدة §12.3 «لا إرسال inline»: المستخدم ينتظر
 * الرمز، فيُرسل فوراً **ويُسجَّل كـ`Notification`** أيضاً (‏Q22).
 * كل ما عداه يُصفّ داخل المعاملة ويُرسل بمهمة مستقلة — لأن استدعاء HTTP
 * خارجياً داخل معاملة قاعدة بيانات يحتجز اتصالاً ويفشل عشوائياً.
 */
export const TEMPLATES: Renderers = {
  "auth.otp": ({ code }) =>
    `رمز الدخول الخاص بك: ${code} — صالح لمدة 5 دقائق. لا تشاركه مع أحد.`,

  "resident.welcome": ({ fullName, compoundName }) =>
    `أهلاً ${fullName}، تم إنشاء حسابك في ${compoundName}. ` +
    `تدخل برقم هاتفك عبر رمز يصلك على واتساب.`,

  "billing.monthly_charge": ({ serviceName, amountIqd, period }) =>
    `تم قيد اشتراك ${serviceName} بمبلغ ${formatIqd(amountIqd)} عن ${period}.`,

  // Q38 — قالب جديد غير موجود في القوالب الاثني عشر.
  // رسالة لكل اشتراك تعني 300 شقة × 4 اشتراكات = 1200 رسالة في يوم واحد،
  // وهو حجم يُنتج حجب رقم الواتساب — **وحجب الرقم يعني فقدان الدخول
  // والتحصيل معاً**، لأن OTP يمرّ من القناة نفسها.
  "billing.monthly_summary": ({ totalIqd, itemsCount, period, balanceIqd }) =>
    `قيود ${period}: ${itemsCount} بنداً بمجموع ${formatIqd(totalIqd)}. ` +
    `رصيدك الحالي ${formatIqd(balanceIqd)}.`,

  "installment.reminder": ({ sequence, amountIqd, dueDate, daysBefore }) =>
    `تذكير: القسط رقم ${sequence} بمبلغ ${formatIqd(amountIqd)} يستحق بعد ${daysBefore} أيام ` +
    `بتاريخ ${formatBaghdadDate(dueDate)}.`,

  "installment.due_today": ({ sequence, amountIqd }) =>
    `القسط رقم ${sequence} بمبلغ ${formatIqd(amountIqd)} مستحق اليوم.`,

  "installment.overdue": ({ sequence, amountIqd, dueDate }) =>
    `القسط رقم ${sequence} بمبلغ ${formatIqd(amountIqd)} متأخّر منذ ${formatBaghdadDate(dueDate)}. ` +
    `يرجى المراجعة.`,

  "payment.receipt": ({ amountIqd, invoiceNumber, balanceIqd }) =>
    `استلمنا دفعتك بمبلغ ${formatIqd(amountIqd)}. رقم الفاتورة ${invoiceNumber}. ` +
    `رصيدك بعد الدفعة ${formatIqd(balanceIqd)}.`,

  "payment.link": ({ amountIqd, url, expiresAt }) =>
    `رابط دفع بمبلغ ${formatIqd(amountIqd)}: ${url}\n` +
    `صالح حتى ${formatBaghdadDate(expiresAt)}.`,

  "request.assigned": ({ requestNumber, title }) =>
    `أُسند إليك الطلب ${requestNumber}: ${title}.`,

  "request.status_changed": ({ requestNumber, statusAr }) =>
    `تغيّرت حالة طلبك ${requestNumber} إلى: ${statusAr}.`,

  "badge.issued": ({ plateNumber, code }) =>
    `صدر باج المرور للسيارة ${plateNumber} برقم ${code}. ` +
    `السيارة تدخل بلا تفتيش ما دام الباج سارياً.`,

  "subscription.approved": ({ serviceName, periodAmountIqd, cycleAr }) =>
    `تمت الموافقة على اشتراكك في ${serviceName} بمبلغ ${formatIqd(periodAmountIqd)} ${cycleAr}.`,
};

/** يُرسل فوراً استثناءً من قاعدة الطابور (‏Q22). */
export const IMMEDIATE_TEMPLATES: readonly TemplateKey[] = Object.freeze(["auth.otp"]);

/** ‏12 قالباً من §7.12 + `billing.monthly_summary` من القرار Q38. */
export const SPEC_TEMPLATE_KEYS: readonly TemplateKey[] = Object.freeze([
  "auth.otp",
  "resident.welcome",
  "billing.monthly_charge",
  "installment.reminder",
  "installment.due_today",
  "installment.overdue",
  "payment.receipt",
  "payment.link",
  "request.assigned",
  "request.status_changed",
  "badge.issued",
  "subscription.approved",
]);

/** التصيير الوحيد. الحدّ 4096 محرفاً في UltraMsg (‏§12.3). */
export function render<K extends TemplateKey>(key: K, params: TemplateParams[K]): string {
  const body = TEMPLATES[key](params);
  if (body.length > 4096) {
    throw new RangeError(`القالب ${key} تجاوز 4096 محرفاً — حدّ UltraMsg.`);
  }
  return body;
}

export function auditTemplates() {
  const all = Object.keys(TEMPLATES) as TemplateKey[];
  const missingFromSpec = SPEC_TEMPLATE_KEYS.filter((k) => !all.includes(k));
  return {
    total: all.length,
    specCount: SPEC_TEMPLATE_KEYS.length,
    added: all.filter((k) => !SPEC_TEMPLATE_KEYS.includes(k)),
    missingFromSpec,
  };
}
