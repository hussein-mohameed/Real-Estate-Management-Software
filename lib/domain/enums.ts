/**
 * قيم المجال المعدودة (‏§4 · §5).
 *
 * ── لماذا تُعرَّف هنا لا في `schema.prisma` وحده ───────────────────────
 * كل قيمة enum تحتاج **تسمية عربية** (‏§2.4: «التسميات العربية في ملف واحد
 * `lib/labels.ts`»). ولو عُرِّفت الأسماء في مكان والتسميات في مكان آخر بلا
 * رابط نوعي، لأمكن إضافة قيمة enum بلا تسمية فتظهر `SCREAMING_SNAKE` في
 * واجهة عربية.
 *
 * الحلّ: تُعرَّف القيم هنا مصدراً واحداً، وتُشتقّ منها الأنواع، ويُجبر
 * `Record<T, string>` على الشمول. و`npm run audit:completeness` يؤكّد أن
 * `schema.prisma` يطابق هذا الملف قيمةً بقيمة — فلا يتفرّق المصدران.
 *
 * ── التصحيحات المطبَّقة ───────────────────────────────────────────────
 * • `TenureType` **محذوف** — `Apartment.tenureType` محور رابع لا تقرأه أي
 *   قاعدة ولا تدفق، ويُشتقّ من نوع العقد النشط (‏Q33). و20-schema يوجب حذف
 *   أي قيمة enum لا ينتجها مسار كود.
 * • `ResidentRelation.CONTRACT_HOLDER` **محذوف** — يكرّر `isContractHolder`
 *   على نفس الصف ويمكن أن يناقضه (‏Q32). القرابة وحدها تبقى.
 * • `SubscriptionSubjectType` **مفصول** إلى `ServiceAppliesTo` (بـ`BOTH`)
 *   و`SubscriptionSubjectType` (بلا `BOTH`) — لأن مجالَي القيم مختلفان (‏Q6).
 * • `LedgerSource.OPENING` **مضاف** — للأرصدة الافتتاحية عند الترحيل (‏N3).
 * • `LedgerEntryType.ADJUSTMENT` **يبقى في الـenum** مطابقةً لـ§5، لكن
 *   **مسار الكتابة يرفضه** (‏D2/4). التسوية قيد `CHARGE`/`PAYMENT` بمصدر
 *   `MANUAL` وسبب إلزامي. قرار قابل للعكس بلا migration.
 * • `RequestScope` **جديد** — شكوى المنطقة المشتركة (‏Q35).
 * • `ResidentRequestKind`/`Status` **جديدان** — مسارات طلب الساكن الثلاثة (‏Q37).
 * • `CounterKind` **جديد** — الترقيم السنوي (‏Q17).
 */

// ── الهوية والأدوار ────────────────────────────────────────────────────

export const GENDER = ["MALE", "FEMALE"] as const;
export type Gender = (typeof GENDER)[number];

export const EMPLOYMENT_TYPE = ["INTERNAL", "FREELANCE", "VENDOR"] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPE)[number];

export const SKILL_LEVEL = ["BEGINNER", "INTERMEDIATE", "ADVANCED", "EXPERT"] as const;
export type SkillLevel = (typeof SKILL_LEVEL)[number];

// ── العقار ─────────────────────────────────────────────────────────────

export const NUMBERING_SCHEME = ["SEQUENTIAL", "PER_FLOOR"] as const;
export type NumberingScheme = (typeof NUMBERING_SCHEME)[number];

export const CONSTRUCTION_STATUS = ["UNDER_CONSTRUCTION", "COMPLETED", "DELIVERED"] as const;
export type ConstructionStatus = (typeof CONSTRUCTION_STATUS)[number];

export const OWNERSHIP_STATUS = ["UNSOLD", "SOLD", "RENTED_BY_COMPANY"] as const;
export type OwnershipStatus = (typeof OWNERSHIP_STATUS)[number];

export const OCCUPANCY_STATUS = [
  "VACANT",
  "OCCUPIED_BY_OWNER",
  "OCCUPIED_BY_TENANT",
] as const;
export type OccupancyStatus = (typeof OCCUPANCY_STATUS)[number];

/** القرابة وحدها — `CONTRACT_HOLDER` محذوف (‏Q32)، والدور يحمله `isContractHolder`. */
export const RESIDENT_RELATION = ["FAMILY_MEMBER", "OTHER"] as const;
export type ResidentRelation = (typeof RESIDENT_RELATION)[number];

// ── العقود والأقساط ────────────────────────────────────────────────────

