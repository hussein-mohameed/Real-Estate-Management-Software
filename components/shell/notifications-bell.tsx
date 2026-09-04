"use client";

import { useTransition } from "react";
import { Bell, CheckCheck } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Ltr } from "@/components/ui/ltr";
import { cn } from "@/lib/cn";
import { formatBaghdadDateTime } from "@/lib/dates";
import { markAllNotificationsRead, type NotificationRow } from "@/lib/actions/notifications";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  جرس الإخطارات (‏§11.2 · Q44).
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── لماذا هذا الجرس **يعمل** ────────────────────────────────────────
 * القرار `Q44` أضاف عمود `readAt` إلى `Notification` بنصّ صريح: «بدون هذا
 * العمود يبقى جرس الإخطارات زخرفة» — لأن `status` يعبّر عن حالة **الإرسال**
 * (‏PENDING/SENT/FAILED) لا عن قراءة المستخدم. فالعدّاد هنا يُحسب من
 * `readAt IS NULL` لا من `status`.
 *
 * ── والصفر ليس فراغاً ──────────────────────────────────────────────
 * ⚠️ جرسٌ يُخفي نفسه حين لا إخطارات يجعل المستخدم يشكّ: هل لا يوجد جديد،
 * أم أن الجرس معطوب؟ الجرس يبقى، ويقول **«لا إخطارات»** — وهي معلومة.
 *
 * ── وشارة العدد بحدٍّ أعلى ──────────────────────────────────────────
 * ⚠️ «١٢٤» في دائرة ‎16px‎ تفيض على الأيقونة وتصير غير مقروءة. وما بعد
 * التسعة لا يضيف قراراً: «٩+» تكفي لأن يُفتح الجرس.
 */

const BADGE_CAP = 9;

export function NotificationsBell({
  rows,
  unread,
}: {
  rows: readonly NotificationRow[];
  unread: number;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative size-9 rounded-full"
          aria-label={
            unread > 0 ? `الإخطارات — ${unread} غير مقروء` : "الإخطارات — لا جديد"
          }
        >
          <Bell className="size-4.5" />
          {unread > 0 ? (
            <span
              className={cn(
                "absolute -top-0.5 -end-0.5 grid min-w-4 place-items-center rounded-full",
                "bg-money-overdue px-1 text-[10px] font-semibold leading-4 text-white",
              )}
              aria-hidden
            >
              <span className="tabular">
                {unread > BADGE_CAP ? `${BADGE_CAP}+` : unread}
              </span>
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between gap-2 border-b px-3 py-2.5">
          <span className="text-theme-sm font-semibold">الإخطارات</span>
          {unread > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => startTransition(() => markAllNotificationsRead().then(() => undefined))}
              className="h-7 gap-1.5 px-2 text-theme-xs"
            >
              <CheckCheck className="size-3.5" />
              تعليم الكل مقروءاً
            </Button>
          ) : null}
        </div>

        <div className="max-h-80 overflow-y-auto">
          {rows.length === 0 ? (
            <p className="px-3 py-8 text-center text-theme-sm text-muted-foreground">
              لا إخطارات.
            </p>
          ) : (
            <ul className="divide-y">
              {rows.map((n) => (
                <li
                  key={n.id}
                  className={cn(
                    "relative px-3 py-3",
                    // نقطة على جهة البدء لغير المقروء — تُقرأ قبل النصّ
                    n.isUnread && "bg-accent-brand-soft/40",
                  )}
                >
                  <div className="flex items-start gap-2.5">
                    <span
                      className={cn(
                        "mt-1.5 size-1.5 shrink-0 rounded-full",
                        n.isUnread ? "bg-accent-brand" : "bg-transparent",
                      )}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-theme-sm leading-relaxed">{n.body}</p>
                      <p className="mt-1 text-theme-xs text-muted-foreground">
                        <Ltr>{formatBaghdadDateTime(n.createdAt)}</Ltr>
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
