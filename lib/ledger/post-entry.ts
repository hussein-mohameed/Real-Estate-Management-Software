import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { assertPositiveIqd } from "@/lib/money";
import { BusinessRuleError, ConflictError, NotFoundError } from "@/lib/errors";
import type { LedgerEntryType, LedgerSource } from "@/lib/domain/enums";
import { collectErrorText } from "@/lib/db-errors";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  `postEntry()` — المنفذ **الوحيد** لكتابة قيد وتحريك رصيد.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── لماذا واحد ────────────────────────────────────────────────────────
 * ثابت الرصيد (‏R31) لا يمكن ضمانه إن كتب أكثر من مسار في الدفتر. مسار
 * ثانٍ ينسى قفل الصف، أو ينسى إعادة الحساب، أو يكتب مبلغاً سالباً — والخطأ
 * **صامت**: لا يظهر إلا حين يشتكي ساكن من رصيد لا يفهمه.
 *
 * ثلاث طبقات تفرض هذا المسار الوحيد:
 *   1. قاعدة ESLint تمنع `prisma.ledgerEntry.create` خارج `lib/ledger`.
 *   2. ‏trigger في Postgres يرفض أي `UPDATE`/`DELETE` على القيود.
 *   3. قيود CHECK ترفض المبالغ ≤ 0 و`MANUAL` بلا سبب.
 * الأولى تحمي من السهو، والثانيتان تحميان حتى من `psql`.
 *
 * ── قرار الأداء الواعي ────────────────────────────────────────────────
 * الرصيد **يُعاد حسابه من الدفتر بالكامل** داخل المعاملة، لا يُزاد بفارق.
 * الزيادة بالفارق أسرع لكنها **تنحرف بصمت** إن أخطأت مرة واحدة، فيصير
 * الكاش كذبةً لا يكتشفها إلا التدقيق الليلي بعد ساعات.
 * الحساب مربوط بعقد واحد، فعدد قيوده بالمئات لا بالملايين، والفهرس
 * `(accountId, createdAt)` يجعل الجمع رخيصاً. الدقّة أَولى هنا.
 */

export interface PostEntryInput {
  accountId: string;
  /** `ADJUSTMENT` **مرفوض** — انظر أدناه. */
  type: Extract<LedgerEntryType, "CHARGE" | "PAYMENT">;
  source: LedgerSource;
  /** موجب دائماً. الاتجاه يحمله `type` وحده. */
  amountIqd: bigint;
  /** ما يقرأه الساكن في كشف حسابه. إلزامي. */
  descriptionAr: string;
  periodStart?: Date | null;
  periodEnd?: Date | null;
  subscriptionId?: string | null;
  installmentId?: string | null;
  badgeId?: string | null;
  paymentId?: string | null;
  /** `null` حين يكتبه النظام (مهمة مجدولة). */
  createdByUserId?: string | null;
  /** **إلزامي** عندما `source = MANUAL`. */
  reason?: string | null;
}

export interface PostEntryResult {
  entryId: string;
  /** الرصيد **بعد** القيد — صحيح فوراً، لا بعد مهمة لاحقة. */
  balanceIqd: bigint;
}

/** أي عميل Prisma يصلح: العميل العام أو عميل معاملة قائمة. */
type Db = Prisma.TransactionClient | typeof prisma;

function validate(input: PostEntryInput): void {
  // D2/4: القيمة باقية في الـenum مطابقةً لـ§5، ومسار الكتابة يرفضها.
  // التسوية قيد CHARGE/PAYMENT بمصدر MANUAL وسبب إلزامي — فتبقى صيغة
  // الرصيد Σ CHARGE − Σ PAYMENT بلا أي فرع للإشارة.
  if ((input.type as string) === "ADJUSTMENT") {
    throw new BusinessRuleError(
      "قيود ADJUSTMENT غير مستخدمة في هذا النظام. التسوية قيد CHARGE أو PAYMENT بمصدر MANUAL مع سبب إلزامي.",
      "D2",
    );
  }

  assertPositiveIqd(input.amountIqd);

  if (!input.descriptionAr?.trim()) {
    throw new BusinessRuleError(
      "وصف القيد بالعربية إلزامي — هو ما يقرأه الساكن في كشف حسابه.",
      "R31",
    );
  }

  if (input.source === "MANUAL" && !input.reason?.trim()) {
    throw new BusinessRuleError(
      "قيد التسوية اليدوي يتطلّب سبباً مكتوباً. لا تسوية بلا تبرير مسجَّل.",
      "D2",
    );
  }

  // Q39: خدمة ONE_TIME تُقيَّد عند الموافقة، و`periodStart = startDate` لا null —
  // وإلا لم يمنع مفتاح التفريد نقرةً مزدوجة على «موافقة» من إنتاج قيدين.
  if (input.subscriptionId && !input.periodStart) {
    throw new BusinessRuleError(
      "قيد الاشتراك يتطلّب periodStart. تركه فارغاً يُبطل الحماية من التكرار (Q39).",
      "R30",
    );
  }
}

