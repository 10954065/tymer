import { can, type Permission, type Role } from "./permissions";

export type NavIcon =
  | "dashboard"
  | "pos"
  | "sales"
  | "products"
  | "categories"
  | "inventory"
  | "purchases"
  | "suppliers"
  | "customers"
  | "orders"
  | "expenses"
  | "payments"
  | "reports"
  | "cash"
  | "audit"
  | "staff"
  | "settings";

export interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
  permission: Permission;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAVIGATION: NavGroup[] = [
  {
    label: "Overview",
    items: [{ href: "/dashboard", label: "Dashboard", icon: "dashboard", permission: "dashboard:view" }],
  },
  {
    label: "Selling",
    items: [
      { href: "/pos", label: "POS / New Sale", icon: "pos", permission: "pos:use" },
      { href: "/sales", label: "Sales History", icon: "sales", permission: "sales:view" },
      { href: "/orders", label: "Orders", icon: "orders", permission: "orders:view" },
      { href: "/customers", label: "Customers", icon: "customers", permission: "customers:view" },
      { href: "/payments", label: "Payments", icon: "payments", permission: "payments:view" },
    ],
  },
  {
    label: "Stock",
    items: [
      { href: "/products", label: "Products", icon: "products", permission: "products:view" },
      { href: "/categories", label: "Categories", icon: "categories", permission: "categories:manage" },
      { href: "/inventory", label: "Inventory", icon: "inventory", permission: "inventory:view" },
      { href: "/purchases", label: "Purchases", icon: "purchases", permission: "purchases:view" },
      { href: "/suppliers", label: "Suppliers", icon: "suppliers", permission: "suppliers:view" },
    ],
  },
  {
    label: "Money",
    items: [
      { href: "/expenses", label: "Expenses", icon: "expenses", permission: "expenses:view" },
      { href: "/reports", label: "Financial Reports", icon: "reports", permission: "reports:view" },
      { href: "/cash", label: "Cash Reconciliation", icon: "cash", permission: "cash:view" },
    ],
  },
  {
    label: "Administration",
    items: [
      { href: "/audit", label: "Audit Logs", icon: "audit", permission: "audit:view" },
      { href: "/staff", label: "Staff & Permissions", icon: "staff", permission: "staff:manage" },
      { href: "/settings", label: "Settings", icon: "settings", permission: "settings:manage" },
    ],
  },
];

/** Navigation visible to a role. Hiding links is cosmetic; the server enforces access. */
export function navigationFor(role: Role): NavGroup[] {
  return NAVIGATION.map((group) => ({ ...group, items: group.items.filter((item) => can(role, item.permission)) })).filter(
    (group) => group.items.length > 0,
  );
}
