import Link from "next/link";
import { requireRoleOrRedirect } from "@/lib/auth/guard";
import { getMyAccount, getMyHome } from "@/lib/actions/resident-portal";
import { Money } from "@/components/ui/money";
import { Ltr } from "@/components/ui/ltr";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Wallet } from "lucide-react";
import { EmptyState, PageHeader, TableCard, TableEmpty } from "@/components/ui/page";
import { PaginationNav } from "@/components/ui/pagination-nav";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CONTRACT_TYPE_AR, LEDGER_SOURCE_AR } from "@/lib/labels";
import { formatBaghdadDate, formatBaghdadDateTime } from "@/lib/dates";

/**
 * كشف حساب الساكن.
 *
 * ── لماذا «غير موجود» بدل «ممنوع» ──────────────────────────────────
 * `getMyAccount` يعيد `null` لحسابٍ ليس للمستخدم **ولحسابٍ غير موجود
 * أصلاً** — الجواب نفسه. لو ميّزنا بينهما لصار تبديل المعرّف في العنوان
 * وسيلةً لمعرفة أي الحسابات موجودة في النظام.
 *
 * ── ولماذا لا يُدمج حسابان ──────────────────────────────────────────
 * ‏D1 يسمح بعقدَي بيع وإيجار على الوحدة نفسها. دمج دفترَيهما في كشف واحد
 * يُنتج رصيداً لا يقابله عقد، ولا يستطيع أحد تفسيره ولا تحصيله.
 */
