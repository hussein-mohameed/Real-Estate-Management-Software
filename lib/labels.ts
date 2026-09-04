/**
 * التسميات العربية لكل قيمة enum (‏§2.4).
 *
 * ── لماذا `Record<T, string>` وليس كائناً حرّاً ───────────────────────
 * النوع يفرض **الشمول**: إضافة قيمة enum جديدة بلا تسمية **تكسر الترجمة**
 * فوراً بدل أن تظهر `SCREAMING_SNAKE` في واجهة عربية أمام مستخدم.
 * هذا بديل i18n في نظام أحادي اللغة — أرخص وأصرم.
 *
 * لا نصّ عربي لقيمة enum يُكتب خارج هذا الملف. أبداً.
 */

import type {
  AccountStatus,
  BadgeStatus,
  BillingCycle,
  ConstructionStatus,
  ContractStatus,
  ContractType,
  CounterKind,
  EmploymentType,
  Gender,
  InstallmentStatus,
  LedgerEntryType,
  LedgerSource,
  NotificationChannel,
  NotificationStatus,
  NumberingScheme,
  OccupancyStatus,
  OwnershipStatus,
  PayerType,
  PaymentMethod,
  PaymentStatus,
  PaymentType,
  PlanStatus,
  PricingModel,
  Priority,
  RequestScope,
  RequestStatus,
  RequestType,
  ResidentRelation,
  ResidentRequestKind,
  ResidentRequestStatus,
  ServiceAppliesTo,
  ServiceBillingType,
  SkillLevel,
  SubscriptionStatus,
  SubscriptionSubjectType,
  VehicleStatus,
} from "./domain/enums";

export const GENDER_AR: Record<Gender, string> = {
  MALE: "ذكر",
  FEMALE: "أنثى",
};

export const EMPLOYMENT_TYPE_AR: Record<EmploymentType, string> = {
  INTERNAL: "داخلي",
  FREELANCE: "حرّ",
  VENDOR: "من شركة متعاقدة",
};

export const SKILL_LEVEL_AR: Record<SkillLevel, string> = {
  BEGINNER: "مبتدئ",
  INTERMEDIATE: "متوسّط",
  ADVANCED: "متقدّم",
  EXPERT: "خبير",
};

export const NUMBERING_SCHEME_AR: Record<NumberingScheme, string> = {
  SEQUENTIAL: "تسلسلي عبر البناية",
  PER_FLOOR: "يبدأ من جديد كل طابق",
};

export const CONSTRUCTION_STATUS_AR: Record<ConstructionStatus, string> = {
  UNDER_CONSTRUCTION: "تحت الإنشاء",
  COMPLETED: "مكتملة",
  DELIVERED: "مُسلَّمة",
};

export const OWNERSHIP_STATUS_AR: Record<OwnershipStatus, string> = {
  UNSOLD: "غير مباعة",
  SOLD: "مباعة",
  RENTED_BY_COMPANY: "مؤجّرة من الشركة",
};

export const OCCUPANCY_STATUS_AR: Record<OccupancyStatus, string> = {
  VACANT: "فارغة",
  OCCUPIED_BY_OWNER: "يسكنها المالك",
  OCCUPIED_BY_TENANT: "يسكنها مستأجر",
};

export const RESIDENT_RELATION_AR: Record<ResidentRelation, string> = {
  FAMILY_MEMBER: "فرد من الأسرة",
  OTHER: "أخرى",
};

export const CONTRACT_TYPE_AR: Record<ContractType, string> = {
  SALE: "بيع / تمليك",
  RENTAL: "إيجار",
};

export const CONTRACT_STATUS_AR: Record<ContractStatus, string> = {
  DRAFT: "مسوّدة",
  ACTIVE: "نشط",
  EXPIRED: "منتهٍ",
  TERMINATED: "مفسوخ",
};

export const PAYMENT_TYPE_AR: Record<PaymentType, string> = {
  FULL: "دفعة كاملة",
  INSTALLMENTS: "أقساط",
};

export const PLAN_STATUS_AR: Record<PlanStatus, string> = {
  ACTIVE: "نشطة",
  COMPLETED: "مكتملة",
  CANCELLED: "ملغاة",
};

