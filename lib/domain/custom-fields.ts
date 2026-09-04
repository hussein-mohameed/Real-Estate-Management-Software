import { z } from "zod";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  مخطّط الحقول المخصّصة — `Service.customFieldsSchema` (‏§4.13).
 * ═══════════════════════════════════════════════════════════════════════
 *
 * **هذا ما يجعل «خدمة جديدة بلا كود جديد» ممكناً.** المولّدة تحتاج «رقم
 * العداد» و«عدد الأمبيرات»، والحارس يحتاج «رقم الغرفة» — بلا أن يُكتب
 * حقلٌ في المخطّط لكل خدمة.
 *
 * ── لماذا يُتحقَّق **عند الحفظ** لا عند العرض ────────────────────────
 * ⚠️ العمود `Json` في Postgres يقبل **أي** شكل: مصفوفة، رقماً، `null`،
 * كائناً بمفاتيح عشوائية. فمخطّط مكسور يُحفظ بلا شكوى، ثم **ينفجر لاحقاً
 * في نموذج الاشتراك أمام المستخدم** — بعيداً عن الشاشة التي أدخلته
 * بأسابيع، وبلا أي أثر يربط السبب بالنتيجة.
 *
 * التحقّق هنا يجعل الخطأ يظهر **للأدمن الذي كتبه، في اللحظة التي كتبه
 * فيها، على الحقل الذي أخطأ فيه**.
 *
 * ── ولماذا `key` مقيَّد ─────────────────────────────────────────────
 * المفتاح يصير اسم حقل في نموذج HTML ومفتاحاً في `customFieldValues`.
 * مفتاح فيه مسافة أو نقطة أو حرف عربي يكسر الربط بين النموذج والقيمة
 * المحفوظة بطرق يصعب تشخيصها.
 */

export const CUSTOM_FIELD_TYPES = [
  "text",
  "number",
  "boolean",
  "select",
  "date",
] as const;

export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

const keyPattern = /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/;

const baseField = z.object({
  key: z
    .string()
    .regex(
      keyPattern,
      "المفتاح يبدأ بحرف لاتيني ويتكوّن من حروف وأرقام وشرطة سفلية فقط (٤٠ حرفاً كحدّ أقصى).",
    ),
  labelAr: z.string().trim().min(1, "التسمية العربية مطلوبة."),
  type: z.enum(CUSTOM_FIELD_TYPES),
  required: z.boolean().default(false),
  min: z.number().optional(),
  max: z.number().optional(),
  options: z.array(z.string().trim().min(1)).optional(),
  helpAr: z.string().trim().max(200).optional(),
});

export type CustomField = z.infer<typeof baseField>;

/**
 * ⚠️ **التوافقات بين الحقول تُفحَص، لا تُترك للنيّة.**
 * حقل `select` بلا خيارات يُعرض قائمةً فارغة لا يمكن تعبئتها، و`min`
 * أكبر من `max` يجعل الحقل مستحيل الملء. كلاهما يُحفظ بلا شكوى إن لم
 * يُفحص، ويظهر عند أول محاولة اشتراك.
 */
export const customFieldSchema = baseField.superRefine((f, ctx) => {
  if (f.type === "select") {
    if (!f.options || f.options.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["options"],
        message: `الحقل «${f.labelAr}» من نوع قائمة ويحتاج خياراً واحداً على الأقل.`,
      });
    } else if (new Set(f.options).size !== f.options.length) {
      ctx.addIssue({
        code: "custom",
        path: ["options"],
        message: `خيارات الحقل «${f.labelAr}» فيها تكرار.`,
      });
    }
  } else if (f.options && f.options.length > 0) {
    ctx.addIssue({
      code: "custom",
      path: ["options"],
      message: `الخيارات تُذكر لحقول القوائم فقط — «${f.labelAr}» ليس قائمة.`,
    });
  }

  // `min`/`max` معنيان للرقم وحده. على نصّ أو صندوق اختيار بيانٌ مضلّل.
  if (f.type !== "number" && (f.min !== undefined || f.max !== undefined)) {
    ctx.addIssue({
      code: "custom",
      path: ["min"],
      message: `الحدّان الأدنى والأعلى للحقول الرقمية فقط — «${f.labelAr}» ليس رقماً.`,
    });
  }

  if (f.min !== undefined && f.max !== undefined && f.min > f.max) {
    ctx.addIssue({
      code: "custom",
      path: ["max"],
      message: `الحدّ الأعلى للحقل «${f.labelAr}» أصغر من الأدنى.`,
    });
  }
});

