/**
 * توليد مخطّط العلاقات من `schema.prisma` نفسه.
 *
 * ── لماذا يُولَّد ولا يُرسم ────────────────────────────────────────────
 * مخطّط مرسوم بيد يتفرّق عن المخطّط الفعلي عند أول تعديل، ثم يُقرأ لاحقاً
 * على أنه الحقيقة فيُبنى عليه قرار خاطئ. هنا هو **مشتقّ**، و`npm run erd`
 * يعيد توليده — فإن اختلف عن آخر نسخة ملتزمة ظهر الفرق في المراجعة.
 *
 * ── لماذا مجزّأ ──────────────────────────────────────────────────────
 * ‏35 جدولاً و59 علاقة في رسم واحد كتلة غير مقروءة. المخطّط الذي لا يُقرأ
 * لا قيمة له. لذلك: نظرة عامة للمحاور، ثم رسم لكل مجموعة مجال.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

interface Field {
  name: string;
  type: string;
  optional: boolean;
  list: boolean;
  attrs: string;
}

interface Model {
  name: string;
  fields: Field[];
}

function parseSchema(source: string): { models: Model[]; enums: Map<string, string[]> } {
  const models: Model[] = [];
  const enums = new Map<string, string[]>();

  for (const m of source.matchAll(/^enum\s+(\w+)\s*\{([\s\S]*?)^\}/gmu)) {
    const values = m[2]!
      .split(/\r?\n/)
      .map((l) => l.replace(/\/\/.*$/u, "").trim())
      .filter((l) => /^\w+$/u.test(l));
    enums.set(m[1]!, values);
  }

  for (const m of source.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gmu)) {
    const fields: Field[] = [];
    for (const raw of m[2]!.split(/\r?\n/)) {
      const line = raw.replace(/\/\/.*$/u, "").trim();
      if (!line || line.startsWith("@@")) continue;
      const f = /^(\w+)\s+(\w+)(\[\])?(\?)?\s*(.*)$/u.exec(line);
      if (!f) continue;
      fields.push({
        name: f[1]!,
        type: f[2]!,
        list: f[3] === "[]",
        optional: f[4] === "?",
        attrs: f[5] ?? "",
      });
    }
    models.push({ name: m[1]!, fields });
  }

  return { models, enums };
}

/** المجموعات كما في §4 — الترتيب هو ترتيب الاعتماد: كلٌّ يعتمد على ما قبله. */
const GROUPS: Array<{ ar: string; models: string[] }> = [
  { ar: "الإعدادات", models: ["CompoundSettings", "Setting", "Counter"] },
  {
    ar: "الهوية والتنظيم",
    models: ["User", "ResidentProfile", "StaffProfile", "Vendor", "Department", "DepartmentTask", "Skill", "StaffSkill", "LoginLink", "OtpCode", "RateLimitHit"],
  },
  { ar: "العقار", models: ["Building", "FloorUnitsOverride", "Apartment", "ApartmentResident"] },
  { ar: "العقود والأقساط", models: ["Contract", "InstallmentPlan", "Installment"] },
  { ar: "الخدمات والاشتراكات", models: ["Service", "Subscription"] },
  { ar: "المال", models: ["Account", "LedgerEntry", "Payment", "Invoice"] },
  { ar: "الوصول", models: ["Vehicle", "Badge"] },
  { ar: "الطلبات", models: ["ServiceRequest", "RequestComment", "ResidentRequest"] },
  { ar: "العرضية", models: ["Attachment", "Notification", "AuditLog"] },
];

const SCALARS = new Set(["String", "Int", "BigInt", "Boolean", "DateTime", "Decimal", "Json", "Float", "Bytes"]);

function isRelation(field: Field, models: Model[], enums: Map<string, string[]>): boolean {
  return !SCALARS.has(field.type) && !enums.has(field.type) && models.some((m) => m.name === field.type);
}

/** علاقة موجَّهة: من الجدول الذي يحمل المفتاح الأجنبي إلى الهدف. */
interface Relation {
  from: string;
  to: string;
  optional: boolean;
  via: string;
}

function relationsOf(models: Model[], enums: Map<string, string[]>): Relation[] {
  const out: Relation[] = [];
  for (const model of models) {
    for (const field of model.fields) {
      if (field.list) continue; // الجانب الآخر يحملها
      if (!isRelation(field, models, enums)) continue;
      if (!field.attrs.includes("@relation") || !field.attrs.includes("fields:")) continue;
      out.push({ from: model.name, to: field.type, optional: field.optional, via: field.name });
    }
  }
  return out;
}

