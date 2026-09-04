"use server";

import { getSession } from "@/lib/auth/session";
import { myVehicles, mySubscriptions } from "@/lib/services/resident-extras";
import type { MySubscription, MyVehicle } from "@/lib/services/resident-extras";

export type {
  MyBadge,
  MySubscription,
  MyVehicle,
} from "@/lib/services/resident-extras";

/**
 * أغلفة الجلسة حول قراءات بوّابة الساكن الإضافية.
 *
 * ⚠️ **لا منطق هنا عمداً.** النطاق كله في `lib/services/resident-extras.ts`
 * حيث يُختبَر — وفيه سطران أمنيّان: فصل الاشتراك الشخصي عن اشتراك الوحدة،
 * واستثناء رسم الباج من الاستعلام.
 */

export async function myActiveSubscriptions(): Promise<MySubscription[]> {
  const session = await getSession();
  if (!session) return [];
  return mySubscriptions(session.user.id);
}

export async function myApartmentVehicles(): Promise<MyVehicle[]> {
  const session = await getSession();
  if (!session) return [];
  return myVehicles(session.user.id);
}
