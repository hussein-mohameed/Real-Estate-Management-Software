import { Badge, type badgeVariants } from "@/components/ui/badge";
import type { VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";
import {
  ACCOUNT_STATUS_AR,
  BADGE_STATUS_AR,
  CONSTRUCTION_STATUS_AR,
  CONTRACT_STATUS_AR,
  INSTALLMENT_STATUS_AR,
  OCCUPANCY_STATUS_AR,
  OWNERSHIP_STATUS_AR,
  PAYMENT_STATUS_AR,
  REQUEST_STATUS_AR,
  SUBSCRIPTION_STATUS_AR,
  VEHICLE_STATUS_AR,
} from "@/lib/labels";

/**
 * شارة الحالة — **المصدر الوحيد للون والتسمية معاً** (‏§11.2).
 *
 * ── لماذا تُبنى الخريطة من `labels.ts` لا بنصوص هنا ─────────────────
 * لو كُتبت التسمية هنا لأصبح للنظام مصدران عربيان لنفس القيمة، فيتفرّقان
 * عند أول تعديل. الشارة تقرأ من `labels.ts`، والتدقيق يؤكّد أن كل قيمة
 * enum مُسمّاة — فلا تظهر `SCREAMING_SNAKE` في واجهة عربية أبداً.
 *
 * ── لغة اللون ────────────────────────────────────────────────────────
 * §11.2 يثبّت الألوان لكل محور. اللون هنا **معلومة لا زينة**: المستخدم
 * يتعلّم أن الكهرماني «قيد الانتظار» فيقرأ الجدول بلمحة.
 */

/**
 * النبرة = `variant` من `Badge` مباشرةً. لا خريطة أصناف هنا: كانت
 * `TONE_CLASS` تعرّف حواف الشارة وحشوتها للمرّة الثانية، فأي تعديل على
 * شكل الشارة كان يلزم في موضعين. الشكل الآن في `badge.tsx` وحده.
 */
type Tone = Extract<
  NonNullable<VariantProps<typeof badgeVariants>["variant"]>,
  "neutral" | "success" | "info" | "warning" | "danger" | "emerald"
>;

interface AxisSpec {
  labels: Record<string, string>;
  tones: Record<string, Tone>;
}

/** كل محور: تسمياته من `labels.ts` وألوانه من §11.2. */
const AXES = {
  occupancy: {
    labels: OCCUPANCY_STATUS_AR,
    tones: { VACANT: "neutral", OCCUPIED_BY_OWNER: "success", OCCUPIED_BY_TENANT: "info" },
  },
  construction: {
    labels: CONSTRUCTION_STATUS_AR,
    tones: { UNDER_CONSTRUCTION: "warning", COMPLETED: "success", DELIVERED: "emerald" },
  },
  ownership: {
    labels: OWNERSHIP_STATUS_AR,
    tones: { UNSOLD: "neutral", SOLD: "success", RENTED_BY_COMPANY: "info" },
  },
  contract: {
    labels: CONTRACT_STATUS_AR,
    tones: { DRAFT: "neutral", ACTIVE: "success", EXPIRED: "warning", TERMINATED: "danger" },
  },
  account: {
    labels: ACCOUNT_STATUS_AR,
    tones: { OPEN: "success", CLOSED: "neutral" },
  },
  subscription: {
    labels: SUBSCRIPTION_STATUS_AR,
    tones: { PENDING_APPROVAL: "warning", ACTIVE: "success", PAUSED: "neutral", CANCELLED: "danger" },
  },
  installment: {
    labels: INSTALLMENT_STATUS_AR,
    tones: { PENDING: "warning", PAID: "success", OVERDUE: "danger", CANCELLED: "neutral" },
  },
  payment: {
    labels: PAYMENT_STATUS_AR,
    tones: { PENDING: "warning", PAID: "success", FAILED: "danger", EXPIRED: "neutral", CANCELLED: "neutral" },
  },
  vehicle: {
    labels: VEHICLE_STATUS_AR,
    tones: { PENDING_APPROVAL: "warning", APPROVED: "success", REJECTED: "danger", REMOVED: "neutral" },
  },
  badge: {
    labels: BADGE_STATUS_AR,
    // ⚠️ EXPIRED **خطر لا محايد**: باج منتهٍ يجب أن يلفت النظر في شاشة
    // الأمن، لأن السماح بمروره ثقب في ضبط الوصول الفيزيائي (‏Q40).
    tones: { REQUESTED: "warning", ISSUED: "success", REVOKED: "neutral", EXPIRED: "danger" },
  },
  request: {
    labels: REQUEST_STATUS_AR,
    tones: { NEW: "info", ASSIGNED: "warning", IN_PROGRESS: "warning", DONE: "success", CANCELLED: "neutral" },
  },
} as const satisfies Record<string, AxisSpec>;

export type StatusAxis = keyof typeof AXES;

export function StatusBadge({
  axis,
  value,
  className,
}: {
  axis: StatusAxis;
  value: string;
  className?: string;
}) {
  const spec: AxisSpec = AXES[axis];
  const label = spec.labels[value];
  const tone = spec.tones[value] ?? "neutral";

  // قيمة بلا تسمية عيب لا حالة عرض — يجب أن تُرى في التطوير لا أن تُخفى.
  if (!label && process.env.NODE_ENV !== "production") {
    throw new Error(
      `StatusBadge: القيمة «${value}» على المحور «${axis}» بلا تسمية عربية. أضفها في lib/labels.ts.`,
    );
  }

  return (
    <Badge variant={tone} className={cn("px-2.5 py-0.5", className)}>
      {label ?? value}
    </Badge>
  );
}
