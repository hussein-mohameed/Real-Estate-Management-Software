import type { ZodType } from "zod";
import { z } from "zod";
import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { DEFAULT_ERROR_MESSAGES, ERROR_CODES, fail, ok, type ActionResult, type FieldErrors } from "@/lib/result";
import { ForbiddenError, isDomainError, PendingDecisionError, UnauthenticatedError } from "@/lib/errors";
import { CAPABILITY_LABELS_AR, can, type Capability, type UserRole } from "@/lib/auth/roles";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  `defineAction` — قالب كل mutation في النظام.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── لماذا مغلّف لا اتفاق ─────────────────────────────────────────────
 * §2.3 يوجب أن يبدأ **كل** Server Action بحلّ الجلسة وتأكيد الصلاحية،
 * و§10.3 يشدّد: «لا تثق أبداً بأن المتصل عرض الصفحة» — لأن Server Action
 * نقطة نهاية HTTP قابلة للاستدعاء مباشرةً.
 *
 * الاعتماد على أن يتذكّر الكاتب أربع خطوات في **53 إجراءً** يفشل حتماً؛
 * وسهو واحد يفتح ثغرة صامتة. هنا الترتيب مفروض بالنوع: لا يمكن بناء
 * إجراء بلا `capability`، ولا تشغيله بلا فحص.
 *
 * ── الترتيب الملزم ───────────────────────────────────────────────────
 *   1. حلّ الجلسة        ← من لا جلسة له لا يصل لشيء
 *   2. فحص الصلاحية       ← من المصفوفة، لا بشرط مكتوب يدوياً
 *   3. تحقّق zod          ← نفس المخطّط المشترك مع الواجهة
 *   4. معاملة Prisma      ← إن أُعلن `transactional`
 *   5. سجلّ التدقيق        ← داخل المعاملة نفسها
 *   6. الشكل الموحّد      ← { ok, data } | { ok, error }
 *
 * ── أثر `D3/1` — طبقتان بمعيارين ────────────────────────────────────
 * كل إجراء يعلن `kind: "read" | "write"`. الـ`layout` يحكم بأدوار
 * **القراءة** فيسمح للمالك بالعرض، والإجراء **الكتابي** يحكم بأدوار
 * الكتابة فيمنعه. خلط المعيارين هو ما يجعل مصفوفة §3.2 تبدو متناقضة.
 */

/** المستخدم كما يصل للإجراء — من **قاعدتنا** لا من مزوّد الهوية. */
export interface ActorContext {
  userId: string;
  role: UserRole;
  ip?: string | null;
  userAgent?: string | null;
}

export interface ActionContext<TInput> {
  input: TInput;
  actor: ActorContext;
  /** موجود حين يكون الإجراء `transactional`. مرّره لـ`postEntry` والتدقيق. */
  tx: Prisma.TransactionClient;
}

export interface ActionDefinition<TInput, TOutput> {
  /** اسم الإجراء كما في `lib/actions/registry.ts`. */
  name: string;
  /** القدرة التي يُفحص عليها — من مصفوفة §3.2 لا بشرط يدوي. */
  capability: Capability;
  kind: "read" | "write";
  /** مخطّط zod المشترك مع الواجهة — مصدر واحد لقواعد التحقّق. */
  schema: ZodType<TInput>;
  /** معاملة واحدة؛ إلزامية لكل ما يمسّ المال. */
  transactional?: boolean;
  /** فعل التدقيق. مطلوب لكل إجراء كتابي. */
  auditAction?: string;
  auditEntityType?: string;
  /** معرّف قرار محجوب — الإجراء يرفض بدل أن يخمّن. */
  blockedBy?: string;
  /** ما يُمنع بالضبط، لرسالة `PendingDecisionError`. */
  blockedDescription?: string;
  handler: (ctx: ActionContext<TInput>) => Promise<TOutput>;
}

/**
 * ⚠️ المُدخل `unknown` عمداً حتى في الاستدعاء المُصرَّف: الـaction نقطة
 * نهاية HTTP، فقد يصلها ما لا يطابق النوع مهما بدا الاستدعاء آمناً.
 * النوع الحقيقي يُستخرج من مخطّط zod في الواجهة عبر `z.infer`.
 */
export type Action<TOutput> = (
  input: unknown,
  actor: ActorContext | null,
) => Promise<ActionResult<TOutput>>;

