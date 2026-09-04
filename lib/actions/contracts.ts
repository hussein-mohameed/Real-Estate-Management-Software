"use server";

import { z } from "zod";
import { defineAction } from "./define-action";
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
  PendingDecisionError,
} from "@/lib/errors";
import { violates } from "@/lib/db-errors";
import { nextNumber } from "@/lib/services/counter";
import { formatIqd } from "@/lib/money";
import { now } from "@/lib/dates";
import { CONTRACT_TYPE, PAYMENT_TYPE, BILLING_CYCLE } from "@/lib/domain/enums";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  العقود وفتح الحساب — الخطوة 1.5. **قلب النظام المالي.**
 * ═══════════════════════════════════════════════════════════════════════
 *
 * المبدأ 3: **الدفتر يتبع العقد لا الشقة.** مالك جديد أو مستأجر جديد =
 * حساب جديد من صفر؛ الحساب القديم يُغلق ويبقى مقروءاً في تاريخ الشقة
 * للأبد. لهذا `Account.contractId` فريد، ولهذا لا يوجد «حساب الشقة».
 *
 * ── أثر D1: عقدان نشطان لا واحد ─────────────────────────────────────
 * `R14` في المواصفة يقول «عقد نشط واحد لكل شقة». **D1 يتجاوزه**: الفريد
 * على `(apartmentId, type)`، فـ«شقة مباعة يسكنها مستأجر» قابلة للتمثيل —
 * وهي بالضبط الحالة التي وُجد من أجلها `payerType`. الفهرس الفريد الجزئي
 * في `prisma/sql/001-constraints.sql` هو التنفيذ الحقيقي؛ الفحوص هنا
 * لإعطاء رسالة عربية قبل أن يصرخ المحرّك برسالة إنكليزية.
 */

// ═══════════════════════════════════════════════════════════════════════
//  المخطّطات
// ═══════════════════════════════════════════════════════════════════════

const iqdField = (label: string) =>
  z
    .union([z.string(), z.number(), z.bigint()])
    .transform((v, ctx) => {
      const n =
        typeof v === "bigint" ? v : BigInt(String(v).replace(/[\s,]/g, "") || "0");
      if (n <= 0n) {
        ctx.addIssue({ code: "custom", message: `${label} يجب أن يكون أكبر من صفر.` });
        return z.NEVER;
      }
      return n;
    });

const createContractSchema = z
  .object({
    apartmentId: z.string().min(1, "الشقة مطلوبة."),
    holderUserId: z.string().min(1, "صاحب العقد مطلوب."),
    type: z.enum(CONTRACT_TYPE),
    startDate: z.coerce.date(),
    endDate: z.coerce.date().optional(),
    totalAmountIqd: iqdField("قيمة العقد").optional(),
    paymentType: z.enum(PAYMENT_TYPE).optional(),
    rentAmountIqd: iqdField("مبلغ الإيجار").optional(),
    rentCycle: z.enum(BILLING_CYCLE).optional(),
    notes: z.string().trim().max(1000).optional(),
  })
  .superRefine((v, ctx) => {
    // ── §4.11: `endDate` **إلزامي للإيجار** ─────────────────────────
    // ليس اجتهاداً: جدول الحقول يقول «Required for RENTAL». وإيجار بلا
    // نهاية يعني دورة فوترة بلا حدّ، وهو ما لا يستطيع أحد مراجعته.
    if (v.type === "RENTAL") {
      if (!v.endDate) {
        ctx.addIssue({ code: "custom", path: ["endDate"], message: "تاريخ نهاية العقد مطلوب لعقد الإيجار." });
      }
      if (!v.rentAmountIqd) {
        ctx.addIssue({ code: "custom", path: ["rentAmountIqd"], message: "مبلغ الإيجار مطلوب لعقد الإيجار." });
      }
      if (!v.rentCycle) {
        ctx.addIssue({ code: "custom", path: ["rentCycle"], message: "دورة الإيجار مطلوبة لعقد الإيجار." });
      }
    }

    if (v.type === "SALE") {
      if (!v.totalAmountIqd) {
        ctx.addIssue({ code: "custom", path: ["totalAmountIqd"], message: "قيمة البيع مطلوبة لعقد التمليك." });
      }
      if (!v.paymentType) {
        ctx.addIssue({ code: "custom", path: ["paymentType"], message: "طريقة الدفع مطلوبة لعقد التمليك." });
      }
    }

    if (v.endDate && v.endDate <= v.startDate) {
      ctx.addIssue({ code: "custom", path: ["endDate"], message: "تاريخ النهاية يجب أن يكون بعد تاريخ البداية." });
    }
  });

