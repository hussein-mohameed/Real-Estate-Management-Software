"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Banknote,
  Briefcase,
  Building2,
  CalendarClock,
  Car,
  ChartNoAxesCombined,
  CircleUser,
  FileSignature,
  Home,
  IdCard,
  LayoutDashboard,
  MessageSquareWarning,
  Network,
  Receipt,
  ReceiptText,
  Repeat,
  ShieldCheck,
  Sparkles,
  Users,
  UsersRound,
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
 * ⚠️ و«ملفي» المثبَّت في الأسفل **رابطُ وجهة لا هوية**: لا صورة ولا بريد
 * ولا خروج. الفرق هو ما يمنع عودة الالتباس.
 *
 * ── ولماذا الأيقونة مفتاح لا مكوّن ─────────────────────────────────
 * ⚠️ `lib/nav.ts` تقرأه مكوّنات خادم، والدوالّ لا تعبر حدّ الخادم/العميل.
 * الخريطة تعيش هنا حيث لا حدّ يُعبَر — راجع تعليق `NavIconKey`.
 */

/**
 * ⚠️ **لا قيمة مكرّرة في هذه الخريطة.** كانت `UserRound` على `staff`
 * و`profile` معاً، و`ListChecks` على أربعة مفاتيح — فصار المفتاح المستقلّ
 * يُصيَّر أيقونةً غير مستقلّة، والاتحاد النصّي يحرس الأسماء ولا يحرس
 * الصور. وفحصٌ في `tests/unit/nav.test.ts` يمنع عودتها.
 */
const ICONS: Record<NavIconKey, LucideIcon> = {
  dashboard: LayoutDashboard,
  metrics: ChartNoAxesCombined,
  requests: MessageSquareWarning,
  buildings: Building2,
  apartments: Home,
  residents: Users,
  staff: IdCard,
  departments: Network,
  users: ShieldCheck,
  contracts: FileSignature,
  services: Sparkles,
  subscriptions: Repeat,
  installments: CalendarClock,
  cash: Banknote,
  statement: ReceiptText,
  invoices: Receipt,
  household: UsersRound,
  vehicles: Car,
  work: Briefcase,
  profile: CircleUser,
};

/**
 * أصناف بند القائمة.
 *
 * ⚠️ مستخرجة إلى ثابت لأن أدوات `data-[active=true]:*` طويلة، ودمجها في
 * الوسم يجعل الشجرة غير مقروءة — فيُنسخ الخطأ بدل أن يُقرأ.
 *
 * ── ⚠️ الحالة النشطة **بلا شريط جانبي** ─────────────────────────────
 * كان شريطاً بعرض ثلاثة بكسلات على حافّة البند — وهو خطٌّ صلب داخل شريطٍ
 * أُريد له ألّا يحمل خطوطاً. وثلاث إشارات كانت تتنافس على بندٍ واحد.
 *
 * فبقيت اثنتان تكفيان: **تعبئة** بلون العلامة تقول «أنت هنا» من مسافة،
 * و**أيقونة ملوّنة** تقولها من غير قراءة. والوزن الأثقل يؤكّدهما.
 *
 * ⚠️ والأيقونة **باهتة حين لا تكون نشطة** عمداً: صفٌّ من ثلاث عشرة أيقونة
 * كلّها بلون النصّ يصير جداراً بصرياً واحداً — فلا يبرز شيء، وهو نقيض
 * الغرض. الخفوت هو ما يجعل النشط يُرى.
 */
const NAV_ITEM = [
  "h-10 gap-3 rounded-xl px-3 font-normal transition-colors",
  "text-sidebar-foreground/80",
  "[&>svg]:size-4.5 [&>svg]:text-muted-foreground [&>svg]:transition-colors",
  /* ⚠️ المرور **أخفت من النشط**: لو تساويا لبدا كل ما تمرّ عليه مختاراً */
  "hover:bg-sidebar-accent/40 hover:text-sidebar-foreground",
  "hover:[&>svg]:text-sidebar-foreground",
  "data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground",
  "data-[active=true]:[&>svg]:text-sidebar-accent-foreground",
].join(" ");

/**
 * عنوان المجموعة — هادئ عمداً.
 *
 * ⚠️ كان `font-semibold` مع `tracking-[0.06em]`: تباعدٌ لاتيني الأصل يُبعثر
 * حروف الكلمة العربية المتّصلة ويجعلها تُقرأ حرفاً حرفاً. والعنوان يجب أن
 * **يُلمَح** لا أن يُقرأ — فالوزن الأخفّ واللون الأهدأ يخدمانه أكثر من
 * الحيلة الطباعية.
 */
const GROUP_LABEL = "h-auto px-3 pb-1.5 pt-0 text-theme-xs font-medium text-muted-foreground";

interface NavGroup {
  /** `null` = بندٌ يقف وحده بلا عنوان — راجع تعليق `group` في `lib/nav.ts`. */
  label: string | null;
  /**
   * ⚠️ **المفتاح من الرابط لا من العنوان.** مجموعتان بلا عنوان (الرئيسية
   * في الأعلى وملفي في الأسفل) تعطيان `key={null}` مرّتين، فيرمي React
   * «مفتاحان متطابقان» ويُعيد استعمال العقدة الخطأ. والرابط فريد بالبناء —
   * يحرسه اختبار «لا رابط مكرّر داخل قائمة واحدة».
   */
  key: string;
  items: NavItem[];
}

