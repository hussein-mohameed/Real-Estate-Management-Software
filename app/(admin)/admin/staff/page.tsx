import Link from "next/link";
import { requireRoleOrRedirect } from "@/lib/auth/guard";
import { one, pageNumber, type SearchParams } from "@/lib/routes/search-params";
import {
  listDepartments,
  listSkills,
  listStaff,
  listVendors,
} from "@/lib/actions/staff";
import { staffCollectionToday } from "@/lib/actions/cash";
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
import { EMPLOYMENT_TYPE_AR, SKILL_LEVEL_AR } from "@/lib/labels";
import { formatPhoneForDisplay, whatsappLink } from "@/lib/domain/phone";
import {
  CreateStaffForm,
  QuickForm,
  AvailabilityToggle,
  ActiveToggle,
  CashPermissionToggle,
  SkillsEditor,
} from "./forms";

/**
 * الموظفون والبيانات المرجعية — الخطوة 1.8.
 *
 * ── ما ليس في هذه الشاشة عمداً ──────────────────────────────────────
 * لا جدول ورديات، ولا حضور وانصراف، ولا كتالوج تدريب [محسوم].
 * `isAvailable` علم حضور بسيط، والمهارات ملصقات تُقرأ كتلميح عند اقتراح
 * مُكلَّف — **والتكليف يدوي دائماً**.
 *
 * ⚠️ ولا حقل «يقبض نقداً»: منح الصلاحية **فعل صريح مستقلّ** موقوف حتى
 * تُحسم سياسة الصندوق (‏B4). حقلٌ هنا كان يُملأ سهواً.
 */



