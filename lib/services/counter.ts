import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { CounterKind } from "@/lib/domain/enums";
import { now, toBaghdadParts } from "@/lib/dates";

/**
 * الترقيم السنوي — `INV-2026-000123` · `CTR-2026-0041` · `REQ-2026-000045`.
 *
 * ── لماذا جدول عدّاد لا تسلسل Postgres (‏Q17) ─────────────────────────
 * `R34` يوجب تنسيقاً يحمل **السنة**، وتسلسل Postgres لا يُصفَّر سنوياً
 * تلقائياً. والبديل الساذج `MAX(number) + 1` **يتكرّر عند التزامن**:
 * معاملتان تقرآن نفس الأقصى فتُنتجان نفس الرقم — ورقما فاتورة متطابقان
 * كارثة محاسبية لا عيب تجميلي.
 *
 * الحلّ: صفّ لكل `(kind, year)` يُقرأ بـ`FOR UPDATE`، فتُسلسَل المعاملات.
 *
 * ── الفراغات مقبولة والتكرار ممنوع (‏R34 حرفياً) ──────────────────────
 * معاملة تحجز رقماً ثم تفشل تترك **فجوة**، وهذا مقبول صراحةً. الفجوة
 * تُفسَّر، أما التكرار فلا. لذلك الحجز يجري **داخل معاملة الدفع نفسها**:
 * لو تراجعت المعاملة تراجع معها الرقم.
 */

const PADDING: Record<CounterKind, number> = {
  INV: 6, // INV-2026-000123
  CTR: 4, // CTR-2026-0041
  REQ: 6, // REQ-2026-000045
};

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * يحجز الرقم التالي ويُعيده منسَّقاً.
 *
 * ⚠️ **مرّر `tx` دائماً** حين يكون الترقيم جزءاً من عملية أكبر (دفعة،
 * عقد، طلب). بدونه يُلتزَم الرقم في معاملة مستقلة، فيبقى محجوزاً حتى لو
 * فشلت العملية — فجوة بلا داعٍ.
 *
 * السنة **بتوقيت بغداد** لا بتوقيت الخادم: فاتورة تُصدر 31/12 الساعة 23:30
 * بغداد هي 20:30 UTC من اليوم نفسه — لكن العكس (‏1/1 الساعة 01:00 بغداد)
 * يقع في السنة السابقة بتوقيت UTC، فيحمل الرقم سنةً خاطئة.
 */
export async function nextNumber(
  kind: CounterKind,
  tx?: Prisma.TransactionClient,
  at: Date = now(),
): Promise<string> {
  const year = toBaghdadParts(at).year;
  if (tx) return reserve(tx, kind, year);
  return prisma.$transaction((client) => reserve(client, kind, year));
}

async function reserve(db: Db, kind: CounterKind, year: number): Promise<string> {
  // ‏INSERT … ON CONFLICT … DO UPDATE ذرّي: يُنشئ الصفّ إن غاب ويزيده إن
  // وُجد، في عبارة واحدة تأخذ القفل ضمناً. أبسط من SELECT FOR UPDATE ثم
  // UPDATE، ولا تترك نافذة سباق بين القراءة والكتابة.
  const rows = await db.$queryRaw<Array<{ lastValue: number }>>`
    INSERT INTO "Counter" ("kind", "year", "lastValue", "updatedAt")
    VALUES (${kind}::"CounterKind", ${year}, 1, now())
    ON CONFLICT ("kind", "year")
    DO UPDATE SET "lastValue" = "Counter"."lastValue" + 1, "updatedAt" = now()
    RETURNING "lastValue"
  `;

  const value = rows[0]?.lastValue;
  if (value === undefined) {
    throw new Error(`تعذّر حجز رقم لـ${kind}/${year}`);
  }

  return format(kind, year, value);
}

export function format(kind: CounterKind, year: number, value: number): string {
  return `${kind}-${year}-${String(value).padStart(PADDING[kind], "0")}`;
}

/** قراءة بلا حجز — للعرض والتشخيص فقط. */
export async function peek(kind: CounterKind, at: Date = now()): Promise<number> {
  const year = toBaghdadParts(at).year;
  const rows = await prisma.$queryRaw<Array<{ lastValue: number }>>`
    SELECT "lastValue" FROM "Counter" WHERE "kind" = ${kind}::"CounterKind" AND "year" = ${year}
  `;
  return rows[0]?.lastValue ?? 0;
}
