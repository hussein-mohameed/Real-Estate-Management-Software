"use server";

import { z } from "zod";
import { defineAction } from "./define-action";
import { residentApartmentIds } from "@/lib/auth/scope";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  بوّابة الساكن — قراءات مقصورة على نطاقه (‏§8.3).
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── النطاق يأتي من مصدر واحد ────────────────────────────────────────
 * كل استعلام هنا يبدأ من `residentApartmentIds(userId)`. **لا يُكتب أي
 * مرشّح نطاق بيدٍ ثانية**: مرشّح واحد يُنسى في استعلام واحد يكفي ليرى
 * ساكن بيانات شقة جاره — وهو عيب لا يظهر في أي شاشة، لأن الساكن الذي
 * يرى ما لا يخصّه لا يشتكي.
 *
 * ── ولماذا `holderUserId` شرط في الحساب لا في الشقة ─────────────────
 * ساكن غير صاحب العقد يعيش في الشقة ولا يملك حسابها. أفراد الأسرة يرون
 * الشقة والسكان، **ولا يرون كشف الحساب ولا الرصيد**. هذا هو الفرق الذي
 * يجعل `residentAccountIds` يشترط `holderUserId` بينما
 * `residentApartmentIds` لا يشترطه.
 *
 * ── الموظف المقيم (‏Q41) ────────────────────────────────────────────
 * دوره `STAFF` ولا يتغيّر، ووصوله هنا يأتي من ارتباط السكن لا من الدور.
 * لولا ذلك لبقي الحارس المقيم بلا كشف حساب ولا طريق لدفع اشتراكاته.
 */

const emptySchema = z.object({}).default({});

/**
 * كل ما تعرضه الصفحة الرئيسية للساكن: شققه، وعقوده، وحساباته وأرصدتها،
 * وآخر حركات دفتره.
 */
export const getMyHome = defineAction({
  name: "getMyHome",
  capability: "APARTMENTS",
  kind: "read",
  schema: emptySchema,
  handler: async ({ actor, tx }) => {
    const apartmentIds = await residentApartmentIds(actor.userId);

    // ⚠️ لا تفريع على القائمة الفارغة عمداً. `in: []` يترجمه Prisma إلى
    // `WHERE 1=0` فلا يكلّف شيئاً، بينما الخروج المبكر بقيمة مصبوبة كان
    // يُنتج **اتحاد نوعين** عند المستهلك: صفوف حقيقية في مسار، ونوع يدوي
    // في الآخر. والنوع اليدوي يتقادم بصمت عند أول تغيير في `select`.
    // «لا ارتباط سكن» حالة حقيقية: حساب أُنشئ ولم يُربط بشقة بعد.
    const apartments = await tx.apartment.findMany({
      where: { id: { in: apartmentIds }, deletedAt: null },
      select: {
        id: true,
        displayNumber: true,
        floorNumber: true,
        occupancyStatus: true,
        constructionStatus: true,
        building: { select: { code: true, name: true } },
        residents: {
          where: { isActive: true },
          select: {
            id: true,
            relationType: true,
            isContractHolder: true,
            movedInAt: true,
            user: { select: { id: true, fullName: true, phone: true } },
          },
        },
      },
      orderBy: { displayNumber: "asc" },
    });

    /**
     * ⚠️ الحسابات **مقيَّدة بـ`holderUserId`** لا بالشقة وحدها.
     * لولا هذا الشرط لرأى كلُّ فرد في الأسرة رصيدَ صاحب العقد — وهو
     * تسريب مالي داخل البيت الواحد، لا يقلّ عن التسريب بين الشقق.
     */
    const accounts = await tx.account.findMany({
      where: { apartmentId: { in: apartmentIds }, holderUserId: actor.userId },
      select: {
        id: true,
        status: true,
        balanceIqd: true,
        openedAt: true,
        closedAt: true,
        apartment: { select: { id: true, displayNumber: true } },
        contract: {
          select: {
            id: true,
            contractNumber: true,
            type: true,
            status: true,
            startDate: true,
            endDate: true,
            rentAmountIqd: true,
            rentCycle: true,
          },
        },
        entries: {
          orderBy: { createdAt: "desc" },
          take: 10,
          select: {
            id: true,
            type: true,
            source: true,
            amountIqd: true,
            descriptionAr: true,
            createdAt: true,
          },
        },
      },
      // المبدأ 3: المفتوح أولاً، والمغلق يبقى مرئياً بعده لا محذوفاً
      orderBy: [{ status: "asc" }, { openedAt: "desc" }],
    });

    return { apartments, accounts };
  },
});

