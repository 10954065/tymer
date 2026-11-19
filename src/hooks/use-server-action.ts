"use client";

import { useTransition } from "react";
import type { FieldValues, Path, UseFormSetError } from "react-hook-form";
import { toast } from "sonner";
import type { ActionResult } from "@/lib/errors";

interface Options<T, F extends FieldValues> {
  successMessage?: string | ((data: T) => string);
  onSuccess?: (data: T) => void;
  setError?: UseFormSetError<F>;
}

/**
 * Runs a server action, shows toast feedback and maps field errors back onto the form.
 * `run` resolves to the result so callers can branch on it.
 */
export function useServerAction<I, T, F extends FieldValues = FieldValues>(
  action: (input: I) => Promise<ActionResult<T>>,
  options: Options<T, F> = {},
) {
  const [isPending, startTransition] = useTransition();

  function run(input: I): Promise<ActionResult<T>> {
    return new Promise((resolve) => {
      startTransition(async () => {
        let result: ActionResult<T>;
        try {
          result = await action(input);
        } catch {
          result = { ok: false, error: "Could not reach the server. Check your connection and try again.", code: "INTERNAL" };
        }
        if (result.ok) {
          const message =
            typeof options.successMessage === "function" ? options.successMessage(result.data) : options.successMessage;
          if (message) toast.success(message);
          options.onSuccess?.(result.data);
        } else {
          if (result.fieldErrors && options.setError) {
            for (const [field, message] of Object.entries(result.fieldErrors)) {
              options.setError(field as Path<F>, { type: "server", message });
            }
          }
          toast.error(result.error);
        }
        resolve(result);
      });
    });
  }

  return { run, isPending };
}