export const INSTALLMENT_STATUS_AR: Record<InstallmentStatus, string> = {
  PENDING: "مستحق",
  PAID: "مدفوع",
  OVERDUE: "متأخّر",
  CANCELLED: "ملغى",
};

export const SERVICE_BILLING_TYPE_AR: Record<ServiceBillingType, string> = {
  RECURRING: "دوري",
  ONE_TIME: "لمرة واحدة",
};

export const BILLING_CYCLE_AR: Record<BillingCycle, string> = {
  MONTHLY: "شهري",
  QUARTERLY: "ربع سنوي",
  YEARLY: "سنوي",
};

export const PRICING_MODEL_AR: Record<PricingModel, string> = {
  FLAT: "سعر ثابت",
  PER_UNIT: "حسب الوحدة",
  PER_PERSON: "حسب الشخص",
};

export const PAYER_TYPE_AR: Record<PayerType, string> = {
  OWNER: "المالك",
  OCCUPANT: "الساكن",
};

export const SERVICE_APPLIES_TO_AR: Record<ServiceAppliesTo, string> = {
  APARTMENT: "على الشقة",
  RESIDENT: "على الساكن",
  BOTH: "على الشقة أو الساكن",
};

export const SUBSCRIPTION_SUBJECT_TYPE_AR: Record<SubscriptionSubjectType, string> = {
  APARTMENT: "شقة",
  RESIDENT: "ساكن",
};

export const SUBSCRIPTION_STATUS_AR: Record<SubscriptionStatus, string> = {
  PENDING_APPROVAL: "بانتظار الموافقة",
  ACTIVE: "نشط",
  PAUSED: "موقوف",
  CANCELLED: "ملغى",
};

export const ACCOUNT_STATUS_AR: Record<AccountStatus, string> = {
  OPEN: "مفتوح",
  CLOSED: "مغلق",
};

export const LEDGER_ENTRY_TYPE_AR: Record<LedgerEntryType, string> = {
  CHARGE: "مدين",
  PAYMENT: "دائن",
  // موجودة في الـenum ومرفوضة من مسار الكتابة (‏D2/4) — التسمية للسجلات القديمة فقط.
  ADJUSTMENT: "تسوية (غير مستخدمة)",
};

export const LEDGER_SOURCE_AR: Record<LedgerSource, string> = {
  SUBSCRIPTION: "اشتراك",
  ONE_TIME_SERVICE: "خدمة لمرة واحدة",
  INSTALLMENT: "قسط",
  RENT: "إيجار",
  BADGE: "رسم باج",
  MANUAL: "قيد يدوي",
  OPENING: "رصيد افتتاحي",
};

export const PAYMENT_METHOD_AR: Record<PaymentMethod, string> = {
  CASH_AT_CENTER: "نقداً في المركز",
  WAYL_LINK: "رابط دفع إلكتروني",
};

export const PAYMENT_STATUS_AR: Record<PaymentStatus, string> = {
  PENDING: "معلّقة",
  PAID: "مدفوعة",
  FAILED: "فاشلة",
  EXPIRED: "منتهية الصلاحية",
  CANCELLED: "ملغاة",
};

export const VEHICLE_STATUS_AR: Record<VehicleStatus, string> = {
  PENDING_APPROVAL: "بانتظار الموافقة",
  APPROVED: "معتمدة",
  REJECTED: "مرفوضة",
  REMOVED: "مُزالة",
};

export const BADGE_STATUS_AR: Record<BadgeStatus, string> = {
  REQUESTED: "مطلوب",
  ISSUED: "صادر",
  REVOKED: "ملغى",
  EXPIRED: "منتهي الصلاحية",
};

export const REQUEST_TYPE_AR: Record<RequestType, string> = {
  SERVICE_REQUEST: "طلب خدمة",
  COMPLAINT: "شكوى",
};

export const REQUEST_SCOPE_AR: Record<RequestScope, string> = {
  APARTMENT: "شقة",
  COMMON_AREA: "منطقة مشتركة",
};

export const REQUEST_STATUS_AR: Record<RequestStatus, string> = {
  NEW: "جديد",
  ASSIGNED: "مُكلَّف",
  IN_PROGRESS: "قيد التنفيذ",
  DONE: "منجَز",
  CANCELLED: "ملغى",
};

