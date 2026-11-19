"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { KeyRound, LockOpen, MoreHorizontal, Pencil, UserPlus } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { SelectField, SwitchField, TextField } from "@/components/app/form-fields";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FieldGroup } from "@/components/ui/field";
import { useServerAction } from "@/hooks/use-server-action";
import { ROLE_LABELS, ROLES, type Role } from "@/lib/permissions";
import { createUserSchema, updateUserSchema } from "@/lib/validation/users";
import {
  createUserAction,
  resetUserPasswordAction,
  unlockUserAction,
  updateUserAction,
} from "@/server/actions/users";

const roleOptions = ROLES.map((role) => ({ value: role, label: ROLE_LABELS[role] }));

export interface StaffSummary {
  id: string;
  fullName: string;
  username: string;
  email: string | null;
  phone: string | null;
  role: Role;
  isActive: boolean;
}

type CreateValues = z.input<typeof createUserSchema>;

export function CreateStaffDialog() {
  const [open, setOpen] = useState(false);
  const form = useForm<CreateValues>({
    resolver: zodResolver(createUserSchema),
    defaultValues: { fullName: "", username: "", email: "", phone: "", role: "CASHIER", password: "" },
  });
  const { run, isPending } = useServerAction(createUserAction, {
    successMessage: "Staff account created",
    setError: form.setError,
    onSuccess: () => {
      form.reset();
      setOpen(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <UserPlus aria-hidden /> Add staff
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add staff member</DialogTitle>
          <DialogDescription>They will be asked to choose their own password at first sign-in.</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit((values) => run(values))} noValidate>
          <FieldGroup>
            <TextField control={form.control} name="fullName" label="Full name" autoComplete="off" />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField control={form.control} name="username" label="Username" autoCapitalize="none" autoComplete="off" />
              <SelectField control={form.control} name="role" label="Role" options={roleOptions} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField control={form.control} name="phone" label="Phone (optional)" inputMode="tel" />
              <TextField control={form.control} name="email" label="Email (optional)" type="email" />
            </div>
            <TextField
              control={form.control}
              name="password"
              label="Temporary password"
              type="password"
              autoComplete="new-password"
              description="At least 8 characters with letters and numbers."
            />
          </FieldGroup>
          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Creating…" : "Create account"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type UpdateValues = z.input<typeof updateUserSchema>;

function EditStaffDialog({ member, isSelf, open, onOpenChange }: { member: StaffSummary; isSelf: boolean; open: boolean; onOpenChange: (v: boolean) => void }) {
  const form = useForm<UpdateValues>({
    resolver: zodResolver(updateUserSchema),
    defaultValues: {
      id: member.id,
      fullName: member.fullName,
      email: member.email ?? "",
      phone: member.phone ?? "",
      role: member.role,
      isActive: member.isActive,
    },
  });
  const { run, isPending } = useServerAction(updateUserAction, {
    successMessage: "Staff member updated",
    setError: form.setError,
    onSuccess: () => onOpenChange(false),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit {member.fullName}</DialogTitle>
          <DialogDescription>Changing the role or deactivating signs this person out of all devices.</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit((values) => run(values))} noValidate>
          <FieldGroup>
            <TextField control={form.control} name="fullName" label="Full name" />
            <SelectField control={form.control} name="role" label="Role" options={roleOptions} />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField control={form.control} name="phone" label="Phone" inputMode="tel" />
              <TextField control={form.control} name="email" label="Email" type="email" />
            </div>
            {!isSelf && (
              <SwitchField control={form.control} name="isActive" label="Account active" description="Inactive staff cannot sign in. Their history is kept." />
            )}
          </FieldGroup>
          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const resetSchema = z.object({ id: z.uuid(), password: z.string().min(8, "At least 8 characters") });

function ResetPasswordDialog({ member, open, onOpenChange }: { member: StaffSummary; open: boolean; onOpenChange: (v: boolean) => void }) {
  const form = useForm<z.input<typeof resetSchema>>({
    resolver: zodResolver(resetSchema),
    defaultValues: { id: member.id, password: "" },
  });
  const { run, isPending } = useServerAction(resetUserPasswordAction, {
    successMessage: "Password reset. Share it with the staff member privately.",
    setError: form.setError,
    onSuccess: () => {
      form.reset({ id: member.id, password: "" });
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reset password for {member.fullName}</DialogTitle>
          <DialogDescription>They will be signed out and asked to choose a new password at next sign-in.</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit((values) => run(values))} noValidate>
          <TextField control={form.control} name="password" label="Temporary password" type="password" autoComplete="new-password" />
          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Resetting…" : "Reset password"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function StaffRowActions({ member, isLocked, isSelf }: { member: StaffSummary; isLocked: boolean; isSelf: boolean }) {
  const [dialog, setDialog] = useState<"edit" | "reset" | null>(null);
  const unlock = useServerAction(unlockUserAction, { successMessage: "Account unlocked" });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`Actions for ${member.fullName}`}>
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setDialog("edit")}>
            <Pencil aria-hidden /> Edit details & role
          </DropdownMenuItem>
          {!isSelf && (
            <DropdownMenuItem onSelect={() => setDialog("reset")}>
              <KeyRound aria-hidden /> Reset password
            </DropdownMenuItem>
          )}
          {isLocked && (
            <DropdownMenuItem disabled={unlock.isPending} onSelect={() => unlock.run(member.id)}>
              <LockOpen aria-hidden /> Unlock account
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {dialog === "edit" && <EditStaffDialog member={member} isSelf={isSelf} open onOpenChange={(v) => !v && setDialog(null)} />}
      {dialog === "reset" && <ResetPasswordDialog member={member} open onOpenChange={(v) => !v && setDialog(null)} />}
    </>
  );
}
