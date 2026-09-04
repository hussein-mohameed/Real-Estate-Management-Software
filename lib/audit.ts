import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * سجلّ التدقيق (‏§12.1 · المبدأ 5).
 *
 * ── قاعدة الخصوصية التي لا تُخرق ─────────────────────────────────────
 * §12.1 يصنّف صور الهوية وبطاقة السكن **بيانات شخصية حسّاسة**: لا تُسجَّل،
 * ولا تُرسل بالبريد، ولا تُدرج في أي تصدير. وسجلّ التدقيق يكتب `before`
 * و`after` كاملَين — فلولا التصفية لسُجّلت روابط الهوية في أول تعديل ملف
 * ساكن، **وبقيت هناك للأبد**.
 *
 * القائمة أدناه ليست تفضيلاً: هي تطبيق نصّ صريح. وتُختبر.
 */

/**
 * الحقول التي تُحجب من `before`/`after` **دائماً**.
 * تشمل ما هو حسّاس بنصّ المواصفة، وما هو سرّي بطبيعته (تهشيرات، رموز).
 */
export const REDACTED_FIELDS: readonly string[] = Object.freeze([
  "nationalIdImageUrl",
  "residenceCardImageUrl",
  "avatarUrl",
  "codeHash",
  "tokenHash",
  "waylRawPayload",
  "password",
  "secret",
  "token",
]);

export const REDACTION_MARK = "[محجوب]";

const REDACTED_SET = new Set(REDACTED_FIELDS.map((f) => f.toLowerCase()));

function shouldRedact(key: string): boolean {
  const k = key.toLowerCase();
  if (REDACTED_SET.has(k)) return true;
  // لواحق تدلّ على سرّ حتى لو لم تُذكر بالاسم — الحماية بالنمط لا بالقائمة
  // وحدها، لأن القائمة تتقادم مع أول حقل جديد.
  return /(imageurl|passwordhash|secret|token|codehash)$/u.test(k);
}

/** يُصفّي الكائن تعاودياً قبل الكتابة. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "object") return value;

  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] = shouldRedact(key) ? REDACTION_MARK : redact(v, depth + 1);
  }
  return out;
}

export interface AuditInput {
  actorUserId: string | null;
  /** فعل بصيغة `entity.action`: `payment.record` · `apartment.occupancy.change`. */
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
}

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * يكتب صفّ تدقيق.
 *
 * ⚠️ **مرّر `tx` دائماً** حين يكون الفعل جزءاً من معاملة: التدقيق الذي
 * يُكتب خارجها يبقى بعد تراجعها، فيوثّق فعلاً **لم يحدث**.
 */
export async function writeAudit(input: AuditInput, tx?: Prisma.TransactionClient): Promise<void> {
  const db: Db = tx ?? prisma;
  await db.auditLog.create({
    data: {
      actorUserId: input.actorUserId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      before: (redact(input.before) ?? null) as Prisma.InputJsonValue,
      after: (redact(input.after) ?? null) as Prisma.InputJsonValue,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    },
  });
}

/**
 * ‏R5: **كل** توليد رابط موقَّع لمستند خاص يُسجَّل — بلا استثناء.
 * هذا ما يجعل «من رأى هوية فلان ومتى» سؤالاً له جواب.
 */
export async function auditSignedUrl(
  actorUserId: string,
  kind: string,
  subjectUserId: string,
  tx?: Prisma.TransactionClient,
): Promise<void> {
  await writeAudit(
    {
      actorUserId,
      action: "document.signed_url.generate",
      entityType: "ResidentProfile",
      entityId: subjectUserId,
      // نسجّل **نوع** المستند لا رابطه — الرابط نفسه بيانات حسّاسة.
      after: { kind },
    },
    tx,
  );
}
