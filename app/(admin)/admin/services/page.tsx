import { requireRoleOrRedirect } from "@/lib/auth/guard";
import type { SearchParams } from "@/lib/routes/search-params";
import { listServices } from "@/lib/actions/services";
import { Money } from "@/components/ui/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader, TableCard, TableEmpty } from "@/components/ui/page";

import { CustomFieldsForm } from "@/components/ui/custom-fields-form";
import { parseStoredFields } from "@/lib/domain/custom-fields";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  BILLING_CYCLE_AR,
  PAYER_TYPE_AR,
  PRICING_MODEL_AR,
  SERVICE_APPLIES_TO_AR,
  SERVICE_BILLING_TYPE_AR,
} from "@/lib/labels";
import { CreateServiceForm, AvailabilityToggle } from "./service-form";
import { RolloutButton } from "./rollout-button";

/**
 * كتالوج الخدمات — الخطوة 2.1.
 *
 * ── لماذا معاينة الحقول المخصّصة ────────────────────────────────────
 * مخطّط JSON مكتوب بيد لا يُقرأ بالنظر. المعاينة تُري الأدمن **النموذج
 * الذي سيراه الساكن فعلاً** من نفس التعريف — فالخطأ يظهر قبل أن يشتك
 * منه أحد، لا بعد أول اشتراك فاشل.
 */


