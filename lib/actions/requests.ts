import { z } from "zod";
import { defineAction } from "./define-action";
import { nextNumber } from "@/lib/services/counter";
import { residentApartmentIds } from "@/lib/auth/scope";
import { requestGrantsApartmentAccess } from "@/lib/auth/access";
import { BusinessRuleError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { now } from "@/lib/dates";
import {
  PRIORITY,
  REQUEST_SCOPE,
  REQUEST_STATUS,
  REQUEST_TYPE,
} from "@/lib/domain/enums";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  الطلبات والشكاوى — الخطوة 4.4.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * تعريف الإنجاز ثلاثة بنود، وكلٌّ منها **قرار تصميم لا تفصيل تنفيذ**:
 *
 * ── ١. `DONE` بلا `resolutionNote` مرفوض **في الخادم** ──────────────
 * ⚠️ لا في الواجهة. الإجراء نقطة نهاية HTTP قابلة للاستدعاء مباشرةً
 * (‏§10.3)، وحقلٌ مطلوب في نموذج وحده يُتجاوَز بطلبٍ واحد. وطلبٌ يُغلَق
 * بلا سببٍ مكتوب يجعل «ماذا فُعل؟» سؤالاً بلا جواب بعد شهر.
 *
 * ── ٢. الساكن لا يستلم تعليقاً داخلياً **في الحمولة** ───────────────
 * ⚠️ الترشيح في `select` لا في العرض. ترشيحٌ في العميل يعني أن التعليق
 * **أُرسل فعلاً** إلى المتصفّح — ويُقرأ بفتح أدوات المطوّر. والاختبار
 * يفحص الحمولة لا الشاشة.
 *
 * ── ٣. شكوى منطقة مشتركة بلا شقة تعمل — ولا تمنح وصولاً ────────────
 * ⚠️ `Q35`: شكوى المصعد أو المسبح لا تنتمي لشقة. وإلحاقُها بشقة عشوائية
 * يلوّث كل تقارير الطلبات («الشقة A-1-2 لها 30 شكوى»). و`COMMON_AREA`
 * يسقط خارج قاعدة `D4` — يفرضه `requestGrantsApartmentAccess`.
 */

const createSchema = z
  .object({
    type: z.enum(REQUEST_TYPE),
    scope: z.enum(REQUEST_SCOPE).default("APARTMENT"),
    apartmentId: z.string().optional(),
    title: z.string().trim().min(3, "العنوان مطلوب (٣ أحرف على الأقل).").max(150),
    description: z.string().trim().min(3, "الوصف مطلوب.").max(2000),
    departmentId: z.string().optional(),
    departmentTaskId: z.string().optional(),
    priority: z.enum(PRIORITY).default("NORMAL"),
  })
  .superRefine((v, ctx) => {
    /*
     * ⚠️ `APARTMENT` يوجب شقة، و`COMMON_AREA` يمنعها.
     * شكوى مشتركة تحمل `apartmentId` تُعيد إنتاج العيب الذي وُجد
     * `scope` من أجله: تقريرٌ يقول إن لتلك الشقة شكاوى ليست لها.
     */
    if (v.scope === "APARTMENT" && !v.apartmentId) {
      ctx.addIssue({
        code: "custom",
        path: ["apartmentId"],
        message: "الشقة مطلوبة لطلب يخصّ وحدة سكنية.",
      });
    }
    if (v.scope === "COMMON_AREA" && v.apartmentId) {
      ctx.addIssue({
        code: "custom",
        path: ["apartmentId"],
        message: "طلب المنطقة المشتركة لا يُلحَق بشقة.",
      });
    }
  });

export const createServiceRequest = defineAction({
  name: "createServiceRequest",
  capability: "SERVICE_REQUESTS",
  kind: "write",
  transactional: true,
  auditAction: "request.create",
  auditEntityType: "ServiceRequest",
  schema: createSchema,
  handler: async ({ input, actor, tx }) => {
    /*
     * ── ⚠️ الساكن يُنشئ على شققه وحدها ─────────────────────────────
     * `LEVEL_ACTIONS.OWN` يمنحه الإنشاء، والنطاق يُفرَض هنا **من الجلسة
     * لا من المُدخل**: لولا ذلك لأنشأ طلباً على شقة جاره — وطلبٌ مُكلَّف
     * به يمنح الموظّف وصولاً إلى تلك الشقة (‏D4).
     */
    if (actor.role === "RESIDENT" && input.apartmentId) {
      const mine = await residentApartmentIds(actor.userId);
      if (!mine.includes(input.apartmentId)) {
        throw new ForbiddenError("لا تُنشئ طلباً على شقة ليست لك.");
      }
    }

    if (input.apartmentId) {
      const apartment = await tx.apartment.findFirst({
        where: { id: input.apartmentId, deletedAt: null },
        select: { id: true },
      });
      if (!apartment) throw new NotFoundError("الشقة");
    }

    if (input.departmentTaskId) {
      const task = await tx.departmentTask.findUnique({
        where: { id: input.departmentTaskId },
        select: { id: true, departmentId: true, isActive: true },
      });
      if (!task) throw new NotFoundError("المهمّة");
      /* ⚠️ الموقوفة لا تُختار لطلب جديد — هذا سبب وجود الإيقاف أصلاً */
      if (!task.isActive) {
        throw new BusinessRuleError("هذه المهمّة موقوفة ولا تُسنَد إليها طلبات جديدة.");
      }
      /* والقسم يُشتقّ من المهمّة لا يُقبَل من المتصل: مصدر واحد للحقيقة */
      input.departmentId = task.departmentId;
    } else if (input.departmentId) {
      const dept = await tx.department.findUnique({
        where: { id: input.departmentId },
        select: { id: true },
      });
      if (!dept) throw new NotFoundError("القسم");
    }

    const number = await nextNumber("REQ", tx);

    const created = await tx.serviceRequest.create({
      data: {
        number,
        type: input.type,
        scope: input.scope,
        apartmentId: input.apartmentId ?? null,
        createdByUserId: actor.userId,
        title: input.title,
        description: input.description,
        departmentId: input.departmentId ?? null,
        departmentTaskId: input.departmentTaskId ?? null,
        priority: input.priority,
        status: "NEW",
      },
      select: { id: true, number: true, status: true },
    });

    return { ...created };
  },
});

/**
 * إسناد الطلب إلى موظّف.
 *
 * ⚠️ **الإسناد يمنح وصولاً** (‏D4): الموظّف المُكلَّف بطلبٍ غير مغلق على
 * شقة يرى تلك الشقة. فالإسناد قرار ترخيص لا تنظيم — ولذلك يُدقَّق.
 */
export const assignServiceRequest = defineAction({
  name: "assignServiceRequest",
  capability: "SERVICE_REQUESTS",
  kind: "write",
  transactional: true,
  auditAction: "request.assign",
  auditEntityType: "ServiceRequest",
  schema: z.object({
    requestId: z.string().min(1),
    staffUserId: z.string().min(1),
  }),
  handler: async ({ input, tx }) => {
    const request = await tx.serviceRequest.findUnique({
      where: { id: input.requestId },
      select: { id: true, status: true, number: true },
    });
    if (!request) throw new NotFoundError("الطلب");
    if (request.status === "DONE" || request.status === "CANCELLED") {
      throw new BusinessRuleError("الطلب مُغلق — لا يُسنَد بعد إغلاقه.");
    }

    const staff = await tx.staffProfile.findUnique({
      where: { userId: input.staffUserId },
      select: { userId: true, user: { select: { isActive: true, fullName: true } } },
    });
    if (!staff) throw new NotFoundError("الملف الوظيفي");

    /*
     * ⚠️ المعطَّل لا يُكلَّف: لا يدخل النظام أصلاً (‏§10.1)، فالإسناد إليه
     * يعني طلباً بلا منفّذ يبدو مُسنَداً — وهو أسوأ من طلبٍ بلا إسناد.
     */
    if (!staff.user.isActive) {
      throw new BusinessRuleError(
        `«${staff.user.fullName}» حساب معطَّل ولا يُسنَد إليه عمل.`,
      );
    }

    const updated = await tx.serviceRequest.update({
      where: { id: input.requestId },
      data: {
        assignedStaffId: input.staffUserId,
        /* ⚠️ `NEW` وحدها تتقدّم: طلبٌ قيد التنفيذ لا يرتدّ إلى «مُسنَد» */
        ...(request.status === "NEW" ? { status: "ASSIGNED" as const } : {}),
      },
      select: { id: true, number: true, status: true, assignedStaffId: true },
    });

    return updated;
  },
});

const statusSchema = z
  .object({
    requestId: z.string().min(1),
    status: z.enum(REQUEST_STATUS),
    resolutionNote: z.string().trim().max(1000).optional(),
  })
  .superRefine((v, ctx) => {
    /*
     * ── 🔴 البند الأول من تعريف الإنجاز ────────────────────────────
     * ⚠️ **في الخادم لا في الواجهة.** حقلٌ مطلوب في نموذج وحده يُتجاوَز
     * بطلب HTTP واحد. وطلبٌ يُغلَق بلا سبب مكتوب يجعل «ماذا فُعل؟»
     * سؤالاً بلا جواب بعد شهر — وهو السؤال الوحيد الذي يُسأل.
     */
    if (v.status === "DONE" && !v.resolutionNote?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["resolutionNote"],
        message: "الإغلاق يحتاج وصفاً لما فُعل. «تمّ» ليست جواباً.",
      });
    }
  });