/**
 * المخطّط كاملاً: مصفوفة حقول بمفاتيح فريدة.
 *
 * ⚠️ **المفتاح المكرّر أخطر ما هنا.** القيم تُحفظ في كائن واحد
 * (`customFieldValues`)، فالحقل الثاني بنفس المفتاح **يكتب فوق الأول
 * صامتاً**: يملأ المستخدم حقلين ويُحفظ واحد، ولا شيء يشير إلى الضياع.
 */
export const customFieldsSchema = z
  .array(customFieldSchema)
  .max(30, "الحدّ الأقصى ثلاثون حقلاً مخصّصاً للخدمة الواحدة.")
  .superRefine((fields, ctx) => {
    const keys = fields.map((f) => f.key);
    const seen = new Set<string>();
    for (const [i, k] of keys.entries()) {
      if (seen.has(k)) {
        ctx.addIssue({
          code: "custom",
          path: [i, "key"],
          message: `المفتاح «${k}» مكرّر — القيمة الثانية ستكتب فوق الأولى.`,
        });
      }
      seen.add(k);
    }
  });

/**
 * يبني مخطّط تحقّق **لقيم** الاشتراك من تعريف الحقول.
 *
 * ── لماذا يُبنى هنا لا في الواجهة ───────────────────────────────────
 * نموذج الاشتراك يرسم الحقول من نفس التعريف، لكن **الواجهة ليست حدّاً**:
 * الإجراء نقطة نهاية HTTP قابلة للاستدعاء مباشرةً. فالقيم تُتحقَّق على
 * الخادم بنفس التعريف الذي رُسم منه النموذج — مصدر واحد للاثنين.
 */
export function buildValuesSchema(fields: readonly CustomField[]) {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const f of fields) {
    let field: z.ZodTypeAny;

    switch (f.type) {
      case "number": {
        let n = z.coerce.number({ error: `«${f.labelAr}» يجب أن يكون رقماً.` });
        if (f.min !== undefined) {
          n = n.min(f.min, `«${f.labelAr}» لا يقلّ عن ${f.min}.`);
        }
        if (f.max !== undefined) {
          n = n.max(f.max, `«${f.labelAr}» لا يزيد عن ${f.max}.`);
        }
        field = n;
        break;
      }
      case "boolean":
        // نموذج HTML يرسل "on" أو لا يرسل شيئاً — لا `true`/`false`
        field = z.union([z.boolean(), z.literal("on"), z.literal("")]).transform((v) => v === true || v === "on");
        break;
      case "date":
        field = z.coerce.date({ error: `«${f.labelAr}» تاريخ غير صالح.` });
        break;
      case "select":
        field = z.enum((f.options ?? []) as [string, ...string[]], {
          error: `«${f.labelAr}» قيمة غير مسموحة.`,
        });
        break;
      case "text":
      default:
        field = z.string().trim().max(500);
        break;
    }

    /**
     * ⚠️ الاختياري يقبل الفراغ **ويُحوّله إلى غياب**.
     * حقل نصّي فارغ في نموذج HTML يصل كسلسلة فارغة لا كـ`undefined`،
     * فيُحفظ `""` ويبدو مملوءاً في كل عرض لاحق.
     */
    if (!f.required) {
      field = z.preprocess(
        (v) => (v === "" || v === null || v === undefined ? undefined : v),
        field.optional(),
      );
    } else if (f.type === "text") {
      field = z.string().trim().min(1, `«${f.labelAr}» مطلوب.`).max(500);
    }

    shape[f.key] = field;
  }

  // ⚠️ `strict` مقصود: قيمة بمفتاح ليس في التعريف تُرفض ولا تُتجاهَل.
  // التجاهل يخفي نموذجاً قديماً يرسل حقلاً حُذف من الخدمة.
  return z.object(shape).strict();
}

/** يقرأ المخطّط المحفوظ من العمود `Json` بأمان — أي شكل غير صالح ← []. */
export function parseStoredFields(raw: unknown): CustomField[] {
  const parsed = customFieldsSchema.safeParse(raw ?? []);
  return parsed.success ? parsed.data : [];
}
