"use server";

import { z } from "zod";
import { defineAction } from "./define-action";
import { LEDGER_ENTRY_TYPE, LEDGER_SOURCE } from "@/lib/domain/enums";
import { now } from "@/lib/dates";
import { RANGE_PRESET, resolveRange } from "@/lib/domain/report-range";
import {
  collectionsReport,
  installmentAgeingReport,
  ledgerMovementReport,
  outstandingReport,
  serviceRevenueReport,
} from "@/lib/services/reports";
import { residentsReport, staffReport } from "@/lib/services/reports-people";
import { requestsReport, vehiclesReport } from "@/lib/services/reports-ops";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  التقارير — الإجراءات.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── ⚠️ **لكل تقرير قدرةُ بياناته** ──────────────────────────────────
 * تقارير المال تحت `FINANCIAL_REPORTS`، والسكان تحت `RESIDENT_PROFILES`،
 * والموظفون تحت `DEPARTMENTS_SKILLS_STAFF`، وهكذا. راجع القسم الثاني
 * أدناه — ولماذا لم تُوضَع كلّها تحت قدرةٍ واحدة.
 *
 * ── والتصدير ليس فعلاً في `LEVEL_ACTIONS` ──────────────────────────
 * ⚠️ `canExport` علمٌ في الخليّة، و`defineAction` يفرض القراءة ولا يعرفه.
 * فحدُّ التصدير يُفرَض في مسار التصدير نفسه —
 * `app/api/reports/[slug]/route.ts` — وكتابتُه في موضعين كانت ستجعل
 * أحدهما يتخلّف عن الآخر.
 *
 * ── والمدّة تُحلّ في الخادم لا تُمرَّر ─────────────────────────────
 * ⚠️ `from`/`to` يصلان من العنوان نصّين. وحلُّهما هنا يجعل كل تقرير يقرأ
 * نفس النافذة بنفس الحدود — وتمريرُ `Date` من العميل كان يفتح مدّةً
 * يخترعها المتصل: «من 1970» يمسح الدفتر كلّه.
 */

const rangeSchema = z.object({
  preset: z.enum(RANGE_PRESET).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

export const getCollectionsReport = defineAction({
  name: "getCollectionsReport",
  capability: "FINANCIAL_REPORTS",
  kind: "read",
  schema: rangeSchema.default({}),
  handler: async ({ input, tx }) => {
    const range = resolveRange(input, now());
    const data = await collectionsReport(range, tx);
    return { range, ...data };
  },
});

export const getOutstandingReport = defineAction({
  name: "getOutstandingReport",
  capability: "FINANCIAL_REPORTS",
  kind: "read",
  /* ⚠️ بلا مدّة عمداً — المستحقّ رصيدٌ الآن لا حركةٌ في فترة */
  schema: z.object({}).default({}),
  handler: async ({ tx }) => outstandingReport(tx),
});

export const getInstallmentAgeingReport = defineAction({
  name: "getInstallmentAgeingReport",
  capability: "FINANCIAL_REPORTS",
  kind: "read",
  schema: z.object({}).default({}),
  handler: async ({ tx }) => installmentAgeingReport(tx),
});

export const getServiceRevenueReport = defineAction({
  name: "getServiceRevenueReport",
  capability: "FINANCIAL_REPORTS",
  kind: "read",
  schema: rangeSchema.default({}),
  handler: async ({ input, tx }) => {
    const range = resolveRange(input, now());
    const data = await serviceRevenueReport(range, tx);
    return { range, ...data };
  },
});

export const getLedgerMovementReport = defineAction({
  name: "getLedgerMovementReport",
  capability: "FINANCIAL_REPORTS",
  kind: "read",
  schema: rangeSchema
    .extend({
      type: z.enum(LEDGER_ENTRY_TYPE).optional(),
      source: z.enum(LEDGER_SOURCE).optional(),
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(200).default(50),
    })
    .default({ page: 1, pageSize: 50 }),
  handler: async ({ input, tx }) => {
    const range = resolveRange(input, now());
    const data = await ledgerMovementReport(
      range,
      {
        page: input.page,
        pageSize: input.pageSize,
        ...(input.type ? { type: input.type } : {}),
        ...(input.source ? { source: input.source } : {}),
      },
      tx,
    );
    return { range, ...data };
  },
});

// ═══════════════════════════════════════════════════════════════════════
//  تقارير الناس والتشغيل
// ═══════════════════════════════════════════════════════════════════════

/**
 * ── 🔴 كل تقرير بقدرة **بياناته** لا بقدرة المال ────────────────────
 * وضعُها كلّها تحت `FINANCIAL_REPORTS` كان أسهل — وكان يمنح من يقرأ
 * تقرير الموظفين حقّاً على التقارير المالية، ويمنع الأدمن `F` على
 * الموظفين من قراءة تقريرهم لأنه `R` على المال.
 *
 * ⚠️ والقدرة الصحيحة تجعل الترخيص يتبع البيانات: من يقرأ الموظفين يقرأ
 * تقريرهم، ومن لا يقرؤهم لا يلتفّ عليهم من باب التقارير.
 */

export const getResidentsReport = defineAction({
  name: "getResidentsReport",
  capability: "RESIDENT_PROFILES",
  kind: "read",
  /* ⚠️ بلا مدّة: «كم ساكناً» سؤالٌ عن اللحظة لا عن فترة */
  schema: z.object({}).default({}),
  handler: async ({ tx }) => residentsReport(tx),
});

export const getStaffReport = defineAction({
  name: "getStaffReport",
  capability: "DEPARTMENTS_SKILLS_STAFF",
  kind: "read",
  schema: z.object({}).default({}),
  handler: async ({ tx }) => staffReport(tx),
});

export const getRequestsReport = defineAction({
  name: "getRequestsReport",
  capability: "SERVICE_REQUESTS",
  kind: "read",
  schema: rangeSchema.default({}),
  handler: async ({ input, tx }) => {
    const range = resolveRange(input, now());
    const data = await requestsReport(range, tx);
    return { range, ...data };
  },
});

export const getVehiclesReport = defineAction({
  name: "getVehiclesReport",
  capability: "VEHICLES",
  kind: "read",
  schema: z.object({}).default({}),
  handler: async ({ tx }) => vehiclesReport(tx),
});
