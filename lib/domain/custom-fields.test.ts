import { describe, expect, it } from "vitest";
import {
  buildValuesSchema,
  customFieldsSchema,
  parseStoredFields,
} from "./custom-fields";

/**
 * الخطوة 2.1 — «نموذج الاشتراك يبني حقوله من المخطّط دون كود مخصّص».
 *
 * ⚠️ العمود `Json` يقبل أي شكل، فمخطّط مكسور يُحفظ بلا شكوى وينفجر لاحقاً
 * في نموذج الاشتراك أمام المستخدم — بعيداً عن الشاشة التي أدخلته. كل ما
 * هنا يقع **عند الحفظ**.
 */

/** ⚠️ `Record<string, unknown>` مقصود: الاختبار يمرّر أشكالاً **غير صالحة**
 *  عمداً، والنوع الصارم كان سيمنع كتابة الاختبار الذي يثبت الرفض. */
const field = (over: Record<string, unknown> = {}): unknown => ({
  key: "meterNumber",
  labelAr: "رقم العداد",
  type: "text",
  ...over,
});

describe("تعريف الحقول — الشكل", () => {
  it("مثال §4.13 الحرفي يمرّ", () => {
    const r = customFieldsSchema.safeParse([
      { key: "meterNumber", labelAr: "رقم العداد", type: "text", required: false },
      { key: "amperes", labelAr: "عدد الأمبيرات", type: "number", required: true, min: 1, max: 30 },
    ]);
    expect(r.success).toBe(true);
  });

  it("مصفوفة فارغة صالحة — خدمة بلا حقول مخصّصة", () => {
    expect(customFieldsSchema.safeParse([]).success).toBe(true);
  });

  it("نوع غير معروف مرفوض", () => {
    expect(customFieldsSchema.safeParse([field({ type: "file" })]).success).toBe(false);
  });

  it("تسمية عربية فارغة مرفوضة", () => {
    expect(customFieldsSchema.safeParse([field({ labelAr: "  " })]).success).toBe(false);
  });
});

describe("المفتاح — لأنه يصير اسم حقل HTML ومفتاح قيمة", () => {
  it.each([
    ["meter number", "مسافة"],
    ["meter.number", "نقطة"],
    ["رقم", "حروف عربية"],
    ["1meter", "يبدأ برقم"],
    ["", "فارغ"],
  ])("«%s» مرفوض (%s)", (key) => {
    expect(customFieldsSchema.safeParse([field({ key })]).success).toBe(false);
  });

  it("🔴 **المفتاح المكرّر مرفوض** — القيمة الثانية تكتب فوق الأولى", () => {
    const r = customFieldsSchema.safeParse([
      field({ key: "amp", labelAr: "أ" }),
      field({ key: "amp", labelAr: "ب" }),
    ]);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(JSON.stringify(r.error.issues)).toContain("مكرّر");
  });
});

describe("التوافقات بين خصائص الحقل", () => {
  it("قائمة بلا خيارات مرفوضة — تُعرَض فارغة لا يمكن ملؤها", () => {
    const r = customFieldsSchema.safeParse([field({ type: "select" })]);
    expect(r.success).toBe(false);
  });

  it("قائمة بخيارات مكرّرة مرفوضة", () => {
    const r = customFieldsSchema.safeParse([
      field({ type: "select", options: ["أ", "أ"] }),
    ]);
    expect(r.success).toBe(false);
  });

  it("خيارات على حقل ليس قائمة مرفوضة", () => {
    const r = customFieldsSchema.safeParse([field({ type: "text", options: ["أ"] })]);
    expect(r.success).toBe(false);
  });

  it("حدّان على حقل ليس رقماً مرفوضان", () => {
    const r = customFieldsSchema.safeParse([field({ type: "text", min: 1 })]);
    expect(r.success).toBe(false);
  });

  it("الحدّ الأعلى أصغر من الأدنى مرفوض", () => {
    const r = customFieldsSchema.safeParse([
      field({ type: "number", labelAr: "الأمبير", min: 10, max: 5 }),
    ]);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(JSON.stringify(r.error.issues)).toContain("أصغر من الأدنى");
  });

  it("أكثر من ثلاثين حقلاً مرفوض", () => {
    const many = Array.from({ length: 31 }, (_, i) => field({ key: `f${i}` }));
    expect(customFieldsSchema.safeParse(many).success).toBe(false);
  });
});

