import type { Metadata } from "next";
import { Users } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/dates";
import { ROLE_LABELS, ROLE_PERMISSIONS, ROLES, type Role } from "@/lib/permissions";
import { requirePagePermission } from "@/server/auth/current-user";
import { getDb } from "@/server/db/client";
import { listUsers, type StaffMember } from "@/server/services/users";
import { CreateStaffDialog, StaffRowActions } from "./staff-dialogs";

export const metadata: Metadata = { title: "Staff & Permissions" };

const ROLE_SUMMARY: Record<Role, string> = {
  OWNER: "Full access, including staff, settings, audit logs and database health.",
  MANAGER: "Sales, inventory, purchases, customers, orders, expenses, cash and reports.",
  CASHIER: "Checkout, sales history, receipts, customer lookup and the cash drawer.",
  INVENTORY_STAFF: "Products, categories, stock movements, purchases and suppliers.",
};

function StatusBadge({ member, isLocked }: { member: StaffMember; isLocked: boolean }) {
  if (!member.isActive) return <Badge variant="outline" className="text-muted-foreground">Inactive</Badge>;
  if (isLocked) return <Badge variant="destructive">Locked</Badge>;
  if (member.mustChangePassword) {
    return <Badge variant="outline" className="border-warning/60">Password change pending</Badge>;
  }
  return <Badge variant="outline" className="border-success/40 text-success">Active</Badge>;
}

export default async function StaffPage() {
  const session = await requirePagePermission("staff:manage");
  const staff = await listUsers(getDb());

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Staff & Permissions"
        description="Create staff accounts and decide what each person can do. Permissions are enforced on the server for every action."
        actions={<CreateStaffDialog />}
      />

      <Card className="surface-elevated mb-8 overflow-hidden py-0">
        {staff.length === 0 ? (
          <EmptyState icon={Users} title="No staff yet" description="Add your first team member." className="m-4" />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="pl-5">Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden md:table-cell">Last sign-in</TableHead>
                  <TableHead className="pr-5 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {staff.map((member) => {
                  const isLocked = member.isLocked;
                  const isSelf = member.id === session.user.id;
                  return (
                    <TableRow key={member.id}>
                      <TableCell className="pl-5">
                        <p className="font-medium">
                          {member.fullName}
                          {isSelf && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
                        </p>
                        <p className="text-xs text-muted-foreground">@{member.username}</p>
                      </TableCell>
                      <TableCell>
                        <Badge variant={member.role === "OWNER" ? "default" : "secondary"}>{ROLE_LABELS[member.role]}</Badge>
                      </TableCell>
                      <TableCell>
                        <StatusBadge member={member} isLocked={isLocked} />
                      </TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground tabular-nums md:table-cell">
                        {formatDateTime(member.lastLoginAt)}
                      </TableCell>
                      <TableCell className="pr-5 text-right">
                        <StaffRowActions
                          member={{
                            id: member.id,
                            fullName: member.fullName,
                            username: member.username,
                            email: member.email,
                            phone: member.phone,
                            role: member.role,
                            isActive: member.isActive,
                          }}
                          isLocked={isLocked}
                          isSelf={isSelf}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      <h2 className="mb-3 text-lg font-semibold">What each role can do</h2>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {ROLES.map((role) => (
          <Card key={role} className="gap-2">
            <CardHeader>
              <CardTitle className="text-base">{ROLE_LABELS[role]}</CardTitle>
              <CardDescription>{ROLE_SUMMARY[role]}</CardDescription>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">{ROLE_PERMISSIONS[role].size} permissions</CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