export default async function StaffPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const me = await requireRoleOrRedirect("ADMIN", "OWNER");
  const p = await searchParams;
  const actor = { userId: me.id, role: me.role };
  const canWrite = me.role === "ADMIN";

  const [staff, departments, vendors, skills] = await Promise.all([
    listStaff(
      {
        departmentId: one(p["dept"]),
        skillId: one(p["skill"]),
        search: one(p["q"]),
        onlyAvailable: p["available"] === "1",
        page: pageNumber(p["page"]),
        pageSize: 25,
      },
      actor,
    ),
    listDepartments({ includeInactive: false }, actor),
    listVendors({ includeInactive: false }, actor),
    listSkills({ includeInactive: false }, actor),
  ]);

  /**
   * تحصيل اليوم — بعد أن تُعرف صفوف الصفحة، لأنه يحتاج معرّفاتها.
   *
   * ⚠️ و**لا يُفشل الشاشة إن فشل**: عمودٌ رقابيّ إضافي، وشاشة الموظفين
   * تُستعمل لأشياء لا علاقة لها بالنقد. رسالة خطأ مكان الشاشة كلّها
   * بسبب عمود واحد ثمنٌ لا يقابله شيء.
   */
  const collection = staff.ok
    ? await staffCollectionToday({ staffUserIds: staff.data.rows.map((r) => r.userId) }, actor)
    : null;
  const collected = new Map(
    collection?.ok ? collection.data.map((c) => [c.staffUserId, c]) : [],
  );

  if (!staff.ok) {
    return (
      <p className="rounded-md bg-destructive/10 p-4 text-sm text-destructive">
        {staff.error.message}
      </p>
    );
  }

  const depts = departments.ok ? departments.data : [];
  const vends = vendors.ok ? vendors.data : [];
  const skls = skills.ok ? skills.data : [];
  const { rows, total, page, pageSize } = staff.data;

  /** هل رُشِّح شيء فعلاً — يقرّر ظهور زرّ المسح ونصّ الحالة الفارغة. */
  const hasFilters =
    one(p["q"]) !== undefined ||
    one(p["dept"]) !== undefined ||
    one(p["skill"]) !== undefined ||
    p["available"] === "1";
  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="الموظفون"
        description={
          <>
            <span className="tabular">{total}</span> موظفاً في{" "}
            <span className="tabular">{depts.length}</span> قسماً
          </>
        }
      />

      {canWrite ? (
        <>
          <CreateStaffForm
            departments={depts.map((d) => ({ id: d.id, name: d.name }))}
            vendors={vends.map((v) => ({ id: v.id, name: v.name }))}
          />
          <div className="grid gap-4 md:grid-cols-3">
            <QuickForm kind="department" />
            <QuickForm kind="skill" />
            <QuickForm kind="vendor" />
          </div>
        </>
      ) : null}

      {/* ── الأقسام: «الأشخاص» محسوب لا مخزَّن (‏§4.6) ──────────────── */}
      <section>
        <h3 className="mb-2 text-sm font-semibold">الأقسام</h3>
        {depts.length === 0 ? (
          <Empty>لا أقسام بعد.</Empty>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {depts.map((d) => (
              <div key={d.id} className="rounded-2xl border bg-card p-5">
                <p className="font-medium">{d.name}</p>
                {d.description ? (
                  <p className="mt-1 text-xs text-muted-foreground">{d.description}</p>
                ) : null}
                <p className="mt-2 text-sm text-muted-foreground">
                  <span className="tabular">{d._count.staff}</span> شخصاً ·{" "}
                  <span className="tabular">{d._count.tasks}</span> مهمة مرجعية
                </p>
                {d.manager ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    المدير: {d.manager.fullName}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── المرشّحات ─────────────────────────────────────────────── */}
      <form className="grid gap-4 rounded-2xl border bg-card p-5 md:grid-cols-5">
        <Field label="بحث" htmlFor="q" hint="بالاسم أو المسمّى أو الهاتف">
          {/*
            ⚠️ **`type="search"` لا `type="text"`.** يعطي المتصفّح زرّ
            المسح ويصل المفتاح `Escape` إلى الحقل — وهو ما يتوقّعه من
            يبحث. و`name="q"` يبقى في العنوان فتُشارَك النتيجة وتُحفظ.
          */}
          <Input
            id="q"
            name="q"
            type="search"
            defaultValue={one(p["q"]) ?? ""}
            placeholder="أحمد · 0770"
            aria-describedby="q-hint"
          />
        </Field>

        <Field label="القسم" htmlFor="dept">
          <NativeSelect id="dept" name="dept" defaultValue={one(p["dept"]) ?? ""}>
            <option value="">الكل</option>
            {depts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <Field label="المهارة" htmlFor="skill" hint="تلميح للاقتراح لا شرط للتكليف">
          <NativeSelect
            id="skill"
            name="skill"
            defaultValue={one(p["skill"]) ?? ""}
            aria-describedby="skill-hint"
          >
            <option value="">الكل</option>
            {skls.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <div className="flex flex-col justify-end gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="available"
              value="1"
              defaultChecked={p["available"] === "1"}
              className="size-4 accent-primary"
            />
            <span>المتواجدون فقط</span>
          </label>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <Button type="submit" size="sm">
            ترشيح
          </Button>
          {/*
            ⚠️ **زرّ المسح يظهر حين يوجد ما يُمسح.** ظهورُه دائماً يجعل
            نصف المستخدمين يجرّبونه ليروا ماذا يفعل. وهو رابط لا زرّ:
            المسح انتقالٌ إلى الشاشة بلا مرشّحات، لا إرسال نموذج.
          */}
          {hasFilters ? (
            <Button asChild size="sm" variant="ghost">
              <Link href="/admin/staff">مسح</Link>
            </Button>
          ) : null}
        </div>
      </form>

      <TableCard>
        <Table className="min-w-[64rem]">
          <TableHeader>
            <TableRow>
              <TableHead>الاسم</TableHead>
              <TableHead>التوظيف</TableHead>
              <TableHead>القسم</TableHead>
              <TableHead>الهاتف</TableHead>
              <TableHead>المهارات</TableHead>
              <TableHead>التواجد</TableHead>
              {/* B4 — الصلاحية والتحصيل متجاوران: من يقبض ومن يُراجَع */}
              <TableHead>قبض النقد</TableHead>
              {/* B4 — الرقابة على النقد تُقرأ حيث يُقرأ الموظف، لا في شاشة منفصلة */}
              <TableHead>تحصيل اليوم</TableHead>
              {canWrite ? <TableHead /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableEmpty colSpan={canWrite ? 9 : 8}>
                  {/*
                    ⚠️ **«لا موظفين» و«لا نتيجة لبحثك» معنيان مختلفان.**
                    الأولى تقول إن النظام فارغ، والثانية تقول إن المرشّح
                    ضيّق. ودمجُهما يجعل الأدمن يظنّ أن الموظفين ضاعوا —
                    وهو أول ما يخطر لمن يرى جدولاً فارغاً.
                  */}
                  {hasFilters
                    ? "لا موظّف يطابق ما رشّحت. جرّب توسيع البحث أو امسح المرشّحات."
                    : "لا موظفين بعد. أنشئ أوّلهم من النموذج أعلاه."}
                </TableEmpty>
            ) : (
              rows.map((s) => (
                <TableRow key={s.userId}>
                  <TableCell className="font-medium">
                    <span className="flex flex-wrap items-center gap-2">
                      {/*
                        ⚠️ المعطَّل يُعلَّم **عند اسمه** لا في عمود بعيد:
                        من ترك العمل يبقى في السجلّ، ويجب أن يُقرأ ذلك في
                        أوّل ما تقع عليه العين — لا بعد سبعة أعمدة.
                      */}
                      {/*
                        ⚠️ الاسم **رابط**: القائمة تجيب «من عندي؟»، وصفحة
                        الموظّف تجيب «من هذا؟». والاسم هو ما تقع عليه العين
                        أوّلاً، فهو مدخل الصفحة لا زرٌّ في آخر الصفّ.
                      */}
                      <Link
                        href={`/admin/staff/${s.userId}`}
                        className={
                          s.user.isActive
                            ? "hover:underline"
                            : "text-muted-foreground line-through hover:underline"
                        }
                      >
                        {s.user.fullName}
                      </Link>
                      {s.user.isActive ? null : (
                        <Badge variant="neutral">معطَّل</Badge>
                      )}
                    </span>
                    {s.jobTitle ? (
                      <span className="block text-xs text-muted-foreground">
                        {s.jobTitle}
                      </span>
                    ) : null}
                  </TableCell>

                  <TableCell>
                    {EMPLOYMENT_TYPE_AR[s.employmentType]}
                    {s.vendor ? (
                      <span className="block text-xs text-muted-foreground">
                        {s.vendor.name}
                      </span>
                    ) : null}
                  </TableCell>

                  <TableCell className="text-muted-foreground">
                    {s.department?.name ?? "—"}
                  </TableCell>

                  <TableCell className="tabular">
                    <a
                      href={whatsappLink(s.user.phone)}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:underline"
                    >
                      <Ltr>{formatPhoneForDisplay(s.user.phone)}</Ltr>
                    </a>
                  </TableCell>

                  <TableCell>
                    <span className="flex flex-col items-start gap-1.5">
                    {s.skills.length === 0 ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      <span className="flex flex-wrap gap-1.5">
                        {s.skills.map((k) => (
                          <Badge
                            key={k.id}
                            variant={k.needsTraining ? "warning" : "neutral"}
                            title={
                              k.needsTraining
                                ? "مُعلَّم أنه يحتاج تدريباً — معلومة لا تمنع تكليفاً"
                                : SKILL_LEVEL_AR[k.level]
                            }
                          >
                            {k.skill.name} · {SKILL_LEVEL_AR[k.level]}
                          </Badge>
                        ))}
                      </span>
                    )}
                    {/*
                      ⚠️ المحرّر **داخل خلية المهارات** لا في عمود أفعال:
                      الزرّ إلى جانب ما يُعدّله. وعمودُ أفعالٍ بعيد يُجبر
                      القارئ على مطابقة صفٍّ بصفّ في جدول من تسعة أعمدة.
                    */}
                    {canWrite ? (
                      <SkillsEditor
                        userId={s.userId}
                        staffName={s.user.fullName}
                        allSkills={skls}
                        current={s.skills}
                      />
                    ) : null}
                    </span>
                  </TableCell>

                  <TableCell>
                    <Badge variant={s.isAvailable ? "success" : "neutral"}>
                      {s.isAvailable ? "متواجد" : "غير متواجد"}
                    </Badge>
                  </TableCell>

                  <TableCell>
                    <span className="flex flex-wrap items-center gap-2">
                      {/*
                        ⚠️ الحالة **تُقال بالكلمة** لا بشارة صامتة: «مصرَّح»
                        و«ممنوع» يقرؤهما من يراجع بلا أن يحفظ معنى لون.
                      */}
                      <Badge variant={s.canReceiveCash ? "warning" : "neutral"}>
                        {s.canReceiveCash ? "مصرَّح" : "ممنوع"}
                      </Badge>
                      {canWrite ? (
                        <CashPermissionToggle
                          userId={s.userId}
                          staffName={s.user.fullName}
                          canReceiveCash={s.canReceiveCash}
                        />
                      ) : null}
                    </span>
                  </TableCell>

                  <TableCell>
                    {(() => {
                      const c = collected.get(s.userId);
                      /*
                       * ⚠️ «لم يفتح صندوقاً» ≠ «حصّل صفراً». الأول يعني أنه
                       * لم يقبض اليوم، والثاني يعني أنه فتح ولم يقبض شيئاً
                       * — وهذا الثاني وحده يستحقّ سؤالاً.
                       */
                      if (!c) {
                        return (
                          <span className="text-theme-xs text-muted-foreground">
                            لم يفتح صندوقاً
                          </span>
                        );
                      }
                      return (
                        <span className="flex flex-col items-start gap-1">
                          <span className="tabular font-medium">{c.collectedLabel}</span>
                          <span className="flex items-center gap-1.5">
                            <span className="tabular text-theme-xs text-muted-foreground">
                              {c.payments} دفعة
                            </span>
                            {/*
                              ⚠️ **ثلاث حالات لا اثنتان.** القرار B4 يوجب
                              إقفالاً يومياً، فصندوقٌ بقي مفتوحاً من أمس ليس
                              «مفتوحاً» بل **خرقاً** — وهو بالضبط ما يبحث
                              عنه من يراجع. ودمجُه مع المفتوح اليوم يجعل
                              العمود يطمئن حيث يجب أن يُنذر.
                            */}
                            {c.staleDrawer ? (
                              <Badge variant="destructive" title="فُتح قبل اليوم ولم يُقفَل">
                                لم يُقفَل من أمس
                              </Badge>
                            ) : c.hasOpenDrawer ? (
                              <Badge variant="warning">مفتوح</Badge>
                            ) : (
                              <Badge variant="neutral">مُقفَل</Badge>
                            )}
                          </span>
                        </span>
                      );
                    })()}
                  </TableCell>

                  {canWrite ? (
                    <TableCell>
                      <span className="flex flex-wrap items-center gap-1">
                      {/* ⚠️ التواجد للفعّال وحده: تبديلُه لمعطَّل بلا معنى */}
                      {s.user.isActive ? (
                        <AvailabilityToggle userId={s.userId} isAvailable={s.isAvailable} />
                      ) : null}
                      <ActiveToggle
                        userId={s.userId}
                        staffName={s.user.fullName}
                        isActive={s.user.isActive}
                      /></span>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableCard>

      <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
        لا أحد يقبض نقداً: صلاحية قبض النقد افتراضها <strong>معطَّلة للجميع</strong>،
        ومنحُها موقوف حتى تُحدَّد سياسة الصندوق والإقفال اليومي (القرار{" "}
        <span dir="ltr">B4</span>).
      </p>

      <PaginationNav
        basePath="/admin/staff"
        page={page}
        pages={pages}
        params={p}
      />
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}
