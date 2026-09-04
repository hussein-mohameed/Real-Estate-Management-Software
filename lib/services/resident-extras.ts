import type {
  BadgeStatus,
  BillingCycle,
  PayerType,
  SubscriptionStatus,
  VehicleStatus,
} from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { residentApartmentIds } from "@/lib/auth/scope";
import { now } from "@/lib/dates";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  بوّابة الساكن — الاشتراكات والسيارات (‏§8.4).
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── النطاق من `residentApartmentIds` لا بيدٍ ثانية ──────────────────
 * نفس قاعدة `resident-portal.ts`: مرشّح واحد يُنسى في استعلام واحد يكفي
 * ليرى ساكن بيانات جاره، **وهو عيب لا يشتكي منه أحد** لأن من يرى ما لا
 * يخصّه لا يبلّغ عنه.
 *
 * ── ⚠️ وخطّان مختلفان للاشتراك ─────────────────────────────────────
 * اشتراك موضوعه **الشقة** (نظافة · حراسة) خدمةٌ للوحدة كلها، يراه كل من
 * يسكنها. واشتراك موضوعه **الساكن** يخصّ شخصاً بعينه بسعره.
 *
 * فلو رُشِّح الاثنان بـ`apartmentId` وحده لرأى الابنُ اشتراكَ أبيه الشخصي
 * وثمنه. هذا تسريب مالي داخل البيت الواحد، وهو ما يمنعه `resident-portal`
 * أصلاً في كشف الحساب. الشرط هنا `OR` بين مسارين لا مرشّح واحد.
 *
 * ── ⚠️ ورسم الباج **مستثنى من الاستعلام** ──────────────────────────
 * `Badge.feeIqd` مال، ويُقيَّد على حساب صاحب العقد. وإخراجه لكل ساكن يعيد
 * التسريب نفسه من باب آخر. مستثنى من `select` لا مُرشَّح في العرض — نفس
 * ما يفعله `getMyProfile` بروابط المستندات: **الترشيح في العرض يُنسى،
 * والاستثناء من الاستعلام لا يُنسى**.
 */

export interface MySubscription {
  id: string;
  serviceName: string;
  /** `true` حين يكون موضوعه أنا لا الوحدة. */
  isPersonal: boolean;
  status: SubscriptionStatus;
  billingCycle: BillingCycle | null;
  periodAmountIqd: bigint;
  payerType: PayerType;
  quantity: number;
  startDate: Date;
  apartmentNumber: string | null;
}

export interface MyBadge {
  id: string;
  code: string | null;
  status: BadgeStatus;
  expiresAt: Date | null;
  /**
   * الحالة **كما تُقرأ اليوم**.
   *
   * ⚠️ `Q40`: لا مهمة تقلب `ISSUED` إلى `EXPIRED` في المواصفة، فباجٌ انتهت
   * صلاحيته يبقى `ISSUED` في القاعدة. وعرضُه «صادر» للساكن **كذب**: يذهب
   * إلى البوّابة واثقاً فيُمنع.
   *
   * هذا علاجٌ في **العرض** لا في البيانات. الإصلاح الحقيقي مهمة صيانة
   * يومية تقلب الحالة فعلاً — وحتى تُبنى، لا يُعرض للساكن ما يخالف الواقع.
   */
  effectiveStatus: BadgeStatus;
}

export interface MyVehicle {
  id: string;
  plateNumber: string;
  plateProvince: string | null;
  make: string | null;
  model: string | null;
  color: string | null;
  status: VehicleStatus;
  /** `true` حين أكون مالكها المسجَّل — لا حين تكون في وحدتي فقط. */
  isMine: boolean;
  apartmentNumber: string;
  badges: MyBadge[];
}

/**
 * اشتراكاتي — الملغاة مستثناة.
 *
 * ⚠️ `CANCELLED` لا تُعرض: قائمةٌ فيها ما أُلغي منذ سنة تُقرأ كأنها التزامات
 * قائمة. أما `PAUSED` و`PENDING_APPROVAL` فتبقيان — الأولى التزام موقوف
 * والثانية طلبٌ ينتظر، وكلتاهما تعني شيئاً للساكن الآن.
 */
