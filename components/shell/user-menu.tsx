"use client";

import { LogOut } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Ltr } from "@/components/ui/ltr";
import { signOutAction } from "@/lib/actions/sign-out";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  قائمة المستخدم — صورة حساب Google واسمه.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── من أين تأتي الصورة ──────────────────────────────────────────────
 * `User.avatarUrl` كان موجوداً في المخطّط **ولا شيء يكتبه**. صار مسار ردّ
 * OAuth يخزّنه من `user_metadata` في كل دخول — راجع تعليقه هناك: الرابط
 * يتغيّر حين يغيّر المستخدم صورته، فلقطةٌ قديمة تُنتج صورة مكسورة.
 *
 * ── ولماذا `AvatarImage` لا `next/image` ────────────────────────────
 * ⚠️ `next/image` يوجب إعلان `lh3.googleusercontent.com` في
 * `images.remotePatterns` وإلا **يرمي وقت التشغيل**. و`AvatarImage` من
 * Radix هو `<img>` عاديّ: لا تهيئة، ولا تحسين لا نحتاجه لصورة ‎32px‎.
 *
 * ── والحرفان الأوّلان ليسا بديلاً احتياطياً بل حالةً أولى ────────────
 * ⚠️ **من دخل بـOTP لا صورة له إطلاقاً** — السكان، وهم أغلب المستخدمين.
 * فالحرفان هما الحالة الشائعة لا الاستثناء، و`AvatarFallback` يعمل أيضاً
 * حين يفشل تحميل صورة Google.
 */

export function UserMenu({
  userName,
  email,
  roleLabel,
  avatarUrl,
}: {
  userName: string;
  email: string | null;
  roleLabel: string;
  avatarUrl: string | null;
}) {
  const initials = userName.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 rounded-full p-0.5 transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          aria-label={`حساب ${userName}`}
        >
          <Avatar className="size-8">
            {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
            <AvatarFallback className="bg-accent-brand-soft text-theme-xs font-semibold text-accent-brand-strong">
              {initials}
            </AvatarFallback>
          </Avatar>
          {/* الاسم على الحاسوب فقط: على الهاتف الصورة تكفي والمساحة لا تتّسع */}
          <span className="hidden max-w-32 truncate text-theme-sm font-medium lg:block">
            {userName}
          </span>
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-64">
        <div className="flex items-start gap-3 p-2">
          <Avatar className="size-10 shrink-0">
            {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
            <AvatarFallback className="bg-accent-brand-soft text-theme-sm font-semibold text-accent-brand-strong">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-theme-sm font-medium">{userName}</p>
            {email ? (
              /* ⚠️ `Ltr` إلزامي: البريد مقاطع لاتينية بنقاط، وبلا عزل
                 يُعرض مقلوباً داخل فقرة عربية */
              <Ltr className="block max-w-full truncate text-theme-xs text-muted-foreground">
                {email}
              </Ltr>
            ) : (
              /* من دخل بـOTP لا بريد له — يُقال لا يُترك فراغاً */
              <p className="text-theme-xs text-muted-foreground">دخول بالهاتف</p>
            )}
            <Badge variant="neutral" className="mt-1.5">
              {roleLabel}
            </Badge>
          </div>
        </div>

        <DropdownMenuSeparator />

        {/*
         * ⚠️ نموذج لا `onClick`: الخروج إجراء خادم يمسح كوكيز **وينفّذ
         * `redirect`**. واستدعاؤه من معالج نقرة يجعله يعمل بلا JavaScript
         * أبداً — والخروج آخر ما يجوز أن يتوقّف على تحميل حزمة.
         */}
        <form action={signOutAction}>
          <DropdownMenuItem asChild variant="destructive">
            <button type="submit" className="w-full">
              <LogOut className="size-4" />
              خروج
            </button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
