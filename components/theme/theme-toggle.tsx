"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { THEME_KEY, type ThemeChoice } from "./theme";

/**
 * مُبدِّل السمة.
 *
 * ── ثلاث حالات في قائمة لا حالتان في زرّ ───────────────────────────
 * راجع تعليق `ThemeChoice`: «حسب النظام» غيابُ قيمة لا قيمة، والزرّ
 * ذو الحالتين يُتلفها عند أول نقرة.
 *
 * ── ولماذا `useSyncExternalStore` لا `useState` مع `useEffect` ──────
 * ⚠️ `localStorage` **مصدرٌ خارجي عن React**، والخادم لا يراه. فقراءته
 * أثناء التصيير تُنتج شجرةً تختلف عن المُرطَّبة، وقراءتها في تأثير ثم
 * `setState` تُنتج تصييراً متتالياً — وهو ما ترفضه قاعدة
 * `react-hooks/set-state-in-effect` بحقّ.
 *
 * والخُطّاف الموضوع لهذا بالضبط هو `useSyncExternalStore`: لقطة للخادم
 * («حسب النظام») ولقطة للمتصفّح، وReact يتولّى الانتقال بينهما بعد
 * الترطيب بلا تحذير ولا دورة زائدة.
 */

const LABELS: Record<ThemeChoice, string> = {
  light: "فاتح",
  dark: "داكن",
  system: "حسب النظام",
};

const ICONS = { light: Sun, dark: Moon, system: Monitor } as const;

/* ── مخزن صغير حول `localStorage` ─────────────────────────────────── */

const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

/**
 * حدث `storage` يصل من **تبويب آخر** لا من هذا التبويب. فالتبديل هنا
 * يستدعي `emit()` بنفسه — بدونه يتغيّر التخزين ولا تتحدّث الأيقونة.
 */
function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener("storage", emit);
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0) window.removeEventListener("storage", emit);
  };
}

function getSnapshot(): ThemeChoice {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "dark" || v === "light" ? v : "system";
  } catch {
    /* التصفّح الخاصّ يرمي — و«حسب النظام» افتراضٌ صحيح */
    return "system";
  }
}

/** ⚠️ لقطة الخادم **ثابتة**: لا `localStorage` هناك، والقيمة المتغيّرة تكسر الترطيب. */
function getServerSnapshot(): ThemeChoice {
  return "system";
}

/** يطبّق الاختيار على المستند — نفس ما يفعله النصّ الحاجب. */
function apply(choice: ThemeChoice): void {
  const dark =
    choice === "dark" ||
    (choice === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  const root = document.documentElement;
  root.dataset.theme = dark ? "dark" : "light";
  root.classList.toggle("dark", dark);
}

export function ThemeToggle({ className }: { className?: string }) {
  const choice = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  /**
   * ⚠️ **تغيّر تفضيل النظام أثناء فتح الصفحة.** بلا هذا المستمع تبقى
   * الصفحة داكنة بعد أن يعود النظام فاتحاً — ما دام الاختيار «حسب
   * النظام». والمستمع مقيَّد بهذه الحالة وحدها: مَن اختار صراحةً لا
   * يريد أن يتبدّل عليه شيء.
   */
  useEffect(() => {
    if (choice !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [choice]);

  const pick = useCallback((next: ThemeChoice) => {
    apply(next);
    try {
      // «حسب النظام» = **مسح** المفتاح، لا تخزين كلمة "system"
      if (next === "system") localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, next);
    } catch {
      /* السمة مطبَّقة على أي حال؛ ما يسقط هو تذكّرها فقط */
    }
    emit();
  }, []);

  const Icon = ICONS[choice];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn("size-9 rounded-full", className)}
          aria-label="السمة"
        >
          <Icon className="size-4.5" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="min-w-40">
        {(["light", "dark", "system"] as const).map((c) => {
          const ItemIcon = ICONS[c];
          return (
            <DropdownMenuItem
              key={c}
              onSelect={() => pick(c)}
              className={cn(choice === c && "bg-accent-brand-soft text-accent-brand")}
            >
              <ItemIcon className="size-4" />
              {LABELS[c]}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
