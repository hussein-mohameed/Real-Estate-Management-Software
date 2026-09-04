import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import type { EmploymentType, SkillLevel } from "@/lib/generated/prisma/client";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  مساحة عمل الموظف — بياناته هو.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── ⚠️ **نصف صلاحية كان مكتوباً وغير مُنفَّذ** ───────────────────────
 * خليّة §3.2 للموظف على `DEPARTMENTS_SKILLS_STAFF` تقول:
 *
 *     { level: "READ", specValue: "R (own profile W)", scope: "own-profile" }
 *
 * أي أن **المواصفة تمنحه الكتابة على ملفّه**، والمُنفَّذ `READ` وحده. ولا
 * حقل `correction` يشرح الفارق — وكل خليّة أخرى يختلف فيها `level` عن
 * `specValue` تحمل شرحاً. فالفارق **سهوٌ لا قرار**.
 *
 * أثره العملي: `setStaffAvailability` موجود، و`can("STAFF", …, "update")`
 * يُرجع `false`، فالموظف **لا يستطيع أن يقول «أنا غير متواجد»**. يبقى
 * مُتاحاً للتكليف وهو ليس كذلك، أو ينتظر أدمناً ليضبط علماً عنه.
 *
 * ── ولماذا لا `defineAction` هنا ────────────────────────────────────
 * ⚠️ `defineAction` يفحص القدرة بمستواها **على كل الصفوف**. ورفعُ الموظف
 * إلى `WRITE` كان سيمنحه تعديل **كل** الموظفين والأقسام والمهارات — أي
 * تجاوزاً هائلاً لـ«ملفّه هو». و`OWN` لا يمنح كتابةً أصلاً
 * (`LEVEL_ACTIONS.OWN = {read}`).
 *
 * فالنطاق هنا **بنيويّ لا صلاحيّ**، كما في جرس الإخطارات: المُعرِّف يأتي
 * من الجلسة لا من مُدخل المتصل، فلا وسيط يمكن التلاعب به. ولا يُكتب إلا
 * حقل واحد: `isAvailable`.
 *
 * ── والتدقيق **إلزامي** هنا خلافاً للجرس ────────────────────────────
 * ⚠️ «قرأتُ إخطاري» ليس حادثاً؛ أما «كنتُ غير متواجد» فهو **جواب سؤال
 * تشغيلي**: لماذا لم يُسنَد إليه الطلب؟ ومن غيّر العلم ومتى؟ بلا سجلّ
 * يصير الأمر كلمةً ضدّ كلمة.
 */

export interface MySkill {
  id: string;
  name: string;
  level: SkillLevel;
  needsTraining: boolean;
  hasTrained: boolean;
  trainingNote: string | null;
}

export interface MyColleague {
  userId: string;
  fullName: string;
  jobTitle: string | null;
  isAvailable: boolean;
}

export interface MyDepartmentTask {
  id: string;
  name: string;
  description: string | null;
}

export interface StaffWorkspace {
  /** `null` لمستخدم بدور STAFF بلا ملفّ وظيفي — حالة حقيقية وقائمة. */
  profile: {
    employmentType: EmploymentType;
    jobTitle: string | null;
    isAvailable: boolean;
    hiredAt: Date | null;
    canReceiveCash: boolean;
    departmentId: string | null;
    departmentName: string | null;
    vendorName: string | null;
  } | null;
  skills: MySkill[];
  /** ما يقوم به قسمه — فراغها يعني قسماً بلا مهام معرَّفة. */
  departmentTasks: MyDepartmentTask[];
  /** زملاء القسم بلا هو. */
  colleagues: MyColleague[];
}

const EMPTY: StaffWorkspace = {
  profile: null,
  skills: [],
  departmentTasks: [],
  colleagues: [],
};

/**
 * كل ما تعرضه مساحة الموظف — **استعلامان لا أكثر**.
 *
 * ⚠️ الاستعلام الثاني مشروط: بلا قسم لا زملاء ولا مهام، وإطلاقه على
 * `departmentId: null` كان سيُرجع **كل من لا قسم له** في المجمّع كزملاء.
 */
