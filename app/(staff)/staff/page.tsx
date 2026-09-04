import {
  BadgeCheck,
  Banknote,
  ClipboardList,
  GraduationCap,
  ListChecks,
  UserRound,
  Users,
  Wrench,
} from "lucide-react";
import { requireRoleOrRedirect } from "@/lib/auth/guard";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { PageHeader, SectionCard, EmptyState } from "@/components/ui/page";
import { Ltr } from "@/components/ui/ltr";
import { myWorkspace } from "@/lib/actions/staff-self";
import { EMPLOYMENT_TYPE_AR, SKILL_LEVEL_AR } from "@/lib/labels";
import { ROLE_LABELS_AR, type UserRole } from "@/lib/auth/roles";
import { formatBaghdadDate } from "@/lib/dates";
import { AvailabilityToggle } from "./availability-toggle";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  مساحة الموظف.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── ما يُعرَض وما لا يُعرَض ─────────────────────────────────────────
 * كل ما هنا **بيانات موجودة** من الخطوة 1.8: ملفّه الوظيفي وقسمه ومهاراته
 * وتواجده، ومهام قسمه وزملاؤه فيه.
 *
 * ⚠️ أما **طلباته ومتابعات الأقساط** — وهما جوهر عمله اليومي — فبياناتهما
 * غير مبنيّة بعد (الخطوتان 4.4 و3.5). والصفحة **تقول ذلك صراحةً** بدل أن
 * تعرض صفراً: «لا طلبات» تعني «فحصنا ولم نجد»، و«لم يُبنَ بعد» تعني شيئاً
 * آخر تماماً — والخلط بينهما يجعل الموظف ينتظر عملاً لن يصله.
 *
 * ── والتواجد صار **قابلاً للتغيير** ────────────────────────────────
 * كان شارةً للقراءة فقط. راجع `lib/services/staff-self.ts`: خليّة §3.2
 * تمنح الموظف الكتابة على ملفّه (`R (own profile W)`) والمُنفَّذ كان
 * `READ` وحده بلا `correction` يشرح الفارق — أي سهوٌ لا قرار.
 *
 * ── وترتيب الأقسام يتبع ما يُفعَل به شيء ───────────────────────────
 *   1. **التواجد** — الشيء الوحيد الذي يقرّره الموظف بنفسه، فهو أعلاها.
 *   2. **ملفّه** — من هو وأين يعمل.
 *   3. **مهاراته** وما يحتاج تدريباً — معلومة قابلة للتصرّف.
 *   4. **مهام قسمه وزملاؤه** — سياق عمله.
 *   5. **ما لم يُبنَ** — في الأسفل، وبشكل مختلف عمداً.
 */
