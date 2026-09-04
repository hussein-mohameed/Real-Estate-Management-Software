import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";

/**
 * نقطة الوصول **الوحيدة** لقاعدة البيانات (‏§2.2 · الخطوة 0.6).
 *
 * ── لماذا Prisma وحده ولا RLS على الجداول ─────────────────────────────
 * §2.2 قرار مُعلن: Prisma يتصل بدور مُتميّز **يتجاوز RLS**. لذلك الترخيص
 * يُفرض في طبقة التطبيق — داخل كل Server Action — لا في قاعدة البيانات.
 * ‏RLS مطبَّق على buckets التخزين وحدها.
 *
 * ── driver adapter ────────────────────────────────────────────────────
 * ‏Prisma 7 لا يشحن محرّكاً ثنائياً لمسار SQL؛ الاتصال عبر `@prisma/adapter-pg`.
 * راجع docs/00-STACK-VERIFIED.md §3.3. هنا **`DATABASE_URL` المجمّع**؛
 * أما الترحيلات فتستخدم `DIRECT_URL` من `prisma.config.ts`.
 */

/**
 * الجداول التي تحمل `deletedAt` — **ثلاثة فقط** (‏§5 · القرار `S3`/`Q4`).
 *
 * §2.4 من المواصفة يوجبه على ثمانية، والمخطط يضعه على ثلاثة، **والمخطط هو
 * الصواب**: `deletedAt` على `LedgerEntry` أو `Invoice` يناقض append-only
 * (‏R29) وحصانة الفواتير (‏R35) نقضاً مباشراً.
 *
 * ودقّة لازمة (تحقّق `V9`): القائمتان **مجموعتان مختلفتان لا أكبر وأصغر** —
 * `Apartment` يحمل `deletedAt` في المخطط وهو **غائب** عن قائمة §2.4، وهو
 * بالذات الجدول الذي يفجّر عيب `T1` عند إعادة توليد الشقق.
 */
const SOFT_DELETE_MODELS = new Set(["Apartment", "Contract", "Subscription"]);

export const SOFT_DELETABLE_MODELS: readonly string[] = Object.freeze([
  ...SOFT_DELETE_MODELS,
]);

function createBaseClient(): PrismaClient {
  const connectionString = process.env["DATABASE_URL"];
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL غير مضبوط. انسخ .env.example إلى .env.local واملأ اتصال Supabase المجمّع.",
    );
  }

  /**
   * ── تحجيم التجمّع ومهلة المعاملة ────────────────────────────────────
   * `postEntry()` يقفل صف الحساب داخل معاملة، فدفعة من القيود على **نفس
   * الحساب** تُسلسَل بالضرورة — وهذا هو المطلوب: السلامة قبل الإنتاجية.
   * لكن كل معاملة منتظِرة **تحجز اتصالاً**، فتجمّع صغير يُنتج
   * «‏Unable to start a transaction» تحت الحمل، وهو فشل يبدو عشوائياً
   * ويصعب تشخيصه لأنه لا يشبه خطأ منطق.
   *
   * كُشف هذا بفشل حقيقي في اختبار 50 قيداً متوازياً — لا بمراجعة نظرية.
   */
  const poolSize = Number(process.env["DATABASE_POOL_SIZE"] ?? 20);
  const txTimeoutMs = Number(process.env["DATABASE_TX_TIMEOUT_MS"] ?? 30_000);

  /**
   * ── ⚠️ المخطّط يُمرَّر إلى المحوّل لا في الرابط ────────────────────
   * مع driver adapter في Prisma 7، الاستعلامات يبنيها المحوّل — و`?schema=`
   * في الرابط **يتجاهله `node-postgres` تماماً**. فتمريره هنا هو الطريق
   * الوحيد الذي يجعل الاستعلامات تصيب المخطّط المقصود.
   *
   * غيابه يعني `public` — وهو الصحيح للتطوير. واختبارات التكامل تضبطه من
   * `.env.test` إلى مخطّطها، وحارس `tests/integration/setup-env.ts` يرفض
   * التشغيل إن بقي `public`.
   */
  const schema = process.env["DB_SCHEMA"];

  /**
   * ── 🔴 و`search_path` على التجمّع **إضافةً** إلى `schema` ────────────
   * خيار `schema` يُقيّد **الاستعلامات التي يبنيها المحوّل** وحدها.
   * و`$queryRaw` يمرّ كما هو — فيُحلّ اسمُ الجدول فيه بـ`search_path`
   * الاتصال، أي `public`.
   *
   * والنتيجة على مخطّط اختبار: Prisma يكتب في `integration_test`،
   * و`SELECT … FOR UPDATE` في `postEntry` و`recordCashPayment`، وتجميعُ
   * `collectionByStaff`، كلّها تقرأ `public` — **فنصف المنطق في مخطّط
   * ونصفه في آخر**. وبعض الاختبارات يمرّ، فيبدو الإعداد سليماً.
   *
   * كشفه العزل: ثلاثة اختبارات صندوق سقطت لأن تجميعها الخام وجد جدولاً
   * فارغاً. ولا أثر لهذا في الإنتاج — هناك `public` وحده — لكن السطر
   * يوثّق أن الخام لا يعرف خيار المحوّل.
   */
  const poolOptions = schema ? { options: `-c search_path=${schema}` } : {};

  const adapter = new PrismaPg(
    { connectionString, max: poolSize, ...poolOptions },
    ...(schema ? [{ schema }] : []),
  );
  return new PrismaClient({
    adapter,
    transactionOptions: {
      // كم تنتظر المعاملة اتصالاً قبل أن تستسلم
      maxWait: txTimeoutMs,
      // كم تُمهَل بعد أن تبدأ — الفوترة الجماعية قد تطول
      timeout: txTimeoutMs,
    },
  });
}

