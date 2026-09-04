import { requireRoleOrRedirect } from "@/lib/auth/guard";
import { one, pageNumber, type SearchParams } from "@/lib/routes/search-params";
import { listContracts } from "@/lib/actions/contracts";
import { listApartments } from "@/lib/actions/apartments";
import { listResidents } from "@/lib/actions/residents";
import { StatusBadge } from "@/components/ui/status-badge";
import { Money } from "@/components/ui/money";
import { Ltr } from "@/components/ui/ltr";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader, TableCard, TableEmpty } from "@/components/ui/page";
import { PaginationNav } from "@/components/ui/pagination-nav";
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
import { CONTRACT_TYPE_AR, CONTRACT_STATUS_AR, BILLING_CYCLE_AR } from "@/lib/labels";
import { formatBaghdadDate } from "@/lib/dates";
import { CreateContractForm } from "./create-form";
import { ActivateButton, EndButton } from "./row-actions";

/**
 * شاشة العقود — الخطوة 1.5.
 *
 * ── لماذا يظهر الحساب في الجدول ─────────────────────────────────────
 * المبدأ 3: الدفتر يتبع العقد. العقد بلا عمود حساب يبدو ورقةً إدارية،
 * بينما هو **الشيء الذي يفتح المال ويغلقه**. والحساب المغلق يبقى ظاهراً
 * برصيده المجمَّد — إخفاؤه كان سيمحو ديناً قائماً من نظر الأدمن.
 */



export default async function ContractsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const me = await requireRoleOrRedirect("ADMIN", "OWNER");
  const p = await searchParams;
  const actor = { userId: me.id, role: me.role };

  const [result, apartments, residents] = await Promise.all([
    listContracts(
      {
        type: one(p["type"]) as never,
        status: one(p["status"]) as never,
        apartmentId: one(p["apartment"]),
        page: pageNumber(p["page"]),
        pageSize: 25,
      },
      actor,
    ),
    listApartments({ page: 1, pageSize: 200 }, actor),
    // ⚠️ `includeNonResidentRoles` ليس تفصيلاً: `createContract` يقبل عمداً
    // صاحبَ عقد دورُه ليس `RESIDENT` (‏Q41 — الحارس المقيم يبقى `STAFF`).
    // بدونه يقبل الخادمُ ما لا تستطيع الواجهة عرضه.
    listResidents({ page: 1, pageSize: 200, includeNonResidentRoles: true }, actor),
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

  // D3/2: المالك يقرأ ولا يكتب — `CONTRACTS` ضمن الأفعال الممنوعة عليه.
  const canWrite = me.role === "ADMIN";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="العقود"
        description={
          <>
            <span className="tabular">{total}</span> عقد — الدفتر يتبع العقد لا الشقة
          </>
        }
      />

      {canWrite ? (
        <CreateContractForm
          apartments={
            apartments.ok
              ? apartments.data.rows.map((a) => ({
                  id: a.id,
                  displayNumber: a.displayNumber,
                }))
              : []
          }
          holders={
            residents.ok
              ? residents.data.rows.map((r) => ({ id: r.id, fullName: r.fullName }))
              : []
          }
        />
      ) : null}

      <form className="grid gap-4 rounded-2xl border bg-card p-5 md:grid-cols-4">
        <Field label="النوع" htmlFor="type">
          <NativeSelect id="type" name="type" defaultValue={one(p["type"]) ?? ""}>
            <option value="">الكل</option>
            {Object.entries(CONTRACT_TYPE_AR).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <Field label="الحالة" htmlFor="status">
          <NativeSelect id="status" name="status" defaultValue={one(p["status"]) ?? ""}>
            <option value="">الكل</option>
            {Object.entries(CONTRACT_STATUS_AR).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <Field label="الشقة" htmlFor="apartment">
          <NativeSelect
            id="apartment"
            name="apartment"
            defaultValue={one(p["apartment"]) ?? ""}
          >
            <option value="">الكل</option>
            {apartments.ok
              ? apartments.data.rows.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.displayNumber}
                  </option>
                ))
              : null}
          </NativeSelect>
        </Field>

        <div className="flex items-end">
          <Button type="submit" size="sm">
            ترشيح
          </Button>
        </div>
      </form>

      <TableCard>
        <Table className="min-w-[64rem]">
          <TableHeader>
            <TableRow>
              <TableHead>الرقم</TableHead>
              <TableHead>الشقة</TableHead>
              <TableHead>النوع</TableHead>
              <TableHead>صاحب العقد</TableHead>
              <TableHead>الحالة</TableHead>
              <TableHead>المدّة</TableHead>
              <TableHead>القيمة</TableHead>
              <TableHead>الحساب</TableHead>
              {canWrite ? <TableHead /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableEmpty colSpan={canWrite ? 9 : 8}>
                  لا عقود مطابقة.
                </TableEmpty>
            ) : (
              rows.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">
                    <Ltr>{c.contractNumber}</Ltr>
                  </TableCell>
                  <TableCell>
                    <Ltr>{c.apartment.displayNumber}</Ltr>
                  </TableCell>
                  <TableCell>{CONTRACT_TYPE_AR[c.type]}</TableCell>
                  <TableCell>{c.holder.fullName}</TableCell>
                  <TableCell>
                    <StatusBadge axis="contract" value={c.status} />
                  </TableCell>
                  <TableCell className="tabular text-muted-foreground">
                    <Ltr>{formatBaghdadDate(c.startDate)}</Ltr>
                    {c.endDate ? (
                      <>
                        {" — "}
                        <Ltr>{formatBaghdadDate(c.endDate)}</Ltr>
                      </>
                    ) : null}
                  </TableCell>
                  <TableCell className="tabular">
                    {c.type === "RENTAL" && c.rentAmountIqd !== null ? (
                      <>
                        <Money value={c.rentAmountIqd} suffix={false} />
                        {c.rentCycle ? (
                          <span className="ms-1 text-xs text-muted-foreground">
                            / {BILLING_CYCLE_AR[c.rentCycle]}
                          </span>
                        ) : null}
                      </>
                    ) : c.totalAmountIqd !== null ? (
                      <Money value={c.totalAmountIqd} suffix={false} />
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>
                    {/* المبدأ 3: الحساب المغلق يبقى ظاهراً برصيده المجمَّد */}
                    {c.account ? (
                      <span className="flex items-center gap-2">
                        <Badge
                          variant={c.account.status === "OPEN" ? "success" : "neutral"}
                        >
                          {c.account.status === "OPEN" ? "مفتوح" : "مغلق"}
                        </Badge>
                        <Money value={c.account.balanceIqd} suffix={false} signed />
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">لم يُفتح بعد</span>
                    )}
                  </TableCell>
                  {canWrite ? (
                    <TableCell>
                      {c.status === "DRAFT" ? (
                        <ActivateButton
                          contractId={c.id}
                          contractNumber={c.contractNumber}
                          apartment={c.apartment.displayNumber}
                        />
                      ) : c.status === "ACTIVE" ? (
                        <EndButton
                          contractId={c.id}
                          contractNumber={c.contractNumber}
                          apartment={c.apartment.displayNumber}
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  ) : null}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableCard>

      <PaginationNav
        basePath="/admin/contracts"
        page={page}
        pages={pages}
        params={p}
      />
    </div>
  );
}