export async function staffWorkspace(
  userId: string,
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<StaffWorkspace> {
  const profile = await db.staffProfile.findUnique({
    where: { userId },
    select: {
      employmentType: true,
      jobTitle: true,
      isAvailable: true,
      hiredAt: true,
      canReceiveCash: true,
      departmentId: true,
      department: { select: { name: true } },
      vendor: { select: { name: true } },
      skills: {
        select: {
          id: true,
          level: true,
          needsTraining: true,
          hasTrained: true,
          trainingNote: true,
          skill: { select: { name: true } },
        },
      },
    },
  });

  if (!profile) return EMPTY;

  const base = {
    profile: {
      employmentType: profile.employmentType,
      jobTitle: profile.jobTitle,
      isAvailable: profile.isAvailable,
      hiredAt: profile.hiredAt,
      canReceiveCash: profile.canReceiveCash,
      departmentId: profile.departmentId,
      departmentName: profile.department?.name ?? null,
      vendorName: profile.vendor?.name ?? null,
    },
    skills: profile.skills
      .map((s) => ({
        id: s.id,
        name: s.skill.name,
        level: s.level,
        needsTraining: s.needsTraining,
        hasTrained: s.hasTrained,
        trainingNote: s.trainingNote,
      }))
      /*
       * ما يحتاج تدريباً أولاً: هو **المعلومة القابلة للتصرّف** في القائمة،
       * وترتيبٌ أبجدي كان يدفنها بين ما لا يحتاج شيئاً.
       */
      .sort((a, b) => Number(b.needsTraining) - Number(a.needsTraining)),
    departmentTasks: [] as MyDepartmentTask[],
    colleagues: [] as MyColleague[],
  };

  if (!profile.departmentId) return base;

  const [tasks, colleagues] = await Promise.all([
    db.departmentTask.findMany({
      where: { departmentId: profile.departmentId, isActive: true },
      select: { id: true, name: true, description: true },
      orderBy: { name: "asc" },
    }),
    db.staffProfile.findMany({
      where: {
        departmentId: profile.departmentId,
        // ⚠️ `not: userId` — القائمة «زملاء» لا «الفريق»، وظهوره فيها يربك
        userId: { not: userId },
        /*
         * ⚠️ **الترشيح في القاعدة لا في الذاكرة.**
         * كان `.filter((c) => c.user.isActive)` بعد الجلب — أي جلبُ كل
         * المعطَّلين ثم رميُهم. والشرط شرطُ استعلام: القاعدة تعرف كيف
         * تُنفّذه بفهرس، والذاكرة تدفع ثمن الشبكة أوّلاً.
         *
         * والمستخدم المعطَّل ليس زميلاً حاضراً — `isActive` هو منع الدخول
         * نفسه (‏§10.1).
         */
        user: { isActive: true },
      },
      select: {
        userId: true,
        jobTitle: true,
        isAvailable: true,
        user: { select: { fullName: true } },
      },
      orderBy: { user: { fullName: "asc" } },
    }),
  ]);

  return {
    ...base,
    departmentTasks: tasks,
    colleagues: colleagues
      .map((c) => ({
        userId: c.userId,
        fullName: c.user.fullName,
        jobTitle: c.jobTitle,
        isAvailable: c.isAvailable,
      })),
  };
}

export interface AvailabilityOutcome {
  ok: boolean;
  isAvailable: boolean;
  /** رسالة عربية عند الرفض — §11.4 يمنع عرض رموز خام. */
  message?: string;
}

/**
 * تبديل تواجدي.
 *
 * ⚠️ **لا يُمرَّر `userId` من الواجهة**: يأتي من الجلسة في الغلاف. ولو كان
 * وسيطاً تتحكّم به الواجهة لصار «اضبط تواجد أي موظف» — وهو ما لا تمنحه
 * المصفوفة للموظف.
 *
 * ⚠️ ولا `upsert`: من لا ملفّ وظيفي له **لا يُنشئ لنفسه واحداً**. إنشاء
 * الملفّ فعلُ إدارة (‏`createStaff`) لأنه يحدّد نوع التوظيف والقسم — وهي
 * قرارات ليست للموظف. الرفض صريحٌ برسالة عربية.
 */
export async function setMyAvailability(
  userId: string,
  isAvailable: boolean,
  meta: { ip?: string | null; userAgent?: string | null } = {},
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<AvailabilityOutcome> {
  const current = await db.staffProfile.findUnique({
    where: { userId },
    select: { isAvailable: true },
  });

  if (!current) {
    return {
      ok: false,
      isAvailable: false,
      message: "لا ملفّ وظيفي على حسابك — راجع الإدارة لإنشائه.",
    };
  }

  /*
   * ⚠️ لا كتابة ولا تدقيق حين لا تغيير: نقرتان متتاليتان على نفس القيمة
   * كانتا ستُنتجان صفَّي تدقيق متطابقين يُغرقان السجلّ الذي يُفتَح للتحقيق.
   */
  if (current.isAvailable === isAvailable) {
    return { ok: true, isAvailable };
  }

  await db.staffProfile.update({ where: { userId }, data: { isAvailable } });

  await writeAudit(
    {
      actorUserId: userId,
      action: "setMyAvailability",
      entityType: "StaffProfile",
      entityId: userId,
      before: { isAvailable: current.isAvailable },
      after: { isAvailable },
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    },
    db as Prisma.TransactionClient,
  );

  return { ok: true, isAvailable };
}