// ═══════════════════════════════════════════════════════════════════════
//  إنشاء عقد — مسوّدة
// ═══════════════════════════════════════════════════════════════════════

/**
 * ينشئ عقداً بحالة `DRAFT`. **لا يفتح حساباً ولا يمسّ الشقة.**
 *
 * ── لماذا يستهلك رقماً وهو مسوّدة ────────────────────────────────────
 * `contractNumber` غير قابل لـnull في المخطّط، فالرقم يُحجز عند الإنشاء.
 * مسوّدة تُهجَر تترك **فجوة** في التسلسل — و`R34` يقبل الفجوات صراحةً
 * ويمنع التكرار وحده. الفجوة تُفسَّر، أما رقما عقد متطابقان فلا.
 *
 * ── لماذا لا نمنع مسوّدة ثانية بينما عقد نشط قائم ───────────────────
 * تحضير عقد التجديد قبل انتهاء الحالي سلوك طبيعي. المنع محلّه **التفعيل**
 * لا الإنشاء؛ والفهرس الفريد الجزئي يحرس `ACTIVE` وحدها.
 */
export const createContract = defineAction({
  name: "createContract",
  capability: "CONTRACTS",
  kind: "write",
  transactional: true,
  auditAction: "contract.create",
  auditEntityType: "Contract",
  schema: createContractSchema,
  handler: async ({ input, tx }) => {
    const apartment = await tx.apartment.findFirst({
      where: { id: input.apartmentId, deletedAt: null },
      select: { id: true, displayNumber: true },
    });
    if (!apartment) throw new NotFoundError("الشقة");

    // ⚠️ لا نشترط `role === "RESIDENT"` رغم أن §4.11 يصف صاحب العقد بذلك:
    // ‏Q41 يقرّر أن الموظف الساكن **يبقى بدور STAFF**، فاشتراط الدور كان
    // سيمنع موظفاً من امتلاك شقة أو استئجارها في المجمّع الذي يعمل فيه.
    const holder = await tx.user.findFirst({
      where: { id: input.holderUserId },
      select: { id: true, fullName: true, isActive: true },
    });
    if (!holder) throw new NotFoundError("صاحب العقد");
    if (!holder.isActive) {
      throw new BusinessRuleError(
        `«${holder.fullName}» حساب معطَّل، ولا يصحّ أن يكون صاحب عقد.`,
      );
    }

    const contractNumber = await nextNumber("CTR", tx);

    const contract = await tx.contract.create({
      data: {
        contractNumber,
        apartmentId: input.apartmentId,
        holderUserId: input.holderUserId,
        type: input.type,
        status: "DRAFT",
        startDate: input.startDate,
        endDate: input.endDate ?? null,
        totalAmountIqd: input.totalAmountIqd ?? null,
        paymentType: input.paymentType ?? null,
        rentAmountIqd: input.rentAmountIqd ?? null,
        rentCycle: input.rentCycle ?? null,
        notes: input.notes ?? null,
      },
      select: {
        id: true, contractNumber: true, type: true, status: true,
        apartmentId: true, holderUserId: true,
      },
    });

    return contract;
  },
});

// ═══════════════════════════════════════════════════════════════════════
//  تفعيل عقد — **معاملة واحدة تفتح الحساب**
// ═══════════════════════════════════════════════════════════════════════

const activateSchema = z.object({
  contractId: z.string().min(1, "العقد مطلوب."),
});

