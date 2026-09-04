import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRoleOrRedirect } from "@/lib/auth/guard";
import { getApartment } from "@/lib/actions/apartments";
import { StatusBadge } from "@/components/ui/status-badge";
import { Money } from "@/components/ui/money";
import { Ltr } from "@/components/ui/ltr";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { TableCard } from "@/components/ui/page";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  CONTRACT_TYPE_AR,
  LEDGER_SOURCE_AR,
  RESIDENT_RELATION_AR,
} from "@/lib/labels";
import { formatBaghdadDate, formatBaghdadDateTime } from "@/lib/dates";
import { formatPhoneForDisplay, whatsappLink } from "@/lib/domain/phone";
import { StatusControls } from "./status-controls";
import { cn } from "@/lib/cn";

/**
 * صفحة الشقة — تشريح §11.2.
 *
 * ── لماذا التبويبات في **العنوان** لا في حالة العميل ────────────────
 * سببان، الثاني تقني ملزم:
 *   1. تبويب في العنوان قابل للمشاركة والرجوع وفتحِ تبويب متصفّح جديد.
 *      «افتح لي دفتر الشقة A-3-12» يصير رابطاً يُرسَل.
 *   2. المبالغ كلها `BigInt`، و**`BigInt` لا يعبر حدّ الخادم إلى مكوّن
 *      عميل** في React Server Components — يرمي عند التسلسل. تبويبات
 *      Radix مكوّن عميل، فتمريرُ الدفتر إليها كان سيتطلّب تحويل كل مبلغ
 *      إلى نصّ ثم إعادته، وهو بالضبط النوع من التحويلات التي تُفقد فيها
 *      الدقّة في نظام مالي.
 *
 * ── ولماذا «التاريخ» تبويب لا حاشية ────────────────────────────────
 * المبدأ 3 و`A2`: الحساب المغلق ودفتره يبقيان مرئيَّين **للأبد**. مستأجر
 * غادر برصيد مستحق لا يختفي دَينه لأنه غادر.
 */

