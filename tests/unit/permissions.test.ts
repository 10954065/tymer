import { describe, expect, it } from "vitest";
import { can, homePathFor, PERMISSIONS } from "@/lib/permissions";

describe("role permissions", () => {
  it("gives the owner every permission", () => {
    expect(PERMISSIONS.every((p) => can("OWNER", p))).toBe(true);
  });

  it("restricts staff management, settings and audit logs to the owner", () => {
    for (const role of ["MANAGER", "CASHIER", "INVENTORY_STAFF"] as const) {
      expect(can(role, "staff:manage")).toBe(false);
      expect(can(role, "settings:manage")).toBe(false);
      expect(can(role, "audit:view")).toBe(false);
    }
  });

  it("lets managers run sales, inventory, customers, expenses and reports", () => {
    for (const p of ["pos:use", "inventory:adjust", "customers:manage", "expenses:manage", "reports:view"] as const) {
      expect(can("MANAGER", p)).toBe(true);
    }
  });

  it("limits cashiers to checkout, sales and receipts (no costs, reports or voids)", () => {
    expect(can("CASHIER", "pos:use")).toBe(true);
    expect(can("CASHIER", "sales:view")).toBe(true);
    expect(can("CASHIER", "products:view_cost")).toBe(false);
    expect(can("CASHIER", "reports:view")).toBe(false);
    expect(can("CASHIER", "sales:void")).toBe(false);
    expect(can("CASHIER", "dashboard:view")).toBe(false);
  });

  it("limits inventory staff to products, purchases and stock movements", () => {
    expect(can("INVENTORY_STAFF", "inventory:adjust")).toBe(true);
    expect(can("INVENTORY_STAFF", "purchases:manage")).toBe(true);
    expect(can("INVENTORY_STAFF", "purchases:pay")).toBe(false);
    expect(can("INVENTORY_STAFF", "pos:use")).toBe(false);
    expect(can("INVENTORY_STAFF", "expenses:view")).toBe(false);
  });

  it("routes each role to a page it can open", () => {
    expect(homePathFor("OWNER")).toBe("/dashboard");
    expect(homePathFor("CASHIER")).toBe("/pos");
    expect(homePathFor("INVENTORY_STAFF")).toBe("/products");
  });
});
