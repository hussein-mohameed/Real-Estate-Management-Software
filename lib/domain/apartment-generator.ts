import type { NumberingScheme } from "./enums";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  مولّد الشقق (‏§4.8) — دالة **نقية** مفصولة عن أي كتابة لقاعدة البيانات.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── أهمّ قرار هوية في النظام ─────────────────────────────────────────
 * `PER_FLOOR` يُنتج أرقام وحدات **مكرَّرة** بين الطوابق. لذلك
 * **`unitNumber` وحده ليس مفتاحاً فريداً أبداً**:
 *   • المفتاح الفريد هو `(buildingId, floorNumber, unitNumber)`
 *   • و`displayNumber` فريد داخل البناية، وهو ما يراه الناس ويبحثون به
 * أي شاشة تعتمد على `unitNumber` وحده **ستخلط شقتين** في بناية
 * `PER_FLOOR` — وهو خطأ لا يظهر في الاختبار إن جُرِّب على `SEQUENTIAL` فقط.
 *
 * ── لماذا نقية ──────────────────────────────────────────────────────
 * توليد 200 شقة بقالب خاطئ يُصلَح بحذفها وإعادة التوليد — إن كان التوليد
 * قابلاً للتشغيل والفحص بلا قاعدة بيانات. والمعاينة الحيّة في الواجهة
 * تستدعي **نفس** هذه الدالة، فما يراه الأدمن قبل الحفظ هو ما سيُحفظ حرفياً.
 */

export interface BuildingSpec {
  code: string;
  floorsCount: number;
  /** العدد الافتراضي لكل طابق. */
  unitsPerFloor: number;
  numberingScheme: NumberingScheme;
  /** الرموز: `{building}` · `{floor}` · `{unit}` · `{seq}` */
  displayNumberFormat: string;
  /**
   * ‏Q43: «الطوابق الفردية قد تختلف» وعد في §4.8، والخوارزمية تستعمل
   * `unitsPerFloor` موحّداً. هذه التجاوزات تفي بالوعد.
   */
  floorOverrides?: ReadonlyMap<number, number>;
}

export interface GeneratedApartment {
  floorNumber: number;
  unitNumber: number;
  displayNumber: string;
  /** التسلسل عبر البناية — يُستعمل في رمز `{seq}` فقط. */
  seq: number;
}

export type GeneratorError =
  | "floors-invalid"
  | "units-invalid"
  | "format-empty"
  | "format-no-token"
  | "override-floor-out-of-range"
  | "override-units-invalid"
  | "duplicate-display-number";

export type GeneratorResult =
  | { ok: true; apartments: GeneratedApartment[] }
  | { ok: false; reason: GeneratorError; messageAr: string };

const MESSAGES: Record<GeneratorError, string> = {
  "floors-invalid": "عدد الطوابق يجب أن يكون عدداً صحيحاً لا يقلّ عن 1.",
  "units-invalid": "عدد الوحدات في الطابق يجب أن يكون عدداً صحيحاً لا يقلّ عن 1.",
  "format-empty": "قالب رقم العرض مطلوب.",
  "format-no-token":
    "قالب رقم العرض لا يحتوي أي رمز متغيّر — كل الشقق ستحمل نفس الرقم. الرموز: {building} {floor} {unit} {seq}",
  "override-floor-out-of-range": "رقم طابق في التجاوزات خارج نطاق البناية.",
  "override-units-invalid": "عدد الوحدات في التجاوز يجب أن يكون عدداً صحيحاً لا يقلّ عن 1.",
  "duplicate-display-number":
    "القالب يُنتج أرقام عرض مكرَّرة داخل البناية. أضف {floor} أو {seq} لتمييزها.",
};

/** يملأ رموز القالب. غير المعروف يبقى كما هو ليظهر الخطأ للأدمن. */
export function renderDisplayNumber(
  format: string,
  values: { building: string; floor: number; unit: number; seq: number },
): string {
  return format
    .replace(/\{building\}/gu, values.building)
    .replace(/\{floor\}/gu, String(values.floor))
    .replace(/\{unit\}/gu, String(values.unit))
    .replace(/\{seq\}/gu, String(values.seq));
}

function unitsOnFloor(spec: BuildingSpec, floor: number): number {
  return spec.floorOverrides?.get(floor) ?? spec.unitsPerFloor;
}