function mermaidFor(models: Model[], relations: Relation[], include: Set<string>, withFields: boolean): string {
  const lines = ["erDiagram"];

  if (withFields) {
    for (const model of models.filter((m) => include.has(m.name))) {
      const shown = model.fields.filter(
        (f) => SCALARS.has(f.type) || f.attrs.includes("@id") || f.attrs.includes("@unique"),
      );
      lines.push(`  ${model.name} {`);
      for (const f of shown.slice(0, 14)) {
        const mark = f.attrs.includes("@id") ? "PK" : f.attrs.includes("@unique") ? "UK" : "";
        lines.push(`    ${f.type}${f.optional ? "_nullable" : ""} ${f.name} ${mark}`.trimEnd());
      }
      if (shown.length > 14) lines.push(`    _ ويتبقّى_${shown.length - 14}_حقلاً`);
      lines.push("  }");
    }
  }

  for (const r of relations) {
    if (!include.has(r.from) || !include.has(r.to)) continue;
    // الهدف واحد؛ المصدر متعدّد. الاختيارية على طرف الهدف.
    const left = r.optional ? "|o" : "||";
    lines.push(`  ${r.to} ${left}--o{ ${r.from} : "${r.via}"`);
  }

  return lines.join("\n");
}

// ── التوليد ─────────────────────────────────────────────────────────────

const schemaPath = resolve(process.cwd(), "prisma/schema.prisma");
const { models, enums } = parseSchema(readFileSync(schemaPath, "utf8"));
const relations = relationsOf(models, enums);

const grouped = new Set(GROUPS.flatMap((g) => g.models));
const ungrouped = models.filter((m) => !grouped.has(m.name)).map((m) => m.name);
if (ungrouped.length > 0) {
  console.error(`❌ جداول خارج كل المجموعات: ${ungrouped.join(" · ")}`);
  console.error("   أضفها إلى GROUPS — جدول بلا مجموعة يختفي من المخطّط بصمت.");
  process.exit(1);
}

const CORE = new Set([
  "User", "Building", "Apartment", "ApartmentResident", "Contract",
  "Account", "LedgerEntry", "Payment", "Invoice",
  "Service", "Subscription", "Vehicle", "Badge", "ServiceRequest",
  "InstallmentPlan", "Installment",
]);

const parts: string[] = [];

parts.push(`# مخطّط العلاقات

> **مُولَّد من \`prisma/schema.prisma\`** — لا يُحرَّر بيد. أعد التوليد بـ\`npm run erd\`.
> **آخر توليد:** ${new Date().toISOString().slice(0, 10)}
> **الإحصاء:** ${models.length} جدولاً · ${enums.size} نوعاً · ${relations.length} علاقة موجَّهة.

## كيف يُقرأ

\`A ||--o{ B\` تعني: **B يحمل المفتاح الأجنبي** إلى A. الاسم على السهم هو حقل العلاقة.
\`|o\` بدل \`||\` تعني أن المفتاح **قابل لـnull** — أي أن الصف قد يوجد بلا هذا الربط، وهذا في حدّ ذاته قرار مجال لا تفصيل تقني.

---

## النظرة العامة — المحاور الأربعة

هذه الكيانات الستة عشر هي ما يجري عليه العمل يومياً. الباقي مرجعي أو عرضي.

\`\`\`mermaid
${mermaidFor(models, relations, CORE, false)}
\`\`\`

**ثلاث حقائق يقولها هذا الرسم وحده:**

1. **\`Account\` يتدلّى من \`Contract\` لا من \`Apartment\`.** هذا المبدأ 3 مرسوماً: مالك جديد أو مستأجر جديد **لا يرث** رصيد سابقه أبداً.
2. **\`Apartment\` له \`Contract\` متعدّد.** بعد \`S1\`/\`D1\` يجوز عقد بيع وعقد إيجار نشطان معاً — «شقة مباعة يسكنها مستأجر». والفهرس الفريد الجزئي هو ما يمنع الثاني **من نفس النوع**.
3. **\`LedgerEntry\` يشير إلى أربعة مصادر** (\`Subscription\` · \`Installment\` · \`Badge\` · \`Payment\`) وكلها **قابلة لـnull** — لأن القيد قد يكون يدوياً أو افتتاحياً بلا أي مصدر منها.
`);

for (const group of GROUPS) {
  const include = new Set(group.models);
  parts.push(`
---

## ${group.ar}

\`\`\`mermaid
${mermaidFor(models, relations, include, true)}
\`\`\`
`);
}

parts.push(`
---

## الأنواع المعدودة (${enums.size})

${[...enums.entries()]
  .map(([name, values]) => `- **\`${name}\`** — ${values.join(" · ")}`)
  .join("\n")}
`);

const out = resolve(process.cwd(), "docs/06-ERD.md");
writeFileSync(out, parts.join("\n"));
console.log(`✅ docs/06-ERD.md — ${models.length} جدولاً · ${enums.size} نوعاً · ${relations.length} علاقة`);
console.log(`   ${GROUPS.length} مجموعة · كل جدول مُسنَد إلى مجموعة`);
