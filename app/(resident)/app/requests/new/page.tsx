import Link from "next/link";
import { requireRoleOrRedirect } from "@/lib/auth/guard";
import { getMyHome } from "@/lib/actions/resident-portal";
import { requestableCategories } from "@/lib/services/resident-requests";
import { PageHeader } from "@/components/ui/page";
import { CreateMyRequestForm } from "./create-form";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  طلب جديد — من الساكن نفسه.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── 🔴 لماذا عادت هذه الشاشة ────────────────────────────────────────
 * نُزعت في جولةٍ سابقة تحت قاعدة «لا كتابة للساكن في بوّابته». والقاعدة
 * صحيحة في المال والعقود والسكان — وخاطئة هنا: مصفوفة §3.2 تعطي الساكن
 * على `SERVICE_REQUESTS` القيمة **`O (create + follow own)`**، أي
 * الإنشاء نصّاً.
 *
 * ⚠️ والفرق ليس شكلياً: الطلب **هو** قناة الساكن إلى النظام. وبوّابةٌ
 * تعرض حالة الطلبات ولا تقبل طلباً تجعل الساكن يتّصل هاتفياً، فيدخل
 * موظّفٌ الطلب نيابةً عنه — وتضيع نصف البيانات: من اشتكى فعلاً، ومتى،
 * وبأي لفظ.
 *
 * ── وما لا يُقرأ من المصفوفة ────────────────────────────────────────
 * الشقق تأتي من `getMyHome` (ارتباطاته)، والتصنيفات من
 * `requestableCategories` — كتالوجٌ مُسقَط لا قراءةٌ للأقسام. والخادم
 * يتحقّق من الشقة ثانيةً في `createRequestFor`: الشاشة راحة، والحدّ هناك.
 */

export default async function NewMyRequestPage() {
  const me = await requireRoleOrRedirect("RESIDENT", "STAFF", "ADMIN", "OWNER");
  const actor = { userId: me.id, role: me.role };

  const [home, categories] = await Promise.all([
    getMyHome({}, actor),
    requestableCategories(),
  ]);

  const apartments = home.ok
    ? home.data.apartments.map((a) => ({ id: a.id, label: a.displayNumber }))
    : [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="طلب جديد"
        description="صِف المشكلة وحدّد تصنيفها، ويصل الطلب إلى القسم المختصّ."
      />

      <nav aria-label="مسار" className="text-theme-xs text-muted-foreground">
        <Link href="/app/requests" className="hover:underline">
          طلباتي وشكاواي
        </Link>
      </nav>

      <CreateMyRequestForm apartments={apartments} categories={categories} />
    </div>
  );
}