export const setRequestStatus = defineAction({
  name: "setRequestStatus",
  capability: "SERVICE_REQUESTS",
  kind: "write",
  transactional: true,
  auditAction: "request.status",
  auditEntityType: "ServiceRequest",
  schema: statusSchema,
  handler: async ({ input, actor, tx }) => {
    const request = await tx.serviceRequest.findUnique({
      where: { id: input.requestId },
      select: {
        id: true,
        status: true,
        number: true,
        assignedStaffId: true,
      },
    });
    if (!request) throw new NotFoundError("الطلب");

    if (request.status === input.status) {
      return { id: request.id, status: request.status, changed: false };
    }

    /*
     * ⚠️ **المغلق لا يُعاد فتحه بهذا الإجراء.** إعادة الفتح تُبطل
     * `closedAt` وتُربك كل قياس زمني للإنجاز. وطلبٌ عاد يُنشأ من جديد
     * بمرجعٍ إلى القديم — وذلك قرار لم يُطلَب بعد.
     */
    if (request.status === "DONE" || request.status === "CANCELLED") {
      throw new BusinessRuleError("الطلب مُغلق. أنشئ طلباً جديداً بدل إعادة فتحه.");
    }

    /*
     * ⚠️ الموظّف يُحرّك ما أُسنِد إليه وحده (‏`scope: "assigned"` في §3.2).
     * والمصفوفة تعطيه `WRITE` على كل الصفوف — والنطاق يُفرَض هنا بنيوياً،
     * كما في `staff-self.ts`.
     */
    if (actor.role === "STAFF" && request.assignedStaffId !== actor.userId) {
      throw new ForbiddenError("تُحرّك ما أُسنِد إليك وحده.");
    }

    const closing = input.status === "DONE" || input.status === "CANCELLED";

    const updated = await tx.serviceRequest.update({
      where: { id: input.requestId },
      data: {
        status: input.status,
        ...(input.resolutionNote ? { resolutionNote: input.resolutionNote } : {}),
        ...(closing ? { closedAt: now() } : {}),
      },
      select: { id: true, number: true, status: true, closedAt: true },
    });

    return { ...updated, changed: true };
  },
});

