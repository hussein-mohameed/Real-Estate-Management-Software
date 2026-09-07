import Link from "next/link";
import { requireRoleOrRedirect } from "@/lib/auth/guard";
import { listServices } from "@/lib/actions/services";
import { getMyHome, getMySubscriptions } from "@/lib/actions/resident-portal";
import { ActionError, EmptyState, PageHeader } from "@/components/ui/page";
import { Sparkles } from "lucide-react";
import { RequestSubscriptionForm } from "./request-form";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  طلب اشتراك — §8.4 «request a new subscription from available services».
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── ⚠️ ثلاثة مرشِّحات قبل أن تُعرَض خدمة ────────────────────────────
 *   ١. **المتاحة وحدها** — `listServices` يفرضه على الساكن قسراً (‏§3.2
 *      «‏R (available ones)»)، لا هذه الشاشة.
 *   ٢. **غير الإلزامية** — الإلزامية تُضاف مع السكن ولا تُطلَب. وعرضُها
 *      يجعل الساكن يطلب ما هو مشترك به أصلاً.
 *   ٣. **ما ليس مشتركاً به** — نشطاً كان أو معلّقاً أو موقوفاً مؤقّتاً.
 *
 * والثالث مرآةٌ لحرسٍ في `createPending` يردّ الطلب المكرّر. والمبدأ:
 * **لا يُعرَض ما سيُردّ** — عرضُه يدعو إلى الضغط ثم يعاقب عليه.
 *
 * ── ولماذا لا تُعرَض خدمات الأفراد ──────────────────────────────────
 * ⚠️ `appliesTo: "RESIDENT"` يلزمه `residentUserId`، والمغلّف يثبّت
 * `subjectType: "APARTMENT"` عمداً كي لا يُطلَب باسم ساكن آخر. فعرضُ
 * خدمةٍ لا يستطيع هذا المسار إنشاءها يُنتج رفضاً بعد الاختيار.
 */

export default async function RequestSubscriptionPage() {
  const me = await requireRoleOrRedirect("RESIDENT", "STAFF", "ADMIN", "OWNER");
  const actor = { userId: me.id, role: me.role };

  const [home, mine, services] = await Promise.all([
    getMyHome({}, actor),
    getMySubscriptions({}, actor),
    listServices({}, actor),
  ]);

  if (!services.ok) return <ActionError message={services.error.message} />;
  if (!home.ok) return <ActionError message={home.error.message} />;

  const apartments = home.data.apartments.map((a) => ({
    id: a.id,
    label: a.displayNumber,
  }));

  /* ⚠️ الملغى وحده لا يُحتسب: طلبُه ثانيةً مشروع */
  const taken = new Set(
    (mine.ok ? mine.data.rows : [])
      .filter((s) => s.status !== "CANCELLED")
      .map((s) => s.service.id),
  );

  const available = services.data
    .filter(
      (s) =>
        !s.isMandatory &&
        !taken.has(s.id) &&
        (s.appliesTo === "APARTMENT" || s.appliesTo === "BOTH"),
    )
    .map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      billingType: s.billingType,
      billingCycle: s.billingCycle,
      pricingModel: s.pricingModel,
      /* ⚠️ `BigInt` لا يعبر حدّ الخادم/العميل — يُحوَّل نصّاً هنا */
      basePriceIqd: s.basePriceIqd === null ? null : s.basePriceIqd.toString(),
      unitPriceIqd: s.unitPriceIqd === null ? null : s.unitPriceIqd.toString(),
      unitLabel: s.unitLabel,
      minUnits: s.minUnits,
      maxUnits: s.maxUnits,
    }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="طلب اشتراك"
        description="اختر خدمة وأرسل الطلب. لا يُقيَّد عليك مبلغ حتى توافق الإدارة."
      />

      <nav aria-label="مسار" className="text-theme-xs text-muted-foreground">
        <Link href="/app/subscriptions" className="hover:underline">
          اشتراكاتي
        </Link>
      </nav>

      {apartments.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="لا شقة مرتبطة بحسابك"
          description="الاشتراك يُقيَّد على وحدة سكنية. راجع الإدارة لربط حسابك بشقّتك."
        />
      ) : available.length === 0 ? (
        /*
          ⚠️ حالتان مختلفتان بنصٍّ واحد — عمداً: «لا جديد» جوابٌ كافٍ سواء
          كان الكتالوج فارغاً أو كان الساكن مشتركاً بكل ما فيه. والتفريق
          بينهما يكشف للساكن عدد خدمات المجمَّع، وليس ذلك من شأنه.
        */
        <EmptyState
          icon={Sparkles}
          title="لا خدمات جديدة متاحة"
          description="أنت مشترك بكل ما هو متاح لوحدتك حالياً."
        />
      ) : (
        <RequestSubscriptionForm apartments={apartments} services={available} />
      )}
    </div>
  );
}
