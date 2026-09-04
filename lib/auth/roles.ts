/**
 * الأدوار ومصفوفة الصلاحيات (‏§3).
 *
 * ── لماذا المصفوفة **بيانات** لا شروط متناثرة ────────────────────────
 * §3.2 يعرّف 23 قدرة × 4 أدوار = 92 خلية. لو تُرجمت إلى `if` في ستّين
 * موضعاً لاستحال التحقّق من أن أحداً لم يُخطئ خليةً واحدة. هنا هي جدول
 * واحد، والاختبار يؤكّد أن **كل** خلية معرَّفة صراحةً.
 *
 * ── تصحيح `S2` / `D3` مطبَّق ──────────────────────────────────────────
 * المصفوفة الأصلية تعطي `OWNER` قيمة **F** على الكيانات التشغيلية (العقود
 * والاشتراكات والدفتر والفواتير والسيارات وخطط الأقساط…) بينما تعطيه **R**
 * على العمليات (تسجيل دفعة · تغيير سكن · إصدار باج). والنثر في §3.3 ينصّ أن
 * المالك «قراءة فقط على العمليات». الخلايا لم تُراجَع مقابل النثر.
 *
 * القرار الملزم: **المالك قراءة كاملة + تصدير** على كل العمليات والكيانات
 * التشغيلية، **باستثناءين كتابيين مؤكَّدين**:
 *   1. `COMPOUND_SETTINGS` — المصفوفة نفسها تعطيه F.
 *   2. `USERS_AND_ROLES`   — §3.1 «حساب الأدمن يُنشئه المالك» · §7.1/2 · R1.
 *      بدونه **لا يوجد مسار إقلاع للنظام إطلاقاً**.
 *
 * نحتفظ بالقيمة الأصلية في `specValue` لتبقى المراجعة ممكنة: من يقرأ الكود
 * يرى ما قالته المواصفة وما نُفِّذ ولماذا اختلفا.
 */

