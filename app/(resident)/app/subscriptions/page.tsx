import Link from "next/link";
import { Plus } from "lucide-react";
import { requireRoleOrRedirect } from "@/lib/auth/guard";
import { Button } from "@/components/ui/button";
import { RequestCancelButton, WithdrawCancelButton } from "./cancel-button";
import { getMySubscriptions } from "@/lib/actions/resident-portal";
import { Money } from "@/components/ui/money";
import { Ltr } from "@/components/ui/ltr";
import { Badge } from "@/components/ui/badge";
import { ActionError, PageHeader, TableCard, TableEmpty } from "@/components/ui/page";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BILLING_CYCLE_AR, SUBSCRIPTION_STATUS_AR } from "@/lib/labels";
import { formatBaghdadDate } from "@/lib/dates";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  اشتراكاتي.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── ⚠️ المعلَّق يُعرَض ولا يُخفى ────────────────────────────────────
 * اشتراكٌ طلبتَه ولم يُوافَق عليه بعد يبقى ظاهراً بحالته. وإخفاؤه يجعل
 * الساكن يطلبه ثانيةً — فيصير طلبان على شيء واحد.
 *
 * ── والمبلغ هو **الدورة الكاملة** ───────────────────────────────────
 * الفترة الأولى وحدها مقسَّطة بالتناسب (‏B2). والعمود يقول ما يُقيَّد كل
 * دورة — وهو ما يسأل عنه الساكن. أمّا ما قُيّد فعلاً فيُقرأ من كشف الحساب.
 */

export default async function MySubscriptionsPage() {
  const me = await requireRoleOrRedirect("RESIDENT", "STAFF", "ADMIN", "OWNER");
  const result = await getMySubscriptions({}, { userId: me.id, role: me.role });

  if (!result.ok) {
    return (
      <ActionError message={result.error.message} />
    );
  }

  const { rows } = result.data;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="اشتراكاتي"
        description="ما يُقيَّد على حسابك كل دورة. والمعلَّق ينتظر موافقة الإدارة."
        actions={
          <Button asChild className="gap-2">
            <Link href="/app/subscriptions/new">
              <Plus className="size-4" />
              طلب اشتراك
            </Link>
          </Button>
        }
      />

      <TableCard>
        <Table className="min-w-[40rem]">
          <TableHeader>
            <TableRow>
              <TableHead>الخدمة</TableHead>
              <TableHead>الشقة</TableHead>
              <TableHead>مبلغ الدورة</TableHead>
              <TableHead>الدورة</TableHead>
              <TableHead>الفوترة القادمة</TableHead>
              <TableHead>الحالة</TableHead>
              <TableHead className="w-0" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableEmpty colSpan={7}>
                {/*
                  ⚠️ النصّ كان يقول «يُطلَب من الإدارة» — وصار الطلب ممكناً
                  من هنا. وحالةٌ فارغة تُحيل إلى مكانٍ آخر بينما الزرّ فوقها
                  تناقضٌ يقرؤه المستخدم قبل أن يقرأ الزرّ.
                */}
                لا اشتراكات على حسابك. الإلزامية تُضاف مع السكن، وغيرها تطلبه
                من «طلب اشتراك».
              </TableEmpty>
            ) : (
              rows.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">
                    {s.service.name}
                    {s.service.isMandatory ? (
                      <Badge variant="neutral" className="ms-2">
                        إلزامية
                      </Badge>
                    ) : null}
                  </TableCell>

                  <TableCell className="text-theme-sm">
                    <Ltr>{s.apartment?.displayNumber ?? "—"}</Ltr>
                  </TableCell>

                  <TableCell className="font-medium">
                    <Money value={s.periodAmountIqd ?? 0n} />
                  </TableCell>

                  <TableCell className="text-theme-sm">
                    {s.billingCycle ? BILLING_CYCLE_AR[s.billingCycle] : "مرّة واحدة"}
                  </TableCell>

                  <TableCell className="tabular text-theme-xs text-muted-foreground">
                    {s.nextChargeDate ? (
                      <Ltr>{formatBaghdadDate(s.nextChargeDate)}</Ltr>
                    ) : (
                      "—"
                    )}
                  </TableCell>

                  <TableCell>
                    <Badge
                      variant={
                        s.status === "ACTIVE"
                          ? "success"
                          : s.status === "PENDING_APPROVAL"
                            ? "warning"
                            : "neutral"
                      }
                    >
                      {SUBSCRIPTION_STATUS_AR[s.status]}
                    </Badge>
                    {/*
                      ⚠️ شارةٌ ثانية لا استبدالٌ للأولى: الاشتراك **ما زال
                      نشطاً ويُفوتَر** وطلب الإلغاء معلّق. وعرضُ «إلغاء
                      مطلوب» وحدها كان سيقول إن الفوترة توقّفت.
                    */}
                    {s.cancellationRequestedAt ? (
                      <Badge variant="warning" className="ms-2">
                        إلغاء مطلوب
                      </Badge>
                    ) : null}
                  </TableCell>

                  <TableCell className="text-end">
                    {/*
                      ⚠️ الزرّ للنشط غير الإلزامي وحده. والإلزامية يعيدها
                      الإشغال إن أُلغيت، فطلبُ إلغائها دورةٌ عبثية — والخادم
                      يردّها، فلا يُعرَض ما سيُردّ.
                    */}
                    {s.cancellationRequestedAt ? (
                      /*
                        ⚠️ **لصاحب الطلب وحده.** فردٌ آخر في البيت يرى
                        الشارة ولا يملك زرّاً — إبطالُ طلب غيره طريقه
                        الإدارة، لا ضغطةٌ صامتة على قرارٍ ماليّ.
                      */
                      s.cancellationIsMine ? (
                        <WithdrawCancelButton subscriptionId={s.id} />
                      ) : null
                    ) : s.status === "ACTIVE" && !s.service.isMandatory ? (
                      <RequestCancelButton
                        subscriptionId={s.id}
                        serviceName={s.service.name}
                      />
                    ) : null}
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
