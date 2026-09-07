import Link from "next/link";
import { requireRoleOrRedirect } from "@/lib/auth/guard";
import { one, pageNumber, type SearchParams } from "@/lib/routes/search-params";
import { listApartments } from "@/lib/actions/apartments";
import { listBuildings } from "@/lib/actions/buildings";
import { StatusBadge } from "@/components/ui/status-badge";
import { Ltr } from "@/components/ui/ltr";
import { Button } from "@/components/ui/button";
import { PageHeader, TableCard, TableEmpty } from "@/components/ui/page";
import { PaginationNav } from "@/components/ui/pagination-nav";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Field } from "@/components/ui/field";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  CONSTRUCTION_STATUS_AR,
  OCCUPANCY_STATUS_AR,
  OWNERSHIP_STATUS_AR,
} from "@/lib/labels";
import { formatBaghdadDate } from "@/lib/dates";
import { AddApartmentForm, BulkConstructionForm } from "./forms";

/**
 * جدول الشقق — الخطوة 1.2.
 *
 * ⚠️ **المحاور الثلاثة تُعرض منفصلة، ولا تُدمج في عمود «حالة» واحد.**
 * الدمج هو الخطأ الشائع، ويُخفي عن الأدمن أن الشقة «مباعة لكن فارغة» —
 * وهي بالضبط الحالة التي يبحث عنها في تقرير المستحقات.
 */



export default async function ApartmentsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const me = await requireRoleOrRedirect("ADMIN", "OWNER");
  const p = await searchParams;
  const actor = { userId: me.id, role: me.role };

  const filters = {
    buildingId: one(p["building"]),
    floorNumber: one(p["floor"]) ? Number(one(p["floor"])) : undefined,
    constructionStatus: one(p["construction"]) as never,
    ownershipStatus: one(p["ownership"]) as never,
    occupancyStatus: one(p["occupancy"]) as never,
    hasOpenBalance: p["balance"] === "1" ? true : undefined,
    search: one(p["q"]),
    page: pageNumber(p["page"]),
  };

  const [result, buildings] = await Promise.all([
    listApartments(filters, actor),
    listBuildings({ page: 1 }, actor),
  ]);

  if (!result.ok) {
    return (
      <p className="rounded-md bg-destructive/10 p-4 text-sm text-destructive">
        {result.error.message}
      </p>
    );
  }

  const { rows, total, page, pageSize } = result.data;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  /** ⚠️ المالك يقرأ ولا يكتب (‏D3/2) — فلا أزرار له بدل أزرار تفشل. */
  const canAct = me.role === "ADMIN";
  const buildingOptions = buildings.ok
    ? buildings.data.rows.map((b) => ({
        id: b.id,
        /* الاسم مع الرمز: بنايتان بلا اسم تُقرآن رمزين لا يُميَّزان */
        label: b.name ? `${b.code} — ${b.name}` : b.code,
        floorsCount: b.floorsCount,
      }))
    : [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="الشقق"
        description={
          <>
            <span className="tabular">{total}</span> شقة — المحاور الثلاثة مستقلّة
          </>
        }
      />

      {/*
        ⚠️ **زرّان مطويّان لا نموذجان مفتوحان.** كلاهما نادر — الشقق
        تُولَّد مع البناية، والتحديث الجماعي يجري مرّةً كل مرحلة. ونموذجٌ
        مفتوح دائماً يدفع الجدول تحت الطيّة ويُبطئ العمل اليومي لأجل النادر.
      */}
      {canAct && buildingOptions.length > 0 ? (
        <div className="flex flex-wrap items-start gap-3">
          <AddApartmentForm buildings={buildingOptions} />
          <BulkConstructionForm buildings={buildingOptions} />
        </div>
      ) : null}

      {/* شريط المرشّحات — تشريح صفحة القائمة الثابت (§11.2).
          نموذج GET بلا JavaScript: المرشّحات تعيش في العنوان، فهي قابلة
          للمشاركة والرجوع وفتحِ تبويب جديد. */}
      <form className="grid gap-4 rounded-2xl border bg-card p-5 md:grid-cols-6">
        <Filter
          name="building"
          label="البناية"
          value={filters.buildingId}
          options={
            buildings.ok
              ? buildings.data.rows.map((b) => [b.id, b.code] as [string, string])
              : []
          }
        />
        <Filter
          name="construction"
          label="الإنشاء"
          value={one(p["construction"])}
          options={Object.entries(CONSTRUCTION_STATUS_AR)}
        />
        <Filter
          name="ownership"
          label="التمليك"
          value={one(p["ownership"])}
          options={Object.entries(OWNERSHIP_STATUS_AR)}
        />
        <Filter
          name="occupancy"
          label="السكن"
          value={one(p["occupancy"])}
          options={Object.entries(OCCUPANCY_STATUS_AR)}
        />

        <Field label="بحث برقم الشقة" htmlFor="q">
          {/* رقم الشقة لاتيني الشكل (A-3-12) فيُعرَض معكوساً في سياق عربي */}
          <Input id="q" name="q" dir="ltr" defaultValue={filters.search ?? ""} />
        </Field>

        <div className="flex flex-col justify-end gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="balance"
              value="1"
              defaultChecked={p["balance"] === "1"}
              className="size-4 accent-primary"
            />
            <span>عليها رصيد مفتوح</span>
          </label>
          <Button type="submit" size="sm">
            ترشيح
          </Button>
        </div>
      </form>

      <TableCard>
        <Table className="min-w-[56rem]">
          <TableHeader>
            <TableRow>
              <TableHead>الشقة</TableHead>
              <TableHead>الطابق</TableHead>
              <TableHead>الإنشاء</TableHead>
              <TableHead>التمليك</TableHead>
              <TableHead>السكن</TableHead>
              <TableHead>الأفراد</TableHead>
              <TableHead>آخر تغيير سكن</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableEmpty colSpan={7}>
                  لا شقق مطابقة. أنشئ بناية أولاً أو غيّر المرشّحات.
                </TableEmpty>
            ) : (
              rows.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">
                    {/* الجدول بلا رابط يجعل الصفحة التفصيلية غير قابلة للوصول */}
                    <Link
                      href={`/admin/apartments/${a.id}`}
                      className="hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                      <Ltr>{a.displayNumber}</Ltr>
                    </Link>
                  </TableCell>
                  <TableCell className="tabular">{a.floorNumber}</TableCell>
                  {/* ثلاثة أعمدة لا عمود واحد — المحاور مستقلة */}
                  <TableCell>
                    <StatusBadge axis="construction" value={a.constructionStatus} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge axis="ownership" value={a.ownershipStatus} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge axis="occupancy" value={a.occupancyStatus} />
                  </TableCell>
                  {/* R9: عدد الأفراد محسوب لا مخزَّن */}
                  <TableCell className="tabular">{a._count.residents}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {a.occupancyChangedAt ? (
                      <Ltr>{formatBaghdadDate(a.occupancyChangedAt)}</Ltr>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableCard>

      <PaginationNav
        basePath="/admin/apartments"
        page={page}
        pages={pages}
        params={p}
      />
    </div>
  );
}

function Filter({
  name,
  label,
  value,
  options,
}: {
  name: string;
  label: string;
  value?: string;
  options: Array<[string, string]>;
}) {
  return (
    <Field label={label} htmlFor={name}>
      <NativeSelect id={name} name={name} defaultValue={value ?? ""}>
        <option value="">الكل</option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </NativeSelect>
    </Field>
  );
}
