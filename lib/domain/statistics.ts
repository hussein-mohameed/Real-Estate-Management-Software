/**
 * الإحصاءات المحسوبة — التعريفات الاثنا عشر في §4.20.
 *
 * ── لماذا تعريف واحد لا اثنان ─────────────────────────────────────────
 * إعادة كتابة «نسبة الإنجاز» في ثلاث شاشات تُنتج ثلاثة أرقام مختلفة، وهو
 * **أسوأ عيب ممكن** في نظام يقرأه المالك ليقرّر. لذلك كل تعريف يعيش هنا
 * مرة واحدة، وكل لوحة تقرأ من هنا.
 *
 * ── المبدأ 1 و`R9` ───────────────────────────────────────────────────
 * لا شيء من هذا يُخزَّن. كلها استعلامات. والاستثناءان المتعمَّدان الوحيدان
 * في النظام كله هما `Account.balanceIqd` و`ApartmentResident.isActive`.
 *
 * ── القسمة على صفر ───────────────────────────────────────────────────
 * المواصفة لا تحدّد ناتج «نسبة الإنجاز» لبناية بلا شقق، ولا «نسبة الاشتراك»
 * لمجمّع بلا شقق مسكونة. القرار: **`null`** — وتعرض الواجهة «—».
 * إعادة `0%` **مضلّلة**: تعني «صفر إنجاز» بينما الحقيقة «لا مقام».
 */

/** نسبة مئوية، أو `null` حين لا مقام. */
export type Percentage = number | null;

/**
 * القسمة الآمنة الوحيدة في النظام.
 * كل نسبة مئوية تمرّ من هنا — فلا يتسرّب `NaN` ولا `Infinity` إلى شاشة.
 */
export function safePercentage(numerator: number, denominator: number): Percentage {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;
  if (denominator === 0) return null;
  return (numerator / denominator) * 100;
}

/** «—» حين لا مقام، وإلا النسبة بخانة عشرية واحدة بأرقام غربية. */
export function formatPercentage(value: Percentage): string {
  if (value === null) return "—";
  return `${value.toFixed(1)}%`;
}

export type StatisticScope = "building" | "apartment" | "service" | "compound";

export interface StatisticDefinition {
  key: string;
  ar: string;
  scope: StatisticScope;
  /** التعريف الحرفي كما في §4.20 — مرجع لا يُعاد صياغته. */
  definition: string;
  /** هل يُنتج `null` عند غياب المقام؟ */
  nullable: boolean;
  /** قرار يحجب هذا الإحصاء تحديداً. */
  blockedBy?: string;
  note?: string;
}

