/**
 * ═══════════════════════════════════════════════════════════════════════
 *  قوائم التنقّل — مصدر واحد لكل دور.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── لماذا هنا لا داخل كل `layout.tsx` ───────────────────────────────
 * ⚠️ كانت القوائم مكتوبة في التخطيطات الأربعة، وفيها **23 رابطاً يعطي
 * 404**: شاشات كُتبت أسماؤها قبل أن تُبنى. القشرة تبدو معطوبة، والمستخدم
 * يتعلّم أن نصف الروابط لا تعمل فيكفّ عن تجربتها.
 *
 * وجودها في وحدة واحدة يجعلها **قابلة للفحص**: اختبار في
 * `tests/unit/nav.test.ts` يقارن كل رابط بصفحة موجودة فعلاً، ويمنع
 * الانحراف في الاتجاهين — رابطاً لصفحة غير موجودة، وصفحةً مبنيّة لا يشير
 * إليها شيء فلا يجدها أحد.
 *
 * ── قاعدة الإضافة ──────────────────────────────────────────────────
 * **يُضاف الرابط مع الصفحة، لا قبلها.** ما ينتظر قراراً أو خطوة لاحقة
 * مسجَّل في `docs/EXECUTION-ROADMAP.md` — وهو موضعه، لا شريط التنقّل.
 */

/**
 * مفاتيح الأيقونات المسموحة.
 *
 * ⚠️ اتحاد نصّي لا `string`: مفتاح مكتوب خطأً يُوقف الترجمة بدل أن يُنتج
 * فراغاً في الشريط لا يلاحظه أحد.
 */
export type NavIconKey =
  | "dashboard"
  | "users"
  | "buildings"
  | "apartments"
  | "residents"
  | "contracts"
  | "services"
  | "staff"
  | "tasks"
  | "wallet"
  | "profile";

export interface NavItem {
  href: string;
  label: string;
  /**
   * **مفتاح** الأيقونة لا الأيقونة نفسها.
   *
   * ⚠️ **هذا الفرق ليس أسلوبياً — بدونه ينكسر التطبيق.**
   * كان الحقل يحمل `LucideIcon` (دالّة مكوّن)، وهذه الوحدة يقرأها
   * `AppShell` وهو **مكوّن خادم**، ويمرّرها إلى `NavLinks` وهو **مكوّن
   * عميل**. والدوالّ لا تُسلسَل عبر حدّ الخادم/العميل في React Server
   * Components، فيرمي:
   *   «Functions cannot be passed directly to Client Components».
   *
   * المفتاح نصّ، والنصّ يعبر. والخريطة `مفتاح ← مكوّن` تعيش داخل مكوّن
   * العميل حيث لا حدّ يُعبَر.
   *
   * ⚠️ **وليست زينة.** شريطٌ من عشرة عناوين نصّية يُقرأ سطراً سطراً في
   * كل مرّة؛ والأيقونة تُتعرَّف بلمحة بعد أول استعمالين.
   */
  icon: NavIconKey;

  /**
   * عنوان المجموعة التي يقع فيها البند.
   *
   * ⚠️ **ثمانية بنود في قائمة واحدة تُقرأ سطراً سطراً.** الشريط كان
   * كتلةً واحدة تحت عنوان «القائمة» — وهو عنوان لا يقول شيئاً. البحث
   * البصري في قائمة مسطّحة خطّيّ: العين تمرّ على كل بند حتى تجد المقصود.
   * والتجميع يجعله سلّمياً: تُختار المجموعة أولاً ثم البند داخلها،
   * فيهبط عدد ما تفحصه العين من ثمانية إلى ثلاثة.
   *
   * البنود المتجاورة في نفس المجموعة **تبقى متجاورة**: الترتيب هنا هو
   * ترتيب العرض، والشريط لا يُعيد فرزه.
   */
  group: string;
}

