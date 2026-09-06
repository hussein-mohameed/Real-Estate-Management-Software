import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { nextNumber } from "@/lib/services/counter";
import { residentApartmentIds } from "@/lib/auth/scope";
import { BusinessRuleError, ForbiddenError, NotFoundError } from "@/lib/errors";
import type { RequestScope, RequestType } from "@/lib/domain/enums";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  طلبات الساكن — نطاق بنيويّ خارج مصفوفة §3.2.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── 🔴 لماذا خارج `defineAction` ────────────────────────────────────
 * المواصفة تمنح الساكن `O (create + follow own)` على الطلبات. لكن
 * `LEVEL_ACTIONS.OWN` في المصفوفة يمنح **القراءة وحدها** — لأن المستوى
 * يسري على كل الصفوف، ورفعُ الساكن إلى `WRITE` كان سيمنحه الكتابة على
 * طلبات المجمَّع كلّه.
 *
 * فنصف «الإنشاء» يُنفَّذ هنا بنطاق بنيويّ: **المعرّف من الجلسة لا من
 * المُدخل**، والشقة يجب أن تكون شقّته. وهو نفس النمط الذي حكم
 * `staff-self.ts` و`requestSubscription` — والثالث يؤكّد أنه قاعدة لا
 * استثناء.
 *
 * ⚠️ ولذلك لا `defineAction` هنا: تمريرُ قدرةٍ تمنع الفعل ثم الالتفاف
 * عليها أسوأ من عدم استعمالها — يُوهم القارئ أن الترخيص فُحص.
 *
 * ── وما يُدقَّق ─────────────────────────────────────────────────────
 * التدقيق يكتبه المغلّف في `lib/actions` حيث تُحلّ الجلسة، فيحمل الفاعل
 * الحقيقي. وهنا المنطق وحده — يُختبَر بلا شبكة.
 */

type Db = Prisma.TransactionClient | typeof prisma;

export interface ResidentRequestInput {
  type: RequestType;
  scope: RequestScope;
  apartmentId?: string | undefined;
  title: string;
  description: string;
  departmentTaskId?: string | undefined;
  /*
   * ⚠️ **ولا `priority` هنا** — للسبب نفسه المكتوب تحت `commentAsResident`:
   * كان الحقل معلَناً في الواجهة و`handler` يكتب `"NORMAL"` دائماً. أي أنه
   * يُقبَل ثم يُهمَل — وهو ما يجعل من يقرأ التوقيع يظنّ للساكن خياراً ليس
   * له، ويكتب واجهةً تعرضه. وغيابُه من التوقيع هو التنفيذ.
   */
}

/**
 * ينشئ طلباً باسم الساكن.
 *
 * ⚠️ **`userId` من الجلسة**. لو قبلت هذه الدالّة مُعرِّفاً من المتصل
 * لصارت «أنشئ طلباً باسم أي أحد» — وطلبٌ مُكلَّف به يمنح الموظّف وصولاً
 * إلى شقة صاحبه (‏D4). أي أنها كانت ستصير باب وصول لا نموذج إدخال.
 */
export async function createRequestFor(
  userId: string,
  input: ResidentRequestInput,
  db: Db = prisma,
): Promise<{ id: string; number: string; status: string }> {
  if (input.scope === "APARTMENT") {
    if (!input.apartmentId) {
      throw new BusinessRuleError("الشقة مطلوبة لطلب يخصّ وحدة سكنية.");
    }
    /* ⚠️ النطاق من الجلسة: لا يُنشئ الساكن طلباً على شقة جاره */
    const mine = await residentApartmentIds(userId);
    if (!mine.includes(input.apartmentId)) {
      throw new ForbiddenError("لا تُنشئ طلباً على شقة ليست لك.");
    }
  } else if (input.apartmentId) {
    throw new BusinessRuleError("طلب المنطقة المشتركة لا يُلحَق بشقة.");
  }

  let departmentId: string | null = null;

  if (input.departmentTaskId) {
    const task = await db.departmentTask.findUnique({
      where: { id: input.departmentTaskId },
      select: { id: true, departmentId: true, isActive: true },
    });
    if (!task) throw new NotFoundError("المهمّة");
    if (!task.isActive) {
      throw new BusinessRuleError("هذه المهمّة موقوفة ولا تُسنَد إليها طلبات جديدة.");
    }
    departmentId = task.departmentId;
  }

  const number = await nextNumber("REQ", db as Prisma.TransactionClient);

  const created = await db.serviceRequest.create({
    data: {
      number,
      type: input.type,
      scope: input.scope,
      apartmentId: input.apartmentId ?? null,
      createdByUserId: userId,
      title: input.title,
      description: input.description,
      departmentId,
      departmentTaskId: input.departmentTaskId ?? null,
      /* ⚠️ الساكن لا يختار الأولوية: كل طلبٍ عاجل عند صاحبه */
      priority: "NORMAL",
      status: "NEW",
    },
    select: { id: true, number: true, status: true },
  });

  return created;
}

/**
 * تعليق الساكن على طلبه.
 *
 * ⚠️ **`isInternal` غير موجود في التوقيع أصلاً** — لا يُقبَل ثم يُتجاهَل.
 * حقلٌ يُقبل ويُهمَل يجعل من يقرأ الواجهة يظنّ أن للساكن خياراً ليس له.
 */
export async function addCommentFor(
  userId: string,
  requestId: string,
  body: string,
  db: Db = prisma,
): Promise<{ id: string; createdAt: Date }> {
  const request = await db.serviceRequest.findUnique({
    where: { id: requestId },
    select: { id: true, createdByUserId: true, status: true },
  });
  if (!request) throw new NotFoundError("الطلب");

  if (request.createdByUserId !== userId) {
    throw new ForbiddenError("تعلّق على طلبك أنت.");
  }

  /*
   * ⚠️ المغلق لا يُعلَّق عليه: تعليقٌ بعد الإغلاق لا يقرؤه أحد — لا إخطار
   * له ولا شاشة تعرضه للمتابعة. والساكن يظنّ أنه أوصل شيئاً.
   */
  if (request.status === "DONE" || request.status === "CANCELLED") {
    throw new BusinessRuleError("الطلب مُغلق. أنشئ طلباً جديداً إن بقي شيء.");
  }

  return db.requestComment.create({
    data: {
      requestId,
      authorUserId: userId,
      body,
      isInternal: false,
    },
    select: { id: true, createdAt: true },
  });
}
