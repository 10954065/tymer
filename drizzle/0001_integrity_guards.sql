-- Financial integrity guards enforced by the database itself, independent of application code.
-- TRUNCATE is intentionally not blocked (used only by the isolated test database).

-- Self-referencing reversal links.
ALTER TABLE "payments" ADD CONSTRAINT "payments_reverses_fk" FOREIGN KEY ("reverses_payment_id") REFERENCES "payments"("id");--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_reverses_fk" FOREIGN KEY ("reverses_payment_id") REFERENCES "supplier_payments"("id");--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_reversal_fk" FOREIGN KEY ("reversal_of_id") REFERENCES "expenses"("id");--> statement-breakpoint

-- 1. Append-only ledgers: no UPDATE or DELETE ever.
CREATE OR REPLACE FUNCTION slb_forbid_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Records in % are append-only (% blocked). Use a reversal or correction entry.', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER inventory_movements_append_only BEFORE UPDATE OR DELETE ON "inventory_movements" FOR EACH ROW EXECUTE FUNCTION slb_forbid_change();--> statement-breakpoint
CREATE TRIGGER payments_append_only BEFORE UPDATE OR DELETE ON "payments" FOR EACH ROW EXECUTE FUNCTION slb_forbid_change();--> statement-breakpoint
CREATE TRIGGER supplier_payments_append_only BEFORE UPDATE OR DELETE ON "supplier_payments" FOR EACH ROW EXECUTE FUNCTION slb_forbid_change();--> statement-breakpoint
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON "audit_logs" FOR EACH ROW EXECUTE FUNCTION slb_forbid_change();--> statement-breakpoint
CREATE TRIGGER price_changes_append_only BEFORE UPDATE OR DELETE ON "product_price_changes" FOR EACH ROW EXECUTE FUNCTION slb_forbid_change();--> statement-breakpoint
CREATE TRIGGER sale_returns_append_only BEFORE UPDATE OR DELETE ON "sale_returns" FOR EACH ROW EXECUTE FUNCTION slb_forbid_change();--> statement-breakpoint
CREATE TRIGGER sale_return_items_append_only BEFORE UPDATE OR DELETE ON "sale_return_items" FOR EACH ROW EXECUTE FUNCTION slb_forbid_change();--> statement-breakpoint

-- 2. Important business records can never be deleted (archive / void / cancel instead).
CREATE OR REPLACE FUNCTION slb_forbid_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Records in % cannot be deleted. Archive, void or cancel them instead.', TG_TABLE_NAME
    USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER products_no_delete BEFORE DELETE ON "products" FOR EACH ROW EXECUTE FUNCTION slb_forbid_delete();--> statement-breakpoint
CREATE TRIGGER sales_no_delete BEFORE DELETE ON "sales" FOR EACH ROW EXECUTE FUNCTION slb_forbid_delete();--> statement-breakpoint
CREATE TRIGGER sale_items_no_delete BEFORE DELETE ON "sale_items" FOR EACH ROW EXECUTE FUNCTION slb_forbid_delete();--> statement-breakpoint
CREATE TRIGGER orders_no_delete BEFORE DELETE ON "orders" FOR EACH ROW EXECUTE FUNCTION slb_forbid_delete();--> statement-breakpoint
CREATE TRIGGER expenses_no_delete BEFORE DELETE ON "expenses" FOR EACH ROW EXECUTE FUNCTION slb_forbid_delete();--> statement-breakpoint
CREATE TRIGGER customers_no_delete BEFORE DELETE ON "customers" FOR EACH ROW EXECUTE FUNCTION slb_forbid_delete();--> statement-breakpoint
CREATE TRIGGER cash_sessions_no_delete BEFORE DELETE ON "cash_sessions" FOR EACH ROW EXECUTE FUNCTION slb_forbid_delete();--> statement-breakpoint
CREATE TRIGGER sync_conflicts_no_delete BEFORE DELETE ON "sync_conflicts" FOR EACH ROW EXECUTE FUNCTION slb_forbid_delete();--> statement-breakpoint

CREATE OR REPLACE FUNCTION slb_purchases_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Purchases cannot be deleted. Cancel them instead.' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.status = 'RECEIVED' AND (NEW.total <> OLD.total OR NEW.supplier_id <> OLD.supplier_id OR NEW.status <> OLD.status) THEN
    RAISE EXCEPTION 'A received purchase is final; its amounts, supplier and status cannot change.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER purchases_guard BEFORE UPDATE OR DELETE ON "purchases" FOR EACH ROW EXECUTE FUNCTION slb_purchases_guard();--> statement-breakpoint

