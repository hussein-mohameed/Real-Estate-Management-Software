/**
 * ═══════════════════════════════════════════════════════════════════════
 *  تصدير CSV.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── 🔴 وثلاثة أشياء تُفسد ملفّ CSV عربياً، وكلّها هنا ────────────────
 *
 * ١) **`BOM` في أوّل الملفّ.** بدونه يفتح Excel على ويندوز الملفّ
 *    بترميز النظام المحلّي فتظهر العربية رموزاً — وهو أشهر عطبٍ في
 *    تصدير عربي، ويُقرأ «التقرير معطوب» لا «الترميز خطأ».
 *
 * ٢) **حقن الصيغ.** خليّة تبدأ بـ`=` أو `+` أو `-` أو `@` يفتحها Excel
 *    كصيغة. واسمٌ يبدأ بـ`=` يُنفَّذ عند الفتح — وهذا `CSV injection`،
 *    ثغرةٌ حقيقية لا تجميل. تُسبَق بفاصلة عليا.
 *
 * ٣) **المال.** الدينار `BigInt` بلا كسور، ويُكتب **رقماً خاماً بلا
 *    فواصل** كي يجمعه Excel. والتنسيق العربي للعرض لا للملفّ — ورقمٌ
 *    مثل «١٢٬٥٠٠ د.ع» عمودٌ نصّي لا يُجمَع.
 *
 * ⚠️ ولا تُصدَّر الأرقام الهندية: الملفّ يُقرأ بأداة، والأداة تقرأ
 *    اللاتينية. أمّا الشاشة فتعرض ما شاءت.
 */

/** خلية: نصّ · رقم · تاريخ · فراغ. */
export type CsvValue = string | number | bigint | Date | null | undefined;

const RISKY_PREFIX = /^[=+\-@\t\r]/u;

/** `YYYY-MM-DD HH:mm` بتوقيت بغداد — قابل للفرز والقراءة معاً. */
function baghdadStamp(value: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Baghdad",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(value);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

function cell(value: CsvValue): string {
  if (value === null || value === undefined) return "";

  /* ⚠️ المال والأعداد بلا اقتباس ولا فواصل — كي تُجمَع في الجدول */
  if (typeof value === "bigint" || typeof value === "number") return String(value);
  if (value instanceof Date) return baghdadStamp(value);

  const text = RISKY_PREFIX.test(value) ? `'${value}` : value;
  /* الاقتباس المزدوج داخل النصّ يُضاعَف — قاعدة RFC 4180 */
  return `"${text.replace(/"/gu, '""')}"`;
}

/**
 * يبني ملفّ CSV من عناوين وصفوف.
 *
 * ⚠️ **`\r\n` لا `\n`**: RFC 4180 يوجبه، وExcel على ويندوز يقرأ الملفّ
 * ذا الأسطر الأحادية سطراً واحداً طويلاً في بعض الإعدادات.
 */
export function toCsv(headers: readonly string[], rows: readonly CsvValue[][]): string {
  const lines = [headers.map((h) => cell(h)).join(",")];
  for (const row of rows) lines.push(row.map((c) => cell(c)).join(","));
  /* `﻿` — راجع (١) أعلاه */
  return `﻿${lines.join("\r\n")}\r\n`;
}

/**
 * اسم ملفٍّ آمن ومفهوم.
 *
 * ⚠️ العربية في اسم الملفّ تمرّ في `Content-Disposition` **مُرمَّزة**
 * (`filename*=UTF-8''…`)، ومتصفّحات قديمة تسقطها. فالاسم لاتينيّ
 * بالتاريخ — يُفرز في المجلّد ويُعرَف بلا فتحه.
 */
export function csvFileName(slug: string, from?: Date, to?: Date): string {
  const day = (d: Date): string =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Baghdad",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);

  const span = from && to ? `_${day(from)}_${day(new Date(to.getTime() - 1))}` : "";
  return `${slug}${span}.csv`;
}