/**
 * يُترجم خرق قيد قاعدة البيانات إلى خطأ مجال بالعربية.
 *
 * ⚠️ **لا يكفي فحص نصّ الرسالة.** Prisma يغلّف الخطأ في
 * `PrismaClientKnownRequestError` ويضع اسم القيد في `meta.constraint`،
 * ورسالته الظاهرة تبدأ بـ«‏Invalid db.ledgerEntry.create() invocation»
 * وقد لا تحوي الاسم إطلاقاً. الاعتماد على النصّ وحده جعل الخطأ يتسرّب
 * خاماً إلى المتصل — كشفه اختبار حقيقي لا مراجعة.
 */
function translateDbError(error: unknown): never {
  const message = collectErrorText(error);

  if (/uniq_rent_charge_per_period/u.test(message)) {
    throw new ConflictError(
      "قيد إيجار لهذه الفترة موجود سلفاً على هذا الحساب. إعادة تشغيل مهمة الفوترة لا تُضاعف الإيجار.",
    );
  }
  if (/uniq_subscription_charge_per_period/u.test(message)) {
    throw new ConflictError("قيد هذا الاشتراك لهذه الفترة موجود سلفاً.");
  }
  if (/uniq_installment_charge/u.test(message)) {
    throw new ConflictError("قيد استحقاق هذا القسط موجود سلفاً.");
  }
  if (/uniq_opening_entry_per_account/u.test(message)) {
    throw new ConflictError("هذا الحساب له رصيد افتتاحي مسجَّل سلفاً.");
  }
  if (/ledger_amount_positive/u.test(message)) {
    throw new BusinessRuleError("مبلغ القيد يجب أن يكون موجباً.", "D2");
  }
  if (/ledger_manual_needs_reason/u.test(message)) {
    throw new BusinessRuleError("قيد التسوية اليدوي يتطلّب سبباً مكتوباً.", "D2");
  }
  throw error;
}

/**
 * يكتب القيد ويعيد حساب الرصيد **في معاملة واحدة مع قفل صف على الحساب**.
 *
 * `tx` اختياري: مرّره حين يكون القيد جزءاً من عملية أكبر (تسجيل دفعة،
 * إصدار باج، تفعيل عقد) — فيبقى الكل ذرّياً. ومن دونه تُفتح معاملة خاصة.
 */
export async function postEntry(
  input: PostEntryInput,
  tx?: Prisma.TransactionClient,
): Promise<PostEntryResult> {
  validate(input);
  if (tx) return run(tx, input);
  return prisma.$transaction((client) => run(client, input));
}

