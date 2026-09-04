import type { OwnershipStatus, PayerType } from "@/lib/domain/enums";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  حلّ الحساب من `payerType` — `R28`. الخطوة 2.3.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * **الدالّة التي تحدّد من يُقيَّد عليه.** كل خدمة وكل رسم يمرّ من هنا،
 * والخطأ فيها يعني ديناً يُطالَب به من ليس عليه.
 *
 * ── `D1` هو ما جعلها قابلة للتنفيذ ──────────────────────────────────
 * قبل `D1` كان للشقة حساب واحد، فـ`payerType = OWNER` على وحدة **مؤجّرة**
 * غير قابلة للتنفيذ إطلاقاً — وهي بالضبط الحالة التي وُجد `payerType`
 * من أجلها. بوجود حسابَي بيع وإيجار مفتوحَين معاً تصير القاعدة صريحة:
 *
 *     OWNER    → حساب عقد التمليك النشط
 *     OCCUPANT → حساب عقد الإيجار النشط، وإلا حساب التمليك
 *
 * ── ولماذا نقيّة ────────────────────────────────────────────────────
 * الثماني حالات تُختبَر بجدول صريح بلا قاعدة بيانات. خطأٌ في فرع واحد
 * يظهر في جدول لا في تحقيق ميداني بعد ثلاثة أشهر من الفوترة الخاطئة.
 */

export interface ContractAccount {
  contractId: string;
  contractNumber: string;
  type: "SALE" | "RENTAL";
  accountId: string;
  /** الحساب المغلق لا يستقبل قيوداً — يُرفَض هنا لا في `postEntry`. */
  accountStatus: "OPEN" | "CLOSED";
  holderUserId: string;
}

export interface PayerContext {
  apartmentDisplayNumber: string;
  ownershipStatus: OwnershipStatus;
  /** العقود **النشطة** وحدها مع حساباتها. */
  activeContracts: readonly ContractAccount[];
}

export type PayerResolution =
  | {
      ok: true;
      accountId: string;
      /** أي عقد وقع عليه الاختيار — يُعرض للأدمن ويُسجَّل. */
      via: ContractAccount;
      /** سببٌ يُقرأ: لماذا هذا الحساب دون غيره. */
      reasonAr: string;
    }
  | { ok: false; messageAr: string };

/**
 * يحدّد الحساب الذي يُقيَّد عليه.
 *
 * ⚠️ **الرسالة عند الفشل تشرح السبب بالضبط، لا خطأً عاماً** (‏R28 حرفياً).
 * «تعذّر تفعيل الاشتراك» لا تقول للأدمن ما يفعل؛ «هذه الخدمة تُحمَّل على
 * المالك ولا يوجد عقد تمليك نشط على الشقة» تقول له.
 */
export function resolvePayerAccount(
  payerType: PayerType,
  ctx: PayerContext,
): PayerResolution {
  const apt = ctx.apartmentDisplayNumber;
  const sale = ctx.activeContracts.find((c) => c.type === "SALE");
  const rental = ctx.activeContracts.find((c) => c.type === "RENTAL");

  if (payerType === "OCCUPANT") {
    /**
     * الساكن الفعلي: المستأجر إن كانت مؤجّرة، وإلا المالك.
     * الترتيب مقصود — وحدة مباعة **ومؤجّرة** ساكنها المستأجر لا المالك.
     */
    const chosen = rental ?? sale;
    if (!chosen) {
      return {
        ok: false,
        messageAr:
          `لا يمكن تحميل هذه الخدمة على الساكن: الشقة «${apt}» ليس عليها عقد نشط ` +
          "(لا إيجار ولا تمليك)، فلا حساب يُقيَّد عليه.",
      };
    }
    return finish(chosen, apt, rental ? "الساكن الفعلي هو المستأجر" : "الساكن الفعلي هو المالك");
  }

  // ── payerType = OWNER ────────────────────────────────────────────
  if (sale) {
    return finish(sale, apt, "الخدمة على المالك، وعقد التمليك نشط");
  }

  /**
   * ⚠️ **`Q36`** — وحدة يملكها المجمّع ويؤجّرها: لا عقد تمليك ولا يمكن
   * أن يوجد، لأن **المجمّع نفسه ليس له `Account`**. حسمت خطة الجسر أن
   * خدمات `payerType = OWNER` عليها تُقيَّد على **حساب عقد الإيجار**.
   *
   * القيد محصور بهذه الحالة وحدها: على وحدة **مباعة** ومؤجّرة يبقى
   * المالك هو المُقيَّد عليه، ولا يُحمَّل المستأجر ما ليس عليه.
   */
  if (ctx.ownershipStatus === "RENTED_BY_COMPANY" && rental) {
    return finish(
      rental,
      apt,
      "الوحدة مؤجّرة من المجمّع ولا مالك متعاقد لها، والمجمّع ليس له حساب (‏Q36)",
    );
  }

  if (rental) {
    return {
      ok: false,
      messageAr:
        `لا يمكن تحميل هذه الخدمة على المالك: الشقة «${apt}» مؤجّرة ولا يوجد عليها ` +
        "عقد تمليك نشط. فعّل عقد التمليك، أو غيّر «من يدفع» إلى الساكن.",
    };
  }

  return {
    ok: false,
    messageAr:
      `لا يمكن تحميل هذه الخدمة على المالك: الشقة «${apt}» ليس عليها عقد تمليك نشط.`,
  };
}

function finish(
  chosen: ContractAccount,
  apt: string,
  reasonAr: string,
): PayerResolution {
  /**
   * ⚠️ الحساب المغلق يُرفَض **هنا** لا في `postEntry`.
   * الرفض المتأخّر يُنتج رسالة عامة من طبقة الدفتر بعد أن يكون
   * المستخدم أتمّ النموذج كلّه؛ الرفض هنا يسمّي العقد والسبب.
   */
  if (chosen.accountStatus !== "OPEN") {
    return {
      ok: false,
      messageAr:
        `حساب العقد «${chosen.contractNumber}» على الشقة «${apt}» مغلق، ` +
        "فلا يستقبل قيوداً جديدة. العقد منتهٍ — أنشئ عقداً جديداً وفعّله.",
    };
  }
  return { ok: true, accountId: chosen.accountId, via: chosen, reasonAr };
}
