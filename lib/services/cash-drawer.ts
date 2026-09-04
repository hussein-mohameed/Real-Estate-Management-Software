import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { BusinessRuleError, NotFoundError } from "@/lib/errors";
import { now } from "@/lib/dates";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  صندوق النقد — القرار `B4` (‏2026-09-01).
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── الثغرة التي وُجد من أجلها ───────────────────────────────────────
 * مصفوفة §3.2 تعطي كل موظف صلاحية «تسجيل دفعة نقدية» على **أي حساب**.
 * وموظف يسجّل دفعة ويقبض النقد ولا يورّده = **إسقاط دَين مقابل سرقة**.
 * الدفتر `append-only` فالقيد لا يُحذف — لكن الدَين سقط والنقد بجيبه.
 *
 * ── والعلم وحده لا يكفي ─────────────────────────────────────────────
 * `canReceiveCash` حراسةٌ على الباب: تقرّر **من يدخل**. والجلسة تجيب
 * السؤال الآخر: **هل ورّد ما سجّله؟** والفرق عملي لا لفظي — تقرير
 * «تحصيل الموظف س اليوم» يجيب عن الأول ولا يقترب من الثاني.
 *
 * ── ⚠️ والفرق **يُحسب لا يُخزَّن** (المبدأ 1) ────────────────────────
 * `expectedIqd` مجموع دفعات الجلسة، **استعلام لا عمود**. عمودٌ مخزَّن
 * يتقادم عند أول دفعة تُسجَّل خارج المسار المتوقَّع، ويبدو معقولاً دائماً.
 * والمخزَّن شيء واحد لا يُشتقّ: `declaredIqd` — ما أقرّ الموظف بتوريده.
 *
 * ── ⚠️ والفرق **يُسجَّل ولا يمنع الإقفال** ─────────────────────────
 * نقصٌ في الصندوق **واقعةٌ تُوثَّق** لا خطأ يُرفض. ورفضُ الإقفال بسببه
 * يجعل الموظف يترك الصندوق مفتوحاً بلا إقفال، فيضيع الضابط كلّه ويبقى
 * النقص مخفياً. الإقفال يمضي، والفرق يظهر باسم صاحبه وفي يومه.
 */

type Db = Prisma.TransactionClient | typeof prisma;

export interface DrawerSummary {
  sessionId: string;
  staffUserId: string;
  openedAt: Date;
  closedAt: Date | null;
  /** مجموع الدفعات المسجَّلة على الجلسة — **محسوب**. */
  expectedIqd: bigint;
  /** ما أقرّ الموظف بتوريده. `null` ما دامت مفتوحة. */
  declaredIqd: bigint | null;
  /**
   * `declaredIqd − expectedIqd`. سالب = **نقص**، موجب = زيادة.
   * `null` ما دامت الجلسة مفتوحة.
   */
  varianceIqd: bigint | null;
  paymentsCount: number;
}

/** مجموع دفعات الجلسة — استعلام مجمَّع لا حلقة في الذاكرة. */
async function expectedFor(sessionId: string, db: Db): Promise<{ sum: bigint; count: number }> {
  const agg = await db.payment.aggregate({
    where: {
      cashDrawerSessionId: sessionId,
      // ⚠️ المدفوعة وحدها. دفعة `PENDING` أو `FAILED` لا نقد فيها،
      // وإدخالُها في المتوقَّع يُنتج نقصاً وهمياً في كل إقفال.
      status: "PAID",
    },
    _sum: { amountIqd: true },
    _count: { _all: true },
  });
  return { sum: agg._sum.amountIqd ?? 0n, count: agg._count._all };
}

function summarize(
  row: {
    id: string;
    staffUserId: string;
    openedAt: Date;
    closedAt: Date | null;
    declaredIqd: bigint | null;
  },
  expected: { sum: bigint; count: number },
): DrawerSummary {
  return {
    sessionId: row.id,
    staffUserId: row.staffUserId,
    openedAt: row.openedAt,
    closedAt: row.closedAt,
    expectedIqd: expected.sum,
    declaredIqd: row.declaredIqd,
    varianceIqd: row.declaredIqd === null ? null : row.declaredIqd - expected.sum,
    paymentsCount: expected.count,
  };
}

/**
 * يفتح جلسة صندوق للموظف.
 *
 * ⚠️ **العلم يُفحص هنا لا في الواجهة.** الإجراء نقطة نهاية HTTP، وموظفٌ
 * بلا `canReceiveCash` يستطيع استدعاءه مباشرةً. والفهرس الفريد الجزئي
 * `uniq_open_cash_drawer_per_staff` يحرس «جلسة واحدة» في القاعدة.
 */