export const PRIORITY_AR: Record<Priority, string> = {
  LOW: "منخفضة",
  NORMAL: "عادية",
  HIGH: "عالية",
};

export const RESIDENT_REQUEST_KIND_AR: Record<ResidentRequestKind, string> = {
  BADGE: "طلب باج",
  SUBSCRIPTION_CANCELLATION: "طلب إلغاء اشتراك",
  PROFILE_CHANGE: "طلب تعديل بيانات",
};

export const RESIDENT_REQUEST_STATUS_AR: Record<ResidentRequestStatus, string> = {
  PENDING: "بانتظار المراجعة",
  APPROVED: "مقبول",
  REJECTED: "مرفوض",
};

export const NOTIFICATION_CHANNEL_AR: Record<NotificationChannel, string> = {
  WHATSAPP: "واتساب",
  IN_APP: "داخل التطبيق",
};

export const NOTIFICATION_STATUS_AR: Record<NotificationStatus, string> = {
  // ⚠️ «مصفوفة» لا «مُسلَّمة»: UltraMsg يصفّ الرسالة إن لم تكن النسخة مُصدَّقة،
  // فردّ غير خاطئ لا يعني الوصول. الشاشة يجب أن تقول ذلك بوضوح (الخطوة 5.4).
  PENDING: "في الطابور",
  SENT: "مُرسَلة إلى المزوّد",
  FAILED: "فشلت",
};

export const COUNTER_KIND_AR: Record<CounterKind, string> = {
  INV: "فاتورة",
  CTR: "عقد",
  REQ: "طلب",
};

/**
 * سجلّ كل خرائط التسمية — يفحصه `audit:completeness` فيؤكّد أن **كل قيمة
 * enum في `lib/domain/enums.ts` لها تسمية عربية**، بلا استثناء واحد.
 */
export const ALL_LABEL_MAPS: Record<string, Record<string, string>> = {
  Gender: GENDER_AR,
  EmploymentType: EMPLOYMENT_TYPE_AR,
  SkillLevel: SKILL_LEVEL_AR,
  NumberingScheme: NUMBERING_SCHEME_AR,
  ConstructionStatus: CONSTRUCTION_STATUS_AR,
  OwnershipStatus: OWNERSHIP_STATUS_AR,
  OccupancyStatus: OCCUPANCY_STATUS_AR,
  ResidentRelation: RESIDENT_RELATION_AR,
  ContractType: CONTRACT_TYPE_AR,
  ContractStatus: CONTRACT_STATUS_AR,
  PaymentType: PAYMENT_TYPE_AR,
  PlanStatus: PLAN_STATUS_AR,
  InstallmentStatus: INSTALLMENT_STATUS_AR,
  ServiceBillingType: SERVICE_BILLING_TYPE_AR,
  BillingCycle: BILLING_CYCLE_AR,
  PricingModel: PRICING_MODEL_AR,
  PayerType: PAYER_TYPE_AR,
  ServiceAppliesTo: SERVICE_APPLIES_TO_AR,
  SubscriptionSubjectType: SUBSCRIPTION_SUBJECT_TYPE_AR,
  SubscriptionStatus: SUBSCRIPTION_STATUS_AR,
  AccountStatus: ACCOUNT_STATUS_AR,
  LedgerEntryType: LEDGER_ENTRY_TYPE_AR,
  LedgerSource: LEDGER_SOURCE_AR,
  PaymentMethod: PAYMENT_METHOD_AR,
  PaymentStatus: PAYMENT_STATUS_AR,
  VehicleStatus: VEHICLE_STATUS_AR,
  BadgeStatus: BADGE_STATUS_AR,
  RequestType: REQUEST_TYPE_AR,
  RequestScope: REQUEST_SCOPE_AR,
  RequestStatus: REQUEST_STATUS_AR,
  Priority: PRIORITY_AR,
  ResidentRequestKind: RESIDENT_REQUEST_KIND_AR,
  ResidentRequestStatus: RESIDENT_REQUEST_STATUS_AR,
  NotificationChannel: NOTIFICATION_CHANNEL_AR,
  NotificationStatus: NOTIFICATION_STATUS_AR,
  CounterKind: COUNTER_KIND_AR,
};
