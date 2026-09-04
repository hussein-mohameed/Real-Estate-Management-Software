import { prisma } from "@/lib/prisma";
import { now } from "@/lib/dates";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  إخطارات المستخدم — منطقُ الجرس (‏§11.2 · Q44).
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── لماذا **لا** `defineAction` هنا ─────────────────────────────────
 * ⚠️ `defineAction` يفحص قدرة من مصفوفة §3.2، والقدرة الوحيدة ذات الصلة
 * هي `NOTIFICATIONS_LOG` — وهي **سجلّ الإخطارات الصادرة للإدارة**، شيء
 * آخر تماماً: مستواها للمالك `READ` وللأدمن `WRITE`. وربط الجرس بها
 * يعطي أحد أمرين، وكلاهما خطأ:
 *   • يمنع الساكن من قراءة إخطاراته هو — وهو أكثر من يحتاج الجرس.
 *   • أو يمنح الساكن سجلّ الإخطارات كلَّه.
 *
 * فالنطاق هنا **بنيويّ لا صلاحيّ**: كل استعلام مقيَّد بـ`userId` من
 * الجلسة، لا من مُدخل المتصل. لا يوجد وسيط يمكن التلاعب به ليقرأ إخطارات
 * غيره — فلا حاجة إلى قدرة، والقدرة كانت ستضلّل.
 *
 * ── ولماذا لا تدقيق ────────────────────────────────────────────────
 * المبدأ 5 يوجب تدقيق **كل حركة مالية**، و«فتحتُ الجرس» ليس حركةً: لا
 * يغيّر رصيداً ولا حالة ولا صلاحية. وتسجيله يُضيف صفّاً إلى `AuditLog`
 * كلّما نُقر الجرس، فيُغرق السجلّ الذي يُفتَح للتحقيق في حوادث حقيقية.
 *
 * ── والقناة `IN_APP` لا كل القنوات ─────────────────────────────────
 * ⚠️ `WHATSAPP` أُرسلت إلى هاتفه؛ وعرضها في الجرس يعني أن يقرأ الشيء
 * مرّتين ويُصفّي قائمةً استُهلكت أصلاً.
 *
 * ── ولماذا `userId` وسيطاً لا جلسةً تُحلّ هنا ──────────────────────
 * ⚠️ النطاق البنيويّ **ادّعاء أمني**، والادّعاء بلا اختبار ظنّ. ودالّةٌ
 * تقرأ الكوكيز بنفسها لا تُختبَر في vitest. التمرير يجعل «لا يرى أحدٌ
 * إخطارات غيره» جملةً يفشل اختبارٌ عند كسرها. والجلسة تُحلّ في الغلاف
 * `lib/actions/notifications.ts` وحده.
 */

/** ثمانية: ما يُقرأ في القائمة المنسدلة بلا تمرير. */
const BELL_LIMIT = 8;

export interface NotificationRow {
  id: string;
  body: string;
  createdAt: Date;
  isUnread: boolean;
}

export interface BellState {
  rows: NotificationRow[];
  /**
   * عدد **غير المقروء** كلّه لا عدد المعروض.
   *
   * ⚠️ عدّ الصفوف المعروضة كان سيُظهر «8» أبداً مهما تراكم — فيتعلّم
   * المستخدم أن الرقم لا يعني شيئاً.
   */
  unread: number;
}

/** ما يُعرَض في الجرس. */
export async function notificationsFor(userId: string): Promise<BellState> {
  const where = { userId, channel: "IN_APP" as const };

  const [rows, unread] = await Promise.all([
    prisma.notification.findMany({
      where,
      select: { id: true, body: true, createdAt: true, readAt: true },
      orderBy: { createdAt: "desc" },
      take: BELL_LIMIT,
    }),
    prisma.notification.count({ where: { ...where, readAt: null } }),
  ]);

  return {
    rows: rows.map(({ readAt, ...r }) => ({ ...r, isUnread: readAt === null })),
    unread,
  };
}

/**
 * تعليم إخطاراتي كلّها مقروءة.
 *
 * ⚠️ `readAt: null` في الشرط ليس تحسيناً: بدونه تُكتب الطابعة الزمنية فوق
 * القديمة في كل نقرة، فيصير «متى قرأتَه» هو «متى نقرتَ آخر مرّة» — ويضيع
 * الحقل الذي أُضيف في Q44 من أجله.
 */
export async function markAllReadFor(userId: string): Promise<{ marked: number }> {
  const { count } = await prisma.notification.updateMany({
    where: { userId, channel: "IN_APP", readAt: null },
    // `now()` لا `new Date()`: قاعدة المشروع — التوقيت من وحدة واحدة
    data: { readAt: now() },
  });
  return { marked: count };
}