/** لوحة الإدارة (‏§9.1). المالك يدخلها للعرض بحكم D3/1. */
export const ADMIN_NAV: readonly NavItem[] = Object.freeze([
  { group: "المتابعة", icon: "dashboard", href: "/admin", label: "مهام اليوم" },
  { group: "المتابعة", icon: "tasks", href: "/admin/requests", label: "الطلبات والشكاوى" },

  // الأصول العقارية: ما يُملَك ويُبنى
  { group: "الأصول", icon: "buildings", href: "/admin/buildings", label: "البنايات" },
  { group: "الأصول", icon: "apartments", href: "/admin/apartments", label: "الشقق" },

  // من يسكن ومن يعمل ومن يدخل النظام
  { group: "الناس", icon: "residents", href: "/admin/residents", label: "السكان" },
  { group: "الناس", icon: "staff", href: "/admin/staff", label: "الموظفون" },
  { group: "الناس", icon: "tasks", href: "/admin/departments", label: "الأقسام والمهامّ" },
  { group: "الناس", icon: "users", href: "/admin/users", label: "المستخدمون" },

  // ما يُتعاقَد عليه ويُفوتَر
  { group: "التعاقد", icon: "contracts", href: "/admin/contracts", label: "العقود" },
  { group: "التعاقد", icon: "services", href: "/admin/services", label: "الخدمات" },
  { group: "التعاقد", icon: "tasks", href: "/admin/subscriptions", label: "الاشتراكات" },
  { group: "المال", icon: "wallet", href: "/admin/installments", label: "متابعة الأقساط" },

  // المال — B4 والخطوة 3.1. القبض يحتاج صلاحية صريحة، والشاشة تقول ذلك
  // لمن لا يملكها بدل أن تعرض زرّاً يفشل.
  { group: "المال", icon: "wallet", href: "/admin/cash", label: "صندوق النقد" },
]);

/** لوحة المالك — عرض فقط (‏D3/2). */
export const OWNER_NAV: readonly NavItem[] = Object.freeze([
  { group: "المتابعة", icon: "dashboard", href: "/owner", label: "المؤشّرات" },
  // ⚠️ المالك يقرأ شاشات الإدارة نفسها بحكم D3/1، ولا تُبنى له نسخة ثانية
  // منها: نسختان لنفس الجدول تتفرّقان عند أول تعديل.
  { group: "السجلّات", icon: "apartments", href: "/admin/apartments", label: "الشقق" },
  { group: "السجلّات", icon: "contracts", href: "/admin/contracts", label: "العقود" },
  { group: "السجلّات", icon: "users", href: "/admin/users", label: "المستخدمون" },
]);

/** لوحة الموظف — نطاقه المُكلَّف به وحده (‏D4). */
export const STAFF_NAV: readonly NavItem[] = Object.freeze([
  /**
 * ⚠️ **التسمية «طلباتي» كانت تكذب.** الطلبات تُبنى في الخطوة 4.4، والصفحة
 * تعرض ملفّه الوظيفي ومهاراته ومهام قسمه — لا طلبات. والموظف الذي يفتح
 * «طلباتي» فيجد ملفّه يظنّ النظام معطوباً.
 */
  { group: "عملي", icon: "tasks", href: "/staff", label: "مساحة عملي" },
]);

/** بوّابة الساكن (‏§8.3). */
/**
 * ⚠️ **ثلاث مجموعات لا قائمة واحدة.** عشرة بنود متتالية بلا عناوين تُقرأ
 * كوماً، ويصير الوصول إلى «سيارتي» بحثاً بالعين في كل مرّة.
 *
 * والترتيب يتبع ما يُفتح كثيراً: المال أوّلاً — الرصيد والفواتير والأقساط
 * هي ما يُسأل عنه شهرياً؛ ثم البيت؛ ثم الحساب الشخصي.
 */
export const RESIDENT_NAV: readonly NavItem[] = Object.freeze([
  { group: "حسابي", icon: "dashboard", href: "/app", label: "الرئيسية" },

  { group: "المال", icon: "wallet", href: "/app/account", label: "كشف حسابي" },
  { group: "المال", icon: "tasks", href: "/app/subscriptions", label: "اشتراكاتي" },
  { group: "المال", icon: "contracts", href: "/app/invoices", label: "الفواتير" },
  { group: "المال", icon: "wallet", href: "/app/installments", label: "الأقساط" },

  { group: "بيتي", icon: "residents", href: "/app/household", label: "أفراد الشقة" },
  { group: "بيتي", icon: "apartments", href: "/app/vehicles", label: "سيارتي" },
  { group: "بيتي", icon: "tasks", href: "/app/requests", label: "طلباتي وشكاواي" },

  { group: "حسابي الشخصي", icon: "profile", href: "/app/profile", label: "ملفي" },
]);

/** كل القوائم — يقرأها اختبار الاتساق. */
export const ALL_NAVS = Object.freeze({
  ADMIN_NAV,
  OWNER_NAV,
  STAFF_NAV,
  RESIDENT_NAV,
});
