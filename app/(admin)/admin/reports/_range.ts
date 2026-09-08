import { cell } from "@/lib/auth/roles";
import type { Capability, UserRole } from "@/lib/auth/roles";
import { one, type SearchParams } from "@/lib/routes/search-params";

/**
 * قراءة مُدخلات المدّة من العنوان.
 *
 * ⚠️ **مستخرَجة لأن خمس صفحات تقرؤها.** ونسخُها فيها كان سيجعل صفحةً
 * تنسى `from`/`to` فتتجاهل المدّة المخصّصة بصمت — والمستخدم يرى تقريراً
 * لمدّةٍ غير التي طلب، ولا شيء يقول له ذلك.
 */
export function rangeInputFrom(p: SearchParams): {
  preset?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
} {
  return {
    ...(one(p["preset"]) ? { preset: one(p["preset"]) } : {}),
    ...(one(p["from"]) ? { from: one(p["from"]) } : {}),
    ...(one(p["to"]) ? { to: one(p["to"]) } : {}),
  };
}

/**
 * هل يُصدِّر هذا الدور؟
 *
 * ⚠️ **يُقرأ من المصفوفة** لا يُكتب `role === "OWNER"`: أي تعديل على
 * `canExport` يسري على الشاشة والمسار معاً. وشرطان في موضعين يتفرّقان.
 */
export function canExportReports(role: UserRole): boolean {
  return canExportFor(role, "FINANCIAL_REPORTS");
}

/**
 * ⚠️ **بقدرة التقرير نفسه** لا بقدرة المال: تقرير الموظفين يُصدَّر بحقّ
 * `DEPARTMENTS_SKILLS_STAFF`، لا بحقٍّ على الدفتر. وقدرةٌ واحدة لكل
 * التصديرات كانت تخلط ترخيصين لا علاقة بينهما.
 */
export function canExportFor(role: UserRole, capability: Capability): boolean {
  return cell(role, capability).canExport === true;
}