/**
 * تعليق على طلب.
 *
 * ⚠️ **`isInternal` لا يُقبَل من الساكن.** لو قبله لكتب تعليقاً «داخلياً»
 * يراه الموظفون ويظنّونه منهم. والحقل يُجبَر على `false` لدوره.
 */
export const addRequestComment = defineAction({
  name: "addRequestComment",
  capability: "SERVICE_REQUESTS",
  kind: "write",
  transactional: true,
  auditAction: "request.comment",
  auditEntityType: "RequestComment",
  schema: z.object({
    requestId: z.string().min(1),
    body: z.string().trim().min(1, "التعليق مطلوب.").max(2000),
    isInternal: z.boolean().default(false),
  }),
  handler: async ({ input, actor, tx }) => {
    const request = await tx.serviceRequest.findUnique({
      where: { id: input.requestId },
      select: { id: true, createdByUserId: true, apartmentId: true, scope: true },
    });
    if (!request) throw new NotFoundError("الطلب");

    if (actor.role === "RESIDENT") {
      /* ⚠️ الساكن يعلّق على طلبه هو — من الجلسة لا من المُدخل */
      if (request.createdByUserId !== actor.userId) {
        throw new ForbiddenError("تعلّق على طلبك أنت.");
      }
    }

    const comment = await tx.requestComment.create({
      data: {
        requestId: input.requestId,
        authorUserId: actor.userId,
        body: input.body,
        /* ⚠️ الساكن لا يكتب داخلياً مهما أرسل */
        isInternal: actor.role === "RESIDENT" ? false : input.isInternal,
      },
      select: { id: true, createdAt: true, isInternal: true },
    });

    return comment;
  },
});

