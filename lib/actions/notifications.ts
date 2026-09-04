"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { markAllReadFor, notificationsFor } from "@/lib/services/notifications";
import type { BellState } from "@/lib/services/notifications";

export type { BellState, NotificationRow } from "@/lib/services/notifications";

/**
 * أغلفة الجلسة حول منطق الإخطارات.
 *
 * ⚠️ **لا منطق هنا عمداً.** النطاق والترتيب والحدّ في
 * `lib/services/notifications.ts` حيث تُختبَر — راجع تعليقه.
 */

/** يُستدعى من `AppShell` وهو مكوّن خادم، فيُصيَّر العدد مع الصفحة. */
export async function myNotifications(): Promise<BellState> {
  const session = await getSession();
  if (!session) return { rows: [], unread: 0 };
  return notificationsFor(session.user.id);
}

export async function markAllNotificationsRead(): Promise<{ marked: number }> {
  const session = await getSession();
  if (!session) return { marked: 0 };

  const out = await markAllReadFor(session.user.id);

  /*
   * ⚠️ الجرس مُصيَّر على الخادم داخل `layout` — بلا إبطال الذاكرة يبقى
   * الرقم القديم معروضاً حتى تنقّل كامل، فتبدو النقرة بلا أثر.
   */
  revalidatePath("/", "layout");
  return out;
}
