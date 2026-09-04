import { NextResponse, type NextRequest } from "next/server";
import { secretsMatch } from "@/lib/auth/jwt";
import { optionalEnv } from "@/lib/env";
import { runPeriodicBilling } from "@/lib/services/billing";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  الفوترة الدورية — `POST /api/cron/billing`.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * المنطق كلّه في `lib/services/billing.ts` حيث يُختبَر بلا HTTP.
 * هنا التحقّق من السرّ وتسلسُل المبالغ.
 *
 * ── التوقيت ─────────────────────────────────────────────────────────
 * ‏02:00 بغداد = **23:00 UTC من اليوم السابق**. الجدولة على 02:00 UTC
 * تعني 05:00 بغداد — وهو ليس خطأً فادحاً لكنه يخالف ما تقوله المواصفة،
 * والفرق يظهر على حدّ الشهر: تشغيلٌ في 01:00 بغداد من اليوم الأول يُفوتِر
 * الشهر الجديد، وتشغيلٌ في 23:00 من اليوم الأخير يُفوتِر القديم.
 *
 * ── ⚠️ ولا يُرسل شيئاً ──────────────────────────────────────────────
 * يُنشئ صفوف `Notification` معلّقة. الإرسال مهمّة أخرى محجوبة بـ`B7`:
 * §12.3 يطلبها **كل دقيقة** والخطط المجانية تسمح بمهمّة يومية واحدة.
 * ذلك مذكور في `skipped` من الجواب لا محذوف بصمت.
 */

/** ⚠️ بلا هذا قد يُخزَّن جواب المهمّة ويُعاد بلا تشغيلها. */
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const expected = optionalEnv("CRON_SECRET");
  if (!expected) {
    return NextResponse.json(
      { error: "CRON_SECRET غير مُهيَّأ — المهمّة لا تعمل بلا سرّ." },
      { status: 503 },
    );
  }

  const header = request.headers.get("authorization");
  const provided = header?.startsWith("Bearer ") ? header.slice(7) : null;

  if (!secretsMatch(provided, expected)) {
    // ⚠️ بلا تفصيل: «السرّ خاطئ» و«لا سرّ» جوابهما واحد كي لا يُستدلّ
    return NextResponse.json({ error: "غير مصرَّح." }, { status: 401 });
  }

  const report = await runPeriodicBilling();

  /*
   * ⚠️ فشلٌ جزئي يُعيد 500 كي **ينبّه المُشغّل**، ومع ذلك يحمل الجواب ما
   * نجح. مهمّة تُرجع 200 وفيها فشل مدفون لا يلاحظها أحد حتى تُكتشف بالصدفة.
   */
  const status = report.errors.length > 0 ? 500 : 200;

  return NextResponse.json(
    {
      ranAt: report.ranAt.toISOString(),
      subscriptions: {
        charged: report.subscriptions.charged,
        alreadyCharged: report.subscriptions.alreadyCharged,
        pausedVacant: report.subscriptions.pausedVacant,
        // ⚠️ `BigInt` لا يُسلسَل في JSON — نصّاً لا رقماً عائماً يفقد الدقّة
        totalIqd: report.subscriptions.totalIqd.toString(),
      },
      rents: {
        charged: report.rents.charged,
        alreadyCharged: report.rents.alreadyCharged,
        totalIqd: report.rents.totalIqd.toString(),
        cappedContracts: report.rents.cappedContracts,
      },
      accountsNotified: report.accountsNotified,
      skipped: [
        {
          task: "notification.send",
          blockedBy: "B7",
          reason:
            "الإخطارات تُنشأ معلّقة ولا تُرسَل. §12.3 يطلب مهمّة إرسال كل دقيقة، " +
            "وخطة الاستضافة غير محسومة.",
        },
        {
          task: "installment.charge",
          blockedBy: "B1",
          reason: "قيد استحقاق القسط شأن /api/cron/installments، ودلالة الدفعة المقدّمة غير محسومة.",
        },
      ],
      errors: report.errors,
    },
    { status },
  );
}
