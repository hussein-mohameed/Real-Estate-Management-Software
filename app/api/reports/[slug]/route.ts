import { getSession } from "@/lib/auth/session";
import { can, cell } from "@/lib/auth/roles";
import type { Capability } from "@/lib/auth/roles";
import { now } from "@/lib/dates";
import { resolveRange } from "@/lib/domain/report-range";
import { csvFileName, toCsv, type CsvValue } from "@/lib/reports/csv";
import {
  collectionsReport,
  installmentAgeingReport,
  ledgerMovementReport,
  outstandingReport,
  serviceRevenueReport,
} from "@/lib/services/reports";
import {
  LEDGER_ENTRY_TYPE_AR,
  LEDGER_SOURCE_AR,
  PAYMENT_METHOD_AR,
} from "@/lib/labels";

import { formatPhoneForDisplay } from "@/lib/domain/phone";
import { residentsReport, staffReport } from "@/lib/services/reports-people";
import { requestsReport, vehiclesReport } from "@/lib/services/reports-ops";
import {
  BADGE_STATUS_AR,
  EMPLOYMENT_TYPE_AR,
  RESIDENT_RELATION_AR,
  VEHICLE_STATUS_AR,
} from "@/lib/labels";
import type { EmploymentType } from "@/lib/domain/enums";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  تصدير التقارير — CSV.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── 🔴 التصدير **للمالك وحده** ──────────────────────────────────────
 * `canExport: true` في خليّة `FINANCIAL_REPORTS` **للمالك فقط**؛ الأدمن
 * `R` يقرأ على الشاشة ولا يُخرج الملفّ.
 *
 * ⚠️ و`defineAction` **لا يفرض هذا**: `canExport` علمٌ في الخليّة لا فعلٌ
 * في `LEVEL_ACTIONS`، والقراءة تمرّ للأدمن بحقّ. فالحدّ يُفرَض هنا —
 * ويُقرأ من المصفوفة لا يُكتب رقماً ثابتاً، كي يسري أي تعديل عليها.
 *
 * ── ولماذا مسارٌ لا `Server Action` ────────────────────────────────
 * الإجراء يُرجع قيمةً إلى المتصفّح؛ والملفّ يحتاج ترويسات: نوع المحتوى،
 * واسم التنزيل. وهذا ما يفعله `Route Handler` وحده.
 *
 * ── ⚠️ ولا تصفيح في الملفّ ─────────────────────────────────────────
 * الشاشة تُصفّح لأن العين لا تقرأ ألفاً؛ والملفّ يُفتَح في جدول يفرز
 * ويجمع — فتصديرُ خمسين صفّاً من ألف يُنتج مجموعاً خاطئاً يبدو صحيحاً.
 */

export const dynamic = "force-dynamic";

type Csv = { headers: string[]; rows: CsvValue[][]; slug: string };

