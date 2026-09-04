import { THEME_KEY } from "./theme";

/**
 * النصّ الحاجب الذي يطبّق السمة **قبل أول رسم**.
 *
 * ── لماذا نصّ مضمّن لا تأثير React ──────────────────────────────────
 * ⚠️ تطبيق السمة داخل `useEffect` يعني أن الصفحة تُرسَم فاتحةً أولاً ثم
 * تنقلب داكنة بعد الترطيب — **وميضٌ أبيض** في كل تنقّل، وهو أسوأ ما
 * يُلاحَظ في واجهة داكنة. النصّ المضمّن يُنفَّذ أثناء تحليل المستند، قبل
 * أن يُرسَم شيء.
 *
 * ── ولماذا يكتب **سمة وصنفاً** معاً ────────────────────────────────
 *   • `data-theme` تقرأه لوحة الألوان في `globals.css`.
 *   • الصنف `dark` يقرأه `@custom-variant dark (&:is(.dark *))` — أي كل
 *     أداة `dark:` في المشروع.
 *
 * ⚠️ **والثاني كان مفقوداً.** المشروع فيه 33 أداة `dark:` ولا شيء كان
 * يضيف الصنف قط، فكانت كلها **ميتة**: لا تفشل في بناء ولا نوع ولا
 * اختبار — تُكتب ولا تُطبَّق أبداً.
 *
 * ⚠️ و`try/catch` ليس زينة: `localStorage` **يرمي** في التصفّح الخاصّ
 * ببعض المتصفّحات، وسقوط هذا النصّ يعني صفحةً بلا سمة.
 */
const SCRIPT = `(function(){try{var c=localStorage.getItem(${JSON.stringify(
  THEME_KEY,
)});var d=c==="dark"||(c!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;r.dataset.theme=d?"dark":"light";r.classList.toggle("dark",d);}catch(e){}})();`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />;
}
