import Link from "next/link";
import { requireRoleOrRedirect } from "@/lib/auth/guard";
import { one, pageNumber, type SearchParams } from "@/lib/routes/search-params";
import { listInstallmentPlans } from "@/lib/actions/installments";
import { Money } from "@/components/ui/money";
import { Ltr } from "@/components/ui/ltr";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { ActionError, PageHeader, Pager, TableCard, TableEmpty } from "@/components/ui/page";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatBaghdadDate } from "@/lib/dates";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  متابعة الأقساط — الخطوة 3.5 · القرار `B1` (‏2026-09-02).
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── ما تجيب عنه هذه الشاشة ──────────────────────────────────────────
 * سؤال واحد: **من تأخّر، وبكم؟** ولذلك يتصدّر عمود المتأخّر، ويُرشَّح
 * بالحالة، ويُبحَث برقم العقد أو اسم صاحبه أو رقم الشقة.
 *
 * ── ⚠️ والمبلغ المعروض هو **المتبقّي** لا قيمة العقد ─────────────────
 * قيمة العقد رقم ثابت لا يتغيّر ولا يُتابَع. والمتبقّي هو ما يُسأل عنه:
 * ما لم يُدفع ولم يُلغَ — **شاملاً المتأخّر**. وجمعُ `PENDING` وحدها كان
 * يُخفي المتأخّر، وهو أهمّ ما وُجدت الشاشة من أجله.
 *
 * ── والدفعة المقدّمة تظهر ولا تُحسب في المتبقّي ──────────────────────
 * `B1`: مقبوضة عند التوقيع بوصل وفاتورة. فهي **مدفوعة سلفاً** — إدخالها
 * في المتبقّي يجعل من دفعها يبدو مديناً بها.
 */

const STATUSES = ["ACTIVE", "COMPLETED", "CANCELLED"] as const;

const STATUS_AR: Record<(typeof STATUSES)[number], string> = {
  ACTIVE: "جارية",
  COMPLETED: "مكتملة",
  CANCELLED: "ملغاة",
};

export default async function InstallmentsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const me = await requireRoleOrRedirect("ADMIN", "OWNER", "STAFF");
  const p = await searchParams;

  const statusParam = one(p["status"]);
  const status = STATUSES.find((s) => s === statusParam);
  const page = pageNumber(p["page"]);

  const result = await listInstallmentPlans(
    {
      ...(status ? { status } : {}),
      ...(one(p["q"]) ? { search: one(p["q"])! } : {}),
      page,
      pageSize: 25,
    },
    { userId: me.id, role: me.role },
  );

  if (!result.ok) {
    return (
      <ActionError message={result.error.message} />
    );
  }

  const { rows, total, pageSize } = result.data;
  const overdueTotal = rows.reduce((n, r) => n + r.overdueCount, 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="متابعة الأقساط"
        description="من تأخّر وبكم. والمبلغ المعروض هو المتبقّي لا قيمة العقد."
        actions={
          <span className="flex flex-wrap items-center gap-2">
            {/*
              ⚠️ الترحيل زرٌّ ثانوي عمداً: يُستعمل مرّة عند إدخال النظام،
              ويكسر قواعد التشغيل اليومي. وإبرازُه يدعو إلى استعماله في
              العمل العادي — حيث لا مكان له.
            */}
            {/* الإنشاء أوّلاً: هو العمل اليومي، والترحيل يجري مرّة */}
            <Button asChild size="sm">
              <Link href="/admin/installments/new">خطة جديدة</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href="/admin/installments/migrate">ترحيل عقد قائم</Link>
            </Button>
            {overdueTotal > 0 ? (
              <Badge variant="destructive">
                <span className="tabular">{overdueTotal}</span> قسطاً متأخّراً
              </Badge>
            ) : (
              <Badge variant="success">لا متأخّر في هذه الصفحة</Badge>
            )}
          </span>
        }
      />

      {/* المرشّحات — نموذج GET، فتبقى الحالة في العنوان وتُشارَك */}
      <form className="grid gap-4 rounded-2xl border bg-card p-5 md:grid-cols-4">
        <Field label="بحث" htmlFor="q" hint="برقم العقد أو اسم صاحبه أو رقم الشقة">
          <Input
            id="q"
            name="q"
            type="search"
            defaultValue={one(p["q"]) ?? ""}
            placeholder="CTR-2026 · أحمد · BRJ-1-2"
            aria-describedby="q-hint"
          />
        </Field>

        <Field label="الحالة" htmlFor="status">
          <select
            id="status"
            name="status"
            defaultValue={status ?? ""}
            className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
          >
            <option value="">الكل</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_AR[s]}
              </option>
            ))}
          </select>
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
              <TableHead>العقد</TableHead>
              <TableHead>صاحب العقد</TableHead>
              <TableHead>الشقة</TableHead>
              <TableHead>المتبقّي</TableHead>
              <TableHead>التقدّم</TableHead>
              <TableHead>القسط القادم</TableHead>
              <TableHead>الحالة</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableEmpty colSpan={8}>
                {status || one(p["q"])
                  ? "لا خطة تطابق الترشيح."
                  : "لا خطط أقساط بعد. تُنشأ من صفحة العقد بعد تفعيله."}
              </TableEmpty>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="tabular font-medium">
                    {/* ⚠️ `Ltr`: رقم العقد لاتيني ويتفتّت في RTL */}
                    <Ltr>{r.contractNumber}</Ltr>
                  </TableCell>

                  <TableCell className="text-theme-sm">{r.holderName}</TableCell>

                  <TableCell className="text-theme-sm">
                    <Ltr>{r.apartmentNumber ?? "—"}</Ltr>
                  </TableCell>

                  <TableCell className="font-medium">
                    <Money value={r.remainingIqd} />
                    {r.downPaymentIqd > 0n ? (
                      <span className="block text-theme-xs text-muted-foreground">
                        {/*
                          ⚠️ المقدّمة تُذكر ولا تُحسب في المتبقّي: مقبوضة
                          عند التوقيع (‏B1)، وإدخالها يجعل من دفعها مديناً بها.
                        */}
                        مقدّمة مقبوضة <Money value={r.downPaymentIqd} suffix={false} />
                      </span>
                    ) : null}
                  </TableCell>

                  <TableCell className="tabular text-theme-sm">
                    {r.paidCount} / {r.installmentsCount}
                    {r.overdueCount > 0 ? (
                      <Badge variant="destructive" className="ms-2">
                        <span className="tabular">{r.overdueCount}</span> متأخّر
                      </Badge>
                    ) : null}
                  </TableCell>

                  <TableCell className="tabular text-theme-xs text-muted-foreground">
                    {r.nextDueDate ? (
                      <Ltr>{formatBaghdadDate(r.nextDueDate)}</Ltr>
                    ) : (
                      "—"
                    )}
                  </TableCell>

                  <TableCell>
                    <Badge
                      variant={
                        r.status === "ACTIVE"
                          ? "warning"
                          : r.status === "COMPLETED"
                            ? "success"
                            : "neutral"
                      }
                    >
                      {STATUS_AR[r.status]}
                    </Badge>
                  </TableCell>

                  <TableCell>
                    <Button asChild size="xs" variant="outline">
                      <Link href={`/admin/installments/${r.id}`}>الأقساط</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableCard>

      <Pager
        basePath={"/admin/installments"}
        page={page}
        total={total}
        pageSize={pageSize}
        params={p}
      />
    </div>
  );
}
