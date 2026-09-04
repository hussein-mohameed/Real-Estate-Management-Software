import Link from "next/link";
import { ListChecks } from "lucide-react";
import { requireRoleOrRedirect } from "@/lib/auth/guard";
import { one, pageNumber, type SearchParams } from "@/lib/routes/search-params";
import { listDepartmentTasks } from "@/lib/actions/departments";
import { listDepartments, listStaff } from "@/lib/actions/staff";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Field } from "@/components/ui/field";
import { ActionError, EmptyState, PageHeader, Pager, SectionCard, TableCard, TableEmpty } from "@/components/ui/page";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  CreateDepartmentForm,
  CreateTaskForm,
  DepartmentPowerButton,
  TaskActions,
} from "./forms";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  الأقسام ومهامّها.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── 🔴 الثغرة التي وُجدت من أجلها ───────────────────────────────────
 * `createDepartmentTask` كان مبنيّاً بلا شاشة تعرضه أو تُصحّحه. فالمهمّة
 * تُنشأ ولا تُقرأ: خطأٌ في اسمها يبقى أبداً، ومهمّةٌ انتهت الحاجة إليها
 * تظلّ تُعرَض على من يُنشئ طلباً.
 *
 * ── ⚠️ والموقوف يُعرَض بطلب لا افتراضاً ─────────────────────────────
 * القائمة تُخفي الموقوف افتراضاً — هو موقوف لسبب. ورابطٌ صريح يُظهره:
 * إخفاؤه نهائياً يجعل إعادته مستحيلة من الشاشة.
 *
 * ── ولا زرّ حذف ─────────────────────────────────────────────────────
 * كل `ServiceRequest` يشير إلى مهمّته وقسمه. الحذف يقتل مراجع لا تُستعاد.
 */