/** الاثنا عشر تعريفاً، بترتيب §4.20 نفسه. */
export const STATISTICS: readonly StatisticDefinition[] = Object.freeze([
  {
    key: "apartmentsInBuilding",
    ar: "عدد الشقق في البناية",
    scope: "building",
    definition: "count(Apartment where buildingId = B)",
    nullable: false,
  },
  {
    key: "completedApartments",
    ar: "عدد الشقق المكتملة",
    scope: "building",
    definition:
      "count(Apartment where buildingId = B and constructionStatus in (COMPLETED, DELIVERED))",
    nullable: false,
    note: "DELIVERED تُحتسب مكتملة — القيمتان تُعاملان معاً في كل الإحصاءات.",
  },
  {
    key: "completedApartmentNumbers",
    ar: "منو الشقق المكتملة",
    scope: "building",
    definition:
      "select displayNumber from Apartment where buildingId = B and constructionStatus in (COMPLETED, DELIVERED) order by floorNumber, unitNumber",
    nullable: false,
  },
  {
    key: "buildingCompletionPercentage",
    ar: "نسبة الإنجاز للبناية",
    scope: "building",
    definition: "completed ÷ total × 100",
    nullable: true,
    note: "بناية بلا شقق ← null لا 0%.",
  },
  {
    key: "residentsInApartment",
    ar: "عدد الأفراد في الشقة",
    scope: "apartment",
    definition: "count(ApartmentResident where apartmentId = A and isActive)",
    nullable: false,
  },
  {
    key: "apartmentsSubscribedToService",
    ar: "عدد الشقق المشتركة بهذه الخدمة",
    scope: "service",
    definition:
      "count(distinct apartmentId from Subscription where serviceId = S and status = ACTIVE)",
    nullable: false,
  },
  {
    key: "residentsSubscribedToService",
    ar: "عدد الأفراد المشتركين بهذه الخدمة",
    scope: "service",
    definition:
      "count(distinct residentUserId from Subscription where serviceId = S and status = ACTIVE and subjectType = RESIDENT)",
    nullable: false,
  },
  {
    key: "serviceSubscriptionPercentage",
    ar: "نسبة الاشتراك بالخدمة",
    scope: "service",
    definition: "subscribed apartments ÷ occupied apartments × 100",
    nullable: true,
    note: "مجمّع بلا شقق مسكونة ← null.",
  },
  {
    key: "expectedMonthlyRevenue",
    ar: "الإيراد الشهري المتوقّع للخدمة",
    scope: "service",
    definition:
      "Σ periodAmountIqd from Subscription where serviceId = S and status = ACTIVE — **مُطبَّعاً شهرياً**",
    nullable: false,
    note:
      "⚠️ تعريف §4.20 يرشّح billingCycle = MONTHLY فقط، فتسقط الاشتراكات الربعية والسنوية " +
      "ويرى المالك رقماً **أقل من الحقيقة** (‏Q45). التطبيع: ربعي ÷ 3 · سنوي ÷ 12.",
  },
  {
    key: "apartmentCurrentBalance",
    ar: "رصيد الشقة الحالي",
    scope: "apartment",
    definition: "Account.balanceIqd للحساب OPEN الخاص بالشقة",
    nullable: false,
    blockedBy: "B3",
    note:
      "التعريف يفترض حساباً مفتوحاً **واحداً بالمفرد**، وD1 يجعلهما اثنين (بيع وإيجار). " +
      "جمعهما يخلط ذمّتين ماليتين لشخصين. القرار B3.",
  },
  {
    key: "compoundTotalOutstanding",
    ar: "إجمالي المستحقات على المجمّع",
    scope: "compound",
    definition: "Σ balanceIqd from Account where status = OPEN and balanceIqd > 0",
    nullable: false,
    note:
      "هذا **إجمالي** لا فردي، فجمع كل الحسابات المفتوحة سليم ولا يتأثّر بـB3 — " +
      "الخلط المحرَّم هو جمع حسابَي شخصين في سطر واحد يُنسب لشقة.",
  },
  {
    key: "occupancyBreakdown",
    ar: "الشقق المشغولة / الفارغة",
    scope: "compound",
    definition: "group by occupancyStatus",
    nullable: false,
  },
]);

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  أرقام **مشتقّة** — ليست من §4.20.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── لماذا مصفوفة ثانية لا إضافةٌ إلى الأولى ─────────────────────────
 * ⚠️ `STATISTICS` أعلاه **أداة مطابقة للمواصفة**: اثنا عشر تعريفاً بعددها،
 * و`scripts/completeness-audit.ts` يتحقّق من العدد حرفياً. وإضافة أرقامنا
 * إليها كانت ستُفسد المعنى: يصير «١٥ من ١٢» ولا يعرف قارئها بعد سنة أيُّها
 * من المواصفة وأيُّها من عندنا.
 *
 * وهذه أرقام احتاجتها **لوحة المالك** ولا تعريف لها في §4.20. تعيش هنا
 * لا في الصفحة، لنفس السبب الذي يجعل الأولى هنا: رقمٌ يُحسب في شاشتين
 * يصير رقمين مختلفين عند أول تعديل، بلا فشل ولا تحذير.
 *
 * ⚠️ وليس فيها رقمٌ يحتاج قراراً محجوباً. «نسبة الإنجاز للمجمّع» توسيعٌ
 * لنطاق تعريفٍ قائم (‏`buildingCompletionPercentage`)، و«الإيراد المتوقّع
 * للمجمّع» جمعٌ لتعريفٍ قائم بنفس تطبيع `Q45`. وما يحتاج قراراً — رصيد
 * الشقة (‏B3) وقيمة المبيعات (‏Q30) — **ليس هنا**.
 */
