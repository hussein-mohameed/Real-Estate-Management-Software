"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2,
  FileSignature,
  Home,
  LayoutDashboard,
  ListChecks,
  Sparkles,
  UserCog,
  UserRound,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import type { NavIconKey, NavItem } from "@/lib/nav";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  الشريط الجانبي — مبنيّ على `shadcn/ui sidebar`.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── لماذا `side="right"` ────────────────────────────────────────────
 * ⚠️ `side` في هذا المكوّن **فيزيائي**: يحدّد أي حافة من الشاشة، لا جهة
 * منطقية. وجهة البدء في واجهة عربية هي اليمين، فـ`"right"` هو الصحيح —
 * والقلب إلى `"left"` يفتح الشريط من الجهة المقابلة لاتجاه القراءة.
 *
 * ── وما يعطيه هذا المكوّن ولم يكن عندي ─────────────────────────────
 *   • **طيّ الشريط** إلى أيقونات (`collapsible="icon"`) وتذكّر الحالة في
 *     كوكي — الأدمن الذي يعمل على جداول عريضة يطويه ويبقى مطويّاً.
 *   • **درج الهاتف** مدمجاً (`Sheet` داخلياً) بلا مكوّن ثانٍ أكتبه.
 *   • **تلميحات** على الأيقونات حين يُطوى، تلقائياً.
 *   • **قضيب سحب** (`SidebarRail`) للطيّ بالنقر على الحافّة.
 *
 * ── ولماذا لا تذييل بهوية المستخدم ─────────────────────────────────
 * ⚠️ كان `SidebarFooter` يحمل الصورة والاسم والدور — وصارت **قائمة
 * المستخدم في الشريط العلوي** تحملها. وهويّةٌ في موضعين تُنتج سؤالاً لا
 * جواباً: أيّهما يُنقر للخروج؟ وأول تعديل يُفرّق شكلهما.
 *
 * الطرف الأعلى هو موضعها المتوقّع، وهو ما يتّسع للبريد وزرّ الخروج.
 *
 * ── ولماذا الأيقونة مفتاح لا مكوّن ─────────────────────────────────
 * ⚠️ `lib/nav.ts` تقرأه مكوّنات خادم، والدوالّ لا تعبر حدّ الخادم/العميل.
 * الخريطة تعيش هنا حيث لا حدّ يُعبَر — راجع تعليق `NavIconKey`.
 */

const ICONS: Record<NavIconKey, LucideIcon> = {
  dashboard: LayoutDashboard,
  users: UserCog,
  buildings: Building2,
  apartments: Home,
  residents: Users,
  contracts: FileSignature,
  services: Sparkles,
  staff: UserRound,
  tasks: ListChecks,
  wallet: Wallet,
  profile: UserRound,
};

/**
 * أصناف البند النشط.
 *
 * ⚠️ مستخرجة إلى ثابت لأن أدوات `data-[active=true]:before:*` طويلة،
 * ودمجها في الوسم يجعل الشجرة غير مقروءة — فيُنسخ الخطأ بدل أن يُقرأ.
 *
 * الشريط على جهة **البدء**: التعبئة وحدها تقول «هنا شيء»، والشريط يقول
 * «أنت هنا» — ويُقرأ بلمحة في قائمة طويلة.
 */
const ACTIVE_ITEM = [
  "relative rounded-lg font-normal transition-colors",
  "data-[active=true]:font-medium",
  "data-[active=true]:before:absolute data-[active=true]:before:inset-y-1.5",
  "data-[active=true]:before:start-0 data-[active=true]:before:w-0.5",
  "data-[active=true]:before:rounded-full data-[active=true]:before:bg-sidebar-primary",
].join(" ");

/**
 * يجمع البنود في مجموعات **بالتجاور لا بالفرز**.
 *
 * ⚠️ الفرز حسب اسم المجموعة كان سيُعيد ترتيب البنود ويكسر ترتيباً مقصوداً
 * في `lib/nav.ts` («مهام اليوم» أولاً دائماً). التجاور يحترم الترتيب
 * المكتوب: مجموعة جديدة تبدأ حين يتغيّر الاسم، لا حين يتكرّر.
 */
function groupNav(nav: readonly NavItem[]): Array<{ label: string; items: NavItem[] }> {
  const out: Array<{ label: string; items: NavItem[] }> = [];
  for (const item of nav) {
    const last = out.at(-1);
    if (last && last.label === item.group) last.items.push(item);
    else out.push({ label: item.group, items: [item] });
  }
  return out;
}

export function AppSidebar({ nav }: { nav: readonly NavItem[] }) {
  const pathname = usePathname();

  /**
   * ── التطابق ليس بالمساواة ولا بالبادئة وحدها ──────────────────────
   * `/admin` بادئةٌ لكل شيء في لوحة الإدارة، فالمطابقة بالبادئة كانت
   * ستُبقيه نشطاً دائماً. الجذر يُطابَق بالمساواة، وما دونه بالبادئة —
   * فتبقى «الشقق» نشطة داخل صفحة شقة بعينها.
   */
  const isActive = (href: string): boolean => {
    const roots = new Set(["/admin", "/owner", "/staff", "/app"]);
    if (roots.has(href)) return pathname === href;
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  const groups = groupNav(nav);

  return (
    <Sidebar side="right" collapsible="icon">
      <SidebarHeader className="p-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              asChild
              className="rounded-xl hover:bg-sidebar-accent/60"
            >
              <Link href="/">
                {/*
                 * تدرّج لا لون مسطّح: علامةٌ بمربّع واحد تُقرأ «أيقونة»،
                 * وبتدرّج خفيف تُقرأ «هوية». والتدرّج محصور في هذا الموضع
                 * وحده — تدرّجات في كل مكان تُنتج ضجيجاً بصرياً.
                 */}
                <span
                  className="grid size-9 shrink-0 place-items-center rounded-xl bg-linear-to-br from-brand-400 to-brand-600 text-white shadow-theme-sm"
                  aria-hidden
                >
                  <Building2 className="size-4.5" />
                </span>
                <span className="grid flex-1 text-start leading-tight">
                  <span className="truncate text-theme-sm font-semibold">
                    نظام إدارة المجمّع
                  </span>
                  <span className="truncate text-theme-xs text-muted-foreground">
                    السكني
                  </span>
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarSeparator className="mx-0" />

      <SidebarContent className="gap-0 px-1.5 py-2">
        {groups.map(({ label, items }) => (
          <SidebarGroup key={label} className="py-1.5">
            <SidebarGroupLabel className="px-2 text-theme-xs font-medium tracking-wide text-muted-foreground">
              {label}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                {items.map(({ href, label: itemLabel, icon }) => {
                  const Icon = ICONS[icon];
                  return (
                    <SidebarMenuItem key={href}>
                      <SidebarMenuButton
                        asChild
                        isActive={isActive(href)}
                        /* التلميح يظهر حين يُطوى الشريط إلى أيقونات */
                        tooltip={itemLabel}
                        className={ACTIVE_ITEM}
                      >
                        <Link href={href}>
                          <Icon />
                          <span>{itemLabel}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarRail />
    </Sidebar>
  );
}