// ── امتداد الحذف الناعم ────────────────────────────────────────────────

type QueryArgs = { where?: Record<string, unknown> } & Record<string, unknown>;

interface QueryContext {
  model: string;
  args: QueryArgs;
  query: (args: QueryArgs) => Promise<unknown>;
}

interface FindDelegate {
  findFirst: (args: QueryArgs) => Promise<unknown>;
  findFirstOrThrow: (args: QueryArgs) => Promise<unknown>;
}

function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

/** يحقن `deletedAt: null` في الاستعلامات التي تقبل شرطاً حرّاً. */
async function injectNotDeleted({ model, args, query }: QueryContext): Promise<unknown> {
  if (SOFT_DELETE_MODELS.has(model)) {
    args.where = { ...args.where, deletedAt: null };
  }
  return query(args);
}

/**
 * ⚠️ **المصيدة المعروفة:** `findUnique` في Prisma لا يقبل شرطاً خارج المفتاح
 * الفريد، فحقن `deletedAt: null` فيه يفشل. لذلك تُحوَّل إلى `findFirst`.
 * لهذه الحالة تحديداً اختبار مستقل (تعريف إنجاز الخطوة 0.6).
 */
function makeUniqueRewriter(
  base: PrismaClient,
  throwing: boolean,
): (ctx: QueryContext) => Promise<unknown> {
  return async ({ model, args, query }: QueryContext) => {
    if (!SOFT_DELETE_MODELS.has(model)) return query(args);

    const delegates = base as unknown as Record<string, FindDelegate | undefined>;
    const delegate = delegates[lowerFirst(model)];
    if (!delegate) return query(args);

    const rewritten: QueryArgs = { ...args, where: { ...args.where, deletedAt: null } };
    return throwing ? delegate.findFirstOrThrow(rewritten) : delegate.findFirst(rewritten);
  };
}

/**
 * §5.1/3 يوجب أن يكون الترشيح بامتداد لا يدوياً في كل استعلام — **لأن
 * استعلاماً واحداً منسياً يُظهر صفاً محذوفاً في تقرير مالي**، وهو عيب لا
 * تكشفه المراجعة البشرية.
 *
 * الامتداد لا يغيّر السطح النوعي العام للعميل (يعترض التنفيذ فقط)، لذلك
 * نُبقي نوع الإرجاع `PrismaClient` ونحصر التحويل النوعي في موضع واحد
 * موثَّق — بدل نثر `any` في كل معالج.
 */
function withSoftDelete(base: PrismaClient): PrismaClient {
  const handlers = {
    findUnique: makeUniqueRewriter(base, false),
    findUniqueOrThrow: makeUniqueRewriter(base, true),
    findFirst: injectNotDeleted,
    findFirstOrThrow: injectNotDeleted,
    findMany: injectNotDeleted,
    count: injectNotDeleted,
    aggregate: injectNotDeleted,
    groupBy: injectNotDeleted,
  };

  const extension = {
    name: "soft-delete",
    query: { $allModels: handlers },
  } as unknown as Parameters<PrismaClient["$extends"]>[0];

  return base.$extends(extension) as unknown as PrismaClient;
}

// ── نمط singleton ──────────────────────────────────────────────────────
// في التطوير الساخن تُعاد الوحدات مراراً؛ بلا هذا النمط تُستنزف اتصالات
// قاعدة البيانات حتى يتوقّف المشروع عن العمل بعد عشرين حفظة.

const globalForPrisma = globalThis as unknown as {
  __basePrisma?: PrismaClient;
  __prisma?: PrismaClient;
};

function getBase(): PrismaClient {
  globalForPrisma.__basePrisma ??= createBaseClient();
  return globalForPrisma.__basePrisma;
}

/**
 * العميل المستخدم في كل مكان. الصفوف المحذوفة ناعماً **غير مرئية** عبره.
 *
 * الإنشاء كسول عبر `Proxy` حتى لا يُطلب `DATABASE_URL` عند مجرّد استيراد
 * الوحدة — وهذا ما يبقي اختبارات الوحدة و`next build` ممكنَين بلا قاعدة بيانات.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    globalForPrisma.__prisma ??= withSoftDelete(getBase());
    return Reflect.get(globalForPrisma.__prisma, prop, receiver);
  },
});

/**
 * المخرج الصريح الوحيد من الحذف الناعم.
 *
 * يُستعمل في **تبويب «التاريخ»** في صفحة الشقة وحده تقريباً — المبدأ 3 يوجب أن
 * تبقى الحسابات المغلقة والعقود المنتهية مرئية للأبد. اسمه صريح ليكون
 * قابلاً للبحث في المراجعة: كل استدعاء له يجب أن يكون مقصوداً ومبرَّراً.
 */
export function withDeleted(): PrismaClient {
  return getBase();
}