export const DERIVED_STATISTICS: readonly StatisticDefinition[] = Object.freeze([
  {
    key: "compoundCompletionPercentage",
    ar: "نسبة الإنجاز على مستوى المجمّع",
    scope: "compound",
    definition:
      "count(Apartment where constructionStatus in (COMPLETED, DELIVERED)) ÷ count(Apartment) × 100",
    nullable: true,
    note:
      "نفس تعريف نسبة إنجاز البناية بنطاق أوسع، وبنفس معاملة DELIVERED: " +
      "التسليم يقع **بعد** الإنجاز لا بدلاً منه.",
  },
  {
    key: "constructionBreakdown",
    ar: "الشقق حسب حالة الإنشاء",
    scope: "compound",
    definition: "group by constructionStatus",
    nullable: false,
  },
  {
    key: "ownershipBreakdown",
    ar: "الشقق حسب حالة التملّك",
    scope: "compound",
    definition: "group by ownershipStatus",
    nullable: false,
  },
  {
    key: "activeContractsByType",
    ar: "العقود النشطة حسب النوع",
    scope: "compound",
    definition: "group by type from Contract where status = ACTIVE and deletedAt is null",
    nullable: false,
  },
  {
    key: "activeResidentsCount",
    ar: "عدد الساكنين فعلياً",
    scope: "compound",
    definition: "count(User where exists ApartmentResident with isActive = true)",
    nullable: false,
    note:
      "⚠️ **أشخاص لا ارتباطات.** عدّ صفوف ApartmentResident كان سيحتسب من " +
      "له ارتباطان مرّتين. ولا يُرشَّح بالدور: الحارس أو الفنّي المقيم ساكنٌ " +
      "فعلاً ويبقى STAFF بحكم Q41.",
  },
  {
    key: "debtorAccountsCount",
    ar: "عدد الحسابات المدينة",
    scope: "compound",
    definition: "count(Account where status = OPEN and balanceIqd > 0)",
    nullable: false,
    note:
      "يرافق «إجمالي المستحقات»: مبلغٌ كبير على حسابين حالةٌ، وعلى ثمانين " +
      "حالةٌ أخرى تماماً — والإجمالي وحده لا يفرّق بينهما.",
  },
  {
    key: "compoundExpectedMonthlyRevenue",
    ar: "الإيراد الشهري المتوقّع من الخدمات",
    scope: "compound",
    definition:
      "Σ periodAmountIqd from Subscription where status = ACTIVE — **مُطبَّعاً شهرياً**",
    nullable: false,
    note:
      "نفس تطبيع Q45 المستعمل لكل خدمة (ربعي ÷ 3 · سنوي ÷ 12)، مجموعاً على " +
      "الخدمات كلها. **تقدير للعرض لا قيد في دفتر** — قسمة BigInt تقتطع الكسر.",
  },
]);

/**
 * فحص اكتمال التعريفات — يستدعيه التدقيق والاختبار.
 *
 * ⚠️ `total` يعدّ **§4.20 وحدها** كي يبقى فحص المطابقة صالحاً؛ والمشتقّة
 * تُعَدّ منفصلةً. أما فحص التكرار فيشمل الاثنتين: مفتاحٌ واحد لمعنيين هو
 * العيب نفسه الذي وُجد هذا الملف لمنعه، ولا يهمّ في أي مصفوفة وقع.
 */
export function auditStatistics(): {
  total: number;
  derived: number;
  duplicateKeys: string[];
  blocked: string[];
} {
  const seen = new Set<string>();
  const duplicateKeys: string[] = [];
  for (const s of [...STATISTICS, ...DERIVED_STATISTICS]) {
    if (seen.has(s.key)) duplicateKeys.push(s.key);
    seen.add(s.key);
  }
  return {
    total: STATISTICS.length,
    derived: DERIVED_STATISTICS.length,
    duplicateKeys,
    blocked: STATISTICS.filter((s) => s.blockedBy).map((s) => s.key),
  };
}