export async function mySubscriptions(userId: string): Promise<MySubscription[]> {
  const apartmentIds = await residentApartmentIds(userId);
  if (apartmentIds.length === 0) return [];

  const rows = await prisma.subscription.findMany({
    where: {
      deletedAt: null,
      status: { not: "CANCELLED" },
      OR: [
        // خدمة الوحدة — يراها كل ساكنيها
        { subjectType: "APARTMENT", apartmentId: { in: apartmentIds } },
        // خدمة شخصية — لصاحبها وحده
        { subjectType: "RESIDENT", residentUserId: userId },
      ],
    },
    select: {
      id: true,
      subjectType: true,
      status: true,
      billingCycle: true,
      periodAmountIqd: true,
      payerType: true,
      quantity: true,
      startDate: true,
      service: { select: { name: true } },
      apartment: { select: { displayNumber: true } },
    },
    orderBy: [{ status: "asc" }, { startDate: "desc" }],
  });

  return rows.map((r) => ({
    id: r.id,
    serviceName: r.service.name,
    isPersonal: r.subjectType === "RESIDENT",
    status: r.status,
    billingCycle: r.billingCycle,
    periodAmountIqd: r.periodAmountIqd,
    payerType: r.payerType,
    quantity: r.quantity,
    startDate: r.startDate,
    apartmentNumber: r.apartment?.displayNumber ?? null,
  }));
}

/**
 * سيارات وحدتي وباجاتها.
 *
 * ⚠️ **على مستوى الوحدة لا الشخص.** `Vehicle.apartmentId` إلزامي
 * و`ownerUserId` اختياري — أي أن السيارة واقعةٌ في الوحدة قبل أن تكون
 * ملك شخص. وإخفاء سيارة الأخ عن أخيه يجعل الساكن يظنّ لوحةً مسجَّلة وهي
 * ليست كذلك، ثم تُمنع عند البوّابة.
 *
 * والحدّ الذي **لا** يُعبَر هو المال: راجع تعليق الرأس عن `feeIqd`.
 *
 * ⚠️ و`REMOVED` مستثناة: سيارة بيعت ليست «سيارتي».
 */
export async function myVehicles(userId: string): Promise<MyVehicle[]> {
  const apartmentIds = await residentApartmentIds(userId);
  if (apartmentIds.length === 0) return [];

  const rows = await prisma.vehicle.findMany({
    where: { apartmentId: { in: apartmentIds }, status: { not: "REMOVED" } },
    select: {
      id: true,
      plateNumber: true,
      plateProvince: true,
      make: true,
      model: true,
      color: true,
      status: true,
      ownerUserId: true,
      apartment: { select: { displayNumber: true } },
      badges: {
        // الملغى ليس باجاً بيد أحد
        where: { status: { not: "REVOKED" } },
        // ⚠️ `feeIqd` غير مذكور — استثناء لا ترشيح. راجع تعليق الرأس.
        select: { id: true, code: true, status: true, expiresAt: true },
        orderBy: { createdAt: "desc" },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const today = now();

  return rows.map((v) => ({
    id: v.id,
    plateNumber: v.plateNumber,
    plateProvince: v.plateProvince,
    make: v.make,
    model: v.model,
    color: v.color,
    status: v.status,
    isMine: v.ownerUserId === userId,
    apartmentNumber: v.apartment.displayNumber,
    badges: v.badges.map((b) => ({
      id: b.id,
      code: b.code,
      status: b.status,
      expiresAt: b.expiresAt,
      effectiveStatus: effectiveBadgeStatus(b.status, b.expiresAt, today),
    })),
  }));
}

/**
 * حالة الباج كما تُقرأ اليوم — علاج `Q40` في العرض.
 *
 * ⚠️ مُصدَّرة كي تُختبَر مباشرةً: المنطق سطران، والخطأ فيهما يجعل الساكن
 * يقف عند البوّابة بباج منتهٍ ظنّاً أنه صالح.
 */
export function effectiveBadgeStatus(
  status: BadgeStatus,
  expiresAt: Date | null,
  today: Date,
): BadgeStatus {
  if (status !== "ISSUED" || expiresAt === null) return status;
  return expiresAt.getTime() < today.getTime() ? "EXPIRED" : status;
}
