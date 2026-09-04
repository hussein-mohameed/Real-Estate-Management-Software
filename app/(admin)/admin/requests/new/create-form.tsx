"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Field } from "@/components/ui/field";
import { PRIORITY_AR, REQUEST_SCOPE_AR, REQUEST_TYPE_AR } from "@/lib/labels";
import {
  PRIORITY,
  REQUEST_SCOPE,
  REQUEST_TYPE,
  type Priority,
  type RequestScope,
  type RequestType,
} from "@/lib/domain/enums";
import { createRequestAction } from "../actions";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  طلب جديد — الخطوة 4.4.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── ⚠️ الشقة تظهر وتختفي مع الموضوع ─────────────────────────────────
 * `Q35`: شكوى المصعد لا شقة لها، وإلحاقُها بشقة عشوائية يلوّث كل تقارير
 * الطلبات («الشقة A-1-2 لها 30 شكوى»). فحقل الشقة يظهر للنطاق السكني
 * وحده — والقاعدة تُقرأ من الشاشة قبل أن تُقرأ من رسالة خطأ.
 *
 * ── والقسم يُشتقّ من المهمّة لا يُختار ──────────────────────────────
 * كل مهمّة تنتمي إلى قسم. واختيارُ الاثنين يفتح احتمال تناقضهما، ويجعل
 * «أيّهما الصحيح؟» سؤالاً لا جواب له في البيانات.
 */

interface Option {
  id: string;
  label: string;
}

export function CreateRequestForm({
  apartments,
  tasks,
}: {
  apartments: readonly Option[];
  tasks: readonly Option[];
}) {
  const [type, setType] = useState<RequestType>("SERVICE_REQUEST");
  const [scope, setScope] = useState<RequestScope>("APARTMENT");
  const [apartmentId, setApartmentId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [taskId, setTaskId] = useState("");
  const [priority, setPriority] = useState<Priority>("NORMAL");

  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const needsApartment = scope === "APARTMENT";
  const ready =
    title.trim().length >= 3 &&
    description.trim().length >= 3 &&
    (!needsApartment || apartmentId !== "");

  function submit() {
    setError(null);
    setDone(null);
    start(async () => {
      const r = await createRequestAction({
        type,
        scope,
        /* ⚠️ يُفرَّغ للمنطقة المشتركة: الخادم يرفض شقةً معها */
        apartmentId: needsApartment ? apartmentId : "",
        title,
        description,
        departmentTaskId: taskId,
        priority,
      });
      if (!r.ok) {
        setError(r.error.message);
        return;
      }
      const data = r.data as { number: string };
      setDone(`أُنشئ الطلب ${data.number}.`);
      setTitle("");
      setDescription("");
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 rounded-2xl border bg-card p-5 md:grid-cols-3">
        <Field label="النوع" htmlFor="type">
          <NativeSelect
            id="type"
            value={type}
            onChange={(e) => setType(e.target.value as RequestType)}
          >
            {REQUEST_TYPE.map((t) => (
              <option key={t} value={t}>
                {REQUEST_TYPE_AR[t]}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <Field label="الموضوع" htmlFor="scope" hint="المنطقة المشتركة لا تُلحَق بشقة">
          <NativeSelect
            id="scope"
            value={scope}
            onChange={(e) => {
              const next = e.target.value as RequestScope;
              setScope(next);
              if (next === "COMMON_AREA") setApartmentId("");
            }}
            aria-describedby="scope-hint"
          >
            {REQUEST_SCOPE.map((s) => (
              <option key={s} value={s}>
                {REQUEST_SCOPE_AR[s]}
              </option>
            ))}
          </NativeSelect>
        </Field>

        {needsApartment ? (
          <Field label="الشقة" htmlFor="apartment">
            <NativeSelect
              id="apartment"
              value={apartmentId}
              onChange={(e) => setApartmentId(e.target.value)}
            >
              <option value="">اختر شقة</option>
              {apartments.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
        ) : null}

        <Field label="المهمّة" htmlFor="task" hint="القسم يُشتقّ منها">
          <NativeSelect
            id="task"
            value={taskId}
            onChange={(e) => setTaskId(e.target.value)}
            aria-describedby="task-hint"
          >
            <option value="">بلا مهمّة</option>
            {tasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <Field label="الأولوية" htmlFor="priority">
          <NativeSelect
            id="priority"
            value={priority}
            onChange={(e) => setPriority(e.target.value as Priority)}
          >
            {PRIORITY.map((pr) => (
              <option key={pr} value={pr}>
                {PRIORITY_AR[pr]}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <Field label="العنوان" htmlFor="title" className="md:col-span-3">
          <Input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={150}
            placeholder="تسرّب ماء في الحمّام"
          />
        </Field>

        <div className="md:col-span-3">
          <Field label="الوصف" htmlFor="desc">
            <Textarea
              id="desc"
              rows={4}
              maxLength={2000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="ما المشكلة بالضبط، ومتى بدأت، وما جُرِّب."
            />
          </Field>
        </div>
      </div>

      {done ? (
        <p role="status" className="text-theme-sm text-occupancy-owner">
          {done}
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-theme-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div>
        <Button disabled={!ready || pending} onClick={submit} className="gap-2">
          <Plus className="size-4" />
          {pending ? "…" : "إنشاء الطلب"}
        </Button>
      </div>
    </div>
  );
}
