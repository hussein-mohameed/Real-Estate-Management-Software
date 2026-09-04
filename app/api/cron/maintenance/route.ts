import { NextResponse, type NextRequest } from "next/server";
import { secretsMatch } from "@/lib/auth/jwt";
import { optionalEnv } from "@/lib/env";
import { runDailyMaintenance } from "@/lib/services/maintenance";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  مهمة الصيانة اليومية — `POST /api/cron/maintenance`.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * المنطق كلّه في `lib/services/maintenance.ts` حيث يُختبَر بلا HTTP.
 * هنا التحقّق من السرّ وحده.
 *
 * ── ⚠️ `POST` لا `GET` ──────────────────────────────────────────────
 * ‏`GET` يُشغَّل بجلب مسبق من متصفّح، أو بزاحف، أو بأي `<img src>` في بريد.
 * ومهمّة تكتب في القاعدة لا يجوز أن تُشغَّل بفتح رابط.
 *
 * ── ⚠️ وبلا سرّ مُهيَّأ لا تعمل إطلاقاً ────────────────────────────
 * `optionalEnv` لا `requireEnv`: الثاني **يرمي**، والرمي هنا يُنتج 500
 * يبدو عطلاً عابراً فتُعاد المحاولة إلى الأبد. الغياب حالة تهيئة لا عطل،
 * وجوابها 503 صريح. والمهمّة **لا تُشغَّل مفتوحة** بحال.
 *
 * ── وترويسة `Authorization: Bearer` ────────────────────────────────
 * هذا اصطلاح مُشغّلات الـcron الشائعة (‏Vercel Cron يرسلها هكذا حرفياً).
 * وليس تخميناً كتخمين سرّ Wayl: الطرفان عندنا، فالاختيار قرار تصميم لا
 * استنتاج عن طرف ثالث.
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

  const report = await runDailyMaintenance();

  /*
   * ⚠️ فشل مهمّة فرعية يُعيد 500 كي **ينبّه المُشغّل ويعيد المحاولة**،
   * ومع ذلك يحمل الجواب ما نجح. مهمّة تُرجع 200 وفيها فشل مدفون لا
   * يلاحظها أحد حتى تُكتشف بالصدفة.
   */
  const status = report.errors.length > 0 ? 500 : 200;

  return NextResponse.json(
    {
      ranAt: report.ranAt.toISOString(),
      badgesExpired: report.badgesExpired,
      // ⚠️ `BigInt` لا يُسلسَل في JSON — يُحوَّل نصّاً لا رقماً عائماً
      drifts: report.drifts.map((d) => ({
        accountId: d.accountId,
        cachedIqd: d.cachedIqd.toString(),
        computedIqd: d.computedIqd.toString(),
        driftIqd: d.driftIqd.toString(),
      }),
      ),
      skipped: report.skipped,
      errors: report.errors,
    },
    { status },
  );
}