function toFieldErrors(error: unknown): FieldErrors | undefined {
  if (!(error instanceof z.ZodError)) return undefined;
  // Zod 4: `z.flattenError()` — لا `error.flatten()` كما في v3.
  // مُتحقَّق منه على الإصدار المثبَّت 4.4.3، لا من الذاكرة.
  const flat = z.flattenError(error) as { fieldErrors: Record<string, string[] | undefined> };
  const out: FieldErrors = {};
  for (const [field, messages] of Object.entries(flat.fieldErrors)) {
    if (messages && messages.length > 0) out[field] = messages;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function defineAction<TInput, TOutput>(
  def: ActionDefinition<TInput, TOutput>,
): Action<TOutput> {
  // فحص بنية وقت التحميل: إجراء كتابي بلا فعل تدقيق عيب لا تفضيل.
  if (def.kind === "write" && !def.auditAction) {
    throw new Error(
      `الإجراء «${def.name}» كتابي بلا auditAction. ` +
        "المبدأ 5: كل حركة مالية مُدقَّقة — من فعلها ومتى وما القيمة قبل وبعد.",
    );
  }

  return async function run(rawInput, actor) {
    try {
      // ── 1. الجلسة ───────────────────────────────────────────────────
      if (!actor) throw new UnauthenticatedError();

      // ── 2. الصلاحية — من المصفوفة ──────────────────────────────────
      const needed = def.kind === "write" ? "update" : "read";
      if (!can(actor.role, def.capability, needed)) {
        // ⚠️ التسمية العربية لا رمز القدرة: §11.4 يمنع عرض رموز خام
        // للمستخدم. كشفه اختبار يفحص الرسالة نفسها لا وجودها فقط.
        throw new ForbiddenError(
          `لا تملك صلاحية تنفيذ هذا الإجراء على «${CAPABILITY_LABELS_AR[def.capability]}».`,
        );
      }

      // ── 2ب. قرار محجوب — رفض صريح لا تخمين ─────────────────────────
      if (def.blockedBy) {
        throw new PendingDecisionError(
          def.blockedBy,
          def.blockedDescription ?? `الإجراء «${def.name}»`,
        );
      }

      // ── 3. التحقّق ─────────────────────────────────────────────────
      const parsed = def.schema.safeParse(rawInput);
      if (!parsed.success) {
        return fail<TOutput>(
          ERROR_CODES.VALIDATION,
          DEFAULT_ERROR_MESSAGES.VALIDATION,
          toFieldErrors(parsed.error),
        );
      }
      const input = parsed.data;

      // ── 4–5. التنفيذ والتدقيق في معاملة واحدة ──────────────────────
      const execute = async (tx: Prisma.TransactionClient): Promise<TOutput> => {
        const result = await def.handler({ input, actor, tx });
        if (def.auditAction) {
          await writeAudit(
            {
              actorUserId: actor.userId,
              action: def.auditAction,
              entityType: def.auditEntityType ?? def.capability,
              entityId: extractId(result) ?? extractId(input),
              after: result,
              ip: actor.ip ?? null,
              userAgent: actor.userAgent ?? null,
            },
            tx,
          );
        }
        return result;
      };

      const data = def.transactional
        ? await prisma.$transaction(execute)
        : await execute(prisma as unknown as Prisma.TransactionClient);

      return ok(data);
    } catch (error) {
      return toResult<TOutput>(error, def.name);
    }
  };
}

function extractId(value: unknown): string | null {
  if (value && typeof value === "object") {
    const id = (value as Record<string, unknown>)["id"];
    if (typeof id === "string") return id;
  }
  return null;
}

function toResult<T>(error: unknown, actionName: string): ActionResult<T> {
  if (isDomainError(error)) {
    return fail<T>(error.code, error.message, error.fieldErrors);
  }
  if (error instanceof z.ZodError) {
    return fail<T>(ERROR_CODES.VALIDATION, DEFAULT_ERROR_MESSAGES.VALIDATION, toFieldErrors(error));
  }

  // ⚠️ الخطأ غير المتوقَّع **لا يُكشف تفصيله للمستخدم** (‏§11.4): الرسائل
  // الخام تسرّب أسماء جداول وقيوداً وبنية داخلية. يُسجَّل كاملاً ويُعرض عاماً.
  console.error(`[action:${actionName}]`, error);
  return fail<T>(ERROR_CODES.INTERNAL, DEFAULT_ERROR_MESSAGES.INTERNAL);
}
