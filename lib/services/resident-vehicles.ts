import { prisma } from "@/lib/prisma";
import { residentApartmentIds } from "@/lib/auth/scope";
import { BusinessRuleError, ConflictError, ForbiddenError } from "@/lib/errors";
import { violates } from "@/lib/db-errors";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  تسجيل الساكن مركبته — نطاق بنيويّ خارج مصفوفة §3.2.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── 🔴 لماذا خارج `defineAction` ────────────────────────────────────
 * خليّة `VEHICLES` للساكن: `W (own — pending admin approval)` مع
 * `requestBased: true`. و`LEVEL_ACTIONS.OWN` يمنح **القراءة وحدها** —
 * لأن المستوى يسري على كل الصفوف، ورفعُ الساكن إلى `WRITE` كان سيمنحه
 * تعديل مركبات المجمَّع كلّه.
 *
 * فالنطاق بنيويّ: **المعرّف من الجلسة**، والشقة من ارتباطاته. وهو خامس
 * موضع بهذا النمط بعد `staff-self` و`requestSubscription` و`createRequestFor`
 * و`requestableCategories`.
 *
 * ── وما لا تفعله هذه الوحدة: **الباج** ──────────────────────────────
 * ⚠️ إصدار الباج محجوب بالقرار `B3`: للشقة حسابان ممكنان بعد `D1` (مالك
 * ومستأجر)، ورسمُ الباج يُقيَّد على أحدهما — ولم يُحسم أيّهما. والتسجيل
 * لا ينتظره: مركبةٌ مسجَّلة ومعتمَدة بيانٌ صحيح بذاته، والباج يُصدَر فوقه
 * حين يُحسم القرار.
 */

/** ما يُدخله الساكن — لا `status` ولا `notes`: تلك للإدارة. */
export interface ResidentVehicleInput {
  apartmentId: string;
  plateNumber: string;
  plateProvince?: string | undefined;
  make?: string | undefined;
  model?: string | undefined;
  color?: string | undefined;
}

/**
 * يسجّل مركبةً باسم الساكن — **معلّقة دائماً**.
 *
 * ⚠️ `status` ثابتٌ هنا لا مُدخَل. قبولُه من المتصل كان يجعل الساكن
 * يسجّل مركبته `APPROVED` — أي يمنح نفسه دخول البوّابة بلا مراجعة، وهو
 * بالضبط ما تعنيه «‏pending admin approval» في المصفوفة.
 */
export async function registerVehicleFor(
  userId: string,
  input: ResidentVehicleInput,
): Promise<{ id: string; plateNumber: string; status: string }> {
  const plateNumber = input.plateNumber.trim();
  if (plateNumber.length < 3) {
    throw new BusinessRuleError("رقم اللوحة قصير جداً.");
  }

  /* ⚠️ النطاق من الجلسة: لا يسجّل الساكن مركبةً على شقة جاره */
  const mine = await residentApartmentIds(userId);
  if (!mine.includes(input.apartmentId)) {
    throw new ForbiddenError("لا تسجّل مركبة على شقة ليست لك.");
  }

  try {
    return await prisma.vehicle.create({
      data: {
        apartmentId: input.apartmentId,
        ownerUserId: userId,
        plateNumber,
        plateProvince: input.plateProvince?.trim() || null,
        make: input.make?.trim() || null,
        model: input.model?.trim() || null,
        color: input.color?.trim() || null,
        status: "PENDING_APPROVAL",
      },
      select: { id: true, plateNumber: true, status: true },
    });
  } catch (error) {
    /**
     * ── ⚠️ الرسالة تُقال ولا تُكشَف ────────────────────────────────────
     * `uniq_active_plate` (‏S7) يمنع تسجيل لوحة مسجَّلة. والرسالة **لا
     * تقول لمن** هي: ذلك يجعل النموذج أداةَ استعلام — يُدخل فضوليّ لوحةً
     * فيعرف أنها في المجمَّع، وربّما في أي شقة لو ذكرناها.
     *
     * والصياغة تُحيل إلى الإدارة لأنها الجهة التي تستطيع النظر في الصفّ
     * والتفريق بين تكرارٍ حقيقي وسيارةٍ بيعت ولم تُرفَع.
     */
    if (violates(error, "uniq_active_plate")) {
      throw new ConflictError(
        `اللوحة «${plateNumber}» مسجَّلة في المجمَّع سلفاً. راجع الإدارة إن كانت لك.`,
      );
    }
    throw error;
  }
}