/** الأدوار الأربعة. المستخدم يحمل **دوراً واحداً** بالضبط (‏§3.1). */
export const USER_ROLES = ["OWNER", "ADMIN", "STAFF", "RESIDENT"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const ROLE_LABELS_AR: Record<UserRole, string> = {
  OWNER: "المالك",
  ADMIN: "الأدمن",
  STAFF: "الموظف",
  RESIDENT: "الساكن",
};

/** المسار الافتراضي بعد الدخول لكل دور (‏§9.1 · الخطوة 0.11). */
export const ROLE_HOME: Record<UserRole, string> = {
  OWNER: "/owner",
  ADMIN: "/admin",
  STAFF: "/staff",
  RESIDENT: "/app",
};

/**
 * مستوى الوصول.
 *
 * `FULL`  = إنشاء + قراءة + تعديل + حذف/أرشفة
 * `WRITE` = إنشاء + تعديل، **بلا حذف** (‏§3.3: «الموظف لا يحذف أبداً»)
 * `READ`  = قراءة كل الصفوف
 * `OWN`   = صفوفه هو فقط؛ والكتابة إن وُجدت تكون **بنظام الطلب** (‏§3.3)
 * `NONE`  = لا وصول
 */
export type AccessLevel = "NONE" | "OWN" | "READ" | "WRITE" | "FULL";

/** القدرات الثلاث والعشرون كما في §3.2، بالترتيب نفسه. */
export const CAPABILITIES = [
  "COMPOUND_SETTINGS",
  "BUILDINGS",
  "APARTMENTS",
  "APARTMENT_OCCUPANCY",
  "USERS_AND_ROLES",
  "RESIDENT_PROFILES",
  "APARTMENT_RESIDENT_LINKS",
  "CONTRACTS",
  "SERVICES_CATALOGUE",
  "SUBSCRIPTIONS",
  "LEDGER_AND_ACCOUNTS",
  "RECORD_CASH_PAYMENT",
  "CREATE_PAYMENT_LINK",
  "INVOICES",
  "INSTALLMENT_PLANS",
  "VEHICLES",
  "BADGES",
  "DEPARTMENTS_SKILLS_STAFF",
  "VENDORS",
  "SERVICE_REQUESTS",
  "FINANCIAL_REPORTS",
  "AUDIT_LOG",
  "NOTIFICATIONS_LOG",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export const CAPABILITY_LABELS_AR: Record<Capability, string> = {
  COMPOUND_SETTINGS: "إعدادات المجمّع",
  BUILDINGS: "البنايات والطوابق",
  APARTMENTS: "الشقق (إنشاء وترقيم وحالة)",
  APARTMENT_OCCUPANCY: "تغيير حالة سكن الشقة",
  USERS_AND_ROLES: "المستخدمون والأدوار",
  RESIDENT_PROFILES: "ملفات السكان ومستندات الهوية",
  APARTMENT_RESIDENT_LINKS: "ربط الشقة بالسكان",
  CONTRACTS: "العقود",
  SERVICES_CATALOGUE: "كتالوج الخدمات",
  SUBSCRIPTIONS: "الاشتراكات",
  LEDGER_AND_ACCOUNTS: "الدفتر والحسابات",
  RECORD_CASH_PAYMENT: "تسجيل دفعة نقدية",
  CREATE_PAYMENT_LINK: "إنشاء رابط دفع",
  INVOICES: "الفواتير",
  INSTALLMENT_PLANS: "خطط الأقساط",
  VEHICLES: "السيارات",
  BADGES: "الباجات (إصدار وإلغاء)",
  DEPARTMENTS_SKILLS_STAFF: "الأقسام والمهارات والموظفون",
  VENDORS: "البائعون",
  SERVICE_REQUESTS: "الطلبات والشكاوى",
  FINANCIAL_REPORTS: "التقارير المالية والمؤشّرات",
  AUDIT_LOG: "سجل التدقيق",
  NOTIFICATIONS_LOG: "سجل الإخطارات",
};

export interface Cell {
  /** المستوى المُنفَّذ فعلاً بعد تصحيحَي `S2`/`D3`. */
  level: AccessLevel;
  /** القيمة الحرفية في مصفوفة §3.2 — للمراجعة والتتبّع. */
  specValue: string;
  /** هل يملك التصدير؟ `F` للمالك تعني «قراءة كاملة + تصدير» (‏D3/2). */
  canExport?: true;
  /** كتابة الساكن تمرّ بنظام الطلب لا مباشرةً (‏§3.3). */
  requestBased?: true;
  /** نطاق أضيق من الدور: التكليف الفعلي أو الملف الشخصي. */
  scope?: "assigned" | "own-profile";
  /** سبب اختلاف `level` عن `specValue`. */
  correction?: string;
}

type Matrix = Record<Capability, Record<UserRole, Cell>>;

const CORRECTION_S2 =
  "S2/D3: المالك قراءة + تصدير على الكيانات التشغيلية — الخلية كانت F والنثر في §3.3 يقول «قراءة فقط على العمليات».";

/**
 * المصفوفة الفعّالة. **كل خلية مذكورة صراحةً** — لا افتراضات ولا قيم ضمنية،
 * لأن خليّة منسية تعني صلاحية غير محدَّدة.
 */
export const PERMISSION_MATRIX: Matrix = {
  COMPOUND_SETTINGS: {
    // ✅ استثناء كتابي أول للمالك — المصفوفة نفسها تعطيه F.
    OWNER: { level: "FULL", specValue: "F", canExport: true },
    ADMIN: { level: "READ", specValue: "R" },
    STAFF: { level: "NONE", specValue: "—" },
    RESIDENT: { level: "NONE", specValue: "—" },
  },
  BUILDINGS: {
    OWNER: { level: "READ", specValue: "F", canExport: true, correction: CORRECTION_S2 },
    ADMIN: { level: "FULL", specValue: "F" },
    STAFF: { level: "READ", specValue: "R" },
    RESIDENT: { level: "NONE", specValue: "—" },
  },
  APARTMENTS: {
    OWNER: { level: "READ", specValue: "F", canExport: true, correction: CORRECTION_S2 },
    ADMIN: { level: "FULL", specValue: "F" },
    STAFF: { level: "READ", specValue: "R" },
    RESIDENT: { level: "OWN", specValue: "R (own)" },
  },
  APARTMENT_OCCUPANCY: {
    // عملية لا كيان — المصفوفة أصلاً تعطي المالك R، متّسقة مع §3.3.
    OWNER: { level: "READ", specValue: "R", canExport: true },
    ADMIN: { level: "FULL", specValue: "F" },
    STAFF: { level: "WRITE", specValue: "W" },
    RESIDENT: { level: "NONE", specValue: "—" },
  },
  USERS_AND_ROLES: {
    // ✅ استثناء كتابي ثانٍ — بدونه لا مسار إقلاع للنظام (‏§3.1 · §7.1/2 · R1).
    OWNER: { level: "FULL", specValue: "F" },
    // «F عدا OWNER»: الأدمن لا يُنشئ ولا يعدّل مالكاً.
    ADMIN: { level: "FULL", specValue: "F (except OWNER)" },
    STAFF: { level: "NONE", specValue: "—" },
    RESIDENT: { level: "NONE", specValue: "—" },
  },
  RESIDENT_PROFILES: {
    OWNER: { level: "READ", specValue: "R", canExport: true },
    ADMIN: { level: "FULL", specValue: "F" },
    STAFF: { level: "READ", specValue: "R", scope: "assigned" },
    RESIDENT: { level: "OWN", specValue: "O (own, read + request change)", requestBased: true },
  },
  APARTMENT_RESIDENT_LINKS: {
    OWNER: { level: "READ", specValue: "F", canExport: true, correction: CORRECTION_S2 },
    ADMIN: { level: "FULL", specValue: "F" },
    STAFF: { level: "WRITE", specValue: "W" },
    RESIDENT: { level: "OWN", specValue: "R (own)" },
  },
  CONTRACTS: {
    OWNER: { level: "READ", specValue: "F", canExport: true, correction: CORRECTION_S2 },
    ADMIN: { level: "FULL", specValue: "F" },
    STAFF: { level: "READ", specValue: "R", scope: "assigned" },
    RESIDENT: { level: "OWN", specValue: "R (own)" },
  },
  SERVICES_CATALOGUE: {
    OWNER: { level: "READ", specValue: "F", canExport: true, correction: CORRECTION_S2 },
    ADMIN: { level: "FULL", specValue: "F" },
    STAFF: { level: "READ", specValue: "R" },
    RESIDENT: { level: "READ", specValue: "R (available ones)" },
  },
  SUBSCRIPTIONS: {
    OWNER: { level: "READ", specValue: "F", canExport: true, correction: CORRECTION_S2 },
    ADMIN: { level: "FULL", specValue: "F" },
    STAFF: { level: "WRITE", specValue: "W" },
    RESIDENT: {
      level: "OWN",
      specValue: "R (own) + request subscribe/unsubscribe",
      requestBased: true,
    },
  },
  LEDGER_AND_ACCOUNTS: {
    OWNER: { level: "READ", specValue: "F", canExport: true, correction: CORRECTION_S2 },
    ADMIN: { level: "FULL", specValue: "F" },
    STAFF: { level: "READ", specValue: "R (assigned)", scope: "assigned" },
    RESIDENT: { level: "OWN", specValue: "R (own)" },
  },
  RECORD_CASH_PAYMENT: {
    OWNER: { level: "READ", specValue: "R", canExport: true },
    ADMIN: { level: "FULL", specValue: "F" },
    // ⚠️ مقيَّدة إضافياً بعلم `canReceiveCash` — القرار B4. راجع lib/auth/cash.ts
    STAFF: { level: "WRITE", specValue: "W" },
    RESIDENT: { level: "NONE", specValue: "—" },
  },
  CREATE_PAYMENT_LINK: {
    OWNER: { level: "READ", specValue: "R", canExport: true },
    ADMIN: { level: "FULL", specValue: "F" },
    STAFF: { level: "WRITE", specValue: "W" },
    RESIDENT: { level: "OWN", specValue: "W (own dues)", requestBased: true },
  },
  INVOICES: {
    OWNER: { level: "READ", specValue: "F", canExport: true, correction: CORRECTION_S2 },
    ADMIN: { level: "FULL", specValue: "F" },
    STAFF: { level: "READ", specValue: "R", scope: "assigned" },
    RESIDENT: { level: "OWN", specValue: "R (own)" },
  },
  INSTALLMENT_PLANS: {
    OWNER: { level: "READ", specValue: "F", canExport: true, correction: CORRECTION_S2 },
    ADMIN: { level: "FULL", specValue: "F" },
    STAFF: { level: "WRITE", specValue: "W (follow-up + mark paid)", scope: "assigned" },
    RESIDENT: { level: "OWN", specValue: "R (own)" },
  },
  VEHICLES: {
    OWNER: { level: "READ", specValue: "F", canExport: true, correction: CORRECTION_S2 },
    ADMIN: { level: "FULL", specValue: "F" },
    STAFF: { level: "WRITE", specValue: "W" },
    RESIDENT: {
      level: "OWN",
      specValue: "W (own — pending admin approval)",
      requestBased: true,
    },
  },
  BADGES: {
    OWNER: { level: "READ", specValue: "R", canExport: true },
    ADMIN: { level: "FULL", specValue: "F" },
    STAFF: { level: "WRITE", specValue: "W" },
    RESIDENT: { level: "OWN", specValue: "R (own)" },
  },
  DEPARTMENTS_SKILLS_STAFF: {
    OWNER: { level: "READ", specValue: "F", canExport: true, correction: CORRECTION_S2 },
    ADMIN: { level: "FULL", specValue: "F" },
    /*
     * ⚠️ **`level: "READ"` مع `specValue` يمنح الكتابة — والفارق مقصود الآن.**
     *
     * المستوى في هذه المصفوفة يسري على **كل الصفوف**. ورفع الموظف إلى
     * `WRITE` كان سيمنحه تعديل كل الموظفين والأقسام والمهارات — تجاوزاً
     * هائلاً لـ«ملفّه هو». و`OWN` لا يمنح كتابةً أصلاً (‏`LEVEL_ACTIONS`).
     *
     * فنصف «‏W على ملفّه» مُنفَّذ **خارج المصفوفة** بنطاق بنيويّ:
     * `lib/services/staff-self.ts` يكتب `isAvailable` لصاحب الجلسة وحده،
     * ومعرِّفه من الجلسة لا من مُدخل المتصل. مُختبَر في
     * `tests/integration/staff-self.test.ts`.
     *
     * وبقيّة الملفّ (نوع التوظيف · القسم · المهارات) تبقى `READ` للموظف:
     * تلك قرارات إدارة لا يقرّرها عن نفسه.
     */
    STAFF: {
      level: "READ",
      specValue: "R (own profile W)",
      scope: "own-profile",
      correction:
        "نصف «الكتابة على الملفّ» مُنفَّذ بنطاق بنيويّ خارج المصفوفة " +
        "(‏lib/services/staff-self.ts) — يقتصر على isAvailable لصاحب الجلسة، " +
        "لأن مستوى المصفوفة يسري على كل الصفوف ولا يعرف «صفّي أنا».",
    },
    RESIDENT: { level: "NONE", specValue: "—" },
  },
  VENDORS: {
    OWNER: { level: "READ", specValue: "F", canExport: true, correction: CORRECTION_S2 },
    ADMIN: { level: "FULL", specValue: "F" },
    STAFF: { level: "READ", specValue: "R" },
    RESIDENT: { level: "NONE", specValue: "—" },
  },
  SERVICE_REQUESTS: {
    OWNER: { level: "READ", specValue: "R", canExport: true },
    ADMIN: { level: "FULL", specValue: "F" },
    STAFF: { level: "WRITE", specValue: "W (assigned)", scope: "assigned" },
    RESIDENT: { level: "OWN", specValue: "O (create + follow own)" },
  },
  FINANCIAL_REPORTS: {
    // التقارير ليست عملية — المالك كامل عليها بنصّ D3 «كامل على الإعدادات والتقارير».
    OWNER: { level: "FULL", specValue: "F", canExport: true },
    ADMIN: { level: "READ", specValue: "R" },
    STAFF: { level: "NONE", specValue: "—" },
    RESIDENT: { level: "NONE", specValue: "—" },
  },
  AUDIT_LOG: {
    OWNER: { level: "READ", specValue: "R", canExport: true },
    ADMIN: { level: "READ", specValue: "R" },
    STAFF: { level: "NONE", specValue: "—" },
    RESIDENT: { level: "NONE", specValue: "—" },
  },
  NOTIFICATIONS_LOG: {
    OWNER: { level: "READ", specValue: "R", canExport: true },
    // تصحيح T7: §8.2/13 يمنح الأدمن زرّ «إعادة المحاولة» وهي كتابة.
    // تُنفَّذ كصلاحية كتابة **محدودة على Notification وحده** ولا تشمل المحتوى.
    ADMIN: {
      level: "WRITE",
      specValue: "R",
      correction: "T7: إعادة إرسال الإخطار فعل كتابي، والمصفوفة تعطي R بينما §8.2/13 يمنح الزر.",
    },
    STAFF: { level: "NONE", specValue: "—" },
    RESIDENT: { level: "NONE", specValue: "—" },
  },
};

// ── الاستعلام عن الصلاحية ──────────────────────────────────────────────

export type Action = "read" | "create" | "update" | "delete" | "export";

const LEVEL_ACTIONS: Record<AccessLevel, ReadonlySet<Action>> = {
  NONE: new Set(),
  OWN: new Set<Action>(["read"]),
  READ: new Set<Action>(["read"]),
  WRITE: new Set<Action>(["read", "create", "update"]),
  FULL: new Set<Action>(["read", "create", "update", "delete"]),
};

export function cell(role: UserRole, capability: Capability): Cell {
  return PERMISSION_MATRIX[capability][role];
}

/** هل يملك الدور هذا الفعل على هذه القدرة؟ */
export function can(role: UserRole, capability: Capability, action: Action): boolean {
  const c = cell(role, capability);
  if (action === "export") return c.canExport === true || c.level === "FULL";
  return LEVEL_ACTIONS[c.level].has(action);
}

/**
 * أدوار **القراءة** — يحكم بها `layout.tsx` لكل مجموعة مسارات.
 *
 * أثر `D3/1`: الطبقتان تحكمان **بمعيارين مختلفين**، وخلطهما هو ما يجعل
 * مصفوفة §3.2 تبدو متناقضة. الـlayout يسمح بالعرض لمن يقرأ (فيدخل `OWNER`
 * إلى `(admin)` كما في §9.1)، والـaction الكتابي يحكم بأدوار الكتابة وحدها.
 */
export function rolesThatCanRead(capability: Capability): UserRole[] {
  return USER_ROLES.filter((r) => can(r, capability, "read"));
}

/** أدوار **الكتابة** — يحكم بها كل Server Action كتابي. */
export function rolesThatCanWrite(capability: Capability): UserRole[] {
  return USER_ROLES.filter(
    (r) => can(r, capability, "create") || can(r, capability, "update"),
  );
}

/** هل وصول هذا الدور مقصور على صفوفه هو؟ (يستوجب مرشّح نطاق إلزامياً) */
export function isOwnScoped(role: UserRole, capability: Capability): boolean {
  return cell(role, capability).level === "OWN";
}

/** هل كتابة هذا الدور تمرّ بنظام الطلب لا مباشرةً؟ (‏§3.3) */
export function isRequestBased(role: UserRole, capability: Capability): boolean {
  return cell(role, capability).requestBased === true;
}

/**
 * الأفعال العملياتية التي **يُمنع المالك منها صراحةً** (‏D3/2).
 * قائمة مغلقة يختبرها اختبار مستقل — لأن «قراءة فقط» بلا قائمة صريحة
 * تتآكل مع أول شاشة جديدة.
 */
export const OWNER_FORBIDDEN_OPERATIONS: readonly Capability[] = Object.freeze([
  "RECORD_CASH_PAYMENT",
  "LEDGER_AND_ACCOUNTS",
  "CONTRACTS",
  "APARTMENT_OCCUPANCY",
  "BADGES",
  "SUBSCRIPTIONS",
  "SERVICE_REQUESTS",
]);

/**
 * من يجوز له إنشاء حساب بأي دور — وبالتبعية تفعيله وتعطيله (‏§3.2).
 *
 * ── لماذا هنا لا داخل `lib/actions/users.ts` ────────────────────────
 * ملف الأفعال يحمل `"use server"`، فلا يُصدَّر منه إلا دوال غير متزامنة.
 * كانت نتيجة ذلك أن نموذجَ الإنشاء في الواجهة يعيد بناء القائمة بيده —
 * فسقط منه أن **المالك يستطيع إنشاء مالك**، وظلّ الخيار مخفيّاً بلا
 * سبب بينما الخادم يقبله. مصدر واحد يقرأه الطرفان يمنع هذا الانفصال.
 *
 * ⚠️ إخفاء الخيار من القائمة تحسينُ تجربة لا حماية. الحدّ الحقيقي هو
 * فحص الخادم في `createUser`، ويبقى قائماً بمعزل عن الواجهة.
 */
export const CAN_CREATE_ROLES: Readonly<Record<UserRole, readonly UserRole[]>> =
  Object.freeze({
    OWNER: Object.freeze(["OWNER", "ADMIN", "STAFF", "RESIDENT"]),
    ADMIN: Object.freeze(["ADMIN", "STAFF", "RESIDENT"]),
    STAFF: Object.freeze([]),
    RESIDENT: Object.freeze([]),
  } as Record<UserRole, readonly UserRole[]>);
