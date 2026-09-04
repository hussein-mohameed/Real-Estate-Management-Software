/**
 * تدقيق تسمية المال — تعريف إنجاز الخطوة 0.4.
 *
 * يمسح schema.prisma ويرفض أي حقل يبدو مالياً ولا يحترم الثابتين:
 *   1. الاسم ينتهي بـ`Iqd`
 *   2. النوع `BigInt`
 *
 * المبدأ 4 و10-money-invariants: لا Float، لا Decimal، لا number للمال.
 * الاستثناء الوحيد المسموح `areaSqm` — مساحة لا مال.
 *
 * يعمل بلا قاعدة بيانات، فيصلح لـCI منذ اليوم الأول.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SCHEMA = resolve(process.cwd(), "prisma/schema.prisma");

/** كلمات تدلّ على أن الحقل مالي. */
const MONEY_HINT = /(price|amount|fee|total|balance|payment|cost|salary|revenue)/i;

/**
 * لواحق تدلّ على أن الحقل **ليس مبلغاً** مهما حوى اسمه كلمة مالية:
 * `waylPaymentUrl` رابط · `paymentId` مفتاح · `paidAt` تاريخ ·
 * `paymentType` enum · `installmentsCount` عدّ.
 *
 * استثناء باللاحقة أدقّ من استثناء بالاسم: القائمة بالأسماء تتقادم مع أول
 * حقل جديد، واللاحقة تصف **نوع الشيء** فتبقى صحيحة.
 */
const NON_MONEY_SUFFIX =
  /(Url|Id|At|Type|Status|Count|Method|Key|Note|Notes|Payload|Number|Prefix|Reason|Hash|Cycle|Day|Days|Percentage|Sqm)$/;

/** استثناء وحيد بالاسم: مساحة لا مال — الاستخدام الوحيد المسموح لـDecimal. */
const ALLOWED_NON_MONEY = new Set(["areaSqm"]);

interface Violation {
  line: number;
  model: string;
  field: string;
  type: string;
  reason: string;
}

function audit(): Violation[] {
  const source = readFileSync(SCHEMA, "utf8");
  const lines = source.split(/\r?\n/);
  const violations: Violation[] = [];
  let model = "";

  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (line.startsWith("//")) return;

    const modelMatch = /^model\s+(\w+)\s*\{/.exec(line);
    if (modelMatch) {
      model = modelMatch[1]!;
      return;
    }
    if (line === "}") {
      model = "";
      return;
    }
    if (!model) return;

    const fieldMatch = /^(\w+)\s+(\w+)(\[\])?(\?)?/.exec(line);
    if (!fieldMatch) return;

    const [, field, type] = fieldMatch as unknown as [string, string, string];
    if (ALLOWED_NON_MONEY.has(field)) return;
    if (NON_MONEY_SUFFIX.test(field)) return;
    if (!MONEY_HINT.test(field)) return;

    // المفاتيح الأجنبية والعلاقات ليست مبالغ
    if (type === "String" && /Id$/.test(field)) return;
    if (/^[A-Z]/.test(type) && !["BigInt", "Int", "Float", "Decimal", "String"].includes(type)) return;

    const endsWithIqd = field.endsWith("Iqd");
    const isBigInt = type === "BigInt";

    if (!endsWithIqd) {
      violations.push({
        line: index + 1, model, field, type,
        reason: "حقل مالي واسمه لا ينتهي بـ`Iqd`",
      });
    } else if (!isBigInt) {
      violations.push({
        line: index + 1, model, field, type,
        reason: `حقل مالي بنوع \`${type}\` — يجب أن يكون \`BigInt\``,
      });
    }
  });

  return violations;
}

const violations = audit();

if (violations.length === 0) {
  console.log("✅ تدقيق تسمية المال: لا مخالفات.");
  process.exit(0);
}

console.error(`❌ تدقيق تسمية المال: ${violations.length} مخالفة\n`);
for (const v of violations) {
  console.error(`  prisma/schema.prisma:${v.line}  ${v.model}.${v.field}: ${v.type}`);
  console.error(`      ${v.reason}\n`);
}
process.exit(1);
