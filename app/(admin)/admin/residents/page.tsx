import { requireRoleOrRedirect } from "@/lib/auth/guard";
import { one, pageNumber, type SearchParams } from "@/lib/routes/search-params";
import { listResidents } from "@/lib/actions/residents";
import { listApartments } from "@/lib/actions/apartments";
import { formatPhoneForDisplay, whatsappLink } from "@/lib/domain/phone";
import { RESIDENT_RELATION_AR } from "@/lib/labels";
import { Ltr } from "@/components/ui/ltr";
import { Badge } from "@/components/ui/badge";
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
import { CreateResidentForm } from "./create-form";
import { LinkDialog, UnlinkButton } from "./link-actions";

/**
 * شاشة السكان — الخطوتان 1.3 و1.4.
 *
 * ── لماذا عمود «الشقق» جمع لا مفرد ──────────────────────────────────
 * `R11`: الشخص الواحد قد يُربط بأكثر من شقة — مالك يسكن واحدة ويؤجّر
 * أخرى. عمودٌ مفرد كان سيُظهر واحدة ويُخفي الباقي، فيبدو النظام ناقص
 * البيانات بينما البيانات كاملة والعرض ناقص.
 */



export default async function ResidentsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const me = await requireRoleOrRedirect("ADMIN", "OWNER");
  const p = await searchParams;
  const actor = { userId: me.id, role: me.role };

  const includeStaff = p["staff"] === "1";

  const [result, apartments] = await Promise.all([
    listResidents(
      {
        search: one(p["q"]),
        apartmentId: one(p["apartment"]),
        includeInactive: p["inactive"] === "1",
        includeNonResidentRoles: includeStaff,
        page: pageNumber(p["page"]),
      },
      actor,
    ),
    listApartments({ page: 1, pageSize: 200 }, actor),
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
  const aptOptions = apartments.ok
    ? apartments.data.rows.map((a) => ({ id: a.id, displayNumber: a.displayNumber }))
    : [];

  const canWrite = me.role === "ADMIN";

  const qs = (patch: Record<string, string | null>) => {
    const out = new URLSearchParams();
    for (const [k, v] of Object.entries(p)) {
      if (typeof v === "string" && v) out.set(k, v);
    }
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) out.delete(k);
      else out.set(k, v);
    }
    out.delete("page");
    return `/admin/residents?${out.toString()}`;
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="السكان"
        description={
          <>
            <span className="tabular">{total}</span> شخص
            {includeStaff ? " (يشمل الموظفين المقيمين)" : ""}
          </>
        }
        actions={
          <>
          <Button asChild variant="outline" size="sm">
            <a href={qs({ inactive: p["inactive"] === "1" ? null : "1" })}>
              {p["inactive"] === "1" ? "إخفاء المعطَّلين" : "إظهار المعطَّلين"}
            </a>
          </Button>
          {/* Q41: الحارس أو الفنّي المقيم يبقى بدور STAFF — وهو ساكن فعلاً */}
          <Button asChild variant="outline" size="sm">
            <a href={qs({ staff: includeStaff ? null : "1" })}>
              {includeStaff ? "السكان فقط" : "إظهار الموظفين المقيمين"}
            </a>
          </Button>
          </>
        }
      />

      {canWrite ? <CreateResidentForm /> : null}

      <form className="grid gap-4 rounded-2xl border bg-card p-5 md:grid-cols-4">
        <Field label="بحث بالاسم أو الهاتف" htmlFor="q" className="md:col-span-2">
          <Input id="q" name="q" defaultValue={one(p["q"]) ?? ""} />
        </Field>

        <Field label="الشقة" htmlFor="apartment">
          <NativeSelect
            id="apartment"
            name="apartment"
            defaultValue={one(p["apartment"]) ?? ""}
          >
            <option value="">الكل</option>
            {aptOptions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.displayNumber}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <div className="flex items-end">
          <Button type="submit" size="sm">
            ترشيح
          </Button>
        </div>
      </form>

      <TableCard>
        <Table className="min-w-[60rem]">
          <TableHeader>
            <TableRow>
              <TableHead>الاسم</TableHead>
              <TableHead>الهاتف</TableHead>
              <TableHead>الشقق</TableHead>
              <TableHead>الحالة</TableHead>
              {canWrite ? <TableHead /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableEmpty colSpan={canWrite ? 5 : 4}>
                  {one(p["q"]) || one(p["apartment"])
                    ? "لا نتائج مطابقة. غيّر المرشّحات."
                    : "لا سكان بعد. أضف أولهم من النموذج أعلاه."}
                </TableEmpty>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.fullName}</TableCell>

                  <TableCell className="tabular">
                    {/* الرقم لاتيني: يُعرض معكوساً بلا عزل ثنائي الاتجاه */}
                    <a
                      href={whatsappLink(r.phone)}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:underline"
                    >
                      <Ltr>{formatPhoneForDisplay(r.phone)}</Ltr>
                    </a>
                  </TableCell>

                  <TableCell>
                    {/* R11: كل الشقق لا الأولى */}
                    {r.apartmentLinks.length === 0 ? (
                      <span className="text-xs text-muted-foreground">غير مربوط</span>
                    ) : (
                      <span className="flex flex-wrap gap-1.5">
                        {r.apartmentLinks.map((l) => (
                          <Badge
                            key={l.id}
                            variant={l.isContractHolder ? "info" : "neutral"}
                            title={
                              l.isContractHolder
                                ? "صاحب العقد"
                                : RESIDENT_RELATION_AR[l.relationType]
                            }
                          >
                            <Ltr>{l.apartment.displayNumber}</Ltr>
                            {l.isContractHolder ? " · صاحب العقد" : ""}
                          </Badge>
                        ))}
                      </span>
                    )}
                  </TableCell>

                  <TableCell>
                    <Badge variant={r.isActive ? "success" : "neutral"}>
                      {r.isActive ? "نشط" : "معطَّل"}
                    </Badge>
                  </TableCell>

                  {canWrite ? (
                    <TableCell>
                      <span className="flex flex-wrap items-center gap-2">
                        <LinkDialog
                          userId={r.id}
                          fullName={r.fullName}
                          apartments={aptOptions}
                        />
                        {r.apartmentLinks.map((l) => (
                          <UnlinkButton
                            key={l.id}
                            apartmentResidentId={l.id}
                            fullName={r.fullName}
                            apartmentNumber={l.apartment.displayNumber}
                          />
                        ))}
                      </span>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableCard>

      <PaginationNav
        basePath="/admin/residents"
        page={page}
        pages={pages}
        params={p}
      />
    </div>
  );
}
