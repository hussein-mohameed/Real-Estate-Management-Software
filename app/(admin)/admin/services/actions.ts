"use server";

import { revalidatePath } from "next/cache";
import {
  createService,
  setServiceAvailability,
  updateService,
} from "@/lib/actions/services";
import {
  applyMandatoryRollout,
  previewMandatoryRollout,
} from "@/lib/actions/subscriptions";
import { requireRole } from "@/lib/auth/guard";
import { formatIqd } from "@/lib/money";
import type { ActionResult } from "@/lib/result";

/**
 * مغلّفات شاشة الخدمات — الهوية من الكوكي لا من العميل.
 *
 * ── تحويل مخطّط الحقول من نصّ ───────────────────────────────────────
 * ⚠️ يُدخَل كـJSON في مساحة نصّية، فقد يصل غير قابل للتحليل. النصّ غير
 * الصالح يُعطي رسالة عربية **هنا**، ولا يُمرَّر إلى zod ليُنتج رسالة
 * محرّك بالإنكليزية.
 */

function s(fd: FormData, key: string): string | undefined {
  const v = fd.get(key);
  const out = typeof v === "string" ? v.trim() : "";
  return out === "" ? undefined : out;
}

function n(fd: FormData, key: string): number | undefined {
  const v = s(fd, key);
  if (v === undefined) return undefined;
  const parsed = Number(v);
  return Number.isFinite(parsed) ? parsed : undefined;
}

type Parsed =
  | { ok: true; value: unknown }
  | { ok: false; message: string };

function parseFieldsJson(raw: string | undefined): Parsed {
  if (!raw) return { ok: true, value: undefined };
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return {
      ok: false,
      message: "مخطّط الحقول المخصّصة ليس JSON صالحاً. راجع الأقواس والفواصل.",
    };
  }
}

function payload(formData: FormData): Record<string, unknown> {
  return {
    name: s(formData, "name"),
    description: s(formData, "description"),
    billingType: s(formData, "billingType"),
    billingCycle: s(formData, "billingCycle"),
    pricingModel: s(formData, "pricingModel"),
    basePriceIqd: s(formData, "basePriceIqd"),
    unitLabel: s(formData, "unitLabel"),
    unitPriceIqd: s(formData, "unitPriceIqd"),
    minUnits: n(formData, "minUnits"),
    maxUnits: n(formData, "maxUnits"),
    payerType: s(formData, "payerType"),
    isMandatory: formData.get("isMandatory") === "on",
    appliesTo: s(formData, "appliesTo"),
    notes: s(formData, "notes"),
  };
}

export async function createServiceAction(
  _prev: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<unknown>> {
  const me = await requireRole("ADMIN");

  const fields = parseFieldsJson(s(formData, "customFieldsSchema"));
  if (!fields.ok) {
    return {
      ok: false,
      error: {
        code: "VALIDATION",
        message: fields.message,
        fieldErrors: { customFieldsSchema: [fields.message] },
      },
    };
  }

  const result = await createService(
    { ...payload(formData), customFieldsSchema: fields.value },
    { userId: me.id, role: me.role },
  );
  if (result.ok) revalidatePath("/admin/services");
  return result;
}

export async function updateServiceAction(
  _prev: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<unknown>> {
  const me = await requireRole("ADMIN");

  const fields = parseFieldsJson(s(formData, "customFieldsSchema"));
  if (!fields.ok) {
    return {
      ok: false,
      error: {
        code: "VALIDATION",
        message: fields.message,
        fieldErrors: { customFieldsSchema: [fields.message] },
      },
    };
  }

  const result = await updateService(
    {
      serviceId: s(formData, "serviceId"),
      ...payload(formData),
      customFieldsSchema: fields.value,
    },
    { userId: me.id, role: me.role },
  );
  if (result.ok) revalidatePath("/admin/services");
  return result;
}

export async function setAvailabilityAction(
  serviceId: string,
  isAvailable: boolean,
): Promise<ActionResult<unknown>> {
  const me = await requireRole("ADMIN");
  const result = await setServiceAvailability(
    { serviceId, isAvailable },
    { userId: me.id, role: me.role },
  );
  if (result.ok) revalidatePath("/admin/services");
  return result;
}

/**
 * معاينة تعميم خدمة إلزامية ثم تنفيذه — الخطوة 2.6.
 *
 * ── ⚠️ المعاينة والتنفيذ إجراءان لا واحد ────────────────────────────
 * لو كان زرٌّ واحداً يعرض ثم ينفّذ، لصار «رأيتُ الرقم» و«وافقتُ عليه» فعلاً
 * واحداً. والعدد قد يتغيّر بينهما إن سُكنت شقة أو أُخليت، فالتنفيذ يحمل
 * العدد الذي رآه الأدمن ويرفض الخادم إن اختلف.
 *
 * ── ⚠️ والمال يُنسَّق هنا لا في العميل ───────────────────────────────
 * `BigInt` لا يعبر حدّ الخادم/العميل في RSC، وتحويله إلى عدد عائم يفقد
 * الدقّة فوق 2^53 — على مبلغٍ يُقيَّد على مئات الحسابات. فيعبر **منسَّقاً
 * نصّاً** بنفس دالّة تنسيق المال الوحيدة، فلا تنشأ قاعدة تنسيق ثانية.
 */

export interface RolloutPreview {
  serviceName: string;
  apartments: number;
  totalLabel: string;
  note: string;
}

export async function previewRolloutAction(
  serviceId: string,
): Promise<ActionResult<RolloutPreview>> {
  const me = await requireRole("OWNER", "ADMIN");
  const r = await previewMandatoryRollout({ serviceId }, { userId: me.id, role: me.role });
  if (!r.ok) return r;
  return {
    ok: true,
    data: {
      serviceName: r.data.serviceName,
      apartments: r.data.apartments,
      totalLabel: formatIqd(r.data.totalIqd),
      note: r.data.note,
    },
  };
}

export async function applyRolloutAction(
  serviceId: string,
  expectedApartments: number,
): Promise<ActionResult<{ apartments: number; chargedLabel: string }>> {
  // ⚠️ المالك ممنوع: التعميم كتابةٌ عملياتية تُقيّد مالاً (‏D3/2)
  const me = await requireRole("ADMIN");
  const r = await applyMandatoryRollout(
    { serviceId, confirm: true, expectedApartments },
    { userId: me.id, role: me.role },
  );
  if (!r.ok) return r;
  revalidatePath("/admin/services");
  return {
    ok: true,
    data: { apartments: r.data.apartments, chargedLabel: formatIqd(r.data.chargedIqd) },
  };
}
