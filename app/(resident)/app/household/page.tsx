import { Users } from "lucide-react";
import { requireRoleOrRedirect } from "@/lib/auth/guard";
import { getMyHome } from "@/lib/actions/resident-portal";
import { Ltr } from "@/components/ui/ltr";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ActionError, EmptyState, PageHeader, SectionCard } from "@/components/ui/page";
import { RESIDENT_RELATION_AR } from "@/lib/labels";
import { formatPhoneForDisplay } from "@/lib/domain/phone";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  أفراد الشقة.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── ⚠️ الهاتف يُعرَض والمال لا ──────────────────────────────────────
 * فردُ الأسرة يرى من يسكن معه وكيف يتّصل به — وهذا ما يحتاجه. أمّا الرصيد
 * وكشف الحساب فلصاحب العقد وحده، ولا يظهران هنا مهما كان القارئ.
 *
 * ── و«صاحب العقد» يُعلَّم صراحةً ────────────────────────────────────
 * ⚠️ هو من تُوجَّه إليه المطالبات ومن يُوقَّع معه. وقائمةٌ تُسوّي بين
 * الجميع تجعل السؤال «من المسؤول؟» بلا جواب في الشاشة.
 *
 * ── ولا تعديل هنا ───────────────────────────────────────────────────
 * ربطُ ساكن بشقة وفكُّه قدرةُ إدارة (‏`APARTMENT_RESIDENT_LINKS`): من يسكن
 * أين ليس قراراً يتّخذه الساكن عن نفسه.
 */

function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("");
}

export default async function HouseholdPage() {
  const me = await requireRoleOrRedirect("RESIDENT", "STAFF", "ADMIN", "OWNER");
  const result = await getMyHome({}, { userId: me.id, role: me.role });

  if (!result.ok) {
    return (
      <ActionError message={result.error.message} />
    );
  }

  const { apartments } = result.data;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="أفراد الشقة"
        description="من يسكن معك، وكيف تتّصل بهم. والربط وفكّه شأن الإدارة."
      />

      {apartments.length === 0 ? (
        <EmptyState
          icon={Users}
          title="لا شقة مرتبطة بحسابك"
          description="حسابك موجود ولم يُربَط بوحدة سكنية. راجع إدارة المجمَّع لربطه."
        />
      ) : (
        apartments.map((apartment) => (
          <SectionCard
            key={apartment.id}
            title={`الشقة ${apartment.displayNumber}`}
            description={apartment.building.name ?? apartment.building.code}
            actions={
              <Badge variant="neutral">
                <span className="tabular">{apartment.residents.length}</span> ساكناً
              </Badge>
            }
          >
            {apartment.residents.length === 0 ? (
              <p className="text-theme-sm text-muted-foreground">
                لا سكان مسجَّلون على هذه الشقة.
              </p>
            ) : (
              <ul className="flex flex-col divide-y">
                {apartment.residents.map((r) => (
                  <li
                    key={r.user.id}
                    className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <Avatar className="size-9">
                      <AvatarFallback className="bg-muted text-theme-xs font-medium">
                        {initialsOf(r.user.fullName)}
                      </AvatarFallback>
                    </Avatar>

                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{r.user.fullName}</span>
                        {/* ⚠️ صاحب العقد يُعلَّم: هو من تُوجَّه إليه المطالبات */}
                        {r.isContractHolder ? (
                          <Badge variant="success">صاحب العقد</Badge>
                        ) : null}
                        {r.user.id === me.id ? (
                          <Badge variant="neutral">أنت</Badge>
                        ) : null}
                      </span>
                      <span className="block text-theme-xs text-muted-foreground">
                        {RESIDENT_RELATION_AR[r.relationType]}
                      </span>
                    </span>

                    <span className="tabular text-theme-sm text-muted-foreground">
                      <Ltr>{formatPhoneForDisplay(r.user.phone)}</Ltr>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        ))
      )}
    </div>
  );
}