const accountSchema = z.object({
  accountId: z.string().min(1),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(50),
});

/**
 * كشف حساب واحد بكل قيوده.
 *
 * ⚠️ الفحص **يُعاد داخل الاستعلام** لا قبله: `accountId` يصل من العميل،
 * ومطابقته على قائمة مسبقة ثم الاستعلام بها نمطٌ ينكسر عند أول إعادة
 * ترتيب. الشرط جزء من `where` نفسه، فلا يوجد مسار يتجاوزه.
 */
export const getMyAccount = defineAction({
  name: "getMyAccount",
  capability: "LEDGER_AND_ACCOUNTS",
  kind: "read",
  schema: accountSchema,
  handler: async ({ input, actor, tx }) => {
    const apartmentIds = await residentApartmentIds(actor.userId);

    const account = await tx.account.findFirst({
      where: {
        id: input.accountId,
        holderUserId: actor.userId,
        apartmentId: { in: apartmentIds },
      },
      select: {
        id: true,
        status: true,
        balanceIqd: true,
        openedAt: true,
        closedAt: true,
        apartment: { select: { displayNumber: true } },
        contract: { select: { contractNumber: true, type: true, status: true } },
      },
    });

    // ⚠️ `null` لا `ForbiddenError`: حسابُ غيري وحسابٌ غير موجود يجب أن
    // يُعطيا الجواب نفسه، وإلا صار الفرق بينهما وسيلةً لاستكشاف ما هو
    // موجود في النظام.
    if (!account) return null;

    const [entries, total, invoices] = await Promise.all([
      tx.ledgerEntry.findMany({
        where: { accountId: account.id },
        orderBy: { createdAt: "desc" },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        select: {
          id: true,
          type: true,
          source: true,
          amountIqd: true,
          descriptionAr: true,
          periodStart: true,
          periodEnd: true,
          createdAt: true,
        },
      }),
      tx.ledgerEntry.count({ where: { accountId: account.id } }),
      /**
       * فواتير الحساب — الخطوة 3.1.
       *
       * ── ⚠️ داخل هذا الإجراء لا إجراءٌ ثانٍ ────────────────────────
       * ملكيّة الحساب تحقَّقت أعلاه بـ`holderUserId` و`apartmentIds`.
       * وإجراءٌ منفصل `getMyInvoices(accountId)` كان سيحتاج أن يُعيد نفس
       * التحقّق — ونسخةٌ ثانية من شرط ملكية تعني موضعين ينبغي أن
       * يتغيّرا معاً، وأول مرّة يُنسى أحدهما تُقرأ فواتير الغير.
       *
       * ── ولا صفحات لها ────────────────────────────────────────────
       * الفاتورة تُصدَر مع دفعة، والدفعات أقلّ بكثير من القيود. أحدثُ
       * 12 تكفي لما يفعله الساكن هنا: يجد وصل آخر دفعة.
       */
      tx.invoice.findMany({
        where: { accountId: account.id },
        orderBy: { issuedAt: "desc" },
        take: 12,
        /*
         * ⚠️ `lines` **مستثناة**: لقطة بنود قد تحمل تفاصيل لا يعرضها
         * هذا الجدول، و`pdfUrl` كذلك لأن الرفع مؤجَّل ورابطٌ بلا توقيع
         * يصير عاماً لمن يحصل عليه.
         */
        select: { id: true, number: true, issuedAt: true, totalIqd: true },
      }),
    ]);

    return {
      account,
      entries,
      total,
      invoices,
      page: input.page,
      pageSize: input.pageSize,
    };
  },
});

/**
 * ملف الساكن الشخصي — بياناته هو وحدها.
 *
 * ⚠️ **روابط صور الهوية وبطاقة السكن لا تُقرأ هنا.** الحقلان موجودان في
 * `ResidentProfile` والرفع مؤجَّل (يحتاج `SUPABASE_SECRET_KEY` وقرارَ مدّة
 * الاحتفاظ `F4`). وإخراج رابط ملف خاص بلا توقيع يجعله عاماً لمن يحصل
 * عليه — فالحقلان يُستثنيان صراحةً من `select` بدل أن يُرشَّحا في العرض.
 * الترشيح في العرض ينسى؛ الاستثناء من الاستعلام لا يُنسى.
 */