export async function openDrawerFor(
  staffUserId: string,
  db: Db = prisma,
): Promise<DrawerSummary> {
  const profile = await db.staffProfile.findUnique({
    where: { userId: staffUserId },
    select: { canReceiveCash: true },
  });
  if (!profile) {
    throw new NotFoundError("الملفّ الوظيفي");
  }
  if (!profile.canReceiveCash) {
    throw new BusinessRuleError(
      "لا تملك صلاحية قبض النقد. تُمنح صراحةً من الإدارة.",
      "B4",
    );
  }

  const open = await db.cashDrawerSession.findFirst({
    where: { staffUserId, closedAt: null },
    select: { id: true },
  });
  if (open) {
    throw new BusinessRuleError("لديك صندوق مفتوح — أقفله قبل فتح آخر.");
  }

  const row = await db.cashDrawerSession.create({
    data: { staffUserId, openedAt: now() },
    select: { id: true, staffUserId: true, openedAt: true, closedAt: true, declaredIqd: true },
  });

  return summarize(row, { sum: 0n, count: 0 });
}

/**
 * الجلسة المفتوحة للموظف، أو `null`.
 *
 * ⚠️ يستدعيها `recordCashPayment`: **دفعة نقدية بلا جلسة مفتوحة تُرفض**.
 * والقيد `payment_cash_needs_drawer` يحرس ذلك في القاعدة أيضاً — الشرط في
 * الكود يعطي رسالة عربية مفهومة، والقيد يمنع المسار الذي يُكتب بعد سنة
 * وينسى الشرط.
 */
export async function openDrawerIdFor(
  staffUserId: string,
  db: Db = prisma,
): Promise<string | null> {
  const row = await db.cashDrawerSession.findFirst({
    where: { staffUserId, closedAt: null },
    select: { id: true },
  });
  return row?.id ?? null;
}

/** حالة جلسة بعينها — للشاشة وللإقفال. */
export async function drawerSummary(
  sessionId: string,
  db: Db = prisma,
): Promise<DrawerSummary> {
  const row = await db.cashDrawerSession.findUnique({
    where: { id: sessionId },
    select: { id: true, staffUserId: true, openedAt: true, closedAt: true, declaredIqd: true },
  });
  if (!row) throw new NotFoundError("جلسة الصندوق");
  return summarize(row, await expectedFor(sessionId, db));
}

/**
 * يُقفل الجلسة بمبلغ مُقرّ.
 *
 * ⚠️ **الفرق لا يمنع الإقفال.** راجع تعليق الرأس: الرفض يجعل الموظف يترك
 * الصندوق مفتوحاً فيضيع الضابط ويبقى النقص مخفياً.
 */
export async function closeDrawer(
  sessionId: string,
  declaredIqd: bigint,
  closedByUserId: string,
  notes: string | null,
  db: Db = prisma,
): Promise<DrawerSummary> {
  if (declaredIqd < 0n) {
    throw new BusinessRuleError("المبلغ المُقرّ لا يكون سالباً.");
  }

  /**
   * ⚠️ الإقفال بـ`updateMany` بشرط `closedAt: null`: إقفالان متوازيان
   * يقرآن «مفتوحة» كلاهما، والشرط في الكود لا يرى ذلك. والثاني يجب أن
   * يُصيب صفراً لا أن يكتب فوق مبلغ الأول.
   */
  const claimed = await db.cashDrawerSession.updateMany({
    where: { id: sessionId, closedAt: null },
    data: { closedAt: now(), declaredIqd, closedByUserId, notes },
  });

  if (claimed.count === 0) {
    const exists = await db.cashDrawerSession.findUnique({
      where: { id: sessionId },
      select: { closedAt: true },
    });
    if (!exists) throw new NotFoundError("جلسة الصندوق");
    throw new BusinessRuleError("الصندوق مُقفَل سلفاً — لا يُقفَل مرّتين.");
  }

  return drawerSummary(sessionId, db);
}

/**
 * تقرير «تحصيل الموظف س» — الجلسات المُقفَلة بفروقها.
 *
 * ⚠️ **الفرق غير الصفري يُعلَّم صراحةً.** جدولٌ من أرقام يحتاج قراءة كل
 * سطر لمعرفة أيّ يوم فيه نقص؛ والعلم يجعله يُقرأ بلمحة، وهو ما يُفتح
 * التقرير من أجله.
 */
export async function drawerHistoryFor(
  staffUserId: string,
  limit = 30,
  db: Db = prisma,
): Promise<DrawerSummary[]> {
  const rows = await db.cashDrawerSession.findMany({
    where: { staffUserId },
    select: { id: true, staffUserId: true, openedAt: true, closedAt: true, declaredIqd: true },
    orderBy: { openedAt: "desc" },
    take: limit,
  });

  /**
   * ⚠️ مجاميع الجلسات **دفعةً واحدة** لا استعلاماً لكل جلسة.
   * ثلاثون جلسة كانت ستُطلق ثلاثين استعلاماً — والتقرير يُفتح يومياً.
   */
  const grouped = await db.payment.groupBy({
    by: ["cashDrawerSessionId"],
    where: { cashDrawerSessionId: { in: rows.map((r) => r.id) }, status: "PAID" },
    _sum: { amountIqd: true },
    _count: { _all: true },
  });
  const byId = new Map(
    grouped.map((g) => [
      g.cashDrawerSessionId!,
      { sum: g._sum.amountIqd ?? 0n, count: g._count._all },
    ]),
  );

  return rows.map((r) => summarize(r, byId.get(r.id) ?? { sum: 0n, count: 0 }));
}