export const CONTRACT_TYPE = ["SALE", "RENTAL"] as const;
export type ContractType = (typeof CONTRACT_TYPE)[number];

export const CONTRACT_STATUS = ["DRAFT", "ACTIVE", "EXPIRED", "TERMINATED"] as const;
export type ContractStatus = (typeof CONTRACT_STATUS)[number];

export const PAYMENT_TYPE = ["FULL", "INSTALLMENTS"] as const;
export type PaymentType = (typeof PAYMENT_TYPE)[number];

export const PLAN_STATUS = ["ACTIVE", "COMPLETED", "CANCELLED"] as const;
export type PlanStatus = (typeof PLAN_STATUS)[number];

export const INSTALLMENT_STATUS = ["PENDING", "PAID", "OVERDUE", "CANCELLED"] as const;
export type InstallmentStatus = (typeof INSTALLMENT_STATUS)[number];

// ── الخدمات والاشتراكات ────────────────────────────────────────────────

export const SERVICE_BILLING_TYPE = ["RECURRING", "ONE_TIME"] as const;
export type ServiceBillingType = (typeof SERVICE_BILLING_TYPE)[number];

export const BILLING_CYCLE = ["MONTHLY", "QUARTERLY", "YEARLY"] as const;
export type BillingCycle = (typeof BILLING_CYCLE)[number];

export const PRICING_MODEL = ["FLAT", "PER_UNIT", "PER_PERSON"] as const;
export type PricingModel = (typeof PRICING_MODEL)[number];

export const PAYER_TYPE = ["OWNER", "OCCUPANT"] as const;
export type PayerType = (typeof PAYER_TYPE)[number];

/** ما يمكن أن تُربط به الخدمة — يقبل `BOTH` (‏Q6). */
export const SERVICE_APPLIES_TO = ["APARTMENT", "RESIDENT", "BOTH"] as const;
export type ServiceAppliesTo = (typeof SERVICE_APPLIES_TO)[number];

/** موضوع الاشتراك الفعلي — **لا يجوز أن يكون `BOTH` أبداً** (‏Q6). */
export const SUBSCRIPTION_SUBJECT_TYPE = ["APARTMENT", "RESIDENT"] as const;
export type SubscriptionSubjectType = (typeof SUBSCRIPTION_SUBJECT_TYPE)[number];

export const SUBSCRIPTION_STATUS = [
  "PENDING_APPROVAL",
  "ACTIVE",
  "PAUSED",
  "CANCELLED",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUS)[number];

// ── المال ──────────────────────────────────────────────────────────────

export const ACCOUNT_STATUS = ["OPEN", "CLOSED"] as const;
export type AccountStatus = (typeof ACCOUNT_STATUS)[number];

/** `ADJUSTMENT` موجودة في الـenum ومرفوضة من مسار الكتابة (‏D2/4). */
export const LEDGER_ENTRY_TYPE = ["CHARGE", "PAYMENT", "ADJUSTMENT"] as const;
export type LedgerEntryType = (typeof LEDGER_ENTRY_TYPE)[number];

export const LEDGER_SOURCE = [
  "SUBSCRIPTION",
  "ONE_TIME_SERVICE",
  "INSTALLMENT",
  "RENT",
  "BADGE",
  "MANUAL",
  "OPENING",
] as const;
export type LedgerSource = (typeof LEDGER_SOURCE)[number];

export const PAYMENT_METHOD = ["CASH_AT_CENTER", "WAYL_LINK"] as const;
export type PaymentMethod = (typeof PAYMENT_METHOD)[number];

export const PAYMENT_STATUS = [
  "PENDING",
  "PAID",
  "FAILED",
  "EXPIRED",
  "CANCELLED",
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUS)[number];

// ── الوصول ─────────────────────────────────────────────────────────────

export const VEHICLE_STATUS = [
  "PENDING_APPROVAL",
  "APPROVED",
  "REJECTED",
  "REMOVED",
] as const;
export type VehicleStatus = (typeof VEHICLE_STATUS)[number];

export const BADGE_STATUS = ["REQUESTED", "ISSUED", "REVOKED", "EXPIRED"] as const;
export type BadgeStatus = (typeof BADGE_STATUS)[number];

// ── الطلبات ────────────────────────────────────────────────────────────

export const REQUEST_TYPE = ["SERVICE_REQUEST", "COMPLAINT"] as const;
export type RequestType = (typeof REQUEST_TYPE)[number];

