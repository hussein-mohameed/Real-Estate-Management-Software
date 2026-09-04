/**
 * التدفقات الاثنا عشر (‏§7) — سجلّ.
 *
 * كل تدفق يحمل: هل هو معاملة واحدة، وأين يُنفَّذ، وما يحجبه.
 * `audit:completeness` يؤكّد أن الاثني عشر كلها مُسنَدة.
 */

export interface BusinessFlow {
  id: `7.${number}`;
  ar: string;
  /** معاملة واحدة إلزامياً — الفشل الجزئي فيها يُنتج حالة غير متّسقة. */
  transactional: boolean;
  step: string;
  implementedIn: string | null;
  blockedBy?: string[];
  note?: string;
}

export const BUSINESS_FLOWS: readonly BusinessFlow[] = Object.freeze([
  {
    id: "7.1", ar: "التهيئة الأولى للمجمّع", transactional: false, step: "0.14 · 1.1 · 1.8 · 2.1",
    implementedIn: null,
    note: "⚠️ V2: الخطوة 2 «المالك يُنشئ الأدمن» بلا إجراء في §9.2 — لا مسار إقلاع. يُبنى createUser.",
  },
  {
    id: "7.2", ar: "تسجيل ساكن وفتح عقد", transactional: true, step: "1.3 · 1.5",
    implementedIn: null,
    note: "التفعيل معاملة واحدة: ACTIVE + Account + ربط صاحب العقد + ownershipStatus + مطالبة بخطة الأقساط.",
  },
  {
    id: "7.3", ar: "تغيير السكن — مفتاح الفوترة", transactional: true, step: "1.6 · 2.6",
    implementedIn: null, blockedBy: ["effectiveDate"],
    note: "أهم عملية غير مالية في النظام لأنها **تُنتج مالاً**. هل تاريخ ماضٍ يُنتج قيوداً رجعية؟ سؤال مفتوح.",
  },
  {
    id: "7.4", ar: "إنشاء خدمة والاشتراك بها", transactional: true, step: "2.1 · 2.3 · 2.4",
    implementedIn: null, blockedBy: ["B2"],
    note: "الفترة الأولى: فوترة فورية أم شهر مجاني أم تحريك بداية الفترة؟",
  },
  {
    id: "7.5", ar: "مهمة الفوترة الدورية", transactional: true, step: "2.7",
    implementedIn: null, blockedBy: ["B7"],
    note: "معاملة **لكل اشتراك** لا واحدة عملاقة — فشل اشتراك لا يُسقط الدفعة كلها.",
  },
  {
    id: "7.6", ar: "خطة الأقساط والمتابعة اليدوية", transactional: true, step: "3.5 · 3.6",
    implementedIn: null, blockedBy: ["B1"],
    note: "Q16 + V7: القيد يظهر لحظة الدفع فقط — فالمديونية لا تظهر على الرصيد أثناء استحقاقها.",
  },
  {
    id: "7.7", ar: "الدفع نقداً في المركز", transactional: true, step: "3.2",
    implementedIn: null,
    note: "سبع خطوات في معاملة واحدة. تسجيل receivedByUserId مسؤولية عن نقد حقيقي لا تفصيل.",
  },
  {
    id: "7.8", ar: "رابط Wayl والـwebhook", transactional: true, step: "3.3",
    implementedIn: null, blockedBy: ["B6"],
    note: "الـwebhook مصدر الحقيقة الوحيد لـPAID. صفحة العودة لا تُعلن الدفع أبداً.",
  },
  {
    id: "7.9", ar: "السيارة والباج", transactional: true, step: "4.1 · 4.2 · 4.3",
    implementedIn: null, blockedBy: ["B3", "B7"],
    note: "على حساب مَن يُقيَّد رسم الباج؟ ولمرة واحدة أم سنوي؟",
  },
  {
    id: "7.10", ar: "دورة الطلبات والشكاوى", transactional: false, step: "4.4",
    implementedIn: null,
    note: "resolutionNote إلزامية للانتقال إلى DONE — تُفرض في الخادم وبقيد CHECK.",
  },
  {
    id: "7.11", ar: "إنهاء العقد وإغلاق الحساب", transactional: true, step: "1.5",
    implementedIn: null,
    note: "D1/5: مفصول بحسب النوع. إنهاء الإيجار **لا يمسّ** حساب البيع، وإنهاء البيع أثناء إيجار نشط **ممنوع**.",
  },
  {
    id: "7.12", ar: "مُطلِقات الإخطارات (12 قالباً)", transactional: false, step: "0.7 · 5.4",
    implementedIn: "lib/notifications/templates.ts",
    note: "Q38: رسالة ملخّص واحدة لكل حساب بدل رسالة لكل اشتراك — 1200 رسالة/يوم تعني حجب الرقم.",
  },
]);

export function auditFlows(): { total: number; blocked: number; implemented: number } {
  return {
    total: BUSINESS_FLOWS.length,
    blocked: BUSINESS_FLOWS.filter((f) => f.blockedBy?.length).length,
    implemented: BUSINESS_FLOWS.filter((f) => f.implementedIn !== null).length,
  };
}
