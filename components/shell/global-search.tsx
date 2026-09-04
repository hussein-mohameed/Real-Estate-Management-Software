"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileSignature, Home, Loader2, Search, Users } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Ltr } from "@/components/ui/ltr";
import { cn } from "@/lib/cn";
import { globalSearch, type SearchHit, type SearchHitKind } from "@/lib/actions/search";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  البحث العامّ.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── حقلٌ **واحد** لا حقلان ──────────────────────────────────────────
 * ⚠️ الزرّ على الشريط يبدو حقلاً على الحاسوب وأيقونةً على الهاتف، لكنه
 * في الحالتين **يفتح نفس الحوار**. الحقل المضمّن في الشريط كان سيحتاج
 * لوحة نتائج ثانية بموضعها وتمريرها ومنطق إغلاقها — أي مسار كودٍ ثانياً
 * يتفرّق عن الأول عند أول تعديل.
 *
 * ── والنتائج تصل من إجراء خادم لا من نقطة نهاية ─────────────────────
 * `globalSearch` يفحص الصلاحية بنفسه ويُسقط ما لا يُصرَّح به — راجع
 * تعليقه. ولا شيء هنا يقرّر ما يُعرض.
 *
 * ── ⚠️ ثلاث مصائد في البحث أثناء الكتابة ───────────────────────────
 *   1. **طلب لكل حرف.** «شقة 12» = ستّة طلبات وخمسة منها مهدورة. تأخيرٌ
 *      قصير يجمع ضربات المفاتيح في طلب واحد.
 *   2. **ردٌّ متأخّر يكتب فوق ردٍّ أحدث.** طلب «ش» قد يعود بعد طلب «شقة»
 *      فتُعرض نتائج أعمّ من المكتوب. كل طلب يحمل رقمه، وما ليس الأحدث
 *      يُهمَل.
 *   3. **«لا نتائج» قبل أن يبدأ البحث.** الفرق بين «فحصنا ولم نجد»
 *      و«لم نبحث بعد» ليس تجميلياً: الأول يجعل المستخدم يبحث بكلمة أخرى،
 *      والثاني يجعله ينتظر.
 */

const DEBOUNCE_MS = 250;
const MIN_QUERY = 2;

const KIND: Record<SearchHitKind, { icon: typeof Home; label: string; chip: string }> = {
  apartment: { icon: Home, label: "شقة", chip: "bg-accent-brand-soft text-accent-brand-strong" },
  resident: { icon: Users, label: "ساكن", chip: "bg-occupancy-owner/10 text-occupancy-owner" },
  contract: {
    icon: FileSignature,
    label: "عقد",
    chip: "bg-occupancy-tenant/10 text-occupancy-tenant",
  },
};

