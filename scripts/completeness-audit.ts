/**
 * تدقيق الاكتمال — يجعل «لا فراغات» **قابلاً للفحص آلياً** بدل أن يكون ادّعاءً.
 *
 * ── منطق التمييز ──────────────────────────────────────────────────────
 * ❌ **فشل**  = تناقض: العدد لا يطابق المواصفة، أو قيمة بلا تسمية، أو فجوة
 *              في الترقيم. هذا خطأ يجب أن يوقف CI.
 * ⏳ **معلَّق** = لم يُبنَ بعد. يُعرض بوضوح ولا يُفشل — لأن مشروعاً في منتصف
 *              الطريق ليس مشروعاً معطوباً، لكن إخفاء ما لم يُبنَ **هو** العطب.
 *
 * كل رقم مرجعي هنا مأخوذ من عدّ فعلي لنصّ المواصفة، موثَّق في
 * docs/AUDIT-VERIFICATION.md §1.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ALL_ENUMS, ENUMS_DEFINED_ELSEWHERE } from "../lib/domain/enums";
import { ALL_LABEL_MAPS } from "../lib/labels";
import { auditRules } from "../lib/domain/rules";
import { auditStatistics } from "../lib/domain/statistics";
import { CAPABILITIES, PERMISSION_MATRIX, USER_ROLES } from "../lib/auth/roles";
import { auditFlows } from "../lib/domain/flows";
import { auditActions } from "../lib/actions/registry";
import { auditRoutes } from "../lib/routes/registry";
import { auditTemplates } from "../lib/notifications/templates";

/** الأعداد المرجعية — أُعيد عدّها من spec.md آلياً، لا من الذاكرة. */
const EXPECTED = {
  rules: 39,
  assumptions: 10,
  /**
   * 30 جدولاً من §5 + 6 جداول تفرضها قرارات محسومة:
   *   Counter (Q17) · LoginLink (Q46) · RateLimitHit (Q20)
   *   ResidentRequest (Q37) · FloorUnitsOverride (Q43)
   *   CashDrawerSession (B4 — 2026-09-01)
   * ولا جدول واحد من الثلاثين مفقود — يتحقّق منه الفحص أدناه بالاسم.
   *
   * ⚠️ **هذا الرقم حرسٌ لا توثيق.** أضفتُ `CashDrawerSession` فكشفه الفحص
   * فوراً: «36 — المتوقَّع 35». ورفعُه بلا سبب مكتوب يُحوّل الحرس إلى
   * ختمٍ يُمرّر كل شيء. كل زيادة هنا تحتاج قراراً مُسمّى بجانبها.
   */
  models: 36,
  specModels: 30,
  serverActions: 44,
  routeHandlers: 9,
  flows: 12,
  notificationTemplates: 12,
  statistics: 12,
  dashboards: 4,
  capabilities: 23,
  roles: 4,
  storageBuckets: 5,
  sharedComponents: 12, // 11 من §11.3 + <Money> من §11.1 (تصحيح V5)
  envVars: 16, // 15 في §12.2 + SENTRY_DSN (تصحيح T6)
} as const;

const failures: string[] = [];
const pending: string[] = [];
const passed: string[] = [];

function check(label: string, actual: number, expected: number): void {
  if (actual === expected) passed.push(`${label}: ${actual}/${expected}`);
  else failures.push(`${label}: ${actual} — المتوقَّع ${expected}`);
}

function pend(label: string, note: string): void {
  pending.push(`${label} — ${note}`);
}

// ── 1. القواعد R1–R39 ───────────────────────────────────────────────────
{
  const { total, missingIds, unenforced } = auditRules();
  check("القواعد R1–R39", total, EXPECTED.rules);
  if (missingIds.length > 0) {
    failures.push(`فجوة في ترقيم القواعد: ${missingIds.join(" · ")}`);
  }
  if (unenforced.length > 0) {
    pend("قواعد بلا موضع إنفاذ بعد", `${unenforced.length} قاعدة: ${unenforced.join(" · ")}`);
  }
}

// ── 2. الإحصاءات (§4.20) ────────────────────────────────────────────────
{
  const { total, duplicateKeys, blocked } = auditStatistics();
  check("الإحصاءات المحسوبة", total, EXPECTED.statistics);
  if (duplicateKeys.length > 0) {
    failures.push(`مفاتيح إحصاء مكرَّرة: ${duplicateKeys.join(" · ")}`);
  }
  if (blocked.length > 0) {
    pend("إحصاءات محجوبة بقرار", `${blocked.length}: ${blocked.join(" · ")}`);
  }
}

// ── 3. مصفوفة الصلاحيات (§3.2) ──────────────────────────────────────────
{
  check("قدرات المصفوفة", CAPABILITIES.length, EXPECTED.capabilities);
  check("الأدوار", USER_ROLES.length, EXPECTED.roles);

  const missing: string[] = [];
  for (const capability of CAPABILITIES) {
    for (const role of USER_ROLES) {
      const cell = PERMISSION_MATRIX[capability]?.[role];
      if (!cell?.level || !cell.specValue) missing.push(`${capability}/${role}`);
    }
  }
  if (missing.length > 0) failures.push(`خلايا صلاحية ناقصة: ${missing.join(" · ")}`);
  else passed.push(`خلايا المصفوفة: ${CAPABILITIES.length * USER_ROLES.length}/92`);
}

