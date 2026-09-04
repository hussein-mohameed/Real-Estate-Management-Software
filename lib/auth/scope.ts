import { prisma } from "@/lib/prisma";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  نطاق الساكن — استعلامات بحتة، **بلا جلسة**.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ⚠️ كانت هاتان الدالّتان في `guard.ts`، وهو يبدأ بـ`import "server-only"`
 * ويجرّ `next/headers` عبر الجلسة. فكل من يحتاج **نطاقاً** كان يجرّ معه
 * **جلسة**: يتعذّر استيراده في الاختبارات، ويثقل كل مسار يستعمله.
 *
 * والفصل صحيح دلالياً قبل أن يكون تقنياً: هاتان تأخذان `userId` وتستعلمان،
 * ولا تعرفان شيئاً عن الكوكي ولا عن الطلب. `guard.ts` يعيد تصديرهما فلا
 * ينكسر أي مستدعٍ قائم.
 */

/**
 * الشقق التي يملك المستخدم نطاقها كساكن.
 *
 * ⚠️ **مركزي عمداً** (‏§10.3). كل استعلام يواجه الساكن يُرشَّح به. ولو
 * رُشِّح استعلام واحد يدوياً ونُسي، لرأى ساكن بيانات شقة غيره.
 *
 * ويخدم أيضاً **الموظف المقيم** (‏Q41): دوره `STAFF` ولا يتغيّر، ووصوله
 * بنطاق الساكن يأتي من هنا لا من الدور — وبدونه يبقى الحارس المقيم بلا
 * كشف حساب ولا طريق لدفع اشتراكاته.
 */
export async function residentApartmentIds(userId: string): Promise<string[]> {
  const rows = await prisma.apartmentResident.findMany({
    where: { userId, isActive: true },
    select: { apartmentId: true },
  });
  return rows.map((r) => r.apartmentId);
}

/** الحسابات التي يملك المستخدم نطاقها — كشف الحساب والفواتير والدفعات. */
export async function residentAccountIds(userId: string): Promise<string[]> {
  const apartmentIds = await residentApartmentIds(userId);
  if (apartmentIds.length === 0) return [];
  const rows = await prisma.account.findMany({
    where: { apartmentId: { in: apartmentIds }, holderUserId: userId },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}
