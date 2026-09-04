import { NextResponse, type NextRequest } from "next/server";
import { secretsMatch } from "@/lib/auth/jwt";
import { optionalEnv } from "@/lib/env";
import { runInstallmentCharges } from "@/lib/services/installment-charges";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  استحقاق الأقساط — `POST /api/cron/installments` · الخطوة 3.5.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * المنطق كلّه في `lib/services/installment-charges.ts` حيث يُختبَر بلا
 * HTTP. هنا التحقّق من السرّ وحده — نفس عقد `/api/cron/maintenance`
 * و`/api/cron/billing` حرفياً، فلا تتفرّق ثلاثة حرّاس لثلاث مهامّ.
 *
 * ── ⚠️ `POST` لا `GET` ──────────────────────────────────────────────
 * ‏`GET` يُشغَّل بجلب مسبق من متصفّح أو بزاحف أو بأي `<img src>` في بريد.
 * ومهمّة **تُقيّد مالاً** لا يجوز أن تُشغَّل بفتح رابط.
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

  const report = await runInstallmentCharges();

  /*
   * ⚠️ فشلُ قسطٍ يُعيد 500 كي **ينبّه المُشغّل**، والجواب يحمل ما نجح.
   * مهمّة تُرجع 200 وفيها فشل مدفون لا يلاحظها أحد حتى تُكتشف بالصدفة.
   */
  const status = report.errors.length > 0 ? 500 : 200;

  return NextResponse.json(
    {
      ranAt: report.ranAt.toISOString(),
      charged: report.charged,
      skipped: report.skipped,
      markedOverdue: report.markedOverdue,
      errors: report.errors,
    },
    { status },
  );
}