/**
 * تحصيل مجموعة موظفين اليوم — عمود شاشة الموظفين (‏B4).
 *
 * ── ⚠️ استعلام **واحد** لكل الصفحة لا واحد لكل صفّ ───────────────────
 * `drawerSummary` تخدم موظفاً واحداً. واستدعاؤها في حلقة على 25 صفّاً
 * يعني 25 رحلة إلى القاعدة في كل تحميل لشاشة تُفتح يومياً.
 *
 * ── ⚠️ و`status: 'PAID'` هنا **نفسه** في `expectedFor` ───────────────
 * لو رشّح أحدهما `PENDING` وتركه الآخر، لاختلف رقم العمود عن رقم شاشة
 * الصندوق لنفس الموظف في نفس اليوم — ولا أحد يعرف أيّهما الصحيح. أي
 * تغيير في أحدهما يلزمه تغيير في الآخر.
 *
 * ── وحدّ اليوم بتوقيت بغداد ─────────────────────────────────────────
 * `openedAt` عمود بلا منطقة زمنية، والحدّ يُبنى من بداية يوم بغداد كي لا
 * يقفز التقرير إلى يوم الأمس بعد التاسعة مساءً.
 *
 * ── ⚠️ والصندوق المفتوح يُرى **أياً كان يومه** ───────────────────────
 * الترشيح بـ`openedAt >= اليوم` وحده كان يُخفي **الخرق الأهمّ**: قرار B4
 * يوجب إقفالاً يومياً، وصندوقٌ بقي مفتوحاً من أمس هو بالضبط ما يبحث عنه
 * من يراجع. وكان يظهر «لم يفتح صندوقاً» — أي أن العمود يطمئن حيث يجب
 * أن يُنذر.
 *
 * فالمجموع يبقى على **اليوم** (وإلا خُلط مال يومين في رقم واحد)، والحالة
 * تُقرأ على **كل** جلسة مفتوحة، و`staleDrawer` تُسمّي الخرق باسمه.
 */
export interface StaffCollection {
  staffUserId: string;
  collectedIqd: bigint;
  payments: number;
  hasOpenDrawer: boolean;
  /** ⚠️ صندوق مفتوح فُتح قبل اليوم — خرق «الإقفال اليومي» (‏B4). */
  staleDrawer: boolean;
}

export async function collectionByStaff(
  staffUserIds: string[],
  since: Date,
  db: Db = prisma,
): Promise<Map<string, StaffCollection>> {
  const out = new Map<string, StaffCollection>();
  if (staffUserIds.length === 0) return out;

  /*
   * ⚠️ SQL خام لأن `groupBy` في Prisma لا يجمع عبر علاقة: المطلوب تجميع
   * `Payment` حسب `CashDrawerSession.staffUserId`، وهو حقل الجدول الآخر.
   * والبديل جلبُ كل الدفعات إلى الذاكرة وجمعُها في JS.
   */
  const rows = await db.$queryRaw<
    Array<{
      staffUserId: string;
      total: bigint | null;
      count: bigint;
      hasOpen: boolean;
      staleOpen: boolean;
    }>
  >`
    SELECT s."staffUserId",
           SUM(p."amountIqd") FILTER (
             WHERE p."status" = 'PAID' AND s."openedAt" >= ${since}
           ) AS total,
           COUNT(p."id") FILTER (
             WHERE p."status" = 'PAID' AND s."openedAt" >= ${since}
           ) AS count,
           bool_or(s."closedAt" IS NULL) AS "hasOpen",
           bool_or(s."closedAt" IS NULL AND s."openedAt" < ${since}) AS "staleOpen"
    FROM "CashDrawerSession" s
    LEFT JOIN "Payment" p ON p."cashDrawerSessionId" = s."id"
    WHERE s."staffUserId" = ANY(${staffUserIds})
      AND (s."openedAt" >= ${since} OR s."closedAt" IS NULL)
    GROUP BY s."staffUserId"
  `;

  for (const r of rows) {
    out.set(r.staffUserId, {
      staffUserId: r.staffUserId,
      collectedIqd: r.total ?? 0n,
      payments: Number(r.count),
      hasOpenDrawer: r.hasOpen,
      staleDrawer: r.staleOpen,
    });
  }
  return out;
}
