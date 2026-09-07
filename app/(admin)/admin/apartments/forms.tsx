"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Layers, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Field } from "@/components/ui/field";
import { ActionError } from "@/components/ui/page";
import { CONSTRUCTION_STATUS } from "@/lib/domain/enums";
import { CONSTRUCTION_STATUS_AR } from "@/lib/labels";
import { addApartmentAction, bulkConstructionAction } from "./actions";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  نموذجا شاشة الشقق.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── ⚠️ اثنان في شريطٍ واحد لا نموذجان مفتوحان ───────────────────────
 * كلاهما نادر الاستعمال — الشقق تُولَّد مع البناية، والتحديث الجماعي
 * يجري مرّةً كل مرحلة إنشاء. ونموذجٌ مفتوح دائماً فوق جدولٍ يُقرأ يومياً
 * يدفع الجدول تحت الطيّة ويُبطئ العمل المعتاد لأجل النادر.
 */

interface BuildingOption {
  id: string;
  label: string;
  floorsCount: number;
}

/** إضافة شقة مفردة — راجع `createApartment` ولماذا يُجمَّد رقم العرض. */
export function AddApartmentForm({ buildings }: { buildings: readonly BuildingOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [buildingId, setBuildingId] = useState(buildings[0]?.id ?? "");
  const [floor, setFloor] = useState("1");
  const [unit, setUnit] = useState("1");
  const [displayNumber, setDisplayNumber] = useState("");
  const [rooms, setRooms] = useState("");
  const [status, setStatus] = useState<string>("UNDER_CONSTRUCTION");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const f = /^[0-9]+$/u.test(floor) ? Number(floor) : null;
  const u = /^[0-9]+$/u.test(unit) ? Number(unit) : null;
  const ready = buildingId !== "" && f !== null && f >= 1 && u !== null && u >= 1;

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} variant="outline" className="gap-2">
        <Plus className="size-4" />
        إضافة شقة
      </Button>
    );
  }

  function submit(): void {
    setError(null);
    start(async () => {
      const r = await addApartmentAction({
        buildingId,
        floorNumber: f ?? 1,
        unitNumber: u ?? 1,
        displayNumber,
        roomsCount: rooms,
        constructionStatus: status,
      });
      if (!r.ok) {
        setError(r.error.message);
        return;
      }
      setOpen(false);
      setDisplayNumber("");
      setRooms("");
      router.refresh();
    });
  }

  const building = buildings.find((b) => b.id === buildingId);

  return (
    <div className="flex w-full flex-col gap-4 rounded-2xl border bg-card p-5">
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="البناية" htmlFor="ap-building">
          <NativeSelect
            id="ap-building"
            value={buildingId}
            onChange={(e) => setBuildingId(e.target.value)}
          >
            {buildings.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <Field
          label="الطابق"
          htmlFor="ap-floor"
          hint={building ? `البناية ${building.floorsCount} طوابق حالياً` : undefined}
        >
          <Input
            id="ap-floor"
            inputMode="numeric"
            value={floor}
            onChange={(e) => setFloor(e.target.value)}
            aria-describedby="ap-floor-hint"
          />
        </Field>

        <Field label="رقم الوحدة" htmlFor="ap-unit">
          <Input
            id="ap-unit"
            inputMode="numeric"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
          />
        </Field>

        {/*
          ⚠️ يُترك فارغاً فيُشتقّ من قالب البناية. والحقل ظاهرٌ لا مخفيّ:
          `seq` لشقّةٍ تُضاف في وسط البناية لا جواب صحيح له، والاشتقاق
          الصامت لما لا جواب له يُنتج أرقاماً لا يفهمها أحد بعد سنة.
        */}
        <Field
          label="رقم العرض"
          htmlFor="ap-display"
          hint="اتركه فارغاً ليُشتقّ من قالب البناية"
        >
          <Input
            id="ap-display"
            value={displayNumber}
            onChange={(e) => setDisplayNumber(e.target.value)}
            maxLength={40}
            aria-describedby="ap-display-hint"
          />
        </Field>

        <Field label="عدد الغرف" htmlFor="ap-rooms" hint="اختياريّ">
          <Input
            id="ap-rooms"
            inputMode="numeric"
            value={rooms}
            onChange={(e) => setRooms(e.target.value)}
            aria-describedby="ap-rooms-hint"
          />
        </Field>

        <Field label="حالة الإنشاء" htmlFor="ap-status">
          <NativeSelect
            id="ap-status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {CONSTRUCTION_STATUS.map((c) => (
              <option key={c} value={c}>
                {CONSTRUCTION_STATUS_AR[c]}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>

      {error ? <ActionError message={error} /> : null}

      <p className="text-theme-xs text-muted-foreground">
        رقم العرض يُجمَّد للشقق المضافة يدوياً (‏Q43) — لا يُعاد توليده مع البناية.
      </p>

      <div className="flex items-center gap-2">
        <Button disabled={!ready || pending} onClick={submit} className="gap-2">
          <Plus className="size-4" />
          {pending ? "…" : "إضافة"}
        </Button>
        <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
          إلغاء
        </Button>
      </div>
    </div>
  );
}