export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return new Response("الجلسة منتهية.", { status: 401 });
  }

  const role = session.user.role;
  const { slug } = await context.params;

  /**
   * ── ⚠️ **قدرة التقرير لا قدرة المال** ────────────────────────────
   * تصدير تقرير الموظفين يُرخَّص بـ`DEPARTMENTS_SKILLS_STAFF`، لا بحقٍّ
   * على الدفتر. وقدرةٌ واحدة لكل التصديرات كانت تخلط ترخيصين لا علاقة
   * بينهما — وتمنح من يقرأ المال حقّاً على بيانات الناس.
   */
  const CAPABILITY_OF: Record<string, Capability> = {
    collections: "FINANCIAL_REPORTS",
    "collections-by-collector": "FINANCIAL_REPORTS",
    outstanding: "FINANCIAL_REPORTS",
    "installment-ageing": "FINANCIAL_REPORTS",
    "service-revenue": "FINANCIAL_REPORTS",
    ledger: "FINANCIAL_REPORTS",
    residents: "RESIDENT_PROFILES",
    staff: "DEPARTMENTS_SKILLS_STAFF",
    requests: "SERVICE_REQUESTS",
    vehicles: "VEHICLES",
  };

  const capability = CAPABILITY_OF[slug];
  if (!capability) return new Response("تقرير غير معروف.", { status: 404 });

  /*
   * ⚠️ شرطان: القراءة **والتصدير**. الأول يمنع من لا يرى البيانات أصلاً،
   * والثاني يمنع من يراها ولا يُخرجها.
   */
  if (!can(role, capability, "read") || cell(role, capability).canExport !== true) {
    return new Response("التصدير من صلاحية المالك وحده.", { status: 403 });
  }

  const url = new URL(request.url);
  const range = resolveRange(
    {
      preset: url.searchParams.get("preset") ?? undefined,
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
    },
    now(),
  );

  let csv: Csv;

  switch (slug) {
    case "collections": {
      const r = await collectionsReport(range);
      /*
       * ⚠️ اليوم **والطريقة** في ملفّ واحد: من يفتح تصدير التحصيل يسأل
       * «كم دخل ومن أين»، وملفّان يجيبان نصفين لا يُجمعان في جدول واحد.
       */
      csv = {
        slug,
        headers: ["اليوم", "عدد الدفعات", "المبلغ"],
        rows: [
          ...r.byDay.map((d): CsvValue[] => [d.day, d.count, d.totalIqd]),
          [],
          ["الطريقة", "عدد الدفعات", "المبلغ"],
          ...r.byMethod.map((m): CsvValue[] => [
            PAYMENT_METHOD_AR[m.method],
            m.count,
            m.totalIqd,
          ]),
        ],
      };
      break;
    }

    case "collections-by-collector": {
      const r = await collectionsReport(range);
      csv = {
        slug,
        headers: ["المحصِّل", "عدد الدفعات", "المبلغ"],
        rows: r.byCollector.map((c) => [c.name, c.count, c.totalIqd]),
      };
      break;
    }

    case "outstanding": {
      const r = await outstandingReport();
      csv = {
        slug,
        headers: ["البناية", "الشقة", "صاحب الحساب", "الهاتف", "الرصيد", "أقدم قيد"],
        rows: r.rows.map((x) => [
          x.buildingCode,
          x.apartmentNumber,
          x.holderName,
          formatPhoneForDisplay(x.holderPhone),
          x.balanceIqd,
          x.oldestChargeAt,
        ]),
      };
      break;
    }

    case "installment-ageing": {
      const r = await installmentAgeingReport();
      csv = {
        slug,
        headers: [
          "العقد",
          "الشقة",
          "صاحب العقد",
          "الهاتف",
          "رقم القسط",
          "الاستحقاق",
          "أيام التأخّر",
          "المبلغ",
        ],
        rows: r.rows.map((x) => [
          x.contractNumber,
          x.apartmentNumber,
          x.holderName,
          formatPhoneForDisplay(x.holderPhone),
          x.sequence,
          x.dueDate,
          x.daysLate,
          x.amountIqd,
        ]),
      };
      break;
    }

    case "service-revenue": {
      const r = await serviceRevenueReport(range);
      csv = {
        slug,
        headers: ["الخدمة", "إلزامية", "المقيَّد في المدّة", "عدد القيود", "اشتراكات نشطة"],
        rows: r.rows.map((x) => [
          x.serviceName,
          x.isMandatory ? "نعم" : "لا",
          x.chargedIqd,
          x.chargeCount,
          x.activeSubscriptions,
        ]),
      };
      break;
    }

    case "ledger": {
      /*
       * ⚠️ سقفٌ صريح بعشرة آلاف صفّ. الدفتر ينمو بلا حدّ، وتصديرٌ بلا
       * سقف يُسقط الخادم على الذاكرة عند أوّل سنةٍ كاملة. والسقف يُقال
       * في الملفّ نفسه لا يُخفى — صفٌّ أخير يقول إن هناك ما لم يُصدَّر.
       */
      const CAP = 10_000;
      const r = await ledgerMovementReport(range, { page: 1, pageSize: CAP });
      const rows: CsvValue[][] = r.rows.map((x) => [
        x.createdAt,
        LEDGER_ENTRY_TYPE_AR[x.type],
        LEDGER_SOURCE_AR[x.source],
        x.apartmentNumber,
        x.holderName,
        x.descriptionAr,
        x.amountIqd,
      ]);
      if (r.total > CAP) {
        rows.push([
          `— بقي ${r.total - CAP} قيداً لم تُصدَّر (السقف ${CAP}). ضيّق المدّة.`,
          "",
          "",
          "",
          "",
          "",
          null,
        ]);
      }
      csv = {
        slug,
        headers: ["الوقت", "النوع", "المصدر", "الشقة", "صاحب الحساب", "الوصف", "المبلغ"],
        rows,
      };
      break;
    }

    case "residents": {
      const r = await residentsReport();
      csv = {
        slug,
        headers: ["البناية", "شقق مسكونة", "سكّان"],
        rows: [
          ...r.byBuilding.map((b): CsvValue[] => [
            b.buildingCode,
            b.apartmentsWithResidents,
            b.residents,
          ]),
          [],
          ["العلاقة", "العدد", ""],
          ...r.byRelation.map((x): CsvValue[] => [
            RESIDENT_RELATION_AR[x.relation],
            x.count,
            "",
          ]),
          [],
          ["مؤشّر", "القيمة", ""],
          ["سكّان نشطون", r.activeResidents, ""],
          ["حسابات معطَّلة", r.inactiveResidents, ""],
          ["نشطون بلا شقة", r.unlinkedActive, ""],
        ],
      };
      break;
    }

    case "staff": {
      const r = await staffReport();
      /* ⚠️ ولا عمود مبالغ — راجع رأس `reports-people.ts` */
      csv = {
        slug,
        headers: [
          "الموظف",
          "القسم",
          "المسمّى",
          "الصفة",
          "متواجد",
          "مهارات",
          "طلبات مفتوحة",
        ],
        rows: r.rows.map((x) => [
          x.name,
          x.departmentName,
          x.jobTitle ?? "",
          EMPLOYMENT_TYPE_AR[x.employmentType as EmploymentType],
          x.isAvailable ? "نعم" : "لا",
          x.skills,
          x.openRequests,
        ]),
      };
      break;
    }

    case "requests": {
      const r = await requestsReport(range);
      csv = {
        slug,
        headers: ["القسم", "مفتوح الآن", "أُغلق في المدّة", "متوسّط الإنجاز (يوم)"],
        rows: [
          ...r.byDepartment.map((x): CsvValue[] => [
            x.departmentName,
            x.open,
            x.closedInRange,
            x.avgDaysToClose,
          ]),
          [],
          ["أقدم ما ينتظر", "القسم", "المُكلَّف", "أيام"],
          ...r.oldestOpen.map((x): CsvValue[] => [
            `${x.number} — ${x.title}`,
            x.departmentName,
            x.assignedTo ?? "بلا مُكلَّف",
            x.daysOpen,
          ]),
        ],
      };
      break;
    }

    case "vehicles": {
      const r = await vehiclesReport();
      csv = {
        slug,
        headers: ["البناية", "مركبات", "معتمَدة"],
        rows: [
          ...r.byBuilding.map((b): CsvValue[] => [b.buildingCode, b.vehicles, b.approved]),
          [],
          ["حالة المركبة", "العدد", ""],
          ...r.byStatus.map((x): CsvValue[] => [
            VEHICLE_STATUS_AR[x.status],
            x.count,
            "",
          ]),
          [],
          ["حالة الباج (مشتقّة)", "العدد", ""],
          ...r.badgesByEffectiveStatus.map((x): CsvValue[] => [
            BADGE_STATUS_AR[x.status],
            x.count,
            "",
          ]),
          [],
          ["معتمَدة بلا باج ساري", r.approvedWithoutValidBadge, ""],
          ["باج منتهٍ لم يُقلَب", r.staleIssuedBadges, ""],
        ],
      };
      break;
    }

    default:
      return new Response("تقرير غير معروف.", { status: 404 });
  }

  const body = toCsv(csv.headers, csv.rows);
  /* ما يعرض «الحال الآن» بلا مدّة — فلا مدّة في اسم ملفّه */
  const UNDATED = new Set([
    "outstanding",
    "installment-ageing",
    "residents",
    "staff",
    "vehicles",
  ]);
  const dated = !UNDATED.has(slug);
  const name = dated ? csvFileName(csv.slug, range.from, range.to) : csvFileName(csv.slug);

  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      /* ⚠️ تقريرٌ ماليّ لا يُخزَّن في وسيط: رقمٌ قديم أسوأ من انتظار ثانية */
      "Cache-Control": "no-store",
    },
  });
}
