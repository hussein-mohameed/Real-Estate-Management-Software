import { requireRoleOrRedirect } from "@/lib/auth/guard";
import { listBuildings } from "@/lib/actions/buildings";
import { NUMBERING_SCHEME_AR } from "@/lib/labels";
import { StatusBadge } from "@/components/ui/status-badge";
import { PageHeader, TableCard, TableEmpty } from "@/components/ui/page";
import { Ltr } from "@/components/ui/ltr";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatPercentage, safePercentage } from "@/lib/domain/statistics";
import { CreateBuildingForm } from "./create-form";

export default async function BuildingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const me = await requireRoleOrRedirect("ADMIN", "OWNER");
  const params = await searchParams;
  const page = Number(params["page"] ?? 1) || 1;

  const result = await listBuildings({ page }, { userId: me.id, role: me.role });
  if (!result.ok) {
    return (
      <p className="rounded-md bg-destructive/10 p-4 text-sm text-destructive">
        {result.error.message}
      </p>
    );
  }

  const { rows, total } = result.data;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="البنايات"
        description={
          <>
            <span className="tabular">{total}</span> بناية — الترقيم يُولَّد ولا يُكتب
          </>
        }
      />

      <CreateBuildingForm />

      <TableCard>
        <Table className="min-w-[46rem]">
          <TableHeader>
            <TableRow>
              <TableHead>الرمز</TableHead>
              <TableHead>الاسم</TableHead>
              <TableHead>الطوابق</TableHead>
              <TableHead>الترقيم</TableHead>
              <TableHead>الشقق</TableHead>
              <TableHead>نسبة الإنجاز</TableHead>
              <TableHead>حالة الهيكل</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableEmpty colSpan={7}>
                  لا بنايات بعد. أضف أولى بناياتك من النموذج أعلاه.
                </TableEmpty>
            ) : (
              rows.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="font-medium">
                    <Ltr>{b.code}</Ltr>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {b.name ?? "—"}
                  </TableCell>
                  <TableCell className="tabular">{b.floorsCount}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {NUMBERING_SCHEME_AR[b.numberingScheme]}
                  </TableCell>
                  <TableCell className="tabular">
                    {b.apartmentsCount}
                    {b.plannedApartmentsCount !== null &&
                    b.plannedApartmentsCount !== b.apartmentsCount ? (
                      <span className="ms-2 text-xs text-muted-foreground">
                        (المخطَّط{" "}
                        <span className="tabular">{b.plannedApartmentsCount}</span>)
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="tabular">
                    {/* §4.20: القسمة على صفر تعيد null ← «—» لا 0% مضلّلة */}
                    {formatPercentage(
                      safePercentage(b.completedCount, b.apartmentsCount),
                    )}
                  </TableCell>
                  <TableCell>
                    <StatusBadge axis="construction" value={b.constructionStatus} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableCard>
    </div>
  );
}