export default async function MyAccountPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const me = await requireRoleOrRedirect("RESIDENT", "STAFF", "ADMIN", "OWNER");
  const sp = await searchParams;
  const actor = { userId: me.id, role: me.role };

  const id = typeof sp["id"] === "string" ? sp["id"] : undefined;
  const page = Number(typeof sp["page"] === "string" ? sp["page"] : 1) || 1;

  // بلا معرّف: نعرض حساباته ليختار — لا صفحة فارغة ولا خطأ
  if (!id) {
    const home = await getMyHome({}, actor);
    const accounts = home.ok ? home.data.accounts : [];

    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="كشف الحساب"
          description="اختر العقد الذي تريد كشف حسابه."
        />
        {accounts.length === 0 ? (
          <EmptyState
            icon={Wallet}
            title="لا حساب على اسمك"
            description="كشف الحساب لصاحب العقد وحده. أفراد الأسرة يرون الوحدة ولا يرون رصيدها."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {accounts.map((acc) => (
              <li key={acc.id}>
                <Link
                  href={`/app/account?id=${acc.id}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card p-5 transition-colors hover:border-brand-300 hover:bg-gray-50 dark:hover:bg-white/[0.03]"
                >
                  <span>
                    <span className="block font-medium">
                      <Ltr>{acc.apartment.displayNumber}</Ltr> · عقد{" "}
                      {CONTRACT_TYPE_AR[acc.contract.type]}
                    </span>
                    <Ltr className="text-xs text-muted-foreground">
                      {acc.contract.contractNumber}
                    </Ltr>
                  </span>
                  <span className="flex items-center gap-3">
                    <Badge variant={acc.status === "OPEN" ? "success" : "neutral"}>
                      {acc.status === "OPEN" ? "مفتوح" : "مغلق"}
                    </Badge>
                    <Money value={acc.balanceIqd} signed />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const result = await getMyAccount({ accountId: id, page, pageSize: 50 }, actor);

  if (!result.ok || result.data === null) {
    return (
      <div className="rounded-2xl border border-dashed p-8 text-center">
        <h2 className="text-base font-semibold">الحساب غير موجود</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          الرابط قد يكون قديماً، أو أن هذا الحساب ليس على اسمك.
        </p>
        <Button asChild variant="outline" size="sm" className="mt-4">
          <Link href="/app/account">حساباتي</Link>
        </Button>
      </div>
    );
  }

  const { account, entries, total, invoices, pageSize } = result.data;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-theme-xs text-muted-foreground">
            <Link href="/app" className="hover:underline">
              الرئيسية
            </Link>
            {" ← "}
            <Ltr>{account.apartment.displayNumber}</Ltr>
          </p>
          <h2 className="text-title-sm font-semibold tracking-tight">
            كشف حساب عقد {CONTRACT_TYPE_AR[account.contract.type]}{" "}
            <Ltr className="text-muted-foreground">{account.contract.contractNumber}</Ltr>
          </h2>
        </div>
        {/* الرصيد أبرز رقم في الشاشة — يُقرأ قبل أي قيد */}
        <div className="rounded-2xl border bg-card px-5 py-3 text-end">
          <p className="text-theme-xs text-muted-foreground">
            {account.status === "OPEN" ? "الرصيد الحالي" : "رصيد مجمَّد"}
          </p>
          <p className="mt-0.5 text-title-sm font-semibold tracking-tight">
            <Money value={account.balanceIqd} signed />
          </p>
        </div>
      </header>

      {account.status !== "OPEN" ? (
        <p className="rounded-xl bg-muted p-4 text-theme-sm text-muted-foreground">
          هذا الحساب مغلق بانتهاء العقد. رصيده مُجمَّد كما هو ولا يُنقَل إلى أي
          عقد آخر، ودفتره يبقى مقروءاً هنا.
          {account.closedAt ? (
            <>
              {" أُغلق في "}
              <Ltr className="tabular">{formatBaghdadDate(account.closedAt)}</Ltr>.
            </>
          ) : null}
        </p>
      ) : null}

      <TableCard>
        <Table className="min-w-[44rem]">
          <TableHeader>
            <TableRow>
              <TableHead>التاريخ</TableHead>
              <TableHead>البيان</TableHead>
              <TableHead>الفترة</TableHead>
              <TableHead>عليك</TableHead>
              <TableHead>لك</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.length === 0 ? (
              <TableEmpty colSpan={5}>لا حركات على هذا الحساب بعد.</TableEmpty>
            ) : (
              entries.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="tabular text-muted-foreground">
                    <Ltr>{formatBaghdadDateTime(e.createdAt)}</Ltr>
                  </TableCell>
                  <TableCell>
                    <span className="block">{e.descriptionAr}</span>
                    <span className="text-xs text-muted-foreground">
                      {LEDGER_SOURCE_AR[e.source]}
                    </span>
                  </TableCell>
                  <TableCell className="tabular text-muted-foreground">
                    {e.periodStart && e.periodEnd ? (
                      <>
                        <Ltr>{formatBaghdadDate(e.periodStart)}</Ltr>
                        {" — "}
                        <Ltr>{formatBaghdadDate(e.periodEnd)}</Ltr>
                      </>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  {/* «عليك» و«لك» بدل «مدين» و«دائن»: الساكن ليس محاسباً */}
                  <TableCell className="tabular">
                    {e.type === "CHARGE" ? <Money value={e.amountIqd} suffix={false} /> : "—"}
                  </TableCell>
                  <TableCell className="tabular">
                    {e.type === "PAYMENT" ? <Money value={e.amountIqd} suffix={false} /> : "—"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableCard>

      <PaginationNav
        basePath="/app/account"
        page={page}
        pages={pages}
        params={{ ...sp, id: account.id }}
      />

      {/*
        ── الفواتير — الخطوة 3.1 ─────────────────────────────────────
        ⚠️ **بعد الكشف لا قبله.** الساكن يفتح هذه الشاشة ليعرف كم عليه؛
        والفاتورة يبحث عنها حين يحتاج وصلاً لدفعةٍ مضت. فترتيبُها أولاً
        كان سيدفع الرصيد — وهو الجواب — تحت الطيّة.

        ⚠️ و**تظهر فقط إن وُجدت**: قسمٌ فارغ بعنوان «الفواتير» يوحي بأن
        فاتورةً كان يجب أن تكون هناك وضاعت. ومن لم يدفع نقداً بعد لا
        فاتورة له، وهذا طبيعي لا نقص.
      */}
      {invoices.length > 0 ? (
        <section className="flex flex-col gap-3">
          <div>
            <h2 className="text-base font-semibold">الفواتير</h2>
            <p className="text-theme-xs text-muted-foreground">
              وصلٌ لكل دفعة سُدّدت. أحدث {invoices.length} فاتورة.
            </p>
          </div>

          <TableCard>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الرقم</TableHead>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>المبلغ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((inv) => (
                  <TableRow key={inv.id}>
                    {/* ⚠️ `Ltr`: رقم الفاتورة لاتيني (‏INV-2026-000001) ويتفتّت في RTL */}
                    <TableCell className="tabular font-medium">
                      <Ltr>{inv.number}</Ltr>
                    </TableCell>
                    <TableCell className="tabular text-muted-foreground">
                      <Ltr>{formatBaghdadDateTime(inv.issuedAt)}</Ltr>
                    </TableCell>
                    <TableCell className="tabular font-medium">
                      <Money value={inv.totalIqd} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableCard>
        </section>
      ) : null}
    </div>
  );
}