export default async function StaffHome() {
  const me = await requireRoleOrRedirect("STAFF", "ADMIN", "OWNER");
  const ws = await myWorkspace();

  const initials = me.fullName.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("");
  const needsTraining = ws.skills.filter((s) => s.needsTraining);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={`أهلاً، ${me.fullName}`}
        description={
          ws.profile?.departmentName
            ? `قسم ${ws.profile.departmentName}`
            : "لم تُسنَد إلى قسم بعد"
        }
        actions={
          ws.profile ? (
            /*
             * ⚠️ **`key` من قيمة الخادم كي تُعاد الحالة عند تغيّرها.**
             * الزرّ يحمل حالته المتفائلة في `useState(initial)`، وذلك
             * يقرأ الـprop **مرّة واحدة**. فلو غيّر الأدمن تواجد الموظف
             * وأُبطلت الذاكرة، وصل prop جديد وبقي الزرّ يعرض القديم.
             * تغيّر المفتاح يُعيد تركيب المكوّن، فتُقرأ القيمة الجديدة.
             */
            <AvailabilityToggle
              key={String(ws.profile.isAvailable)}
              initial={ws.profile.isAvailable}
            />
          ) : undefined
        }
      />

      {/* ── الملفّ الوظيفي ────────────────────────────────────────── */}
      <Card className="gap-0 py-0">
        <CardContent className="flex flex-wrap items-start gap-5 p-5">
          <Avatar className="size-14">
            {me.avatarUrl ? <AvatarImage src={me.avatarUrl} alt="" /> : null}
            <AvatarFallback className="bg-accent-brand-soft font-medium text-accent-brand-strong">
              {initials}
            </AvatarFallback>
          </Avatar>

          <div className="min-w-0 flex-1 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">
                {ws.profile?.jobTitle ?? "بلا مسمّى وظيفي"}
              </span>
              <Badge variant="neutral">{ROLE_LABELS_AR[me.role as UserRole]}</Badge>
              {ws.profile ? (
                <Badge variant={ws.profile.isAvailable ? "success" : "neutral"}>
                  {ws.profile.isAvailable ? "متواجد" : "غير متواجد"}
                </Badge>
              ) : null}
              {/*
               * ⚠️ صلاحية قبض النقد تُعرَض لأنها **مسؤولية** لا ميزة:
               * من يحملها يُطالَب بضابط إقفال يومي. وإخفاؤها يجعل الموظف
               * لا يعرف أنه مسؤول عن صندوق.
               */}
              {ws.profile?.canReceiveCash ? (
                <Badge variant="warning" className="gap-1">
                  <Banknote className="size-3" aria-hidden />
                  يقبض نقداً
                </Badge>
              ) : null}
            </div>

            {ws.profile ? (
              <dl className="grid gap-x-6 gap-y-1.5 text-theme-sm sm:grid-cols-2">
                <div className="flex gap-2">
                  <dt className="text-muted-foreground">التوظيف</dt>
                  <dd>{EMPLOYMENT_TYPE_AR[ws.profile.employmentType]}</dd>
                </div>
                {ws.profile.vendorName ? (
                  <div className="flex gap-2">
                    <dt className="text-muted-foreground">الشركة</dt>
                    <dd>{ws.profile.vendorName}</dd>
                  </div>
                ) : null}
                {ws.profile.hiredAt ? (
                  <div className="flex gap-2">
                    <dt className="text-muted-foreground">تاريخ المباشرة</dt>
                    <dd>
                      <Ltr>{formatBaghdadDate(ws.profile.hiredAt)}</Ltr>
                    </dd>
                  </div>
                ) : null}
              </dl>
            ) : (
              /* ⚠️ حالة حقيقية: مستخدم بدور STAFF بلا ملفّ وظيفي — موجود
                 وغير قابل للتكليف، ولا شيء كان يشير إلى ذلك */
              <p className="text-theme-sm text-money-pending">
                لا ملفّ وظيفي على حسابك: لن تُسنَد إليك طلبات ولا متابعات.
                راجع الإدارة لإنشائه.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── المهارات ──────────────────────────────────────────────── */}
      <SectionCard
        title="مهاراتي"
        description="ملصقات لا كتالوج تدريب (‏§4.7) — ما يحتاج تدريباً يظهر أولاً."
        actions={
          needsTraining.length > 0 ? (
            <Badge variant="warning" className="gap-1">
              <GraduationCap className="size-3" aria-hidden />
              <span className="tabular">{needsTraining.length}</span> تحتاج تدريباً
            </Badge>
          ) : null
        }
      >
        {ws.skills.length === 0 ? (
          <EmptyState
            icon={Wrench}
            title="لا مهارات مسجَّلة"
            description="الإدارة تسجّل المهارات ومستوياتها — وهي ما يُبنى عليه التكليف."
          />
        ) : (
          <ul className="flex flex-col divide-y">
            {ws.skills.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
                <span className="min-w-0 flex-1 font-medium">{s.name}</span>
                <Badge variant="neutral">{SKILL_LEVEL_AR[s.level]}</Badge>
                {/*
                 * ⚠️ ثلاث حالات لا اثنتان: «يحتاج تدريباً» و«تدرَّب» و«لا
                 * شيء مطلوب». وعرضُ الأوليين بشارة واحدة يخفي أن التدريب
                 * أُنجز فعلاً — فيُطلَب مرّتين.
                 */}
                {s.needsTraining ? (
                  <Badge variant="warning">يحتاج تدريباً</Badge>
                ) : s.hasTrained ? (
                  <Badge variant="success" className="gap-1">
                    <BadgeCheck className="size-3" aria-hidden />
                    تدرَّب
                  </Badge>
                ) : null}
                {s.trainingNote ? (
                  <span className="w-full text-theme-xs text-muted-foreground">
                    {s.trainingNote}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {/* ── سياق القسم: ما يقوم به، ومن فيه ──────────────────────── */}
      <section className="grid gap-4 md:gap-6 lg:grid-cols-2">
        <SectionCard
          title="مهام قسمي"
          description="ما يُسنَد إلى القسم من أعمال — تعرّفها الإدارة (‏§4.6)."
        >
          {!ws.profile?.departmentId ? (
            <EmptyState
              icon={ListChecks}
              title="لم تُسنَد إلى قسم"
              description="مهام القسم تظهر هنا بعد إسنادك إليه."
            />
          ) : ws.departmentTasks.length === 0 ? (
            <EmptyState
              icon={ListChecks}
              title="لا مهام معرَّفة لقسمك"
              description={`قسم ${ws.profile.departmentName} بلا مهام بعد — تضيفها الإدارة.`}
            />
          ) : (
            <ul className="flex flex-col divide-y">
              {ws.departmentTasks.map((t) => (
                <li key={t.id} className="py-3 first:pt-0 last:pb-0">
                  <p className="font-medium">{t.name}</p>
                  {t.description ? (
                    <p className="mt-0.5 text-theme-xs leading-relaxed text-muted-foreground">
                      {t.description}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="زملاء القسم"
          description="من يمكن أن يُسنَد إليه العمل الآن — التواجد يقرّره كلٌّ بنفسه."
        >
          {!ws.profile?.departmentId ? (
            <EmptyState
              icon={Users}
              title="لم تُسنَد إلى قسم"
              description="زملاء القسم يظهرون هنا بعد إسنادك إليه."
            />
          ) : ws.colleagues.length === 0 ? (
            <EmptyState
              icon={Users}
              title="أنت وحدك في القسم"
              description="لا موظف آخر مُسنَد إلى هذا القسم."
            />
          ) : (
            <ul className="flex flex-col divide-y">
              {ws.colleagues.map((c) => (
                <li key={c.userId} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <Avatar className="size-8">
                    <AvatarFallback className="bg-muted text-theme-xs font-medium">
                      {c.fullName.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("")}
                    </AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-theme-sm font-medium">
                      {c.fullName}
                    </span>
                    {c.jobTitle ? (
                      <span className="block truncate text-theme-xs text-muted-foreground">
                        {c.jobTitle}
                      </span>
                    ) : null}
                  </span>
                  <Badge variant={c.isAvailable ? "success" : "neutral"} className="shrink-0">
                    {c.isAvailable ? "متواجد" : "غير متواجد"}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </section>

      {/* ── ما لم يُبنَ بعد — يُقال صراحةً لا يُعرَض صفراً ─────────── */}
      <section className="grid gap-4 md:grid-cols-2">
        <NotBuiltYet
          icon={ClipboardList}
          title="الطلبات المُسنَدة إليك"
          stepAr="تُبنى في الخطوة 4.4 — الطلبات والشكاوى"
        />
        <NotBuiltYet
          icon={UserRound}
          title="متابعات الأقساط"
          stepAr="تُبنى في الخطوة 3.5 — وتنتظر القرار B1"
        />
      </section>
    </div>
  );
}

/**
 * بطاقة «لم يُبنَ بعد».
 *
 * ⚠️ **مختلفة عمداً عن حالة الفراغ.** حدّ متقطّع وأيقونة باهتة يقولان
 * «هذا المكان محجوز»، بينما البطاقة الممتلئة بصفر تقول «فحصنا ولم نجد».
 * الخلط بينهما يجعل الموظف ينتظر عملاً لن يصله.
 */
function NotBuiltYet({
  icon: Icon,
  title,
  stepAr,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  stepAr: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed p-8 text-center">
      <Icon className="size-6 text-muted-foreground/60" aria-hidden />
      <p className="text-theme-sm font-medium text-muted-foreground">{title}</p>
      <p className="text-theme-xs text-muted-foreground/80">{stepAr}</p>
    </div>
  );
}
