import type { UserRole } from "./roles";

/**
 * سياسة الوصول إلى شقة — تطبيق القرار `D4`.
 *
 * **هذه أخطر سياسة في النظام.** تُنفَّذ في كل استدعاء تقريباً، وخطأ فيها يفتح
 * بيانات ساكن لساكن آخر. لذلك هي مكتوبة **دالة نقية** تستقبل الحقائق
 * وتُرجع قراراً — لا تستعلم قاعدة البيانات بنفسها. الفائدة أنها قابلة
 * للاختبار كاملة قبل وجود أي جدول، وأن جلب الحقائق قابل للتحسين وحده.
 */

/** الحقائق التي يجلبها مُنفِّذ المستودع قبل استدعاء السياسة. */
export interface ApartmentAccessFacts {
  role: UserRole;
  /** الساكن: صف `ApartmentResident` نشط يربطه بالشقة. */
  hasActiveResidentLink: boolean;
  /**
   * الموظف: طلب خدمة `assignedStaffId = me` على **هذه الشقة** وحالته ليست
   * `DONE` ولا `CANCELLED`.
   */
  hasOpenAssignedRequest: boolean;
  /**
   * الموظف: قسط `followUpStaffId = me` حالته `PENDING` أو `OVERDUE` على أحد
   * عقود هذه الشقة.
   *
   * ⚠️ المسار ثلاثي القفزات: `Installment → InstallmentPlan → Contract → apartmentId`.
   * يحتاج فهرساً على `Installment(followUpStaffId, status)` وضمّاً مُخطَّطاً،
   * وإلا صار **فحص الترخيص نفسه** بطيئاً — وهو يُنفَّذ في كل استدعاء (‏D4/1).
   */
  hasActiveFollowUpInstallment: boolean;
}

export interface AccessDecision {
  allowed: boolean;
  /** سبب القرار — يُسجَّل في التدقيق، ولا يُعرض للمستخدم. */
  reason: string;
}

/**
 * القرار.
 *
 * `ADMIN`/`OWNER` ← نطاق المجمّع كله (‏§2.3).
 * `RESIDENT`      ← صفوف شقّته وحدها.
 * `STAFF`         ← **التكليف الفعلي** لا الدور ولا القسم (‏D4).
 *
 * ملاحظة على الموظف الساكن (قرار `Q41`): الدور يبقى `STAFF`، ووصوله بنطاق
 * الساكن **لا يأتي من هذه السياسة** بل من `residentApartmentIds(userId)` —
 * لأن الدور واحد والوصول اثنان. لذلك نمنح `STAFF` أيضاً حقّ الرابط السكني
 * إن وُجد: بدونه يبقى الحارس المقيم بلا كشف حساب ولا طريق لدفع اشتراكاته.
 */
export function decideApartmentAccess(facts: ApartmentAccessFacts): AccessDecision {
  switch (facts.role) {
    case "OWNER":
    case "ADMIN":
      return { allowed: true, reason: "نطاق المجمّع الكامل (§2.3)" };

    case "RESIDENT":
      return facts.hasActiveResidentLink
        ? { allowed: true, reason: "رابط سكن نشط" }
        : { allowed: false, reason: "لا رابط سكن نشط بهذه الشقة" };

    case "STAFF": {
      if (facts.hasOpenAssignedRequest) {
        return { allowed: true, reason: "طلب خدمة مُكلَّف به وغير مُغلق على هذه الشقة" };
      }
      if (facts.hasActiveFollowUpInstallment) {
        return { allowed: true, reason: "قسط متابعة PENDING/OVERDUE على أحد عقود الشقة" };
      }
      // Q41: موظف يسكن في المجمّع — الوصول بنطاق الساكن لا بالدور.
      if (facts.hasActiveResidentLink) {
        return { allowed: true, reason: "موظف مقيم — نطاق الساكن (Q41)" };
      }
      return {
        allowed: false,
        reason: "لا تكليف مفتوح ولا قسط متابعة ولا سكن على هذه الشقة",
      };
    }
  }
}

/**
 * ⛔ **طلبات المنطقة المشتركة لا تمنح أي وصول لأي شقة.**
 *
 * نصّ ملزم من قرار `Q35`. طلب المصعد أو المسبح أو البوّابة يحمل
 * `scope = COMMON_AREA` و`apartmentId = null`، فيسقط خارج قاعدة `D4`
 * («طلب مُكلَّف به على تلك الشقة»). لو مُرِّر إلى `requireApartmentAccess`
 * لَفُتح للموظف وصول عشوائي، ولو أُلحق بشقة عشوائية لتلوّثت كل تقارير الطلبات.
 *
 * هذه الدالة هي البوّابة الصريحة: يُستثنى الطلب المشترك قبل الوصول للسياسة.
 */
export function requestGrantsApartmentAccess(request: {
  scope: "APARTMENT" | "COMMON_AREA";
  apartmentId: string | null;
}): boolean {
  return request.scope === "APARTMENT" && request.apartmentId !== null;
}

// ── سطحان ضيّقان للقراءة، مستقلّان عن requireApartmentAccess (‏D4/2) ────

/**
 * **«بحث عن شقة»** (‏§8.3) — قائمة الحقول المسموحة حرفياً كما تحدّدها المواصفة:
 * السكان · الاتصال · الاشتراكات · حالة الباج — **«بلا أي إجماليات مالية»**.
 *
 * قائمة سماح صريحة لا استثناء: أي حقل جديد يجب أن يُضاف هنا عن قصد، فلا
 * يتسرّب رقم مالي إلى شاشة لا يحقّ لها.
 */
export const APARTMENT_LOOKUP_FIELDS = Object.freeze([
  "apartment.displayNumber",
  "apartment.buildingCode",
  "apartment.floorNumber",
  "apartment.occupancyStatus",
  "resident.fullName",
  "resident.phone",
  "resident.isContractHolder",
  "subscription.serviceName",
  "subscription.status",
  "badge.status",
  "badge.expiresAt",
] as const);

/**
 * **«بحث بوّابة الأمن»** (‏§7.9/4) — أضيق: السؤال التشغيلي الوحيد هو
 * «هل تدخل هذه السيارة بلا تفتيش؟».
 */
export const SECURITY_GATE_FIELDS = Object.freeze([
  "vehicle.plateNumber",
  "vehicle.plateProvince",
  "vehicle.make",
  "vehicle.model",
  "vehicle.color",
  "apartment.displayNumber",
  "resident.fullName",
  "badge.status",
  "badge.expiresAt",
  "badge.isCurrentlyValid",
] as const);

/** أي حقل يحمل هذه الكلمات ممنوع على السطحين الضيّقين. */
const FINANCIAL_TOKEN = /(iqd|balance|amount|price|fee|total|invoice|payment|ledger)/i;

/**
 * فحص آلي يمنع تسرّب أي حقل مالي إلى سطح قراءة ضيّق.
 * يستدعيه اختبار الخطوتين 4.3 و1.7، ويُستدعى وقت التشغيل في بناء الاستعلام.
 */
export function assertNoFinancialLeak(
  fields: readonly string[],
  surfaceNameAr: string,
): void {
  const leaked = fields.filter((f) => FINANCIAL_TOKEN.test(f));
  if (leaked.length > 0) {
    throw new Error(
      `تسرّب مالي في «${surfaceNameAr}»: ${leaked.join(" · ")} — ` +
        "هذه الشاشة لا تعرض أي إجماليات مالية (§8.3 · §7.9/4).",
    );
  }
}