/**
 * يجمع البنود في مجموعات **بالتجاور لا بالفرز**.
 *
 * ⚠️ الفرز حسب اسم المجموعة كان سيُعيد ترتيب البنود ويكسر ترتيباً مقصوداً
 * في `lib/nav.ts` («مهام اليوم» أولاً دائماً). التجاور يحترم الترتيب
 * المكتوب: مجموعة جديدة تبدأ حين يتغيّر الاسم، لا حين يتكرّر.
 *
 * ⚠️ وبندان بلا مجموعة **متجاوران** يقعان معاً — وهذا صحيح: كلاهما بلا
 * عنوان، فلا فرق بصري بين ضمّهما وفصلهما.
 */
function groupNav(nav: readonly NavItem[]): NavGroup[] {
  const out: NavGroup[] = [];
  for (const item of nav) {
    const last = out.at(-1);
    if (last && last.label === (item.group ?? null)) last.items.push(item);
    else out.push({ label: item.group ?? null, key: item.href, items: [item] });
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
  const lastIndex = groups.length - 1;

  return (
    /*
     * ── ⚠️ **بلا حدّ رأسيّ.** ────────────────────────────────────────
     * `shadcn` يضع `border-l` على الحاوية حين `side="right"`. والرمز
     * `--color-sidebar` فوقه في `globals.css` مكتوبٌ صراحةً ليجعل السطحين
     * مختلفَي اللون «فتُقرأ الطبقتان بلا إطار ثقيل» — ثم يأتي الحدّ فيرسم
     * الإطار الذي نُفي. الطبقتان تُميَّزان باللون وحده، وهو أهدأ للعين.
     *
     * ── ولماذا `border-transparent` لا `border-l-0` ────────────────────
     * ⚠️ إلغاء العرض يلزمه **نفس المُحدِّد** (`group-data-[side=right]:`)،
     * لأن صنفاً بلا مُتغيّر لا يهزم صنفاً بمُتغيّر في `tailwind-merge` ولا
     * في التخصّص. وكتابته تُدخل `border-l` في ملفّ يمنع فيه ESLint كلَّ
     * اتجاه فيزيائي (‏§11.1) — وليس في المشروع استثناءٌ سطريّ واحد، ولن
     * أفتح أوّله لأجل خطّ.
     *
     * وتصفير **اللون** يكفي: `globals.css` يلوّن كل الحدود بـ
     * `--color-border`، وهذا يبطله. والصنف غير اتجاهيّ، ولا حدَّ آخر على
     * هذه الحاوية ليتأثّر.
     */
    <Sidebar side="right" collapsible="icon" className="border-transparent">
      <SidebarHeader className="px-3 py-4">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              asChild
              className="h-auto gap-3 rounded-xl px-2 py-2 hover:bg-sidebar-accent/40"
            >
              <Link href="/">
                {/*
                 * ⚠️ **لونٌ واحد لا تدرّج.** التدرّج كان يقول «هوية» —
                 * ويقولها بلهجة تسويقية. وهذه لوحةُ عملٍ إداريّ تُفتح كل
                 * يوم ساعات، والعلامة فيها تُعرَّف ولا تُعرَض. واللون
                 * المصمت أهدأ للعين وأدلّ على الرسميّة.
                 */}
                <span
                  className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent-brand text-white"
                  aria-hidden
                >
                  <Building2 className="size-4.5" />
                </span>
                <span className="grid flex-1 text-start leading-tight">
                  <span className="truncate text-theme-sm font-semibold">
                    نظام إدارة المجمّع
                  </span>
                  {/*
                    ⚠️ «السكني» **صفةٌ معلّقة** كانت تُقرأ سطراً ثانياً بلا
                    موصوف. صارت الوصف الذي يقوله الشريط عن نفسه.
                  */}
                  <span className="truncate text-theme-xs text-muted-foreground">
                    مجمَّع سكني
                  </span>
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      {/*
        ⚠️ **لا فاصل تحت الترويسة، ولا بين المجموعات.** كان `SidebarSeparator`
        يرسم خطّاً عبر العرض كلّه، ثم يأتي عنوان المجموعة الأول تحته بأربعة
        بكسلات — فيُقرأ خطّان أفقيّان متتاليان.

        والفراغ يفصل بما يكفي: `gap-6` بين المجموعات يقول «هنا تبدأ مجموعة
        أخرى» بلا خطٍّ واحد. وهذا هو الفرق بين شريطٍ مقسَّم إلى شرائح
        وشريطٍ سطحه واحد.
      */}
      <SidebarContent className="gap-6 px-3 pb-4">
        {groups.map(({ label, key, items }, index) => (
          <SidebarGroup
            key={key}
            /*
             * ⚠️ آخر مجموعة بلا عنوان تُدفع إلى الأسفل: «ملفي» في ذيل
             * الشريط حيث يتوقّعه المستخدم — والفراغ الذي كان يملأ نصف
             * الشريط يصير فاصلاً له معنى بدل أن يكون فراغاً.
             */
            className={[
              "px-0 py-0",
              label === null && index === lastIndex && index > 0 ? "mt-auto" : "",
            ].join(" ")}
          >
            {label === null ? null : (
              <SidebarGroupLabel className={GROUP_LABEL}>{label}</SidebarGroupLabel>
            )}
            <SidebarGroupContent>
              <SidebarMenu className="gap-1">
                {items.map(({ href, label: itemLabel, icon }) => {
                  const Icon = ICONS[icon];
                  return (
                    <SidebarMenuItem key={href}>
                      <SidebarMenuButton
                        asChild
                        isActive={isActive(href)}
                        /* التلميح يظهر حين يُطوى الشريط إلى أيقونات */
                        tooltip={itemLabel}
                        className={NAV_ITEM}
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
