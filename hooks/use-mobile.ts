import * as React from "react";

const MOBILE_BREAKPOINT = 768;
const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

/**
 * هل نحن على شاشة هاتف؟
 *
 * ── لماذا `useSyncExternalStore` لا `useEffect` ─────────────────────
 * ⚠️ النسخة الأصلية تضبط الحالة **داخل التأثير** لقراءة القياس أول مرّة،
 * فتُصيّر المكوّن مرّتين: مرّةً بقيمة خاطئة ثم بالصحيحة. على الهاتف يعني
 * ذلك **وميض الشريط الجانبي** قبل أن يصير درجاً.
 *
 * و`useSyncExternalStore` هو الـAPI المخصَّص للاشتراك بمصدر خارجي: يقرأ
 * القيمة الصحيحة في التصيير الأول، ويشترك للتحديثات — بلا حالة وسيطة.
 *
 * ودالّة الخادم تُعيد `false`: لا نافذة على الخادم، والافتراض «سطح مكتب»
 * يطابق ما يراه الزاحف وما يُرسَّخ في HTML الأولي.
 */
function subscribe(onChange: () => void): () => void {
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

export function useIsMobile(): boolean {
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}