/**
 * التحديث الجماعي لحالة الإنشاء.
 *
 * ⚠️ **يُبلَّغ عن المتخطَّى لا يُخفى.** الإجراء يرفض إرجاع شقة مسكونة إلى
 * «قيد الإنشاء» ويُرجع قائمة ما تخطّاه. ورسالةُ «حُدّثت 12» وحدها تجعل
 * الأدمن يظنّ أن الطابق كلّه تغيّر — والفارق شقّتان يسكنهما ناس.
 */
export function BulkConstructionForm({ buildings }: { buildings: readonly BuildingOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [buildingId, setBuildingId] = useState(buildings[0]?.id ?? "");
  const [fromFloor, setFromFloor] = useState("1");
  const [toFloor, setToFloor] = useState("1");
  const [status, setStatus] = useState<string>("COMPLETED");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const from = /^[0-9]+$/u.test(fromFloor) ? Number(fromFloor) : null;
  const to = /^[0-9]+$/u.test(toFloor) ? Number(toFloor) : null;
  const ready = buildingId !== "" && from !== null && to !== null && from >= 1 && to >= from;

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} variant="outline" className="gap-2">
        <Layers className="size-4" />
        تحديث جماعي لحالة الإنشاء
      </Button>
    );
  }

  function submit(): void {
    setError(null);
    setDone(null);
    start(async () => {
      const r = await bulkConstructionAction({
        buildingId,
        fromFloor: from ?? 1,
        toFloor: to ?? 1,
        status,
      });
      if (!r.ok) {
        setError(r.error.message);
        return;
      }
      const data = r.data as { updated: number; skipped: string[] };
      setDone(
        data.skipped.length > 0
          ? `حُدّثت ${data.updated} شقة · تُخطّيت ${data.skipped.length} لأنها مسكونة: ${data.skipped.join(" · ")}`
          : `حُدّثت ${data.updated} شقة.`,
      );
      router.refresh();
    });
  }

  return (
    <div className="flex w-full flex-col gap-4 rounded-2xl border bg-card p-5">
      <div className="grid gap-4 md:grid-cols-4">
        <Field label="البناية" htmlFor="bk-building">
          <NativeSelect
            id="bk-building"
            value={buildingId}
            onChange={(e) => setBuildingId(e.target.value)}
          >
            {buildings.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <Field label="من الطابق" htmlFor="bk-from">
          <Input
            id="bk-from"
            inputMode="numeric"
            value={fromFloor}
            onChange={(e) => setFromFloor(e.target.value)}
          />
        </Field>

        <Field label="إلى الطابق" htmlFor="bk-to">
          <Input
            id="bk-to"
            inputMode="numeric"
            value={toFloor}
            onChange={(e) => setToFloor(e.target.value)}
          />
        </Field>

        <Field label="الحالة الجديدة" htmlFor="bk-status">
          <NativeSelect
            id="bk-status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {CONSTRUCTION_STATUS.map((c) => (
              <option key={c} value={c}>
                {CONSTRUCTION_STATUS_AR[c]}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>

      {error ? <ActionError message={error} /> : null}
      {done ? (
        <p role="status" className="text-theme-sm text-occupancy-owner">
          {done}
        </p>
      ) : null}

      <p className="text-theme-xs text-muted-foreground">
        الشقة المسكونة لا تعود «قيد الإنشاء» — تُتخطّى ويُقال أيّها.
      </p>

      <div className="flex items-center gap-2">
        <Button disabled={!ready || pending} onClick={submit} className="gap-2">
          <Layers className="size-4" />
          {pending ? "…" : "تحديث"}
        </Button>
        <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
          إغلاق
        </Button>
      </div>
    </div>
  );
}
