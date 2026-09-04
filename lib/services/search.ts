import type { ActorContext } from "@/lib/actions/define-action";
import { listApartments } from "@/lib/actions/apartments";
import { listResidents } from "@/lib/actions/residents";
import { listContracts } from "@/lib/actions/contracts";
import { CONTRACT_STATUS_AR, OCCUPANCY_STATUS_AR } from "@/lib/labels";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  البحث العامّ — منطقُه. والغلاف في `lib/actions/search.ts`.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── لماذا **لا** `defineAction` هنا ─────────────────────────────────
 * ⚠️ `defineAction` يفحص **قدرة واحدة** من مصفوفة §3.2، وهذا البحث يعبر
 * ثلاث قدرات: `APARTMENTS` و`RESIDENT_PROFILES` و`CONTRACTS`. وإعلان
 * إحداها كان سيمنح وصولاً إلى الأخريين بلا فحص، أو يمنع من يقرأ واحدة
 * فقط. واختراع قدرة رابعة «بحث» يُنشئ **مساراً موازياً** لا تحكمه
 * المصفوفة — وهو بالضبط ما تمنعه §10.3.
 *
 * فالبديل: **لا فحص خاصّ هنا إطلاقاً**، بل استدعاء الإجراءات الثلاثة
 * القائمة، وكلٌّ منها يفحص قدرته بنفسه. وما يُرفض يُسقَط بصمت من
 * النتائج — فيرى كل دور ما يُصرَّح له به لا أكثر، بلا سطر صلاحية جديد
 * أكتبه هنا وقد أخطئ فيه.
 *
 * ── ولماذا يقتصر على الإدارة والمالك ───────────────────────────────
 * ⚠️ `APARTMENTS` للساكن مستواها `OWN` — أي «صفوفه هو»، وترشيح النطاق
 * مسؤولية طبقة أخرى (`lib/auth/scope.ts`). فلا أبني بحثاً عامّاً فوق
 * إجراء لم أتحقّق من ترشيحه بنفسي: البحث يُرفض لغير `ADMIN`/`OWNER`،
 * وشريطه لا يُعرض لهما أصلاً. تخفيفُ هذا القيد يستوجب إثبات النطاق أولاً.
 */

/** نوع النتيجة — يحدّد أيقونتها ولون شارتها في الواجهة. */
export type SearchHitKind = "apartment" | "resident" | "contract";

export interface SearchHit {
  kind: SearchHitKind;
  id: string;
  /** السطر الأول — ما يُطابِق ما كتبه المستخدم. */
  label: string;
  /** السطر الثاني — ما يميّز النتيجة عن مثيلاتها. */
  sub: string;
  href: string;
}

export interface SearchOutcome {
  hits: SearchHit[];
  /** ‏`true` حين قُصَّت النتائج — كي تقول الواجهة «هناك المزيد» بدل أن تكذب. */
  truncated: boolean;
}

/** خمس لكل نوع: قائمة أطول تحتاج تمريراً، والتمرير يُبطل فائدة اللمحة. */
const PER_KIND = 5;

/** الحدّ الأدنى للطول: حرفٌ واحد يُطابِق كل شيء فيُرجع ضجيجاً بلا معلومة. */
const MIN_QUERY = 2;

export async function searchFor(query: string, actor: ActorContext): Promise<SearchOutcome> {
  const q = query.trim();
  if (q.length < MIN_QUERY) return { hits: [], truncated: false };

  if (actor.role !== "ADMIN" && actor.role !== "OWNER") {
    return { hits: [], truncated: false };
  }

  const params = { search: q, page: 1, pageSize: PER_KIND };

  /**
   * ⚠️ `Promise.all` لا انتظار متسلسل: ثلاثة استعلامات متسلسلة تُضاعف
   * زمن الاستجابة ثلاث مرّات، والبحث أثناء الكتابة يُقاس بالميلي ثانية.
   */
  const [apartments, residents, contracts] = await Promise.all([
    listApartments(params, actor),
    listResidents({ ...params, includeNonResidentRoles: true }, actor),
    listContracts(params, actor),
  ]);

  const hits: SearchHit[] = [];
  let truncated = false;

  if (apartments.ok) {
    truncated = truncated || apartments.data.total > PER_KIND;
    for (const a of apartments.data.rows) {
      hits.push({
        kind: "apartment",
        id: a.id,
        label: a.displayNumber,
        sub: `${a.building.code} · ${OCCUPANCY_STATUS_AR[a.occupancyStatus]}`,
        href: `/admin/apartments/${a.id}`,
      });
    }
  }

  if (residents.ok) {
    truncated = truncated || residents.data.total > PER_KIND;
    for (const r of residents.data.rows) {
      const units = r.apartmentLinks.map((l) => l.apartment.displayNumber);
      hits.push({
        kind: "resident",
        id: r.id,
        label: r.fullName,
        // ⚠️ «بلا شقة» صريحاً: الفراغ يُقرأ خطأً في التحميل
        sub: units.length > 0 ? units.join(" · ") : "بلا شقة",
        href: "/admin/residents",
      });
    }
  }

  if (contracts.ok) {
    truncated = truncated || contracts.data.total > PER_KIND;
    for (const c of contracts.data.rows) {
      hits.push({
        kind: "contract",
        id: c.id,
        label: c.contractNumber,
        sub: `${c.apartment.displayNumber} · ${CONTRACT_STATUS_AR[c.status]}`,
        href: `/admin/contracts?status=${c.status}`,
      });
    }
  }

  return { hits, truncated };
}
