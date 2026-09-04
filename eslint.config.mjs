import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * قواعد هذا المشروع ليست تفضيلات أسلوب — كل واحدة منها تمنع عيباً موصوفاً
 * في المستندات. الاعتماد على انتباه المراجع البشري يفشل في المراجعة الخمسين.
 */

/** RTL: خصائص Tailwind الاتجاهية ممنوعة، المنطقية فقط (‏§11.1 · 6.4). */
/*
 * ⚠️ كان النمط السابق يطابق كلمة `right` أو `left` **مجرّدة**، فرفض
 * `side="right"` — وهي قيمة خاصيّة في واجهة مكوّن، لا صنف Tailwind.
 * التمييز هنا صريح: الأصناف ذات القيمة تلزمها شرطة (`pl-4`)، والأصناف
 * القائمة بذاتها تُذكر بأسمائها كاملة (`text-left`, `border-r`).
 */
const RTL_FORBIDDEN = String.raw`/(?:^|\s|:)-?(?:(?:ml|mr|pl|pr|left|right|border-l|border-r|rounded-l|rounded-r)-|text-(?:left|right)\b|(?:border|rounded)-[lr]\b)/u`;

const rtlRule = {
  selector: `Literal[value=${RTL_FORBIDDEN}]`,
  message:
    "RTL: استخدم الخصائص المنطقية (ms-* me-* ps-* pe-* start-* end-* border-s-* text-start) — الاتجاهية ممنوعة (§11.1).",
};

const rtlTemplateRule = {
  selector: `TemplateElement[value.raw=${RTL_FORBIDDEN}]`,
  message:
    "RTL: استخدم الخصائص المنطقية (ms-* me-* ps-* pe-* start-* end-*) — الاتجاهية ممنوعة (§11.1).",
};

/** الدفتر: مسار كتابة واحد فقط هو postEntry() في lib/ledger. */
const ledgerWriteRule = {
  selector:
    "CallExpression > MemberExpression[object.property.name='ledgerEntry'][property.name=/^(create|createMany|createManyAndReturn|update|updateMany|upsert|delete|deleteMany)$/]",
  message:
    "الدفتر append-only بمسار كتابة وحيد: نادِ postEntry() من lib/ledger. الكتابة المباشرة على ledgerEntry تكسر ثابت الرصيد (‏R29 · 10-money-invariants).",
};

/**
 * الرصيد المُكاش لا يُكتب إلا داخل معاملة postEntry.
 *
 * ⚠️ **كانت القاعدة تحجب `account.update` كلياً** — أي شمولاً يمنع أيضاً
 * إغلاق الحساب (`status`/`closedAt`) وهو لا يمسّ الرصيد. والشمول الذي
 * يعترض عملاً مشروعاً يُقابَل بـ`eslint-disable`، فيتآكل حتى يزول.
 *
 * الآن تُصيب ما تقصده بالضبط: كتابةٌ تذكر `balanceIqd`، أو كتابةٌ تنشر
 * كائناً (`...data`) لا يمكن التحقّق من محتواه ساكناً — فقد يهرّب الرصيد.
 */
const balanceWriteRule = {
  selector:
    "CallExpression[callee.object.property.name='account'][callee.property.name=/^(update|updateMany|upsert)$/]:has(Property[key.name='balanceIqd'])",
  message:
    "balanceIqd يُعاد حسابه داخل معاملة postEntry() وحدها مع قفل صف. لا تكتبه من خارج lib/ledger (‏R29).",
};

/**
 * الميلاد وحده مستثنى — وبصفر فقط.
 *
 * ‏R15 يوجب أن يفتح تفعيلُ العقد حسابه، و`postEntry` لا يُنشئ حسابات. لكن
 * إنشاءه برصيد افتتاحي غير صفري يخلق مالاً بلا قيد يفسّره، فينكسر ثابت
 * «الرصيد = مجموع القيود» من اللحظة الأولى ولا يكشفه كاشف الانحراف — لأن
 * الانحراف وُلد مع الحساب.
 */
const balanceSeedRule = {
  selector:
    "CallExpression[callee.object.property.name='account'][callee.property.name=/^(create|createMany)$/]:has(Property[key.name='balanceIqd']):not(:has(Property[key.name='balanceIqd'] > Literal[bigint='0']))",
  message:
    "الحساب يُفتح برصيد صفر فقط (‏R15). أي رصيد افتتاحي غير صفري مالٌ بلا قيد يفسّره — راجع N3/B1.",
};