/**
 * التوليد.
 *
 * `SEQUENTIAL` — الترقيم يجري متّصلاً عبر البناية: ط1 ← 1,2,3,4 · ط2 ← 5,6,7,8
 * `PER_FLOOR`  — يبدأ من جديد كل طابق:            ط1 ← 1..5   · ط2 ← 1..5
 *
 * ⚠️ **`seq` يُحسب بالتراكم لا بالضرب.** الصيغة الشائعة
 * `(floor - 1) * unitsPerFloor + unit` تُنتج تسلسلاً **خاطئاً** بمجرّد وجود
 * تجاوز في أي طابق سابق — وهو بالضبط ما يفتحه القرار `Q43`. التراكم يبقى
 * صحيحاً مهما اختلفت الطوابق.
 */
export function generateApartments(spec: BuildingSpec): GeneratorResult {
  if (!Number.isInteger(spec.floorsCount) || spec.floorsCount < 1) {
    return { ok: false, reason: "floors-invalid", messageAr: MESSAGES["floors-invalid"] };
  }
  if (!Number.isInteger(spec.unitsPerFloor) || spec.unitsPerFloor < 1) {
    return { ok: false, reason: "units-invalid", messageAr: MESSAGES["units-invalid"] };
  }
  if (!spec.displayNumberFormat.trim()) {
    return { ok: false, reason: "format-empty", messageAr: MESSAGES["format-empty"] };
  }
  if (!/\{(floor|unit|seq)\}/u.test(spec.displayNumberFormat)) {
    // ‏{building} وحده ثابت لكل الشقق — قالب بلا متغيّر يُنتج 200 شقة
    // بنفس الرقم، وكلها ستفشل على قيد التفريد إلا الأولى.
    return { ok: false, reason: "format-no-token", messageAr: MESSAGES["format-no-token"] };
  }

  if (spec.floorOverrides) {
    for (const [floor, units] of spec.floorOverrides) {
      if (!Number.isInteger(floor) || floor < 1 || floor > spec.floorsCount) {
        return {
          ok: false,
          reason: "override-floor-out-of-range",
          messageAr: `${MESSAGES["override-floor-out-of-range"]} (الطابق ${floor})`,
        };
      }
      if (!Number.isInteger(units) || units < 1) {
        return {
          ok: false,
          reason: "override-units-invalid",
          messageAr: MESSAGES["override-units-invalid"],
        };
      }
    }
  }

  const apartments: GeneratedApartment[] = [];
  const seen = new Set<string>();
  let seq = 0;

  for (let floor = 1; floor <= spec.floorsCount; floor += 1) {
    const units = unitsOnFloor(spec, floor);
    for (let unit = 1; unit <= units; unit += 1) {
      seq += 1;
      const unitNumber = spec.numberingScheme === "PER_FLOOR" ? unit : seq;
      const displayNumber = renderDisplayNumber(spec.displayNumberFormat, {
        building: spec.code,
        floor,
        unit: unitNumber,
        seq,
      });

      // فحص التفريد **هنا** لا في قاعدة البيانات: الفشل بعد إدراج 199 صفاً
      // يترك حالة نصف مُنشأة، والرسالة تقول «خطأ تفريد» بلا تفسير.
      if (seen.has(displayNumber)) {
        return {
          ok: false,
          reason: "duplicate-display-number",
          messageAr: `${MESSAGES["duplicate-display-number"]} (تكرّر: ${displayNumber})`,
        };
      }
      seen.add(displayNumber);

      apartments.push({ floorNumber: floor, unitNumber, displayNumber, seq });
    }
  }

  return { ok: true, apartments };
}

/** العدد المتوقَّع بلا توليد — لمعاينة «سيُنشأ N شقة» قبل الحفظ. */
export function countApartments(spec: BuildingSpec): number {
  let total = 0;
  for (let floor = 1; floor <= spec.floorsCount; floor += 1) {
    total += unitsOnFloor(spec, floor);
  }
  return total;
}

/**
 * معاينة حيّة — أول ثلاث شقق وآخر واحدة.
 *
 * §4.8: اكتشاف قالب خاطئ **بعد** توليد 200 شقة مكلف. المعاينة تجعل الخطأ
 * ظاهراً قبل الحفظ بلا أي كتابة.
 */
export function previewApartments(spec: BuildingSpec, sampleSize = 3): GeneratorResult & {
  total?: number;
} {
  const result = generateApartments(spec);
  if (!result.ok) return result;
  const all = result.apartments;
  const sample =
    all.length <= sampleSize + 1
      ? all
      : [...all.slice(0, sampleSize), all[all.length - 1]!];
  return { ok: true, apartments: sample, total: all.length };
}