describe("مخطّط القيم المبنيّ من التعريف", () => {
  const fields = customFieldsSchema.parse([
    { key: "meterNumber", labelAr: "رقم العداد", type: "text", required: false },
    { key: "amperes", labelAr: "عدد الأمبيرات", type: "number", required: true, min: 1, max: 30 },
    { key: "phase", labelAr: "الطور", type: "select", required: true, options: ["أحادي", "ثلاثي"] },
    { key: "hasBackup", labelAr: "يوجد احتياطي", type: "boolean", required: false },
  ]);
  const schema = buildValuesSchema(fields);

  it("قيم صالحة تمرّ، والأرقام تُحوَّل من نصّ النموذج", () => {
    const r = schema.safeParse({
      meterNumber: "A-1234",
      amperes: "5", // نموذج HTML يرسل نصّاً
      phase: "ثلاثي",
      hasBackup: "on", // صندوق اختيار مؤشَّر
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data["amperes"]).toBe(5);
    expect(r.data["hasBackup"]).toBe(true);
  });

  it("المطلوب الغائب مرفوض برسالة عربية تسمّي الحقل", () => {
    const r = schema.safeParse({ phase: "أحادي" });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(JSON.stringify(r.error.issues)).toContain("عدد الأمبيرات");
  });

  it("الرقم خارج المدى مرفوض", () => {
    const r = schema.safeParse({ amperes: "99", phase: "أحادي" });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(JSON.stringify(r.error.issues)).toContain("لا يزيد عن 30");
  });

  it("خيار خارج القائمة مرفوض", () => {
    const r = schema.safeParse({ amperes: "5", phase: "رباعي" });
    expect(r.success).toBe(false);
  });

  it("⚠️ الاختياري الفارغ **يُحوَّل إلى غياب** لا يُحفظ سلسلةً فارغة", () => {
    // "" يبدو مملوءاً في كل عرض لاحق، ولا يمكن تمييزه عن قيمة حقيقية
    const r = schema.safeParse({ meterNumber: "", amperes: "5", phase: "أحادي" });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data["meterNumber"]).toBeUndefined();
    /**
     * ⚠️ المفتاح **يبقى موجوداً بقيمة `undefined`** — هذا سلوك zod مع
     * `preprocess` + `optional`، وكنت أتوقّع غيابه. لا أثر له عملياً:
     * `JSON.stringify` يُسقط المفاتيح ذات القيمة `undefined`، والقيم
     * تُحفظ في عمود `Json`. ما يهمّ أن المحفوظ ليس `""`.
     */
    expect(JSON.parse(JSON.stringify(r.data))).not.toHaveProperty("meterNumber");
  });

  it("صندوق اختيار غير مؤشَّر = false لا خطأ", () => {
    const r = schema.safeParse({ amperes: "5", phase: "أحادي" });
    expect(r.success).toBe(true);
  });

  it("🔴 مفتاح ليس في التعريف **يُرفض ولا يُتجاهَل**", () => {
    /**
     * التجاهل يخفي نموذجاً قديماً يرسل حقلاً حُذف من الخدمة: يملأه
     * المستخدم ويضيع، ولا شيء يشير إلى ذلك.
     */
    const r = schema.safeParse({ amperes: "5", phase: "أحادي", oldField: "قيمة" });
    expect(r.success).toBe(false);
  });

  it("تعريف فارغ يعني نموذجاً بلا حقول — لا خطأ", () => {
    const empty = buildValuesSchema([]);
    expect(empty.safeParse({}).success).toBe(true);
    expect(empty.safeParse({ x: 1 }).success).toBe(false);
  });
});

describe("قراءة المخطّط المحفوظ من عمود Json", () => {
  it("الشكل الصالح يُقرأ", () => {
    expect(parseStoredFields([{ key: "a", labelAr: "أ", type: "text" }])).toHaveLength(1);
  });

  it.each([[null], [undefined], [{}], ["نص"], [42], [[{ bad: true }]]])(
    "الشكل غير الصالح %s ← مصفوفة فارغة لا انهيار",
    (raw) => {
      expect(parseStoredFields(raw)).toEqual([]);
    },
  );
});