export default async function ServicesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const me = await requireRoleOrRedirect("ADMIN", "OWNER");
  const p = await searchParams;
  const canWrite = me.role === "ADMIN";
  const showAll = p["all"] === "1";
  const preview = typeof p["preview"] === "string" ? p["preview"] : undefined;

  const result = await listServices(
    { includeUnavailable: showAll, onlyMandatory: false },
    { userId: me.id, role: me.role },
  );

  if (!result.ok) {
    return (
      <p className="rounded-md bg-destructive/10 p-4 text-sm text-destructive">
        {result.error.message}
      </p>
    );
  }

  const services = result.data;
  const previewed = preview ? services.find((s) => s.id === preview) : undefined;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="الخدمات"
        description={
          <>
            <span className="tabular">{services.length}</span> خدمة
            {showAll ? " (تشمل الموقوفة)" : " متاحة"}
          </>
        }
        actions={
          <Button asChild variant="outline" size="sm">
            <a href={showAll ? "/admin/services" : "/admin/services?all=1"}>
              {showAll ? "المتاحة فقط" : "إظهار الموقوفة"}
            </a>
          </Button>
        }
      />

      {canWrite ? <CreateServiceForm /> : null}

      <TableCard>
        <Table className="min-w-[68rem]">
          <TableHeader>
            <TableRow>
              <TableHead>الخدمة</TableHead>
              <TableHead>الفوترة</TableHead>
              <TableHead>التسعير</TableHead>
              <TableHead>السعر</TableHead>
              <TableHead>يدفعها</TableHead>
              <TableHead>تنطبق على</TableHead>
              <TableHead>المشتركون</TableHead>
              <TableHead>الحالة</TableHead>
              {canWrite ? <TableHead /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {services.length === 0 ? (
              <TableEmpty colSpan={canWrite ? 9 : 8}>
                  {/*
                    ⚠️ **الرسالة تتبع ما يراه القارئ.** النموذج لا يُصيَّر
                    للمالك (`canWrite`)، فإحالتُه إلى «النموذج أعلاه» تُرسله
                    يبحث عن شيء غير موجود ويظنّ الصفحة معطوبة.
                  */}
                  {canWrite
                    ? "لا خدمات بعد. أنشئ أولاها من النموذج أعلاه — بلا كود جديد."
                    : "لا خدمات بعد. تُنشئها الإدارة."}
                </TableEmpty>
            ) : (
              services.map((s) => {
                const fields = parseStoredFields(s.customFieldsSchema);
                return (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">
                      {s.name}
                      {s.description ? (
                        <span className="block text-xs text-muted-foreground">
                          {s.description}
                        </span>
                      ) : null}
                      {fields.length > 0 ? (
                        <a
                          href={`/admin/services?${showAll ? "all=1&" : ""}preview=${s.id}`}
                          className="mt-1 block text-xs underline"
                        >
                          <span className="tabular">{fields.length}</span> حقلاً مخصّصاً —
                          معاينة
                        </a>
                      ) : null}
                    </TableCell>

                    <TableCell className="text-muted-foreground">
                      {SERVICE_BILLING_TYPE_AR[s.billingType]}
                      {s.billingCycle ? (
                        <span className="block text-xs">{BILLING_CYCLE_AR[s.billingCycle]}</span>
                      ) : null}
                    </TableCell>

                    <TableCell className="text-muted-foreground">
                      {PRICING_MODEL_AR[s.pricingModel]}
                    </TableCell>

                    <TableCell className="tabular">
                      {s.pricingModel === "PER_UNIT" && s.unitPriceIqd !== null ? (
                        <>
                          <Money value={s.unitPriceIqd} suffix={false} />
                          <span className="ms-1 text-xs text-muted-foreground">
                            / {s.unitLabel}
                          </span>
                        </>
                      ) : s.basePriceIqd !== null ? (
                        <>
                          <Money value={s.basePriceIqd} suffix={false} />
                          {s.pricingModel === "PER_PERSON" ? (
                            <span className="ms-1 text-xs text-muted-foreground">/ فرد</span>
                          ) : null}
                        </>
                      ) : (
                        "—"
                      )}
                    </TableCell>

                    <TableCell className="text-muted-foreground">
                      {PAYER_TYPE_AR[s.payerType]}
                    </TableCell>

                    <TableCell className="text-muted-foreground">
                      {SERVICE_APPLIES_TO_AR[s.appliesTo]}
                    </TableCell>

                    {/* R22: محسوب دائماً، والنشط وحده */}
                    <TableCell className="tabular">{s.activeSubscriptions}</TableCell>

                    <TableCell>
                      <span className="flex flex-wrap gap-1.5">
                        <Badge variant={s.isAvailable ? "success" : "neutral"}>
                          {s.isAvailable ? "متاحة" : "موقوفة"}
                        </Badge>
                        {s.isMandatory ? <Badge variant="info">إلزامية</Badge> : null}
                      </span>
                    </TableCell>

                    {canWrite ? (
                      <TableCell>
                        <span className="flex flex-wrap items-center gap-2">
                          {/*
                            ⚠️ التعميم للإلزامية **المتاحة** وحدها: تعميم
                            خدمة موقوفة يُنشئ اشتراكات في خدمة لا تُقدَّم،
                            والإلزامية وحدها تُنشأ بلا طلبٍ من الساكن.
                          */}
                          {s.isMandatory && s.isAvailable ? (
                            <RolloutButton serviceId={s.id} serviceName={s.name} />
                          ) : null}
                        <AvailabilityToggle
                          serviceId={s.id}
                          serviceName={s.name}
                          isAvailable={s.isAvailable}
                          isMandatory={s.isMandatory}
                          activeSubscriptions={s.activeSubscriptions}
                        />
                        </span>
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableCard>

      {/* ── معاينة النموذج المولَّد ─────────────────────────────────── */}
      {previewed ? (
        <section className="rounded-2xl border bg-card p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">
              نموذج الاشتراك بـ«{previewed.name}» كما سيراه المستخدم
            </h3>
            <Button asChild variant="ghost" size="xs">
              <a href={showAll ? "/admin/services?all=1" : "/admin/services"}>إغلاق</a>
            </Button>
          </div>
          <p className="mb-4 text-xs text-muted-foreground">
            مولَّد من تعريف الحقول — لا كود مكتوب لهذه الخدمة.
          </p>
          {/* نموذج معطَّل: معاينة لا إدخال */}
          <fieldset disabled className="opacity-90">
            <CustomFieldsForm fields={parseStoredFields(previewed.customFieldsSchema)} />
          </fieldset>
        </section>
      ) : null}

      <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
        لا حذف للخدمات (‏R24): خدمة لها اشتراكات محذوفةٌ تقتل مراجع في الدفتر.
        الإيقاف يمنع الاشتراكات الجديدة <strong>ويُبقي القائمة تعمل</strong>.
        وتغيير السعر لا يرتدّ على اشتراك قائم (‏R23) — لكل اشتراك لقطة سعره.
      </p>
    </div>
  );
}
