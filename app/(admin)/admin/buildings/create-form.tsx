"use client";

import { useActionState } from "react";
import { createBuildingAction } from "./actions";
import { NumberingPreview } from "./numbering-preview";
import type { ActionResult } from "@/lib/result";
import { Button } from "@/components/ui/button";

export function CreateBuildingForm() {
  const [state, action, pending] = useActionState<
    ActionResult<unknown> | null,
    FormData
  >(createBuildingAction, null);

  return (
    <form action={action} className="flex flex-col gap-3">
      <NumberingPreview />

      {state && !state.ok ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error.message}
          {state.error.fieldErrors
            ? ` — ${Object.values(state.error.fieldErrors).flat().join(" · ")}`
            : ""}
        </p>
      ) : null}
      {state?.ok ? (
        <p role="status" className="text-sm text-occupancy-owner">
          أُنشئت البناية وشققها.
        </p>
      ) : null}

      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "جارٍ الإنشاء…" : "إنشاء البناية وتوليد شققها"}
      </Button>
    </form>
  );
}