const TABS = [
  { key: "overview", label: "نظرة عامة" },
  { key: "residents", label: "السكان" },
  { key: "contracts", label: "العقود" },
  { key: "ledger", label: "الدفتر" },
  { key: "history", label: "التاريخ" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default async function ApartmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const me = await requireRoleOrRedirect("ADMIN", "OWNER");
  const { id } = await params;
  const sp = await searchParams;

  const raw = typeof sp["tab"] === "string" ? sp["tab"] : "overview";
  const tab: TabKey = TABS.some((t) => t.key === raw) ? (raw as TabKey) : "overview";

  const result = await getApartment({ apartmentId: id }, { userId: me.id, role: me.role });
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    return (
      <p className="rounded-md bg-destructive/10 p-4 text-sm text-destructive">
        {result.error.message}
      </p>
    );
  }

  const a = result.data;
  const activeContracts = a.contracts.filter((c) => c.status === "ACTIVE");
  const pastContracts = a.contracts.filter((c) => c.status !== "ACTIVE" && c.status !== "DRAFT");
  const activeResidents = a.residents.filter((r) => r.isActive);
  const pastResidents = a.residents.filter((r) => !r.isActive);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">
            <Link href="/admin/apartments" className="hover:underline">
              الشقق
            </Link>
            {" ← "}
            <Ltr>{a.building.code}</Ltr>
            {a.building.name ? ` · ${a.building.name}` : ""}
          </p>
          <h2 className="text-xl font-semibold">
            <Ltr>{a.displayNumber}</Ltr>
          </h2>
        </div>

        {/* المحاور الثلاثة في الرأس — مستقلّة، لا تُدمج في «حالة» واحدة */}
        <div className="flex flex-col items-end gap-2">
          <div className="flex flex-wrap gap-2">
            <StatusBadge axis="construction" value={a.constructionStatus} />
            <StatusBadge axis="ownership" value={a.ownershipStatus} />
            <StatusBadge axis="occupancy" value={a.occupancyStatus} />
          </div>
          {/* D3/2: المالك يرى ولا يغيّر — APARTMENT_OCCUPANCY ممنوعة عليه */}
          {me.role === "ADMIN" ? (
            <StatusControls
              apartmentId={a.id}
              occupancyStatus={a.occupancyStatus}
              constructionStatus={a.constructionStatus}
            />
          ) : null}
        </div>
      </header>

      {/* ── التبويبات ─────────────────────────────────────────────── */}
      <nav
        className="flex flex-wrap gap-1 rounded-2xl border bg-card p-1.5"
        aria-label="أقسام الشقة"
      >
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/admin/apartments/${a.id}?tab=${t.key}`}
            aria-current={t.key === tab ? "page" : undefined}
            className={cn(
              "rounded-xl px-4 py-2 text-theme-sm transition-colors",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              t.key === tab
                ? "bg-brand-50 font-medium text-brand-500 dark:bg-brand-500/12 dark:text-brand-400"
                : "text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/5",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "overview" ? <Overview a={a} /> : null}
      {tab === "residents" ? (
        <Residents active={activeResidents} past={pastResidents} />
      ) : null}
      {tab === "contracts" ? <Contracts rows={a.contracts} /> : null}
      {tab === "ledger" ? <Ledger contracts={activeContracts} /> : null}
      {tab === "history" ? (
        <History contracts={pastContracts} residents={pastResidents} />
      ) : null}
    </div>
  );
}

type Data = Awaited<ReturnType<typeof getApartment>> extends infer R
  ? R extends { ok: true; data: infer D }
    ? D
    : never
  : never;

// ═══════════════════════════════════════════════════════════════════════

function Overview({ a }: { a: Data }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card className="gap-0 py-0"><CardContent className="p-5 md:p-6">
        <h3 className="mb-3 text-theme-sm font-semibold">الوحدة</h3>
        <dl className="grid grid-cols-2 gap-y-2 text-sm">
          <Row label="الطابق" value={<span className="tabular">{a.floorNumber}</span>} />
          <Row label="رقم الوحدة" value={<span className="tabular">{a.unitNumber}</span>} />
          <Row
            label="المساحة"
            // ‏Decimal من Prisma ليس رقماً: يُحوَّل صراحةً لا يُطبع كما هو
            value={
              a.areaSqm ? (
                <span className="tabular">{a.areaSqm.toString()} م²</span>
              ) : (
                "—"
              )
            }
          />
          <Row
            label="الغرف"
            value={a.roomsCount ? <span className="tabular">{a.roomsCount}</span> : "—"}
          />
          <Row
            label="السعر المعروض"
            value={
              a.priceIqd !== null ? (
                <Money value={a.priceIqd} />
              ) : (
                <span className="text-muted-foreground">—</span>
              )
            }
          />
        </dl>
        {a.priceIqd !== null ? (
          // Q30: سعر الشقة مخزَّن مرتين بلا مرجع معلن. الحقيقة المالية في
          // العقد؛ الرقم هنا سعر معروض لا يدخل أي تقرير.
          <p className="mt-3 text-xs text-muted-foreground">
            سعر معروض. القيمة المالية المعتمدة هي قيمة العقد.
          </p>
        ) : null}
      </CardContent></Card>

      <Card className="gap-0 py-0"><CardContent className="p-5 md:p-6">
        <h3 className="mb-3 text-theme-sm font-semibold">الحالة</h3>
        <dl className="grid grid-cols-2 gap-y-2 text-sm">
          <Row
            label="الإنشاء"
            value={<StatusBadge axis="construction" value={a.constructionStatus} />}
          />
          <Row
            label="التمليك"
            value={<StatusBadge axis="ownership" value={a.ownershipStatus} />}
          />
          <Row
            label="السكن"
            value={<StatusBadge axis="occupancy" value={a.occupancyStatus} />}
          />
          <Row
            label="آخر تغيير سكن"
            value={
              a.occupancyChangedAt ? (
                <Ltr>{formatBaghdadDateTime(a.occupancyChangedAt)}</Ltr>
              ) : (
                "—"
              )
            }
          />
          {/* R9: العدد محسوب لا مخزَّن */}
          <Row
            label="الأفراد الآن"
            value={
              <span className="tabular">
                {a.residents.filter((r) => r.isActive).length}
              </span>
            }
          />
        </dl>
        {a.notes ? (
          <>
            <Separator className="my-3" />
            <p className="text-sm text-muted-foreground">{a.notes}</p>
          </>
        ) : null}
      </CardContent></Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════

function Residents({
  active,
  past,
}: {
  active: Data["residents"];
  past: Data["residents"];
}) {
  if (active.length === 0 && past.length === 0) {
    return <Empty>لا سكان مسجَّلين على هذه الشقة.</Empty>;
  }

  return (
    <div className="flex flex-col gap-6">
      <ResidentTable
        title="السكان الحاليون"
        rows={active}
        empty="لا ساكن نشط — الشقة خالية من المقيمين."
      />
      {past.length > 0 ? (
        <ResidentTable title="سكنوا سابقاً" rows={past} empty="" muted />
      ) : null}
    </div>
  );
}

function ResidentTable({
  title,
  rows,
  empty,
  muted,
}: {
  title: string;
  rows: Data["residents"];
  empty: string;
  muted?: boolean;
}) {
  return (
    <section>
      <h3 className="mb-3 text-theme-sm font-semibold">
        {title} <span className="tabular text-muted-foreground">({rows.length})</span>
      </h3>
      {rows.length === 0 ? (
        <Empty>{empty}</Empty>
      ) : (
        <TableCard>
          <Table className={cn("min-w-[44rem]", muted && "text-muted-foreground")}>
            <TableHeader>
              <TableRow>
                <TableHead>الاسم</TableHead>
                <TableHead>الصفة</TableHead>
                <TableHead>الهاتف</TableHead>
                <TableHead>دخل</TableHead>
                <TableHead>خرج</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">
                    {r.user.fullName}
                    {/* Q41: الموظف الساكن يبقى بدور STAFF — يُعلَّم ولا يُخفى */}
                    {r.user.role !== "RESIDENT" ? (
                      <Badge variant="neutral" className="ms-2">
                        موظف مقيم
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    {r.isContractHolder ? (
                      <Badge variant="info">صاحب العقد</Badge>
                    ) : (
                      RESIDENT_RELATION_AR[r.relationType]
                    )}
                  </TableCell>
                  <TableCell className="tabular">
                    <a
                      href={whatsappLink(r.user.phone)}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:underline"
                    >
                      <Ltr>{formatPhoneForDisplay(r.user.phone)}</Ltr>
                    </a>
                  </TableCell>
                  <TableCell className="tabular">
                    <Ltr>{formatBaghdadDate(r.movedInAt)}</Ltr>
                  </TableCell>
                  <TableCell className="tabular">
                    {r.movedOutAt ? <Ltr>{formatBaghdadDate(r.movedOutAt)}</Ltr> : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      )}
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════════

function Contracts({ rows }: { rows: Data["contracts"] }) {
  if (rows.length === 0) {
    return (
      <Empty>
        لا عقود على هذه الشقة.{" "}
        <a href="/admin/contracts" className="underline">
          أنشئ عقداً
        </a>
        .
      </Empty>
    );
  }

  return (
    <TableCard>
      <Table className="min-w-[56rem]">
        <TableHeader>
          <TableRow>
            <TableHead>الرقم</TableHead>
            <TableHead>النوع</TableHead>
            <TableHead>صاحب العقد</TableHead>
            <TableHead>الحالة</TableHead>
            <TableHead>المدّة</TableHead>
            <TableHead>الحساب</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((c) => (
            <TableRow key={c.id}>
              <TableCell className="font-medium">
                <Ltr>{c.contractNumber}</Ltr>
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
              <TableCell>
                {c.account ? (
                  <span className="flex items-center gap-2">
                    <Badge variant={c.account.status === "OPEN" ? "success" : "neutral"}>
                      {c.account.status === "OPEN" ? "مفتوح" : "مغلق"}
                    </Badge>
                    <Money value={c.account.balanceIqd} suffix={false} signed />
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">لم يُفتح بعد</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableCard>
  );
}

// ═══════════════════════════════════════════════════════════════════════

function Ledger({ contracts }: { contracts: Data["contracts"] }) {
  const withAccounts = contracts.filter((c) => c.account !== null);

  if (withAccounts.length === 0) {
    return <Empty>لا حساب مفتوح على هذه الشقة. الحساب يُفتح بتفعيل عقد.</Empty>;
  }

  return (
    <div className="flex flex-col gap-6">
      {/* D1: قد يكون على الشقة حسابان — بيع وإيجار. لا يُدمجان أبداً. */}
      {withAccounts.map((c) => (
        <AccountLedger key={c.id} contract={c} />
      ))}
    </div>
  );
}

function AccountLedger({ contract }: { contract: Data["contracts"][number] }) {
  const account = contract.account!;
  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">
          دفتر عقد {CONTRACT_TYPE_AR[contract.type]}{" "}
          <Ltr className="text-muted-foreground">{contract.contractNumber}</Ltr>
        </h3>
        <span className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">الرصيد</span>
          <Money value={account.balanceIqd} signed className="font-semibold" />
        </span>
      </div>

      {account.entries.length === 0 ? (
        <Empty>لا قيود بعد على هذا الحساب.</Empty>
      ) : (
        <TableCard>
          <Table className="min-w-[44rem]">
            <TableHeader>
              <TableRow>
                <TableHead>التاريخ</TableHead>
                <TableHead>البيان</TableHead>
                <TableHead>المصدر</TableHead>
                <TableHead>مدين</TableHead>
                <TableHead>دائن</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {account.entries.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="tabular text-muted-foreground">
                    <Ltr>{formatBaghdadDateTime(e.createdAt)}</Ltr>
                  </TableCell>
                  <TableCell>{e.descriptionAr}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {LEDGER_SOURCE_AR[e.source]}
                  </TableCell>
                  {/* الاتجاه يحمله `type` — والمبلغ موجب دائماً */}
                  <TableCell className="tabular">
                    {e.type === "CHARGE" ? (
                      <Money value={e.amountIqd} suffix={false} />
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="tabular">
                    {e.type === "PAYMENT" ? (
                      <Money value={e.amountIqd} suffix={false} />
                    ) : (
                      "—"
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      )}
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════════

function History({
  contracts,
  residents,
}: {
  contracts: Data["contracts"];
  residents: Data["residents"];
}) {
  if (contracts.length === 0 && residents.length === 0) {
    return <Empty>لا تاريخ بعد — لم يُنهَ عقد ولم يخرج ساكن من هذه الشقة.</Empty>;
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
        الحسابات المغلقة ودفاترها تبقى هنا <strong>للأبد</strong>. رصيد مجمَّد على
        عقد منتهٍ يبقى دَيناً قائماً — لا يُنقَل إلى العقد التالي ولا يختفي.
      </p>

      {contracts.length > 0 ? (
        <>
          <Contracts rows={contracts} />
          {contracts
            .filter((c) => c.account && c.account.entries.length > 0)
            .map((c) => (
              <AccountLedger key={c.id} contract={c} />
            ))}
        </>
      ) : null}

      {residents.length > 0 ? (
        <ResidentTable title="سكنوا سابقاً" rows={residents} empty="" muted />
      ) : null}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed px-6 py-12 text-center text-theme-sm text-muted-foreground">
      {children}
    </div>
  );
}
