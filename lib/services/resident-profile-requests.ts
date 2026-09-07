import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { BusinessRuleError, ConflictError, NotFoundError } from "@/lib/errors";
import { normalizePhone } from "@/lib/domain/phone";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  طلب الساكن تعديل بياناته — §3.2 «‏O (own, read + request change)».
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── 🔴 جدولٌ كان بلا كاتب ولا قارئ ──────────────────────────────────
 * `ResidentRequest` موجود في المخطّط بأنواعه الثلاثة (`Q37`) ولم يمسّه
 * سطرٌ واحد في الكود. أي جدولٌ يبدو مبنيّاً في مراجعة المخطّط، ولا مسار
 * إليه في التطبيق — وهو أسوأ من غيابه، لأنه يُقرأ كأن الميزة موجودة.
 *
 * ── ولماذا **طلب** لا تعديل مباشر ───────────────────────────────────
 * `LEVEL_ACTIONS.OWN` يمنح القراءة وحدها، والخليّة تقول «read + request
 * change» — والفرق ليس شكلياً: بيانات الساكن يُبنى عليها عقدٌ ومطالبات،
 * وتغييرُها بضغطة يجعل «مع من تعاقدنا؟» سؤالاً بلا جواب موثوق.
 *
 * ── 🔴 والهاتف **هو هويّة الدخول** ──────────────────────────────────
 * الساكن يدخل برمز على رقمه. فطلب تغييره طلبُ **نقل وصولٍ إلى الحساب**
 * لا تحديثُ حقل. ولذلك:
 *   • يُطبَّع ويُفحَص تفرّده **مرّتين**: عند الطلب برسالة مفهومة، وعند
 *     الموافقة لأن رقماً قد يُسجَّل لغيره في ما بين الاثنين.
 *   • تُعرَض القيمة القديمة والجديدة معاً للأدمن — قرارٌ لا يُتّخذ على
 *     الجديدة وحدها.
 *
 * ── والبريد **مستثنى** ──────────────────────────────────────────────
 * ⚠️ هو مفتاح مطابقة حساب Google — ودخول الساكن بالرمز لا بالبريد. فحقلٌ
 * لا يستعمله ولا يملك تغييره أثرٌ بلا فائدة، وطريقٌ لنقل حسابٍ إلى بريد
 * آخر. من احتاجه يراجع الإدارة.
 */

export const profileChangeSchema = z
  .object({
    fullName: z.string().trim().min(3, "الاسم قصير جداً.").max(120).optional(),
    /** يُطبَّع إلى E.164 قبل الحفظ — راجع أعلاه. */
    phone: z.string().trim().min(6).max(20).optional(),
    emergencyPhone: z.string().trim().min(6).max(20).optional(),
    /** سبب الطلب — يقرؤه الأدمن قبل أن يقرّر. */
    note: z.string().trim().max(500).optional(),
  })
  .refine(
    (v) =>
      v.fullName !== undefined || v.phone !== undefined || v.emergencyPhone !== undefined,
    { message: "لم تطلب تغيير أي حقل." },
  );

export type ProfileChangeInput = z.infer<typeof profileChangeSchema>;

/** ما يُخزَّن في `payload` — بعد التطبيع، وبالقيم القديمة للمقارنة. */
export interface ProfileChangePayload {
  fullName?: { from: string; to: string };
  phone?: { from: string; to: string };
  emergencyPhone?: { from: string | null; to: string };
  note?: string;
}

/**
 * ينشئ طلب تعديل باسم الساكن.
 *
 * ⚠️ **`userId` من الجلسة** — لو قبلت هذه الدالّة مُعرِّفاً من المتصل
 * لصارت «اطلب تغيير بيانات أي أحد»، وأخطرُ ما فيها الهاتف.
 */
export async function requestProfileChangeFor(
  userId: string,
  rawInput: ProfileChangeInput,
): Promise<{ id: string }> {
  const input = profileChangeSchema.parse(rawInput);

  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      fullName: true,
      phone: true,
      residentProfile: { select: { emergencyPhone: true } },
    },
  });
  if (!me) throw new NotFoundError("المستخدم");

  /*
   * ⚠️ **طلبٌ معلّق واحد.** طلبان على نفس الحقل يُوافَق عليهما بالترتيب
   * فيسري الأقدم ثم الأحدث — أو العكس بحسب من ضغط أوّلاً. والنتيجة لا
   * يعرفها الساكن ولا الأدمن.
   */
  const pending = await prisma.residentRequest.findFirst({
    where: { createdByUserId: userId, kind: "PROFILE_CHANGE", status: "PENDING" },
    select: { id: true },
  });
  if (pending) {
    throw new BusinessRuleError("لك طلب تعديل معلّق. انتظر قرار الإدارة أو راجعها.");
  }

  const payload: ProfileChangePayload = {};

  if (input.fullName !== undefined && input.fullName !== me.fullName) {
    payload.fullName = { from: me.fullName, to: input.fullName };
  }

  if (input.phone !== undefined) {
    const normalized = normalizePhone(input.phone);
    if (!normalized.ok) throw new BusinessRuleError(normalized.messageAr);

    if (normalized.phone !== me.phone) {
      /*
       * ⚠️ الفحص هنا **للرسالة لا للأمان**: الحارس الحقيقي هو تفرّد
       * العمود عند الموافقة. ورقمٌ قد يُسجَّل لغيره في ما بين الطلب
       * والقرار — فالفحص يُعاد هناك.
       */
      const taken = await prisma.user.findFirst({
        where: { phone: normalized.phone, NOT: { id: userId } },
        select: { id: true },
      });
      if (taken) {
        throw new ConflictError("هذا الرقم مسجَّل لمستخدم آخر. راجع الإدارة.");
      }
      payload.phone = { from: me.phone, to: normalized.phone };
    }
  }

  if (input.emergencyPhone !== undefined) {
    const normalized = normalizePhone(input.emergencyPhone);
    if (!normalized.ok) throw new BusinessRuleError(normalized.messageAr);
    if (normalized.phone !== (me.residentProfile?.emergencyPhone ?? null)) {
      payload.emergencyPhone = {
        from: me.residentProfile?.emergencyPhone ?? null,
        to: normalized.phone,
      };
    }
  }

  if (input.note) payload.note = input.note;

  /*
   * ⚠️ **لا طلب بلا تغيير فعليّ.** من أرسل النموذج بلا تعديل يُنتج صفّاً
   * ينتظر قراراً على لا شيء — ويظهر في عدّاد الأدمن فيُقرأ عملاً.
   */
  if (!payload.fullName && !payload.phone && !payload.emergencyPhone) {
    throw new BusinessRuleError("لا تغيير في ما أرسلتَه — القيم مطابقة لما هو مسجَّل.");
  }

  const created = await prisma.residentRequest.create({
    data: {
      kind: "PROFILE_CHANGE",
      createdByUserId: userId,
      payload: payload as object,
      status: "PENDING",
    },
    select: { id: true },
  });

  return created;
}
