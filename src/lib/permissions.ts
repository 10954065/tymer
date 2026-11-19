/**
 * Role-based permissions shared by server (enforcement) and client (navigation only).
 * The server is the only authority: every action and page calls requirePermission().
 */

export const ROLES = ["OWNER", "MANAGER", "CASHIER", "INVENTORY_STAFF"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  OWNER: "Owner",
  MANAGER: "Manager",
  CASHIER: "Cashier",
  INVENTORY_STAFF: "Inventory staff",
};

export const PERMISSIONS = [
  "dashboard:view",
  "pos:use",
  "sales:view",
  "sales:void",
  "sales:return",
  "sales:discount_override",
  "products:view",
  "products:view_cost",
  "products:manage",
  "categories:manage",
  "inventory:view",
  "inventory:adjust",
  "purchases:view",
  "purchases:manage",
  "purchases:pay",
  "suppliers:view",
  "suppliers:manage",
  "customers:view",
  "customers:create",
  "customers:manage",
  "orders:view",
  "orders:manage",
  "expenses:view",
  "expenses:manage",
  "payments:view",
  "payments:record",
  "payments:reverse",
  "reports:view",
  "cash:view",
  "cash:manage",
  "audit:view",
  "staff:manage",
  "settings:manage",
  "sync:review",
  "system:health",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const MANAGER_PERMISSIONS: Permission[] = [
  "dashboard:view",
  "pos:use",
  "sales:view",
  "sales:void",
  "sales:return",
  "sales:discount_override",
  "products:view",
  "products:view_cost",
  "products:manage",
  "categories:manage",
  "inventory:view",
  "inventory:adjust",
  "purchases:view",
  "purchases:manage",
  "purchases:pay",
  "suppliers:view",
  "suppliers:manage",
  "customers:view",
  "customers:create",
  "customers:manage",
  "orders:view",
  "orders:manage",
  "expenses:view",
  "expenses:manage",
  "payments:view",
  "payments:record",
  "payments:reverse",
  "reports:view",
  "cash:view",
  "cash:manage",
  "sync:review",
];

const CASHIER_PERMISSIONS: Permission[] = [
  "pos:use",
  "sales:view",
  "products:view",
  "customers:view",
  "customers:create",
  "payments:record",
  "cash:view",
  "cash:manage",
];

const INVENTORY_PERMISSIONS: Permission[] = [
  "products:view",
  "products:view_cost",
  "products:manage",
  "categories:manage",
  "inventory:view",
  "inventory:adjust",
  "purchases:view",
  "purchases:manage",
  "suppliers:view",
  "suppliers:manage",
];

export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  OWNER: new Set(PERMISSIONS),
  MANAGER: new Set(MANAGER_PERMISSIONS),
  CASHIER: new Set(CASHIER_PERMISSIONS),
  INVENTORY_STAFF: new Set(INVENTORY_PERMISSIONS),
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

/** Landing page after login for each role. */
export function homePathFor(role: Role): string {
  if (can(role, "dashboard:view")) return "/dashboard";
  if (can(role, "pos:use")) return "/pos";
  return "/products";
}