export function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  /**
   * ⚠️ **النتيجة تحمل نصّها.**
   * تخزين `hits` وحدها كان يجعل رسالة «لا نتائج لـ…» تعرض ما يكتبه
   * المستخدم **الآن** لا ما بُحث عنه فعلاً — فتقول «لا نتائج لـ‹شقة 12›»
   * وهي نتيجة البحث عن «شقة». وحملُ `q` معها يجعل الرسالة صادقة دائماً.
   */
  const [result, setResult] = useState<{
    q: string;
    hits: SearchHit[];
    truncated: boolean;
  } | null>(null);
  const [pending, startTransition] = useTransition();

  /** رقم أحدث طلب — يُهمَل ما دونه (المصيدة 2). */
  const latest = useRef(0);

  const q = query.trim();
  const tooShort = q.length < MIN_QUERY;

  /**
   * ⚠️ **مُشتقّ لا مُخزَّن.** مسح النتائج داخل التأثير حين يقصر النصّ
   * كان `setState` متزامناً في تأثير — تصييرٌ متتالٍ ترفضه قاعدة
   * `react-hooks/set-state-in-effect` بحقّ. والاشتقاق أثناء التصيير يعطي
   * نفس النتيجة بلا دورة زائدة، ويُسقط حالةً كان يمكن أن تتناقض.
   */
  const shown = tooShort ? null : result;

  useEffect(() => {
    const term = query.trim();
    if (term.length < MIN_QUERY) return;

    const id = window.setTimeout(() => {
      const ticket = ++latest.current;
      startTransition(async () => {
        const out = await globalSearch(term);
        if (ticket !== latest.current) return;
        setResult({ q: term, hits: out.hits, truncated: out.truncated });
      });
    }, DEBOUNCE_MS);

    return () => window.clearTimeout(id);
  }, [query]);

  /** ⌘K / Ctrl+K — الاختصار المتوقّع، ويمنع فتح بحث المتصفّح فوقه. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      setQuery("");
      setResult(null);
      router.push(href);
    },
    [router],
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-9 items-center gap-2 rounded-full border bg-surface-muted/60 text-muted-foreground transition-colors",
            "hover:bg-surface-muted hover:text-foreground",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
            // أيقونة على الهاتف، حقلٌ بعرضٍ ثابت على الحاسوب
            "size-9 justify-center md:w-56 md:justify-start md:px-3 lg:w-72",
          )}
        >
          <Search className="size-4 shrink-0" aria-hidden />
          <span className="hidden flex-1 text-start text-theme-sm md:block">
            بحث في الشقق والسكان والعقود…
          </span>
          {/*
           * ⚠️ التلميح فيزيائي بالضرورة: `Ctrl K` سلسلة مفاتيح تُقرأ
           * بترتيبها على لوحة المفاتيح، لا نصّ يتبع اتجاه اللغة.
           */}
          <Ltr className="hidden shrink-0 rounded border bg-surface px-1.5 py-0.5 text-[10px] font-medium lg:block">
            Ctrl K
          </Ltr>
          <span className="sr-only md:hidden">بحث</span>
        </button>
      </DialogTrigger>

      <DialogContent className="top-24 translate-y-0 gap-0 p-0 sm:max-w-xl" showCloseButton={false}>
        <DialogHeader className="sr-only">
          <DialogTitle>البحث العامّ</DialogTitle>
          <DialogDescription>ابحث في الشقق والسكان والعقود.</DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 border-b px-4">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="رقم شقة · اسم ساكن · رقم عقد"
            aria-label="نصّ البحث"
            className="h-12 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
          />
          {pending ? (
            <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />
          ) : null}
        </div>

        <div className="max-h-80 overflow-y-auto p-2" role="listbox" aria-label="نتائج البحث">
          {shown === null ? (
            <p className="px-3 py-6 text-center text-theme-sm text-muted-foreground">
              اكتب حرفين على الأقل.
            </p>
          ) : shown.hits.length === 0 ? (
            <p className="px-3 py-6 text-center text-theme-sm text-muted-foreground">
              لا نتائج لـ«{shown.q}».
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {shown.hits.map((hit) => {
                const k = KIND[hit.kind];
                const Icon = k.icon;
                return (
                  <li key={`${hit.kind}:${hit.id}`}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={false}
                      onClick={() => go(hit.href)}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-start transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                    >
                      <span
                        className={cn("grid size-8 shrink-0 place-items-center rounded-lg", k.chip)}
                        aria-hidden
                      >
                        <Icon className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-theme-sm font-medium">
                          <Ltr>{hit.label}</Ltr>
                        </span>
                        <span className="block truncate text-theme-xs text-muted-foreground">
                          {hit.sub}
                        </span>
                      </span>
                      <span className="shrink-0 text-theme-xs text-muted-foreground">
                        {k.label}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {shown?.truncated ? (
            /* ⚠️ يُقال صراحةً: قائمةٌ مقصوصة بصمت تجعل المستخدم يستنتج
               أن ما لم يظهر غير موجود */
            <p className="border-t px-3 pt-3 text-center text-theme-xs text-muted-foreground">
              تُعرض أوّل خمس نتائج من كل نوع — ضيّق البحث أو افتح الشاشة كاملة.
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