export const listServiceRequests = defineAction({
  name: "listServiceRequests",
  capability: "SERVICE_REQUESTS",
  kind: "read",
  schema: z
    .object({
      status: z.enum(REQUEST_STATUS).optional(),
      type: z.enum(REQUEST_TYPE).optional(),
      scope: z.enum(REQUEST_SCOPE).optional(),
      departmentId: z.string().optional(),
      assignedStaffId: z.string().optional(),
      search: z.string().trim().min(1).max(80).optional(),
      /**
       * ── 🔴 «طلباتي» **صفة الصفحة لا صفة الدور** ────────────────────
       * كان النطاق مشروطاً بـ`role === "RESIDENT"` وحده. و`/app/requests`
       * يفتحه الساكن **والموظّف والأدمن والمالك** (‏Q41: موظّفٌ يسكن
       * المجمَّع). فمن ليس ساكناً كان يقرأ تحت عنوان «طلباتي وشكاواي»
       * قائمةَ طلبات المجمَّع كلّه — أربعين طلباً لجيرانه بدل سبعة وعشرين
       * له. عنوانٌ يكذب، وتسريبُ نطاق لا يقصده أحد.
       *
       * ⚠️ والعَلَم **يضيّق ولا يوسّع**: `true` يقصر على صاحبه أياً كان
       * دوره، وغيابُه لا يمنح الساكن شيئاً — شرط دوره باقٍ تحته.
       */
      mine: z.boolean().optional(),
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(25),
    })
    .default({ page: 1, pageSize: 25 }),
  handler: async ({ input, actor, tx }) => {
    /*
     * ⚠️ النطاق يُفرَض في `where` لا في العرض: قائمةٌ تُرجع طلبات الجيران
     * ثم تُرشَّح في الصفحة أرسلتها فعلاً.
     */
    const ownScope =
      input.mine === true || actor.role === "RESIDENT"
        ? { createdByUserId: actor.userId }
        : {};

    const where = {
      ...ownScope,
      ...(input.status ? { status: input.status } : {}),
      ...(input.type ? { type: input.type } : {}),
      ...(input.scope ? { scope: input.scope } : {}),
      ...(input.departmentId ? { departmentId: input.departmentId } : {}),
      ...(input.assignedStaffId ? { assignedStaffId: input.assignedStaffId } : {}),
      ...(input.search
        ? {
            OR: [
              { number: { contains: input.search, mode: "insensitive" as const } },
              { title: { contains: input.search, mode: "insensitive" as const } },
              {
                apartment: {
                  displayNumber: { contains: input.search, mode: "insensitive" as const },
                },
              },
            ],
          }
        : {}),
    };

    const [rows, total, openTotal] = await Promise.all([
      tx.serviceRequest.findMany({
        where,
        /*
         * ⚠️ الأولوية أوّلاً ثم الأقدم: قائمةٌ مرتَّبة بالتاريخ وحده تدفن
         * طلباً عاجلاً وصل اليوم تحت ثلاثين طلباً عادياً وصلت أمس.
         */
        orderBy: [{ priority: "desc" }, { createdAt: "asc" }, { id: "asc" }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        select: {
          id: true,
          number: true,
          type: true,
          scope: true,
          title: true,
          status: true,
          priority: true,
          createdAt: true,
          closedAt: true,
          apartment: { select: { displayNumber: true } },
          department: { select: { id: true, name: true } },
          assignedStaff: { select: { user: { select: { fullName: true } } } },
        },
      }),
      tx.serviceRequest.count({ where }),
      /**
       * ── 🔴 «المفتوح» يُعدّ من القاعدة لا من الصفحة ──────────────────
       * كانت الشاشة تحسبه بـ`rows.filter(...)` — أي **الصفحة المعروضة
       * وحدها**. فمن له سبعة وعشرون طلباً يقرأ «١٢ مفتوح» وفي الثانية
       * أربعة أخرى، ثم يضغط «التالي» فيتغيّر العدد أمامه.
       *
       * ورقمٌ يتغيّر بتغيّر الصفحة ليس عدّاً بل صدفة.
       */
      tx.serviceRequest.count({
        where: { ...where, status: { notIn: ["DONE", "CANCELLED"] } },
      }),
    ]);

    return { rows, total, openTotal, page: input.page, pageSize: input.pageSize };
  },
});

/**
 * تفصيل طلب — بتعليقاته.
 *
 * ── 🔴 البند الثاني من تعريف الإنجاز ────────────────────────────────
 * ⚠️ التعليق الداخلي **يُستثنى من الاستعلام** لا من العرض. ترشيحٌ في
 * العميل يعني أنه أُرسل فعلاً إلى المتصفّح ويُقرأ بفتح أدوات المطوّر.
 */
export const getServiceRequest = defineAction({
  name: "getServiceRequest",
  capability: "SERVICE_REQUESTS",
  kind: "read",
  schema: z.object({ requestId: z.string().min(1) }),
  handler: async ({ input, actor, tx }) => {
    const isResident = actor.role === "RESIDENT";

    const request = await tx.serviceRequest.findUnique({
      where: { id: input.requestId },
      select: {
        id: true,
        number: true,
        type: true,
        scope: true,
        title: true,
        description: true,
        status: true,
        priority: true,
        resolutionNote: true,
        createdAt: true,
        closedAt: true,
        createdByUserId: true,
        apartmentId: true,
        apartment: { select: { id: true, displayNumber: true } },
        department: { select: { id: true, name: true } },
        departmentTask: { select: { id: true, name: true } },
        assignedStaffId: true,
        assignedStaff: { select: { user: { select: { fullName: true } } } },
        createdBy: { select: { fullName: true } },
        comments: {
          /* 🔴 الترشيح هنا — في الاستعلام */
          where: isResident ? { isInternal: false } : {},
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            body: true,
            isInternal: true,
            createdAt: true,
            author: { select: { fullName: true } },
          },
        },
      },
    });
    if (!request) return null;

    /*
     * ⚠️ الساكن يقرأ طلبه هو. و`null` لا `ForbiddenError`: طلبُ غيري
     * وطلبٌ غير موجود يجب أن يُعطيا الجواب نفسه، وإلا صار الفرق وسيلةَ
     * استكشاف لما هو موجود.
     */
    if (isResident && request.createdByUserId !== actor.userId) return null;

    /*
     * ⚠️ **`Q35` صراحةً**: طلب المنطقة المشتركة لا يمنح وصولاً إلى شقة.
     * يُعاد العلم كي تعتمد عليه الطبقات الأعلى بدل أن تُعيد الاستنتاج.
     */
    const grantsApartmentAccess = requestGrantsApartmentAccess({
      scope: request.scope,
      apartmentId: request.apartmentId,
    });

    return { ...request, grantsApartmentAccess };
  },
});
