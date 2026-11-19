"use client";

import type { ComponentProps, ReactNode } from "react";
import { Controller, type Control, type FieldPath, type FieldValues } from "react-hook-form";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

interface BaseProps<T extends FieldValues> {
  control: Control<T>;
  name: FieldPath<T>;
  label: string;
  description?: ReactNode;
}

export function TextField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  ...inputProps
}: BaseProps<T> & Omit<ComponentProps<typeof Input>, "name">) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={name}>{label}</FieldLabel>
          <Input
            id={name}
            aria-invalid={fieldState.invalid}
            {...inputProps}
            {...field}
            value={field.value ?? ""}
          />
          {description && <FieldDescription>{description}</FieldDescription>}
          {fieldState.error && <FieldError errors={[fieldState.error]} />}
        </Field>
      )}
    />
  );
}

/** Money input in cedis (e.g. "25.00"); the server converts to pesewas. */
export function MoneyField<T extends FieldValues>(props: BaseProps<T> & Omit<ComponentProps<typeof Input>, "name">) {
  return <TextField inputMode="decimal" placeholder="0.00" autoComplete="off" className="tabular-nums" {...props} />;
}

export function TextAreaField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  ...rest
}: BaseProps<T> & Omit<ComponentProps<typeof Textarea>, "name">) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={name}>{label}</FieldLabel>
          <Textarea id={name} aria-invalid={fieldState.invalid} rows={3} {...rest} {...field} value={field.value ?? ""} />
          {description && <FieldDescription>{description}</FieldDescription>}
          {fieldState.error && <FieldError errors={[fieldState.error]} />}
        </Field>
      )}
    />
  );
}

export function SelectField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  options,
  placeholder,
}: BaseProps<T> & { options: { value: string; label: string }[]; placeholder?: string }) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={name}>{label}</FieldLabel>
          <Select value={field.value ?? ""} onValueChange={field.onChange}>
            <SelectTrigger id={name} aria-invalid={fieldState.invalid} className="w-full">
              <SelectValue placeholder={placeholder ?? "Select…"} />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {description && <FieldDescription>{description}</FieldDescription>}
          {fieldState.error && <FieldError errors={[fieldState.error]} />}
        </Field>
      )}
    />
  );
}

export function SwitchField<T extends FieldValues>({ control, name, label, description }: BaseProps<T>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <Field orientation="horizontal" className="items-start justify-between gap-4 rounded-lg border p-3">
          <div>
            <FieldLabel htmlFor={name}>{label}</FieldLabel>
            {description && <FieldDescription>{description}</FieldDescription>}
          </div>
          <Switch id={name} checked={Boolean(field.value)} onCheckedChange={field.onChange} />
        </Field>
      )}
    />
  );
}