export default async function DepartmentsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const me = await requireRoleOrRedirect("ADMIN", "OWNER");
  const p = await searchParams;
  const actor = { userId: me.id, role: me.role };

  const includeInactive = p["inactive"] === "1";
  const departmentId = one(p["dept"]);
  const search = one(p["q"]);
  const page = pageNumber(p["page"]);

  const [tasks, departments] = await Promise.all([
    listDepartmentTasks(
      {
        ...(departmentId ? { departmentId } : {}),
        ...(search ? { search } : {}),
        includeInactive,
        page,
        pageSize: 25,
      },
      actor,
    ),
    listDepartments({ includeInactive: true }, actor),
  ]);

  if (!tasks.ok) {
    return (
      <ActionError message={tasks.error.message} />
    );
  }

  const depts = departments.ok ? departments.data : [];

  /*
   * ⚠️ عدد موظفي كل قسم يُقرأ **مرّة واحدة** لكل الصفحة: هو ما يقرّر
   * إمكان الإيقاف. واستعلامٌ لكل قسم يعني رحلةً لكل صفّ في شاشة تُفتح
   * لتعريف بنيةٍ لا تتغيّر كثيراً.
   */
  const staffPerDept = new Map<string, number>();
  for (const d of depts) {
    const listed = await listStaff({ departmentId: d.id, pageSize: 1 }, actor);
    if (listed.ok) staffPerDept.set(d.id, listed.data.total);
  }

  const { rows, total, pageSize } = tasks.data;
  const canWrite = me.role === "ADMIN";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="الأقسام والمهامّ"
        description="ما يُسنَد إلى كل قسم من أعمال. والطلبات تُبنى على هذه المهامّ."
        actions={
          <Badge variant="neutral">
            <span className="tabular">{depts.length}</span> قسماً
          </Badge>
        }
      />

      {canWrite ? (
        <>
          <SectionCard title="قسم جديد" description="اسم القسم فريد في المجمَّع.">
            <CreateDepartmentForm />
          </SectionCard>

          <SectionCard
            title="مهمّة جديدة"
            description="اسم المهمّة فريد داخل قسمها — لا في النظام كلّه."
          >
            <CreateTaskForm departments={depts.map((d) => ({ id: d.id, name: d.name }))} />
          </SectionCard>
        </>
      ) : null}

      {/* ── الأقسام ──────────────────────────────────────────────── */}
      <SectionCard title="الأقسام" description="القسم الذي فيه موظفون لا يُوقَف.">
        {depts.length === 0 ? (
          <EmptyState
            icon={ListChecks}
            title="لا أقسام بعد"
            description="أنشئ قسماً أولاً — المهامّ تُعرَّف داخله."
          />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {depts.map((d) => (
              <li key={d.id} className="rounded-2xl border p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 font-medium">{d.name}</span>
                  {d.isActive ? null : <Badge variant="neutral">موقوف</Badge>}
                </div>
                <p className="mt-1 text-theme-xs text-muted-foreground">
                  <span className="tabular">{staffPerDept.get(d.id) ?? 0}</span> موظفاً
                </p>
                {canWrite ? (
                  <div className="mt-2">
                    <DepartmentPowerButton
                      departmentId={d.id}
                      name={d.name}
                      isActive={d.isActive}
                      staffCount={staffPerDept.get(d.id) ?? 0}
                    />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {/* ── المرشّحات ────────────────────────────────────────────── */}
      <form className="grid gap-4 rounded-2xl border bg-card p-5 md:grid-cols-4">
        <Field label="بحث" htmlFor="q" hint="باسم المهمّة أو وصفها">
          <Input
            id="q"
            name="q"
            type="search"
            defaultValue={search ?? ""}
            placeholder="عطل كهربائي"
            aria-describedby="q-hint"
          />
        </Field>

        <Field label="القسم" htmlFor="dept">
          <NativeSelect id="dept" name="dept" defaultValue={departmentId ?? ""}>
            <option value="">الكل</option>
            {depts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <div className="flex flex-col justify-end gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="inactive"
              value="1"
              defaultChecked={includeInactive}
              className="size-4 accent-primary"
            />
            {/* ⚠️ إظهار الموقوف بطلب — إخفاؤه نهائياً يجعل إعادته مستحيلة */}
            <span>إظهار الموقوف</span>
          </label>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <Button type="submit" size="sm">
            ترشيح
          </Button>
          {search || departmentId || includeInactive ? (
            <Button asChild size="sm" variant="ghost">
              <Link href="/admin/departments">مسح</Link>
            </Button>
          ) : null}
        </div>
      </form>

      <TableCard>
        <Table className="min-w-[48rem]">
          <TableHeader>
            <TableRow>
              <TableHead>المهمّة</TableHead>
              <TableHead>القسم</TableHead>
              <TableHead>الطلبات</TableHead>
              <TableHead>الحالة</TableHead>
              {canWrite ? <TableHead>أفعال</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableEmpty colSpan={canWrite ? 5 : 4}>
                {search || departmentId
                  ? "لا مهمّة تطابق الترشيح."
                  : "لا مهامّ معرَّفة بعد. تُضاف من النموذج أعلاه."}
              </TableEmpty>
            ) : (
              rows.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">
                    <span className={t.isActive ? "" : "text-muted-foreground"}>
                      {t.name}
                    </span>
                    {t.description ? (
                      <span className="block text-theme-xs text-muted-foreground">
                        {t.description}
                      </span>
                    ) : null}
                  </TableCell>

                  <TableCell className="text-theme-sm text-muted-foreground">
                    {t.departmentName}
                  </TableCell>

                  {/*
                    ⚠️ العدد يُعرَض لأنه **سبب منع الحذف**: من يراه يفهم
                    لماذا الفعل «إيقاف» لا «حذف».
                  */}
                  <TableCell className="tabular">{t.requestsCount}</TableCell>

                  <TableCell>
                    <Badge variant={t.isActive ? "success" : "neutral"}>
                      {t.isActive ? "مفعَّلة" : "موقوفة"}
                    </Badge>
                  </TableCell>

                  {canWrite ? (
                    <TableCell>
                      <TaskActions
                        taskId={t.id}
                        name={t.name}
                        description={t.description}
                        isActive={t.isActive}
                        requestsCount={t.requestsCount}
                      />
                    </TableCell>
                  ) : null}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableCard>

      <Pager
        basePath={"/admin/departments"}
        page={page}
        total={total}
        pageSize={pageSize}
        params={p}
      />
    </div>
  );
}