/** نشرُ كائن في كتابة Account يُخفي ما يُكتب — فلا يمكن إثبات سلامة الرصيد. */
const balanceSpreadRule = {
  selector:
    "CallExpression[callee.object.property.name='account'][callee.property.name=/^(update|updateMany|upsert|create|createMany)$/]:has(SpreadElement)",
  message:
    "لا تنشر كائناً في كتابة Account: المحتوى غير قابل للفحص ساكناً، فقد يحمل balanceIqd. اذكر الحقول صراحةً.",
};

/** الفواتير حصينة بعد الإصدار (‏R35). */
const invoiceMutationRule = {
  selector:
    "CallExpression > MemberExpression[object.property.name='invoice'][property.name=/^(update|updateMany|upsert|delete|deleteMany)$/]",
  message:
    "الفاتورة غير قابلة للتعديل بعد الإصدار (‏R35). الإلغاء يكون بقيد معاكس لا بتعديل.",
};

/** التوقيت: حدود الفترات المالية لا تُحسب بمنطقة الخادم. */
const rawDateRule = {
  selector: "NewExpression[callee.name='Date'][arguments.length=0]",
  message:
    "لا تستدعِ new Date() في كود المجال. استخدم lib/dates — حدود الفترات المالية بتوقيت Asia/Baghdad، وحسابها بمنطقة الخادم يُنتج قيوداً في الشهر الخطأ.",
};

/** المال: لا تنسيق خارج <Money> / formatIqd. */
const moneyFormatRule = {
  selector:
    "CallExpression > MemberExpression[property.name='toLocaleString']",
  message:
    "تنسيق المال يمرّ بـformatIqd() ومكوّن <Money> وحدهما (‏§11.1).",
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "lib/generated/**",
  ]),

  // ── كل الكود: RTL + التوقيت + تنسيق المال ────────────────────────
  {
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        rtlRule,
        rtlTemplateRule,
        ledgerWriteRule,
        balanceWriteRule,
        balanceSeedRule,
        balanceSpreadRule,
        invoiceMutationRule,
        moneyFormatRule,
      ],
    },
  },

  // ── مكوّنات shadcn/ui المستوردة ───────────────────────────────────
  //
  // كود يُنسَخ من أعلى المجرى، وفيه اتجاهات **فيزيائية مشروعة**: توسيط
  // الحوار بـ`left-[50%]` متماثل، ومتغيّرا `side` في Sheet يحدّدان حافة
  // الشاشة فعلاً لا جهة المنطق. القاعدة العامة لا تفرّق بين هذه وبين
  // خطأ اتجاه حقيقي.
  //
  // ⚠️ ليس تخفيفاً بلا بديل: `tests/unit/ui-rtl.test.ts` يفحص هذه
  // الملفات بقائمة استثناءات **صريحة ومحصورة**، ويفشل عند أي اتجاه
  // فيزيائي خارجها — بما في ذلك ما يعيده `shadcn add` مستقبلاً.
  {
    files: ["components/ui/**/*.tsx"],
    rules: {
      "no-restricted-syntax": ["error", moneyFormatRule],
    },
  },

  // ── كود المجال: ممنوع any صراحةً (‏§2.1) ──────────────────────────
  {
    files: ["lib/**/*.ts", "app/**/actions.ts", "app/**/actions/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unsafe-assignment": "off",
    },
  },

  // ── منطق المجال الخالص: ممنوع new Date() ─────────────────────────
  {
    files: ["lib/domain/**/*.ts", "lib/services/**/*.ts", "lib/ledger/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        rtlRule,
        rtlTemplateRule,
        ledgerWriteRule,
        balanceWriteRule,
        balanceSeedRule,
        balanceSpreadRule,
        invoiceMutationRule,
        moneyFormatRule,
        rawDateRule,
      ],
    },
  },

  // ── lib/ledger هو صاحب الاستثناء: هو المسار الوحيد المسموح ────────
  {
    files: ["lib/ledger/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        rtlRule,
        rtlTemplateRule,
        moneyFormatRule,
        rawDateRule,
      ],
    },
  },

  // ── وحدة المال والتواريخ تحتاج التنسيق والوقت الحقيقي ────────────
  {
    files: ["lib/money.ts", "lib/dates.ts", "lib/money/**/*.ts", "lib/dates/**/*.ts"],
    rules: {
      "no-restricted-syntax": ["error", rtlRule, rtlTemplateRule],
    },
  },

  // ── الاختبارات والسكربتات: قيود أخف ───────────────────────────────
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "scripts/**/*.ts", "prisma/**/*.ts"],
    rules: {
      "no-restricted-syntax": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
]);

export default eslintConfig;