async function run(db: Db, input: PostEntryInput): Promise<PostEntryResult> {
  // ── 1. قفل صف الحساب ────────────────────────────────────────────────
  // بلا هذا القفل تقرأ معاملتان متوازيتان نفس الرصيد وتكتبان فوق بعضهما،
  // فيضيع أحد المبلغين **بلا أي خطأ يظهر**. القفل يُسلسِلهما.
  const locked = await db.$queryRaw<Array<{ id: string; status: string }>>`
    SELECT "id", "status"::text AS status
    FROM "Account"
    WHERE "id" = ${input.accountId}
    FOR UPDATE
  `;

  const account = locked[0];
  if (!account) throw new NotFoundError("الحساب");

  // إعادة الفحص **داخل** المعاملة: حالة قُرئت قبل القفل قد تكون قديمة.
  if (account.status !== "OPEN") {
    throw new BusinessRuleError(
      "لا يمكن القيد على حساب مغلق. الحساب المغلق يبقى للقراءة في تاريخ الشقة.",
      "R16",
    );
  }

  // ── 2. إدراج القيد ─────────────────────────────────────────────────
  let entryId: string;
  try {
    const entry = await db.ledgerEntry.create({
      data: {
        accountId: input.accountId,
        type: input.type,
        source: input.source,
        amountIqd: input.amountIqd,
        descriptionAr: input.descriptionAr.trim(),
        periodStart: input.periodStart ?? null,
        periodEnd: input.periodEnd ?? null,
        subscriptionId: input.subscriptionId ?? null,
        installmentId: input.installmentId ?? null,
        badgeId: input.badgeId ?? null,
        paymentId: input.paymentId ?? null,
        createdByUserId: input.createdByUserId ?? null,
        reason: input.reason?.trim() ?? null,
      },
      select: { id: true },
    });
    entryId = entry.id;
  } catch (error) {
    translateDbError(error);
  }

  // ── 3. إعادة حساب الرصيد من الدفتر ─────────────────────────────────
  // R31 بعد تبسيط D2: `Σ CHARGE − Σ PAYMENT`، **بلا أي فرع للإشارة**.
  // وهذا التبسيط هو ما يزيل أكثر موضع كان يمكن أن يُخطئ فيه الحساب.
  const [totals] = await db.$queryRaw<Array<{ balance: bigint }>>`
    SELECT COALESCE(SUM(
      CASE WHEN "type" = 'CHARGE' THEN "amountIqd" ELSE -"amountIqd" END
    ), 0)::bigint AS balance
    FROM "LedgerEntry"
    WHERE "accountId" = ${input.accountId}
  `;

  const balanceIqd = totals?.balance ?? 0n;

  await db.$executeRaw`
    UPDATE "Account" SET "balanceIqd" = ${balanceIqd}, "updatedAt" = now()
    WHERE "id" = ${input.accountId}
  `;

  return { entryId, balanceIqd };
}

/**
 * الرصيد المحسوب من الدفتر — **مصدر الحقيقة**.
 * `Account.balanceIqd` كاش يقارَن به في المهمة الليلية (الخطوة 2.8).
 */
export async function computeBalance(accountId: string, tx?: Prisma.TransactionClient): Promise<bigint> {
  const db: Db = tx ?? prisma;
  const [row] = await db.$queryRaw<Array<{ balance: bigint }>>`
    SELECT COALESCE(SUM(
      CASE WHEN "type" = 'CHARGE' THEN "amountIqd" ELSE -"amountIqd" END
    ), 0)::bigint AS balance
    FROM "LedgerEntry"
    WHERE "accountId" = ${accountId}
  `;
  return row?.balance ?? 0n;
}

export interface BalanceDrift {
  accountId: string;
  cachedIqd: bigint;
  computedIqd: bigint;
  driftIqd: bigint;
}

/**
 * كشف انحراف الكاش (‏R31 · الخطوة 2.8).
 *
 * ⚠️ **يُنبّه ولا يُصحّح تلقائياً.** التصحيح الصامت يخفي الخلل الذي سبّبه —
 * معاملة ناقصة، أو كتابة مباشرة في الجدول، أو عبثاً بالبيانات — فيضيع
 * الدليل الوحيد على وجود مشكلة.
 */
export async function detectBalanceDrift(): Promise<BalanceDrift[]> {
  return prisma.$queryRaw<BalanceDrift[]>`
    SELECT
      a."id" AS "accountId",
      a."balanceIqd" AS "cachedIqd",
      COALESCE(SUM(CASE WHEN e."type" = 'CHARGE' THEN e."amountIqd" ELSE -e."amountIqd" END), 0)::bigint AS "computedIqd",
      (a."balanceIqd" - COALESCE(SUM(CASE WHEN e."type" = 'CHARGE' THEN e."amountIqd" ELSE -e."amountIqd" END), 0))::bigint AS "driftIqd"
    FROM "Account" a
    LEFT JOIN "LedgerEntry" e ON e."accountId" = a."id"
    GROUP BY a."id", a."balanceIqd"
    HAVING a."balanceIqd" <> COALESCE(SUM(CASE WHEN e."type" = 'CHARGE' THEN e."amountIqd" ELSE -e."amountIqd" END), 0)
  `;
}