/**
 * ينقل العقد إلى `ACTIVE` **ويفتح حسابه في نفس المعاملة** (‏R15).
 *
 * ── لماذا الذرّية ليست تفصيلاً ───────────────────────────────────────
 * عقد نشط بلا حساب لا يفشل عند التفعيل — يفشل **بعد شهر** عند أول دورة
 * فوترة، بصمت، على شقة يظنّها الأدمن مفوترة. لذلك الخطوتان معاملة واحدة،
 * ويوجد اختبار يُفشل خطوة وسطى عمداً ويؤكّد التراجع الكامل.
 *
 * ── ما لا يفعله هذا الإجراء ─────────────────────────────────────────
 * **لا يغيّر `occupancyStatus`.** الإشغال مفتاح الفوترة وله إجراؤه
 * (‏1.6): عقد بيع نشط لا يعني أن المالك انتقل للسكن، وعقد إيجار موقَّع
 * لا يعني أن المستأجر دخل. خلط الاثنين يبدأ الفوترة قبل أوانها.
 */
export const activateContract = defineAction({
  name: "activateContract",
  capability: "CONTRACTS",
  kind: "write",
  transactional: true,
  auditAction: "contract.activate",
  auditEntityType: "Contract",
  schema: activateSchema,
  handler: async ({ input, tx }) => {
    const contract = await tx.contract.findFirst({
      where: { id: input.contractId, deletedAt: null },
      select: {
        id: true, contractNumber: true, type: true, status: true,
        apartmentId: true, holderUserId: true, paymentType: true,
        holder: { select: { fullName: true, isActive: true } },
        apartment: { select: { displayNumber: true, ownershipStatus: true } },
      },
    });
    if (!contract) throw new NotFoundError("العقد");

    if (contract.status !== "DRAFT") {
      throw new BusinessRuleError(
        contract.status === "ACTIVE"
          ? `العقد «${contract.contractNumber}» نشط أصلاً.`
          : `العقد «${contract.contractNumber}» منتهٍ أو مُنهى، ولا يمكن تفعيله. أنشئ عقداً جديداً.`,
      );
    }

    if (!contract.holder.isActive) {
      throw new BusinessRuleError(
        `«${contract.holder.fullName}» حساب معطَّل. فعّل الحساب قبل تفعيل العقد.`,
      );
    }

    // ── B1 محجوب ─────────────────────────────────────────────────────
    // التفعيل بالأقساط يوجب خطة أقساط، وحساب أقساطها يحتاج دلالة الدفعة
    // المقدّمة: هل تُقسَّم على القيمة كلها أم على القيمة ناقص المقدّم؟
    // الفرق **10 ملايين د.ع على عقد بخمسين مليوناً**. لا يُخمَّن.
    if (contract.paymentType === "INSTALLMENTS") {
      throw new PendingDecisionError(
        "B1",
        "تفعيل عقد بالأقساط (يحتاج خطة أقساط، ودلالة الدفعة المقدّمة غير محسومة)",
      );
    }

    // ── D1: التعارض على (شقة + نوع) لا على الشقة ─────────────────────
    const rival = await tx.contract.findFirst({
      where: {
        apartmentId: contract.apartmentId,
        type: contract.type,
        status: "ACTIVE",
        deletedAt: null,
      },
      select: { contractNumber: true },
    });
    if (rival) {
      throw new ConflictError(
        `الشقة «${contract.apartment.displayNumber}» عليها عقد ${
          contract.type === "SALE" ? "تمليك" : "إيجار"
        } نشط بالرقم «${rival.contractNumber}». أنهِ العقد القائم أولاً.`,
      );
    }

    try {
      await tx.contract.update({
        where: { id: contract.id },
        data: { status: "ACTIVE" },
      });

      // ── R15: الحساب يُفتح هنا، برصيد صفر، لهذا العقد وحده ──────────
      const account = await tx.account.create({
        data: {
          contractId: contract.id,
          apartmentId: contract.apartmentId,
          holderUserId: contract.holderUserId,
          status: "OPEN",
          balanceIqd: 0n,
        },
        select: { id: true, status: true, balanceIqd: true },
      });

      // ── ربط صاحب العقد بسكنه إن كان ساكناً فعلاً ──────────────────
      // ⚠️ لا يُنشأ صفّ سكن جديد: مالك يؤجّر وحدته **ليس ساكناً فيها**،
      // وإنشاء صفّ له كان سيجعله يظهر في تعداد أفراد الشقة (‏R9) وفي
      // كشوف الأمن. الربط هنا يرفع العلم على صفّ قائم فقط.
      const holderResidency = await tx.apartmentResident.findFirst({
        where: {
          apartmentId: contract.apartmentId,
          userId: contract.holderUserId,
          isActive: true,
        },
        select: { id: true, isContractHolder: true },
      });

      if (holderResidency && !holderResidency.isContractHolder) {
        // القيد `uniq_contract_holder_per_apartment` **لكل شقة** لا لكل
        // عقد — و`ApartmentResident` لا يحمل `contractId` أصلاً فلا يمكن
        // جعله لكل عقد. إن كان العلم مرفوعاً لشخص آخر نُظهر الحالة بدل
        // أن نسحبه منه صامتين: السحب الصامت يغيّر صاحب العقد المسجَّل
        // للشقة دون أن يطلبه أحد.
        const other = await tx.apartmentResident.findFirst({
          where: {
            apartmentId: contract.apartmentId,
            isContractHolder: true,
            isActive: true,
            NOT: { userId: contract.holderUserId },
          },
          select: { user: { select: { fullName: true } } },
        });
        if (other) {
          throw new ConflictError(
            `«${other.user.fullName}» مسجَّل صاحبَ عقد على الشقة «${contract.apartment.displayNumber}». ` +
              "أزل صفته أولاً، أو راجع مسؤول النظام: القاعدة الحالية تسمح بصاحب عقد واحد لكل شقة لا لكل عقد.",
          );
        }
        await tx.apartmentResident.update({
          where: { id: holderResidency.id },
          data: { isContractHolder: true },
        });
      }

      // ── تحديث حالة التمليك ────────────────────────────────────────
      // ‏SALE ← SOLD صريح في خطة التنفيذ.
      // ‏RENTAL ← **لا يُمسّ**. تعيين `RENTED_BY_COMPANY` هو بالضبط
      // ‏Q36 المفتوح («لا تدفق يضبطها ولا قاعدة تشرح أثرها»)، وضبطها هنا
      // اختيارٌ لدلالة لم يخترها أحد — ولها أثر مالي عبر R28.
      if (contract.type === "SALE" && contract.apartment.ownershipStatus !== "SOLD") {
        await tx.apartment.update({
          where: { id: contract.apartmentId },
          data: { ownershipStatus: "SOLD" },
        });
      }

      return {
        contractId: contract.id,
        contractNumber: contract.contractNumber,
        accountId: account.id,
        accountStatus: account.status,
        balanceIqd: account.balanceIqd,
      };
    } catch (error) {
      // اسم القيد مدفون في meta.driverAdapterError.cause.originalMessage —
      // لهذا يوجد `violates()` بدل فحص String(error).
      if (violates(error, "uniq_active_contract_per_type")) {
        throw new ConflictError(
          `الشقة «${contract.apartment.displayNumber}» عليها عقد نشط من النوع نفسه.`,
        );
      }
      if (violates(error, "uniq_contract_holder_per_apartment")) {
        throw new ConflictError(
          `الشقة «${contract.apartment.displayNumber}» لها صاحب عقد مسجَّل بالفعل.`,
        );
      }
      throw error;
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════
//  إنهاء عقد — **معاملة واحدة** (‏§7.11)
// ═══════════════════════════════════════════════════════════════════════

const endSchema = z.object({
  contractId: z.string().min(1, "العقد مطلوب."),
  /** `EXPIRED` انتهاء طبيعي بالمدّة · `TERMINATED` إنهاء مبكر بقرار. */
  outcome: z.enum(["EXPIRED", "TERMINATED"]),
  reason: z.string().trim().max(500).optional(),
  /**
   * §7.11/3: الرصيد غير الصفري **يحذّر ويطلب تأكيداً — ولا يمنع**.
   * الواقع التجاري فيه ديون معدومة، ومنعُ الإغلاق يترك حسابات مفتوحة
   * إلى الأبد تشوّه كل تقرير مستحقات.
   */
  confirmNonZeroBalance: z.boolean().optional(),
});

/**
 * ينهي العقد ويغلق حسابه في معاملة واحدة (‏§7.11 · R16).
 *
 * ── أثر D1: §7.11 كُتب لعقد واحد ويجب فصله بالنوع ───────────────────
 * إنهاء **الإيجار** يمسّ حساب الإيجار واشتراكاته وسكّانه وباجاتهم فقط.
 * **حساب البيع واشتراكات المالك لا تُمسّ إطلاقاً** — وإلا خسر المالك
 * دفتره لأن مستأجره غادر.
 *
 * إنهاء **البيع** أثناء إيجار نشط **مرفوض**: وحدة يسكنها مستأجر بلا
 * مالك متعاقد حالة لا يمكن تفسيرها مالياً — على حساب مَن تُقيَّد خدمات
 * `payerType = OWNER` عندئذٍ؟
 *
 * هذا الفصل **مُستنتَج من D1 لا من نصّ §7.11**، ومُوثَّق في خطة التنفيذ.
 */
export const endContract = defineAction({
  name: "endContract",
  capability: "CONTRACTS",
  kind: "write",
  transactional: true,
  auditAction: "contract.end",
  auditEntityType: "Contract",
  schema: endSchema,
  handler: async ({ input, tx }) => {
    const contract = await tx.contract.findFirst({
      where: { id: input.contractId, deletedAt: null },
      select: {
        id: true, contractNumber: true, type: true, status: true,
        apartmentId: true,
        account: { select: { id: true, status: true, balanceIqd: true } },
        apartment: { select: { displayNumber: true, occupancyStatus: true } },
      },
    });
    if (!contract) throw new NotFoundError("العقد");

    if (contract.status !== "ACTIVE") {
      throw new BusinessRuleError(
        `العقد «${contract.contractNumber}» غير نشط، فلا شيء لإنهائه.`,
      );
    }

    // ── D1/5: إنهاء بيع أثناء إيجار نشط مرفوض ────────────────────────
    if (contract.type === "SALE") {
      const activeRental = await tx.contract.findFirst({
        where: {
          apartmentId: contract.apartmentId,
          type: "RENTAL",
          status: "ACTIVE",
          deletedAt: null,
        },
        select: { contractNumber: true },
      });
      if (activeRental) {
        throw new BusinessRuleError(
          `لا يمكن إنهاء عقد التمليك «${contract.contractNumber}» بينما عقد الإيجار ` +
            `«${activeRental.contractNumber}» نشط على الشقة «${contract.apartment.displayNumber}». ` +
            "أنهِ عقد الإيجار أولاً — وحدة يسكنها مستأجر بلا مالك متعاقد حالة لا يمكن تحصيلها.",
          "D1",
        );
      }
    }

    const account = contract.account;

    // ── §7.11/3: الرصيد غير الصفري يطلب تأكيداً ولا يُمنع ────────────
    if (account && account.balanceIqd !== 0n && !input.confirmNonZeroBalance) {
      const owed = account.balanceIqd > 0n;
      throw new BusinessRuleError(
        `إغلاق العقد مع وجود رصيد ${owed ? "مستحق" : "دائن"} قدره ` +
          `${formatIqd(account.balanceIqd < 0n ? -account.balanceIqd : account.balanceIqd)}. ` +
          "الرصيد يُجمَّد ولا يُنقَل إلى أي عقد آخر. أكّد الإغلاق للمتابعة.",
        "§7.11",
      );
    }

    const at = now();

    // 1) إلغاء اشتراكات **هذا الحساب وحده** ─────────────────────────
    let cancelledSubscriptions = 0;
    if (account) {
      const res = await tx.subscription.updateMany({
        where: { accountId: account.id, status: "ACTIVE", deletedAt: null },
        data: { status: "CANCELLED", endDate: at, nextChargeDate: null },
      });
      cancelledSubscriptions = res.count;
    }

    // 2) إغلاق الحساب — **الرصيد يُجمَّد لا يُصفَّر ولا يُنقَل** ──────
    // تصفيره كان سيمحو ديناً قائماً؛ ونقله كان سيخالف المبدأ 3.
    if (account && account.status === "OPEN") {
      await tx.account.update({
        where: { id: account.id },
        data: { status: "CLOSED", closedAt: at },
      });
    }

    // 3) إخراج السكان ────────────────────────────────────────────────
    // ⚠️ `ApartmentResident` لا يحمل `contractId`، فلا يمكن تمييز ساكني
    // الإيجار من ساكني التمليك على مستوى الصف. عملياً لا لبس: إنهاء
    // البيع ممنوع أصلاً أثناء إيجار نشط (أعلاه)، فمن يبقى ساكناً وقت
    // إنهاء البيع هم ساكنو التمليك؛ ومن يسكن وقت إنهاء الإيجار هم
    // المستأجرون. الأثر مقصور على شقة العقد.
    const movedOut = await tx.apartmentResident.updateMany({
      where: { apartmentId: contract.apartmentId, isActive: true },
      data: { isActive: false, movedOutAt: at, isContractHolder: false },
    });

    // 4) إلغاء الباجات — R38 بسبب «انتهاء العقد» ────────────────────
    const revoked = await tx.badge.updateMany({
      where: {
        status: { in: ["REQUESTED", "ISSUED"] },
        vehicle: { apartmentId: contract.apartmentId },
      },
      data: { status: "REVOKED", revokedAt: at, revokeReason: "انتهاء العقد" },
    });

    // 5) الشقة تصبح فارغة ───────────────────────────────────────────
    if (contract.apartment.occupancyStatus !== "VACANT") {
      await tx.apartment.update({
        where: { id: contract.apartmentId },
        data: { occupancyStatus: "VACANT", occupancyChangedAt: at },
      });
    }

    // ⚠️ `ownershipStatus` **لا يُمسّ عمداً**: §7.11 يعدّد أثر الإنهاء
    // بنداً بنداً ولا يذكره. إعادة الشقة إلى `UNSOLD` عند إنهاء البيع
    // قد تبدو منطقية، لكنها قرار لم يتّخذه أي مستند — وأثرها يمتدّ إلى
    // مؤشّر «إجمالي قيمة المبيعات» وإلى R28.

    await tx.contract.update({
      where: { id: contract.id },
      data: {
        status: input.outcome,
        endDate: at,
        notes: input.reason
          ? `${contract.contractNumber} — سبب الإنهاء: ${input.reason}`
          : undefined,
      },
    });

    return {
      contractId: contract.id,
      contractNumber: contract.contractNumber,
      outcome: input.outcome,
      accountClosed: account ? true : false,
      frozenBalanceIqd: account?.balanceIqd ?? 0n,
      cancelledSubscriptions,
      movedOutResidents: movedOut.count,
      revokedBadges: revoked.count,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════
//  القراءة
// ═══════════════════════════════════════════════════════════════════════

const listSchema = z.object({
  apartmentId: z.string().optional(),
  holderUserId: z.string().optional(),
  type: z.enum(CONTRACT_TYPE).optional(),
  status: z.enum(["DRAFT", "ACTIVE", "EXPIRED", "TERMINATED"]).optional(),
  /**
   * بحث نصّي على **رقم العقد** ورقم الشقة.
   *
   * ⚠️ رقم العقد هو ما يحمله الورق الذي بيد المستخدم، ورقم الشقة هو ما
   * يعرفه عن ظهر قلب. البحث بأحدهما دون الآخر يجعل نصف الحالات تفشل.
   */
  search: z.string().trim().max(60).optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
});

export const listContracts = defineAction({
  name: "listContracts",
  capability: "CONTRACTS",
  kind: "read",
  schema: listSchema,
  handler: async ({ input }) => {
    const { prisma } = await import("@/lib/prisma");
    const where = {
      deletedAt: null,
      ...(input.apartmentId ? { apartmentId: input.apartmentId } : {}),
      ...(input.holderUserId ? { holderUserId: input.holderUserId } : {}),
      ...(input.type ? { type: input.type } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.search
        ? {
            OR: [
              { contractNumber: { contains: input.search, mode: "insensitive" as const } },
              {
                apartment: {
                  displayNumber: { contains: input.search, mode: "insensitive" as const },
                },
              },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      prisma.contract.findMany({
        where,
        orderBy: [{ createdAt: "desc" }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        select: {
          id: true, contractNumber: true, type: true, status: true,
          startDate: true, endDate: true,
          totalAmountIqd: true, rentAmountIqd: true, rentCycle: true,
          paymentType: true,
          holder: { select: { id: true, fullName: true } },
          apartment: { select: { id: true, displayNumber: true } },
          // المبدأ 3: الحساب المغلق يبقى مرئياً — لا نرشّحه هنا
          account: { select: { id: true, status: true, balanceIqd: true } },
        },
      }),
      prisma.contract.count({ where }),
    ]);

    return { rows, total, page: input.page, pageSize: input.pageSize };
  },
});
