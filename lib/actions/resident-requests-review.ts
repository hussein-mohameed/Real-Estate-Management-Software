import { z } from "zod";
import { defineAction } from "./define-action";
import { BusinessRuleError, ConflictError, NotFoundError } from "@/lib/errors";
import { violates } from "@/lib/db-errors";
import { now } from "@/lib/dates";
import { RESIDENT_REQUEST_STATUS } from "@/lib/domain/enums";
import type { ProfileChangePayload } from "@/lib/services/resident-profile-requests";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  مراجعة طلبات الساكن — الإدارة.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── 🔴 الموافقة **تُطبّق** التغيير ولا تكتفي بتعليمه ────────────────
 * أسهل تنفيذ هو ضبط `status = APPROVED` وترك الأدمن يُدخل القيم يدوياً
 * في شاشة الساكن. وذلك يُنتج طلباً «مقبولاً» وبياناتٍ لم تتغيّر — والساكن
 * يرى القبول ويظنّ الأمر انتهى، ثم يصله الرمز على رقمه القديم.
 *
 * فالتطبيق والقرار **في معاملة واحدة**: إمّا سرى التغيير وسُجّل القبول
 * معاً، أو لم يقع شيء.
 *
 * ── ⚠️ والهاتف يُفحَص تفرّده **هنا ثانيةً** ─────────────────────────
 * فُحص عند الطلب لتُقال رسالة مفهومة. لكن بين الطلب والقرار ساعاتٌ أو
 * أيام، وقد يُسجَّل الرقم لغيره فيها. والحارس الحقيقي هو تفرّد العمود —
 * وهذا ما يمسكه `violates`.
 */

const idSchema = z.object({
  requestId: z.string().min(1),
  note: z.string().trim().max(500).optional(),
});

export const listResidentRequests = defineAction({
  name: "listResidentRequests",
  capability: "RESIDENT_PROFILES",
  kind: "read",
  schema: z
    .object({
      status: z.enum(RESIDENT_REQUEST_STATUS).optional(),
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(25),
    })
    .default({ page: 1, pageSize: 25 }),
  handler: async ({ input, tx }) => {
    const where = input.status ? { status: input.status } : {};

    const [rows, total, pendingCount] = await Promise.all([
      tx.residentRequest.findMany({
        where,
        select: {
          id: true,
          kind: true,
          payload: true,
          status: true,
          reviewNote: true,
          reviewedAt: true,
          createdAt: true,
          createdBy: { select: { id: true, fullName: true, phone: true } },
          reviewedBy: { select: { id: true, fullName: true } },
        },
        /* المعلّق أوّلاً — هو ما ينتظر قراراً */
        orderBy: [{ status: "asc" }, { createdAt: "desc" }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      tx.residentRequest.count({ where }),
      tx.residentRequest.count({ where: { status: "PENDING" } }),
    ]);

    return { rows, total, page: input.page, pageSize: input.pageSize, pendingCount };
  },
});

export const approveResidentRequest = defineAction({
  name: "approveResidentRequest",
  capability: "RESIDENT_PROFILES",
  kind: "write",
  transactional: true,
  schema: idSchema,
  auditAction: "resident_request.approve",
  auditEntityType: "ResidentRequest",
  handler: async ({ input, actor, tx }) => {
    const request = await tx.residentRequest.findUnique({
      where: { id: input.requestId },
      select: { id: true, kind: true, status: true, payload: true, createdByUserId: true },
    });
    if (!request) throw new NotFoundError("الطلب");
    if (request.status !== "PENDING") {
      throw new BusinessRuleError("هذا الطلب قُرِّر سلفاً.");
    }

    /*
     * ⚠️ النوعان الآخران (`BADGE` · `SUBSCRIPTION_CANCELLATION`) لا مسار
     * إنشاء لهما هنا: الأول محجوب بـ`B3`، والثاني نُفِّذ بعمودين على صفّ
     * الاشتراك (قرار المالك). فالموافقة تُطبَّق على `PROFILE_CHANGE` وحده،
     * وترفض ما لا تعرف كيف تُطبّقه بدل أن تعلّمه مقبولاً بلا أثر.
     */
    if (request.kind !== "PROFILE_CHANGE") {
      throw new BusinessRuleError(
        "هذا النوع من الطلبات لا يُطبَّق من هنا بعد. راجع خطة التنفيذ.",
      );
    }

    const payload = request.payload as ProfileChangePayload;

    try {
      if (payload.fullName || payload.phone) {
        await tx.user.update({
          where: { id: request.createdByUserId },
          data: {
            ...(payload.fullName ? { fullName: payload.fullName.to } : {}),
            ...(payload.phone ? { phone: payload.phone.to } : {}),
          },
        });
      }

      if (payload.emergencyPhone) {
        /*
         * ⚠️ `upsert` لا `update`: ساكنٌ بلا `ResidentProfile` ممكن —
         * الملفّ يُنشأ عند رفع مستند أو إدخال هاتف طوارئ، لا مع المستخدم.
         */
        await tx.residentProfile.upsert({
          where: { userId: request.createdByUserId },
          create: {
            userId: request.createdByUserId,
            emergencyPhone: payload.emergencyPhone.to,
          },
          update: { emergencyPhone: payload.emergencyPhone.to },
        });
      }
    } catch (error) {
      if (violates(error, "User_phone_key")) {
        throw new ConflictError(
          `الرقم «${payload.phone?.to ?? ""}» سُجّل لمستخدم آخر بعد إرسال الطلب. اطلب من الساكن رقماً غيره.`,
        );
      }
      throw error;
    }

    return tx.residentRequest.update({
      where: { id: request.id },
      data: {
        status: "APPROVED",
        reviewedByUserId: actor.userId,
        reviewedAt: now(),
        ...(input.note ? { reviewNote: input.note } : {}),
      },
      select: { id: true, status: true },
    });
  },
});

export const rejectResidentRequest = defineAction({
  name: "rejectResidentRequest",
  capability: "RESIDENT_PROFILES",
  kind: "write",
  schema: idSchema.extend({
    /* ⚠️ إلزاميّ: رفضٌ بلا سبب يجعل الساكن يعيد الطلب نفسه */
    note: z.string().trim().min(3, "سبب الرفض مطلوب.").max(500),
  }),
  auditAction: "resident_request.reject",
  auditEntityType: "ResidentRequest",
  handler: async ({ input, actor, tx }) => {
    const request = await tx.residentRequest.findUnique({
      where: { id: input.requestId },
      select: { id: true, status: true },
    });
    if (!request) throw new NotFoundError("الطلب");
    if (request.status !== "PENDING") {
      throw new BusinessRuleError("هذا الطلب قُرِّر سلفاً.");
    }

    return tx.residentRequest.update({
      where: { id: request.id },
      data: {
        status: "REJECTED",
        reviewedByUserId: actor.userId,
        reviewedAt: now(),
        reviewNote: input.note,
      },
      select: { id: true, status: true },
    });
  },
});