// ── 4. كل قيمة enum لها تسمية عربية — بلا استثناء واحد ──────────────────
{
  const unlabeled: string[] = [];
  const orphanMaps: string[] = [];

  for (const [enumName, values] of Object.entries(ALL_ENUMS)) {
    const labels = ALL_LABEL_MAPS[enumName];
    if (!labels) {
      unlabeled.push(`${enumName} (لا خريطة تسمية إطلاقاً)`);
      continue;
    }
    for (const value of values) {
      const label = labels[value];
      if (!label || label.trim() === "") unlabeled.push(`${enumName}.${value}`);
      if (label && /^[A-Z_]+$/.test(label)) {
        failures.push(`${enumName}.${value} تسميته إنجليزية خام: «${label}»`);
      }
    }
  }

  for (const mapName of Object.keys(ALL_LABEL_MAPS)) {
    if (!(mapName in ALL_ENUMS)) orphanMaps.push(mapName);
  }

  if (unlabeled.length > 0) {
    failures.push(`قيم enum بلا تسمية عربية (${unlabeled.length}): ${unlabeled.join(" · ")}`);
  } else {
    const totalValues = Object.values(ALL_ENUMS).reduce((n, v) => n + v.length, 0);
    passed.push(
      `تسميات enum: ${totalValues} قيمة في ${Object.keys(ALL_ENUMS).length} enum — كلها مُسمّاة`,
    );
  }
  if (orphanMaps.length > 0) {
    failures.push(`خرائط تسمية بلا enum مقابل: ${orphanMaps.join(" · ")}`);
  }
  if (ENUMS_DEFINED_ELSEWHERE.length !== 1) {
    failures.push("قائمة الـenums المعرَّفة خارج المجال تغيّرت — راجعها.");
  }
}

// ── 5. مطابقة schema.prisma لتعريفات TypeScript ─────────────────────────
{
  const schemaPath = resolve(process.cwd(), "prisma/schema.prisma");
  const schema = existsSync(schemaPath) ? readFileSync(schemaPath, "utf8") : "";

  const models = [...schema.matchAll(/^model\s+(\w+)\s*\{/gmu)].map((m) => m[1]!);
  const enumBlocks = [...schema.matchAll(/^enum\s+(\w+)\s*\{([^}]*)\}/gmu)];

  if (models.length === 0) {
    pend("مخطّط Prisma", "لم يُكتب بعد — المحاولة 5. محجوب بالقرارين B3 · B4 حسب 20-schema.md");
  } else {
    check("جداول المخطّط", models.length, EXPECTED.models);

    // كل جدول من الثلاثين في §5 موجود بالاسم — لا اكتفاء بمطابقة العدد،
    // لأن عدداً صحيحاً قد يخفي جدولاً مفقوداً وآخر مضافاً.
    const SPEC_MODELS = [
      "CompoundSettings", "Setting", "User", "ResidentProfile", "StaffProfile",
      "Vendor", "Department", "DepartmentTask", "Skill", "StaffSkill",
      "Building", "Apartment", "ApartmentResident", "Contract", "InstallmentPlan",
      "Installment", "Service", "Subscription", "Account", "LedgerEntry",
      "Payment", "Invoice", "Vehicle", "Badge", "ServiceRequest",
      "RequestComment", "Attachment", "Notification", "OtpCode", "AuditLog",
    ];
    if (SPEC_MODELS.length !== EXPECTED.specModels) {
      failures.push(`قائمة جداول المواصفة نفسها ${SPEC_MODELS.length} لا ${EXPECTED.specModels}`);
    }
    const present = new Set(models);
    const missingSpecModels = SPEC_MODELS.filter((m) => !present.has(m));
    if (missingSpecModels.length > 0) {
      failures.push(`جداول من §5 مفقودة: ${missingSpecModels.join(" · ")}`);
    } else {
      passed.push(`جداول §5 الثلاثون: 30/30 موجودة بالاسم`);
      const added = models.filter((m) => !SPEC_MODELS.includes(m));
      passed.push(`جداول مضافة بقرارات محسومة: ${added.length} — ${added.join(" · ")}`);
    }

    // ⚠️ ثابت لا يُخرق: LedgerEntry و Invoice **لا يحملان deletedAt** —
    // الحذف الناعم عليهما يناقض append-only (R29) وحصانة الفاتورة (R35).
    for (const forbidden of ["LedgerEntry", "Invoice"]) {
      const block = new RegExp(`^model\\s+${forbidden}\\s*\\{([\\s\\S]*?)^\\}`, "mu").exec(schema);
      if (block && /^\s*deletedAt\s/mu.test(block[1]!)) {
        failures.push(`${forbidden} يحمل deletedAt — يناقض append-only (R29/R35 · S3)`);
      }
    }
    if (!failures.some((f) => f.includes("deletedAt"))) {
      passed.push("append-only محفوظ: لا deletedAt على LedgerEntry ولا Invoice");
    }

    const schemaEnums = new Map(
      enumBlocks.map((m) => [
        m[1]!,
        m[2]!
          .split(/\r?\n/)
          .map((line) => line.replace(/\/\/.*$/u, "").trim())
          .filter((line) => /^\w+$/u.test(line)),
      ]),
    );

    for (const [enumName, values] of Object.entries(ALL_ENUMS)) {
      const inSchema = schemaEnums.get(enumName);
      if (!inSchema) {
        failures.push(`enum «${enumName}» معرَّف في TypeScript ومفقود من schema.prisma`);
        continue;
      }
      const tsSet = new Set<string>(values);
      const dbSet = new Set(inSchema);
      const onlyTs = [...tsSet].filter((v) => !dbSet.has(v));
      const onlyDb = [...dbSet].filter((v) => !tsSet.has(v));
      if (onlyTs.length > 0) failures.push(`${enumName}: في TS ومفقود من المخطّط → ${onlyTs.join(",")}`);
      if (onlyDb.length > 0) failures.push(`${enumName}: في المخطّط ومفقود من TS → ${onlyDb.join(",")}`);
    }

    for (const enumName of schemaEnums.keys()) {
      if (!(enumName in ALL_ENUMS) && !ENUMS_DEFINED_ELSEWHERE.includes(enumName as never)) {
        failures.push(`enum «${enumName}» في المخطّط ولا تعريف له في lib/domain/enums.ts`);
      }
    }

    if (!failures.some((f) => f.includes("enum"))) {
      passed.push(`enums المخطّط تطابق TypeScript: ${schemaEnums.size}`);
    }
  }
}