/** نطاق الطلب — `COMMON_AREA` يجعل `apartmentId` قابلاً لـnull (‏Q35). */
export const REQUEST_SCOPE = ["APARTMENT", "COMMON_AREA"] as const;
export type RequestScope = (typeof REQUEST_SCOPE)[number];

export const REQUEST_STATUS = [
  "NEW",
  "ASSIGNED",
  "IN_PROGRESS",
  "DONE",
  "CANCELLED",
] as const;
export type RequestStatus = (typeof REQUEST_STATUS)[number];

export const PRIORITY = ["LOW", "NORMAL", "HIGH"] as const;
export type Priority = (typeof PRIORITY)[number];

/** مسارات طلب الساكن الثلاثة في نموذج عام واحد (‏Q37). */
export const RESIDENT_REQUEST_KIND = [
  "BADGE",
  "SUBSCRIPTION_CANCELLATION",
  "PROFILE_CHANGE",
] as const;
export type ResidentRequestKind = (typeof RESIDENT_REQUEST_KIND)[number];

export const RESIDENT_REQUEST_STATUS = ["PENDING", "APPROVED", "REJECTED"] as const;
export type ResidentRequestStatus = (typeof RESIDENT_REQUEST_STATUS)[number];

// ── العرضية ────────────────────────────────────────────────────────────

export const NOTIFICATION_CHANNEL = ["WHATSAPP", "IN_APP"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNEL)[number];

/** حالة **الإرسال** لا القراءة. القراءة يحملها `readAt` (‏Q44). */
export const NOTIFICATION_STATUS = ["PENDING", "SENT", "FAILED"] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUS)[number];

/** عدّاد الترقيم السنوي: فاتورة · عقد · طلب (‏Q17). */
export const COUNTER_KIND = ["INV", "CTR", "REQ"] as const;
export type CounterKind = (typeof COUNTER_KIND)[number];

// ── سجل كل الـenums، لتدقيق الاكتمال آلياً ─────────────────────────────

/**
 * كل enum في المجال مع قيمه. يقارنه `audit:completeness` بـ`schema.prisma`
 * قيمةً بقيمة، فلا يمكن أن يتفرّق المصدران بصمت.
 */
export const ALL_ENUMS = {
  Gender: GENDER,
  EmploymentType: EMPLOYMENT_TYPE,
  SkillLevel: SKILL_LEVEL,
  NumberingScheme: NUMBERING_SCHEME,
  ConstructionStatus: CONSTRUCTION_STATUS,
  OwnershipStatus: OWNERSHIP_STATUS,
  OccupancyStatus: OCCUPANCY_STATUS,
  ResidentRelation: RESIDENT_RELATION,
  ContractType: CONTRACT_TYPE,
  ContractStatus: CONTRACT_STATUS,
  PaymentType: PAYMENT_TYPE,
  PlanStatus: PLAN_STATUS,
  InstallmentStatus: INSTALLMENT_STATUS,
  ServiceBillingType: SERVICE_BILLING_TYPE,
  BillingCycle: BILLING_CYCLE,
  PricingModel: PRICING_MODEL,
  PayerType: PAYER_TYPE,
  ServiceAppliesTo: SERVICE_APPLIES_TO,
  SubscriptionSubjectType: SUBSCRIPTION_SUBJECT_TYPE,
  SubscriptionStatus: SUBSCRIPTION_STATUS,
  AccountStatus: ACCOUNT_STATUS,
  LedgerEntryType: LEDGER_ENTRY_TYPE,
  LedgerSource: LEDGER_SOURCE,
  PaymentMethod: PAYMENT_METHOD,
  PaymentStatus: PAYMENT_STATUS,
  VehicleStatus: VEHICLE_STATUS,
  BadgeStatus: BADGE_STATUS,
  RequestType: REQUEST_TYPE,
  RequestScope: REQUEST_SCOPE,
  RequestStatus: REQUEST_STATUS,
  Priority: PRIORITY,
  ResidentRequestKind: RESIDENT_REQUEST_KIND,
  ResidentRequestStatus: RESIDENT_REQUEST_STATUS,
  NotificationChannel: NOTIFICATION_CHANNEL,
  NotificationStatus: NOTIFICATION_STATUS,
  CounterKind: COUNTER_KIND,
} as const;

/**
 * `UserRole` يعيش في `lib/auth/roles.ts` لأنه محور الترخيص لا مجرّد قيمة
 * مجال، ويُدرَج هنا للتدقيق فقط.
 */
export const ENUMS_DEFINED_ELSEWHERE = ["UserRole"] as const;