export const getMyProfile = defineAction({
  name: "getMyProfile",
  capability: "RESIDENT_PROFILES",
  kind: "read",
  schema: emptySchema,
  handler: async ({ actor, tx }) => {
    return tx.user.findUnique({
      where: { id: actor.userId },
      select: {
        id: true,
        fullName: true,
        phone: true,
        email: true,
        role: true,
        isActive: true,
        createdAt: true,
        lastLoginAt: true,
        residentProfile: {
          select: {
            emergencyPhone: true,
            notes: true,
            // nationalIdImageUrl / residenceCardImageUrl مستثنيان عمداً
          },
        },
        /*
         * ⚠️ **آخر طلب تعديل — واحدٌ لا قائمة.** الشاشة تجيب عن سؤالين
         * فقط: «هل طلبي قيد النظر؟» و«ماذا قيل في الأخير؟». وقائمةُ
         * تاريخٍ كامل تُحوّل صفحة الملفّ إلى سجلّ لا أحد يفتحها لأجله.
         */
        residentRequests: {
          where: { kind: "PROFILE_CHANGE" },
          select: {
            id: true,
            status: true,
            reviewNote: true,
            reviewedAt: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });
  },
});

// ═══════════════════════════════════════════════════════════════════════
//  اشتراكاتي (‏§8.4) — «الخدمات النشطة بسعرها ودورتها»
// ═══════════════════════════════════════════════════════════════════════

/**
 * اشتراكات وحداتي.
 *
 * ── ⚠️ **المبلغ لصاحب الحساب وحده** ────────────────────────────────
 * هذا هو نفس الفرق الذي يحكم الرصيد في `getMyHome`، مطبَّقاً على
 * الاشتراك: **وجودُ الخدمة على الوحدة** حقيقةٌ منزلية يراها كل ساكن
 * (النفايات والمولّدة تخصّ الجميع)، أما **ثمنُها** فيُقيَّد على حساب صاحب
 * العقد ولا يخصّ غيره. فابن صاحب العقد يرى «مولّدة · شهري» ولا يرى كم.
 *
 * وبلا هذا التمييز كان الخيار بين حجب قائمة الخدمات عن أهل البيت — وهي
 * معلومة يحتاجونها — أو تسريب مبالغ داخل البيت الواحد.
 *
 * ── والاشتراك الشخصي لغيري لا يظهر لي ──────────────────────────────
 * ⚠️ اشتراك `subjectType = RESIDENT` مربوطٌ بشخص بعينه (‏`residentUserId`).
 * وعرضُه لكل من في الوحدة يكشف ما اشترك به فردٌ لنفسه. الشرط: إمّا
 * اشتراك الوحدة، أو اشتراكي أنا.
 */
export const getMySubscriptions = defineAction({
  name: "getMySubscriptions",
  capability: "SUBSCRIPTIONS",
  kind: "read",
  schema: emptySchema,
  handler: async ({ actor, tx }) => {
    const apartmentIds = await residentApartmentIds(actor.userId);

    /**
     * ⚠️ حسابات «صاحب العقد أنا» تُقرأ **داخل `tx`** لا عبر
     * `residentAccountIds`: تلك تستعلم على `prisma` مباشرةً، أي خارج هذه
     * المعاملة وعلى لقطة أخرى. والاتساق داخل الاستعلام الواحد أهمّ من
     * إعادة استعمال دالّة — والشرط نفسه حرفياً: `holderUserId = أنا`.
     */
    const myAccounts = await tx.account.findMany({
      where: { apartmentId: { in: apartmentIds }, holderUserId: actor.userId },
      select: { id: true },
    });
    const mine = new Set(myAccounts.map((a) => a.id));

    const rows = await tx.subscription.findMany({
      where: {
        apartmentId: { in: apartmentIds },
        deletedAt: null,
        // المعلَّق يُعرَض أيضاً: طلبَ ولم يُوافَق بعد، وإخفاؤه يجعله يطلب ثانيةً
        // PAUSED لا SUSPENDED — الأخيرة ليست في enum المخطّط
        status: { in: ["ACTIVE", "PENDING_APPROVAL", "PAUSED"] },
        OR: [{ subjectType: "APARTMENT" }, { residentUserId: actor.userId }],
      },
      select: {
        id: true,
        status: true,
        subjectType: true,
        billingCycle: true,
        quantity: true,
        periodAmountIqd: true,
        startDate: true,
        nextChargeDate: true,
        accountId: true,
        /*
         * ⚠️ التاريخ وحده — لا `cancellationReason` ولا من طلبه.
         * السبب كتبه الساكن للإدارة، وعرضُه على شاشة يقرؤها أفراد البيت
         * يُظهر ما قاله عنهم أحياناً. والشاشة تحتاج «هل طُلب؟» لا «لماذا».
         */
        cancellationRequestedAt: true,
        /*
         * ⚠️ يُقرأ ليُشتقّ منه `cancellationIsMine` **ولا يخرج**: الشاشة
         * تحتاج «هل أسحبه؟» لا «من طلبه». وكشفُ الاسم يُخبر فرداً في البيت
         * أن قريبه طلب إلغاء ما يدفعه غيرُه — خبرٌ ليس للشاشة أن تنقله.
         */
        cancellationRequestedByUserId: true,
        service: { select: { id: true, name: true, isMandatory: true } },
        apartment: { select: { id: true, displayNumber: true } },
      },
      orderBy: [{ status: "asc" }, { startDate: "desc" }],
    });

    return {
      rows: rows.map(({ accountId, periodAmountIqd, cancellationRequestedByUserId, ...r }) => ({
        ...r,
        /*
         * ⚠️ منطقيّ لا معرّف: `cancellationRequestedByUserId` يُستهلَك هنا
         * ولا يُمرَّر. و**صاحب الطلب وحده يسحبه** — راجع
         * `withdrawSubscriptionCancellation`: طلبٌ يبطله فردٌ آخر في البيت
         * يفتح تنازعاً صامتاً على قرارٍ ماليّ.
         */
        cancellationIsMine: cancellationRequestedByUserId === actor.userId,
        /**
         * ⚠️ `null` لا صفر. الصفر مبلغٌ صحيح («خدمة بلا مقابل»)، و`null`
         * تعني «ليس من شأنك» — والواجهة تعرض الأولى رقماً والثانية شرطة.
         * الخلط بينهما كان سيُخبر أهل البيت أن الخدمة مجانية.
         */
        periodAmountIqd: accountId !== null && mine.has(accountId) ? periodAmountIqd : null,
      })),
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════
//  سياراتي وباجاتها (‏§8.4)
// ═══════════════════════════════════════════════════════════════════════

/**
 * سيارات وحداتي وحالة باجاتها.
 *
 * ── القدرة `VEHICLES`، والباج يأتي معها ────────────────────────────
 * `BADGES` للساكن `OWN` قراءةً أيضاً، فقراءة الباج المرفق بسيارة في نطاقه
 * **لا تمنح شيئاً** لم تمنحه المصفوفة. والفصل إلى إجراءين كان سيُجبر
 * الواجهة على ضمّ النتيجتين بيدها — وهو موضع خطأ نطاق جديد.
 *
 * ── ⚠️ والباج المنتهي يُحسَب منتهياً هنا لا في القاعدة ─────────────
 * `Q40` مسجَّل في المخطّط بنصّه: **لا مهمة تقلب `EXPIRED`**، فباج مضى
 * تاريخه يبقى صفُّه `ISSUED`. وعرضُ «صالح» لباج منتهٍ يجعل الساكن يقف عند
 * البوّابة واثقاً ثم يُمنَع.
 *
 * فالحالة الفعلية تُحسب هنا. وهذا **عرضٌ لا إصلاح**: الصفّ يبقى كما هو
 * حتى تُبنى مهمة الصيانة، ولا يجوز أن تُخفي الواجهة نقصاً في البيانات
 * بتصحيحه صامتاً — لذلك يُرجَع العَلَم `isStale` كي تقول الواجهة إن
 * الحالة محسوبة لا مخزَّنة.
 */
export const getMyVehicles = defineAction({
  name: "getMyVehicles",
  capability: "VEHICLES",
  kind: "read",
  schema: emptySchema,
  handler: async ({ actor, tx }) => {
    const apartmentIds = await residentApartmentIds(actor.userId);

    const rows = await tx.vehicle.findMany({
      where: {
        apartmentId: { in: apartmentIds },
        // المُزالة لا تُعرَض: سيارة بيعت ليست سيارته، وعرضها يربك
        status: { not: "REMOVED" },
      },
      select: {
        id: true,
        plateNumber: true,
        plateProvince: true,
        make: true,
        model: true,
        color: true,
        status: true,
        ownerUserId: true,
        apartment: { select: { id: true, displayNumber: true } },
        badges: {
          where: { status: { not: "REVOKED" } },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { id: true, code: true, status: true, expiresAt: true, issuedAt: true },
        },
      },
      orderBy: [{ status: "asc" }, { plateNumber: "asc" }],
    });

    const nowMs = Date.now();

    return {
      rows: rows.map(({ badges, ...v }) => {
        const badge = badges[0] ?? null;
        const expired =
          badge !== null &&
          badge.status === "ISSUED" &&
          badge.expiresAt !== null &&
          badge.expiresAt.getTime() < nowMs;

        return {
          ...v,
          isMine: v.ownerUserId === actor.userId,
          badge:
            badge === null
              ? null
              : {
                  ...badge,
                  /** الحالة **المعروضة** — محسوبة لا مخزَّنة حين انتهت. */
                  effectiveStatus: expired ? ("EXPIRED" as const) : badge.status,
                  /** `true` حين خالفت المحسوبة المخزَّنة — أثر `Q40`. */
                  isStale: expired,
                },
        };
      }),
    };
  },
});

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  فواتيري — قائمة مستقلّة مصفَّحة.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ⚠️ **مقصورة على حساباتي أنا** (`holderUserId`) لا على شققي. فردُ الأسرة
 * يرى بيته ولا يرى فواتير صاحب العقد — نفس الحدّ الذي يحكم كشف الحساب.
 * والتسريب المالي داخل البيت لا يقلّ عن التسريب بين البيوت.
 *
 * ⚠️ و`lines` و`pdfUrl` **مستثناتان من `select`**: لقطة البنود قد تحمل
 * تفاصيل لا يعرضها الجدول، ورابطٌ لملفّ خاص بلا توقيع يصير عاماً لمن
 * يحصل عليه. والاستثناء من الاستعلام لا يُنسى؛ الترشيح في العرض يُنسى.
 */
export const getMyInvoices = defineAction({
  name: "getMyInvoices",
  capability: "LEDGER_AND_ACCOUNTS",
  kind: "read",
  schema: z
    .object({
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(25),
    })
    .default({ page: 1, pageSize: 25 }),
  handler: async ({ input, actor, tx }) => {
    const apartmentIds = await residentApartmentIds(actor.userId);

    const accounts = await tx.account.findMany({
      where: { apartmentId: { in: apartmentIds }, holderUserId: actor.userId },
      select: { id: true },
    });
    const accountIds = accounts.map((a) => a.id);

    if (accountIds.length === 0) {
      return { rows: [], total: 0, page: input.page, pageSize: input.pageSize };
    }

    const where = { accountId: { in: accountIds } };

    const [rows, total] = await Promise.all([
      tx.invoice.findMany({
        where,
        /* ⚠️ ترتيب حاسم: فاتورتان في ثانية واحدة تتداخلان بين الصفحات */
        orderBy: [{ issuedAt: "desc" }, { number: "desc" }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        select: {
          id: true,
          number: true,
          issuedAt: true,
          totalIqd: true,
          account: { select: { apartment: { select: { displayNumber: true } } } },
        },
      }),
      tx.invoice.count({ where }),
    ]);

    return { rows, total, page: input.page, pageSize: input.pageSize };
  },
});

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  أقساطي — الخطة وجدولها.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ⚠️ **على عقودي أنا** (`holderUserId`) لا على شققي: الأقساط التزامٌ مالي
 * على صاحب العقد وحده. وفردُ الأسرة يرى بيته ولا يرى دَين من وقّع.
 *
 * ⚠️ و«المتبقّي» يشمل **المتأخّر**: جمعُ `PENDING` وحدها يُخفي ما تأخّر —
 * وهو أوّل ما يسأل عنه من يفتح هذه الشاشة.
 */
export const getMyInstallments = defineAction({
  name: "getMyInstallments",
  capability: "INSTALLMENT_PLANS",
  kind: "read",
  schema: emptySchema,
  handler: async ({ actor, tx }) => {
    const plans = await tx.installmentPlan.findMany({
      where: { contract: { holderUserId: actor.userId, deletedAt: null } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        totalAmountIqd: true,
        downPaymentIqd: true,
        installmentsCount: true,
        status: true,
        contract: {
          select: {
            contractNumber: true,
            type: true,
            apartment: { select: { displayNumber: true } },
          },
        },
        installments: {
          orderBy: { sequence: "asc" },
          select: {
            id: true,
            sequence: true,
            dueDate: true,
            amountIqd: true,
            status: true,
            paidAt: true,
          },
        },
      },
    });

    return plans.map((p) => ({
      ...p,
      paidCount: p.installments.filter((i) => i.status === "PAID").length,
      overdueCount: p.installments.filter((i) => i.status === "OVERDUE").length,
      remainingIqd: p.installments
        .filter((i) => i.status === "PENDING" || i.status === "OVERDUE")
        .reduce((sum, i) => sum + i.amountIqd, 0n),
    }));
  },
});