// ── 6. التدفقات · الإجراءات · المسارات · القوالب ───────────────────────
{
  const flows = auditFlows();
  check("التدفقات §7", flows.total, EXPECTED.flows);
  if (flows.blocked > 0) pend("تدفقات محجوبة بقرارات", `${flows.blocked} من ${flows.total}`);

  const actions = auditActions();
  check("إجراءات §9.2", actions.fromSpec, EXPECTED.serverActions);
  if (actions.duplicates > 0) failures.push(`إجراءات مكرّرة: ${actions.duplicates}`);
  passed.push(
    `الإجراءات كاملةً: ${actions.total} = ${actions.fromSpec} من المواصفة + ${actions.fromAudit} كشفها التدقيق`,
  );
  if (actions.blocked.length > 0) {
    pend("إجراءات محجوبة بقرارات", `${actions.blocked.length}: ${actions.blocked.join(" · ")}`);
  }

  const routes = auditRoutes();
  check("مسارات §9.3", routes.fromSpec, EXPECTED.routeHandlers);
  passed.push(`المسارات كاملةً: ${routes.total} (‏+1 مسار صيانة كشفه Q40)`);
  if (routes.blocked.length > 0) {
    pend("مسارات محجوبة بقرارات", `${routes.blocked.length}: ${routes.blocked.join(" · ")}`);
  }

  const templates = auditTemplates();
  check("قوالب §7.12", templates.specCount, EXPECTED.notificationTemplates);
  if (templates.missingFromSpec.length > 0) {
    failures.push(`قوالب من §7.12 غير مُنفَّذة: ${templates.missingFromSpec.join(" · ")}`);
  }
  passed.push(
    `القوالب كاملةً: ${templates.total} = 12 من المواصفة + ${templates.added.length} (${templates.added.join(",")})`,
  );
}

// ── 7. متغيّرات البيئة ──────────────────────────────────────────────────
{
  const examplePath = resolve(process.cwd(), ".env.example");
  if (existsSync(examplePath)) {
    const vars = [...readFileSync(examplePath, "utf8").matchAll(/^([A-Z][A-Z0-9_]*)=/gmu)];
    check("متغيّرات البيئة في .env.example", vars.length, EXPECTED.envVars);
  } else {
    failures.push(".env.example مفقود");
  }
}

// ── التقرير ─────────────────────────────────────────────────────────────

console.log("\n═══ تدقيق الاكتمال ═══\n");

for (const line of passed) console.log(`  ✅ ${line}`);

if (pending.length > 0) {
  console.log("\n  ── معلَّق (لم يُبنَ بعد) ──");
  for (const line of pending) console.log(`  ⏳ ${line}`);
}

if (failures.length > 0) {
  console.log("\n  ── فشل (تناقض يجب إصلاحه) ──");
  for (const line of failures) console.log(`  ❌ ${line}`);
  console.log(`\n${failures.length} تناقض.\n`);
  process.exit(1);
}

console.log(`\n✅ لا تناقض. ${passed.length} فحصاً مرّ · ${pending.length} بنداً معلَّقاً.\n`);