CREATE OR REPLACE FUNCTION slb_purchase_items_guard() RETURNS trigger AS $$
DECLARE
  parent_status purchase_status;
BEGIN
  SELECT status INTO parent_status FROM purchases WHERE id = COALESCE(OLD.purchase_id, NEW.purchase_id);
  IF parent_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Items of a % purchase cannot be changed.', parent_status USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER purchase_items_guard BEFORE UPDATE OR DELETE ON "purchase_items" FOR EACH ROW EXECUTE FUNCTION slb_purchase_items_guard();--> statement-breakpoint

-- 3. Frozen financial columns.
CREATE OR REPLACE FUNCTION slb_sales_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.subtotal <> OLD.subtotal OR NEW.discount_total <> OLD.discount_total OR NEW.tax_total <> OLD.tax_total
     OR NEW.total <> OLD.total OR NEW.cost_total <> OLD.cost_total OR NEW.created_at <> OLD.created_at
     OR NEW.idempotency_key <> OLD.idempotency_key OR NEW.sale_number <> OLD.sale_number THEN
    RAISE EXCEPTION 'Sale amounts are immutable. Use a return or void.' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.status = 'VOIDED' AND NEW.status <> 'VOIDED' THEN
    RAISE EXCEPTION 'A voided sale cannot be reinstated.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER sales_guard BEFORE UPDATE ON "sales" FOR EACH ROW EXECUTE FUNCTION slb_sales_guard();--> statement-breakpoint

CREATE OR REPLACE FUNCTION slb_sale_items_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.sale_id <> OLD.sale_id OR NEW.product_id <> OLD.product_id OR NEW.product_name <> OLD.product_name
     OR NEW.sku <> OLD.sku OR NEW.quantity <> OLD.quantity OR NEW.unit_cost <> OLD.unit_cost
     OR NEW.unit_price <> OLD.unit_price OR NEW.discount <> OLD.discount OR NEW.tax <> OLD.tax
     OR NEW.line_total <> OLD.line_total THEN
    RAISE EXCEPTION 'Sale item snapshots are immutable.' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.returned_quantity < OLD.returned_quantity THEN
    RAISE EXCEPTION 'Returned quantity can only increase.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER sale_items_guard BEFORE UPDATE ON "sale_items" FOR EACH ROW EXECUTE FUNCTION slb_sale_items_guard();--> statement-breakpoint

CREATE OR REPLACE FUNCTION slb_expenses_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.amount <> OLD.amount OR NEW.expense_date <> OLD.expense_date OR NEW.payment_method <> OLD.payment_method
     OR NEW.reversal_of_id IS DISTINCT FROM OLD.reversal_of_id OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'Expense amount, date and payment method are immutable. Record a correction instead.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER expenses_guard BEFORE UPDATE ON "expenses" FOR EACH ROW EXECUTE FUNCTION slb_expenses_guard();--> statement-breakpoint

CREATE OR REPLACE FUNCTION slb_orders_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.status IN ('COMPLETED', 'CANCELLED') AND (
       NEW.status <> OLD.status OR NEW.total_amount <> OLD.total_amount OR NEW.product_cost_total <> OLD.product_cost_total
       OR NEW.customer_id <> OLD.customer_id) THEN
    RAISE EXCEPTION 'A % order is final.', OLD.status USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER orders_guard BEFORE UPDATE ON "orders" FOR EACH ROW EXECUTE FUNCTION slb_orders_guard();--> statement-breakpoint

CREATE OR REPLACE FUNCTION slb_cash_sessions_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'CLOSED' THEN
    RAISE EXCEPTION 'A closed cash session is final.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER cash_sessions_guard BEFORE UPDATE ON "cash_sessions" FOR EACH ROW EXECUTE FUNCTION slb_cash_sessions_guard();--> statement-breakpoint

-- 4. Reference data.
INSERT INTO "business_settings" ("id") VALUES (1) ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "expense_categories" ("name") VALUES
  ('Rent'), ('Electricity'), ('Water'), ('Internet'), ('Transportation'), ('Staff salaries'),
  ('Marketing'), ('Packaging'), ('Repairs'), ('Maintenance'), ('Business supplies'),
  ('Order materials'), ('Order labour'), ('Miscellaneous')
ON CONFLICT DO NOTHING;
