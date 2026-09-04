"use server";

import { getSession } from "@/lib/auth/session";
import { searchFor } from "@/lib/services/search";
import type { SearchOutcome } from "@/lib/services/search";

export type { SearchHit, SearchHitKind, SearchOutcome } from "@/lib/services/search";

/**
 * غلاف الجلسة حول `searchFor`.
 *
 * ⚠️ **لا منطق هنا عمداً.** كل قرار — قيد الدور، وحدّ الطول، وما يُعرض —
 * في `lib/services/search.ts` حيث يُختبَر. وما لا يُختبَر في هذا الملف
 * هو حلّ الجلسة وحده، وهو مُختبَر في مكانه.
 */
export async function globalSearch(query: string): Promise<SearchOutcome> {
  const session = await getSession();
  if (!session) return { hits: [], truncated: false };
  return searchFor(query, { userId: session.user.id, role: session.user.role });
}
