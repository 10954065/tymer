CREATE TYPE "public"."backup_status" AS ENUM('SUCCESS', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."cash_session_status" AS ENUM('OPEN', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."fulfilment_type" AS ENUM('COLLECTION', 'DELIVERY');--> statement-breakpoint
CREATE TYPE "public"."movement_type" AS ENUM('INITIAL_STOCK', 'PURCHASE', 'SALE', 'CUSTOMER_RETURN', 'DAMAGE', 'LOSS', 'MANUAL_ADJUSTMENT', 'REVERSAL');--> statement-breakpoint
CREATE TYPE "public"."order_item_kind" AS ENUM('PRODUCT', 'SERVICE');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('NEW', 'DEPOSIT_PAID', 'IN_PROGRESS', 'READY', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."payment_kind" AS ENUM('RECEIPT', 'REFUND', 'REVERSAL');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('CASH', 'MTN_MOMO', 'TELECEL_CASH', 'AT_MONEY', 'BANK_TRANSFER', 'CARD', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."product_status" AS ENUM('ACTIVE', 'OUT_OF_STOCK', 'ARCHIVED', 'DISCONTINUED');--> statement-breakpoint
CREATE TYPE "public"."purchase_status" AS ENUM('DRAFT', 'RECEIVED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."sale_status" AS ENUM('COMPLETED', 'VOIDED');--> statement-breakpoint
CREATE TYPE "public"."supplier_payment_kind" AS ENUM('PAYMENT', 'REVERSAL');--> statement-breakpoint
CREATE TYPE "public"."sync_conflict_status" AS ENUM('PENDING', 'RESOLVED_RECORDED', 'DISMISSED');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('OWNER', 'MANAGER', 'CASHIER', 'INVENTORY_STAFF');--> statement-breakpoint
CREATE SEQUENCE "public"."return_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "public"."sale_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "public"."order_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "public"."expense_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "public"."payment_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "public"."purchase_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "public"."supplier_payment_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_agent" varchar(255),
	"ip_address" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" varchar(120) NOT NULL,
	"username" varchar(60) NOT NULL,
	"email" varchar(160),
	"phone" varchar(30),
	"password_hash" text NOT NULL,
	"role" "user_role" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"failed_login_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_failed_attempts_ck" CHECK ("users"."failed_login_attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(80) NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_movements" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"product_id" uuid NOT NULL,
	"type" "movement_type" NOT NULL,
	"quantity_change" integer NOT NULL,
	"previous_quantity" integer NOT NULL,
	"new_quantity" integer NOT NULL,
	"unit_cost" bigint,
	"reference_type" varchar(32),
	"reference_id" uuid,
	"reason" text,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "movements_nonzero_ck" CHECK ("inventory_movements"."quantity_change" <> 0),
	CONSTRAINT "movements_balance_ck" CHECK ("inventory_movements"."new_quantity" = "inventory_movements"."previous_quantity" + "inventory_movements"."quantity_change")
);
--> statement-breakpoint
CREATE TABLE "product_price_changes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"product_id" uuid NOT NULL,
	"old_cost_price" bigint NOT NULL,
	"new_cost_price" bigint NOT NULL,
	"old_selling_price" bigint NOT NULL,
	"new_selling_price" bigint NOT NULL,
	"reason" text,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(160) NOT NULL,
	"sku" varchar(60) NOT NULL,
	"barcode" varchar(64),
	"category_id" uuid,
	"supplier_id" uuid,
	"description" text,
	"cost_price" bigint DEFAULT 0 NOT NULL,
	"selling_price" bigint NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"reorder_threshold" integer DEFAULT 5 NOT NULL,
	"initial_stock" integer DEFAULT 0 NOT NULL,
	"image_key" varchar(255),
	"status" "product_status" DEFAULT 'ACTIVE' NOT NULL,
	"out_of_stock_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"archive_reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_cost_ck" CHECK ("products"."cost_price" >= 0),
	CONSTRAINT "products_price_ck" CHECK ("products"."selling_price" >= 0),
	CONSTRAINT "products_reorder_ck" CHECK ("products"."reorder_threshold" >= 0),
	CONSTRAINT "products_initial_ck" CHECK ("products"."initial_stock" >= 0)
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"contact_person" varchar(120),
	"phone" varchar(30),
	"email" varchar(160),
	"address" text,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" varchar(120) NOT NULL,
	"phone" varchar(30),
	"email" varchar(160),
	"address" text,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sale_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sale_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"product_name" varchar(160) NOT NULL,
	"sku" varchar(60) NOT NULL,
	"quantity" integer NOT NULL,
	"unit_cost" bigint NOT NULL,
	"unit_price" bigint NOT NULL,
	"discount" bigint DEFAULT 0 NOT NULL,
	"tax" bigint DEFAULT 0 NOT NULL,
	"line_total" bigint NOT NULL,
	"returned_quantity" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "sale_items_qty_ck" CHECK ("sale_items"."quantity" > 0),
	CONSTRAINT "sale_items_returned_ck" CHECK ("sale_items"."returned_quantity" >= 0 and "sale_items"."returned_quantity" <= "sale_items"."quantity"),
	CONSTRAINT "sale_items_money_ck" CHECK ("sale_items"."unit_cost" >= 0 and "sale_items"."unit_price" >= 0 and "sale_items"."discount" >= 0 and "sale_items"."tax" >= 0),
	CONSTRAINT "sale_items_discount_ck" CHECK ("sale_items"."discount" <= "sale_items"."quantity" * "sale_items"."unit_price"),
	CONSTRAINT "sale_items_total_ck" CHECK ("sale_items"."line_total" = "sale_items"."quantity" * "sale_items"."unit_price" - "sale_items"."discount" + "sale_items"."tax")
);
--> statement-breakpoint
CREATE TABLE "sale_return_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"return_id" uuid NOT NULL,
	"sale_item_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"restocked" boolean NOT NULL,
	"value" bigint NOT NULL,
	"tax" bigint DEFAULT 0 NOT NULL,
	"unit_cost" bigint NOT NULL,
	CONSTRAINT "sale_return_items_qty_ck" CHECK ("sale_return_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "sale_returns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"return_number" varchar(20) DEFAULT 'RET-' || lpad(nextval('return_number_seq')::text, 6, '0') NOT NULL,
	"sale_id" uuid NOT NULL,
	"idempotency_key" varchar(100) NOT NULL,
	"reason" text NOT NULL,
	"value_total" bigint NOT NULL,
	"tax_total" bigint DEFAULT 0 NOT NULL,
	"restocked_cost_total" bigint DEFAULT 0 NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sale_returns_money_ck" CHECK ("sale_returns"."value_total" >= 0 and "sale_returns"."tax_total" >= 0 and "sale_returns"."restocked_cost_total" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sale_number" varchar(20) DEFAULT 'SAL-' || lpad(nextval('sale_number_seq')::text, 6, '0') NOT NULL,
	"idempotency_key" varchar(100) NOT NULL,
	"customer_id" uuid,
	"status" "sale_status" DEFAULT 'COMPLETED' NOT NULL,
	"subtotal" bigint NOT NULL,
	"discount_total" bigint DEFAULT 0 NOT NULL,
	"tax_total" bigint DEFAULT 0 NOT NULL,
	"total" bigint NOT NULL,
	"cost_total" bigint NOT NULL,
	"source" varchar(16) DEFAULT 'POS' NOT NULL,
	"device_id" varchar(64),
	"client_created_at" timestamp with time zone,
	"notes" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by" uuid,
	"void_reason" text,
	CONSTRAINT "sales_amounts_ck" CHECK ("sales"."subtotal" >= 0 and "sales"."discount_total" >= 0 and "sales"."tax_total" >= 0 and "sales"."cost_total" >= 0),
	CONSTRAINT "sales_total_ck" CHECK ("sales"."total" = "sales"."subtotal" - "sales"."discount_total" + "sales"."tax_total"),
	CONSTRAINT "sales_void_ck" CHECK (("sales"."status" = 'VOIDED') = ("sales"."voided_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "sync_devices" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"label" varchar(120),
	"last_sync_at" timestamp with time zone,
	"last_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"kind" "order_item_kind" NOT NULL,
	"product_id" uuid,
	"description" varchar(200) NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price" bigint NOT NULL,
	"line_total" bigint NOT NULL,
	"unit_cost" bigint,
	CONSTRAINT "order_items_qty_ck" CHECK ("order_items"."quantity" > 0),
	CONSTRAINT "order_items_total_ck" CHECK ("order_items"."line_total" = "order_items"."quantity" * "order_items"."unit_price" and "order_items"."unit_price" >= 0),
	CONSTRAINT "order_items_product_ck" CHECK (("order_items"."kind" = 'PRODUCT') = ("order_items"."product_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_number" varchar(20) DEFAULT 'ORD-' || lpad(nextval('order_number_seq')::text, 6, '0') NOT NULL,
	"customer_id" uuid NOT NULL,
	"title" varchar(160) NOT NULL,
	"description" text,
	"status" "order_status" DEFAULT 'NEW' NOT NULL,
	"total_amount" bigint DEFAULT 0 NOT NULL,
	"estimated_materials_cost" bigint DEFAULT 0 NOT NULL,
	"estimated_labour_cost" bigint DEFAULT 0 NOT NULL,
	"product_cost_total" bigint DEFAULT 0 NOT NULL,
	"expected_completion_date" date,
	"fulfilment" "fulfilment_type" DEFAULT 'COLLECTION' NOT NULL,
	"delivery_address" text,
	"delivery_notes" text,
	"internal_notes" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	CONSTRAINT "orders_money_ck" CHECK ("orders"."total_amount" >= 0 and "orders"."estimated_materials_cost" >= 0 and "orders"."estimated_labour_cost" >= 0 and "orders"."product_cost_total" >= 0),
	CONSTRAINT "orders_completed_ck" CHECK (("orders"."status" = 'COMPLETED') = ("orders"."completed_at" is not null)),
	CONSTRAINT "orders_cancelled_ck" CHECK (("orders"."status" = 'CANCELLED') = ("orders"."cancelled_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "cash_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_date" date NOT NULL,
	"status" "cash_session_status" DEFAULT 'OPEN' NOT NULL,
	"opening_balance" bigint NOT NULL,
	"opening_notes" text,
	"opened_by" uuid NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cash_received" bigint,
	"cash_refunds" bigint,
	"cash_expenses" bigint,
	"cash_supplier_payments" bigint,
	"expected_closing" bigint,
	"actual_closing" bigint,
	"difference" bigint,
	"explanation" text,
	"closed_by" uuid,
	"closed_at" timestamp with time zone,
	CONSTRAINT "cash_sessions_opening_ck" CHECK ("cash_sessions"."opening_balance" >= 0),
	CONSTRAINT "cash_sessions_closed_ck" CHECK ("cash_sessions"."status" = 'OPEN' or ("cash_sessions"."actual_closing" is not null and "cash_sessions"."expected_closing" is not null and "cash_sessions"."closed_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "expense_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(80) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expense_number" varchar(20) DEFAULT 'EXP-' || lpad(nextval('expense_number_seq')::text, 6, '0') NOT NULL,
	"description" varchar(200) NOT NULL,
	"amount" bigint NOT NULL,
	"category_id" uuid NOT NULL,
	"expense_date" date NOT NULL,
	"payment_method" "payment_method" NOT NULL,
	"order_id" uuid,
	"reversal_of_id" uuid,
	"attachment_key" varchar(255),
	"notes" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expenses_sign_ck" CHECK (("expenses"."reversal_of_id" is null and "expenses"."amount" > 0) or ("expenses"."reversal_of_id" is not null and "expenses"."amount" < 0))
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_number" varchar(20) DEFAULT 'PAY-' || lpad(nextval('payment_number_seq')::text, 6, '0') NOT NULL,
	"kind" "payment_kind" NOT NULL,
	"method" "payment_method" NOT NULL,
	"amount" bigint NOT NULL,
	"sale_id" uuid,
	"order_id" uuid,
	"customer_id" uuid,
	"return_id" uuid,
	"reverses_payment_id" uuid,
	"external_reference" varchar(100),
	"notes" text,
	"received_by" uuid NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_target_ck" CHECK (("payments"."sale_id" is not null) <> ("payments"."order_id" is not null)),
	CONSTRAINT "payments_sign_ck" CHECK (("payments"."kind" = 'RECEIPT' and "payments"."amount" > 0) or ("payments"."kind" <> 'RECEIPT' and "payments"."amount" < 0)),
	CONSTRAINT "payments_reversal_ck" CHECK (("payments"."kind" = 'REVERSAL') = ("payments"."reverses_payment_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "purchase_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"unit_cost" bigint NOT NULL,
	"line_total" bigint NOT NULL,
	CONSTRAINT "purchase_items_qty_ck" CHECK ("purchase_items"."quantity" > 0),
	CONSTRAINT "purchase_items_total_ck" CHECK ("purchase_items"."line_total" = "purchase_items"."quantity" * "purchase_items"."unit_cost" and "purchase_items"."unit_cost" >= 0)
);
--> statement-breakpoint
CREATE TABLE "purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_number" varchar(20) DEFAULT 'PUR-' || lpad(nextval('purchase_number_seq')::text, 6, '0') NOT NULL,
	"supplier_id" uuid NOT NULL,
	"status" "purchase_status" DEFAULT 'DRAFT' NOT NULL,
	"supplier_reference" varchar(100),
	"purchase_date" date NOT NULL,
	"total" bigint DEFAULT 0 NOT NULL,
	"notes" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"received_at" timestamp with time zone,
	"received_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	CONSTRAINT "purchases_total_ck" CHECK ("purchases"."total" >= 0)
);
--> statement-breakpoint
CREATE TABLE "supplier_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_number" varchar(20) DEFAULT 'SPY-' || lpad(nextval('supplier_payment_number_seq')::text, 6, '0') NOT NULL,
	"purchase_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"kind" "supplier_payment_kind" NOT NULL,
	"method" "payment_method" NOT NULL,
	"amount" bigint NOT NULL,
	"reverses_payment_id" uuid,
	"external_reference" varchar(100),
	"notes" text,
	"paid_by" uuid NOT NULL,
	"paid_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_payments_sign_ck" CHECK (("supplier_payments"."kind" = 'PAYMENT' and "supplier_payments"."amount" > 0) or ("supplier_payments"."kind" = 'REVERSAL' and "supplier_payments"."amount" < 0 and "supplier_payments"."reverses_payment_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"action" varchar(64) NOT NULL,
	"entity_type" varchar(40) NOT NULL,
	"entity_id" varchar(64),
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"reference" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backup_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" "backup_status" NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone NOT NULL,
	"size_bytes" bigint,
	"checksum" varchar(128),
	"verified" boolean DEFAULT false NOT NULL,
	"location" text,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"business_name" varchar(160) DEFAULT 'SMARTLIVING BUYNFRY VENTURES' NOT NULL,
	"address" text,
	"phone" varchar(60),
	"email" varchar(160),
	"receipt_footer" text DEFAULT 'Thank you for shopping with us!',
	"allow_negative_stock" boolean DEFAULT false NOT NULL,
	"default_reorder_threshold" integer DEFAULT 5 NOT NULL,
	"cashier_max_discount_bps" integer DEFAULT 1000 NOT NULL,
	"tax_rate_bps" integer DEFAULT 0 NOT NULL,
	"tax_label" varchar(40) DEFAULT 'VAT',
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_settings_singleton_ck" CHECK ("business_settings"."id" = 1),
	CONSTRAINT "business_settings_discount_ck" CHECK ("business_settings"."cashier_max_discount_bps" between 0 and 10000),
	CONSTRAINT "business_settings_tax_ck" CHECK ("business_settings"."tax_rate_bps" between 0 and 10000)
);
--> statement-breakpoint
CREATE TABLE "sync_conflicts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idempotency_key" varchar(100) NOT NULL,
	"device_id" varchar(64),
	"submitted_by" uuid,
	"payload" jsonb NOT NULL,
	"reason" varchar(40) NOT NULL,
	"details" jsonb,
	"status" "sync_conflict_status" DEFAULT 'PENDING' NOT NULL,
	"sale_id" uuid,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"resolution_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_price_changes" ADD CONSTRAINT "product_price_changes_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_price_changes" ADD CONSTRAINT "product_price_changes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_return_items" ADD CONSTRAINT "sale_return_items_return_id_sale_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."sale_returns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_return_items" ADD CONSTRAINT "sale_return_items_sale_item_id_sale_items_id_fk" FOREIGN KEY ("sale_item_id") REFERENCES "public"."sale_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_devices" ADD CONSTRAINT "sync_devices_last_user_id_users_id_fk" FOREIGN KEY ("last_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_opened_by_users_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_category_id_expense_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."expense_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_return_id_sale_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."sale_returns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_paid_by_users_id_fk" FOREIGN KEY ("paid_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_settings" ADD CONSTRAINT "business_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_conflicts" ADD CONSTRAINT "sync_conflicts_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_conflicts" ADD CONSTRAINT "sync_conflicts_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_conflicts" ADD CONSTRAINT "sync_conflicts_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_lower_uq" ON "users" USING btree (lower("username"));--> statement-breakpoint
CREATE UNIQUE INDEX "categories_name_lower_uq" ON "categories" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "movements_product_idx" ON "inventory_movements" USING btree ("product_id","id");--> statement-breakpoint
CREATE INDEX "movements_created_idx" ON "inventory_movements" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "movements_reference_idx" ON "inventory_movements" USING btree ("reference_type","reference_id");--> statement-breakpoint
CREATE INDEX "price_changes_product_idx" ON "product_price_changes" USING btree ("product_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "products_sku_upper_uq" ON "products" USING btree (upper("sku"));--> statement-breakpoint
CREATE UNIQUE INDEX "products_barcode_uq" ON "products" USING btree ("barcode") WHERE "products"."barcode" is not null;--> statement-breakpoint
CREATE INDEX "products_status_name_idx" ON "products" USING btree ("status","name");--> statement-breakpoint
CREATE INDEX "products_category_idx" ON "products" USING btree ("category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_name_lower_uq" ON "suppliers" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "customers_phone_uq" ON "customers" USING btree ("phone") WHERE "customers"."phone" is not null;--> statement-breakpoint
CREATE INDEX "customers_name_idx" ON "customers" USING btree (lower("full_name"));--> statement-breakpoint
CREATE INDEX "sale_items_sale_idx" ON "sale_items" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "sale_items_product_idx" ON "sale_items" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "sale_return_items_return_idx" ON "sale_return_items" USING btree ("return_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sale_returns_number_uq" ON "sale_returns" USING btree ("return_number");--> statement-breakpoint
CREATE UNIQUE INDEX "sale_returns_idempotency_uq" ON "sale_returns" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "sale_returns_sale_idx" ON "sale_returns" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "sale_returns_created_idx" ON "sale_returns" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_number_uq" ON "sales" USING btree ("sale_number");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_idempotency_uq" ON "sales" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "sales_created_idx" ON "sales" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "sales_customer_idx" ON "sales" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "order_items_order_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_number_uq" ON "orders" USING btree ("order_number");--> statement-breakpoint
CREATE INDEX "orders_customer_idx" ON "orders" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "orders_completed_idx" ON "orders" USING btree ("completed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cash_sessions_date_uq" ON "cash_sessions" USING btree ("business_date");--> statement-breakpoint
CREATE UNIQUE INDEX "expense_categories_name_lower_uq" ON "expense_categories" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "expenses_number_uq" ON "expenses" USING btree ("expense_number");--> statement-breakpoint
CREATE UNIQUE INDEX "expenses_reversal_uq" ON "expenses" USING btree ("reversal_of_id") WHERE "expenses"."reversal_of_id" is not null;--> statement-breakpoint
CREATE INDEX "expenses_date_idx" ON "expenses" USING btree ("expense_date");--> statement-breakpoint
CREATE INDEX "expenses_category_idx" ON "expenses" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "expenses_order_idx" ON "expenses" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_number_uq" ON "payments" USING btree ("payment_number");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_reverses_uq" ON "payments" USING btree ("reverses_payment_id") WHERE "payments"."reverses_payment_id" is not null;--> statement-breakpoint
CREATE INDEX "payments_sale_idx" ON "payments" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "payments_order_idx" ON "payments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "payments_customer_idx" ON "payments" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "payments_received_idx" ON "payments" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "purchase_items_purchase_idx" ON "purchase_items" USING btree ("purchase_id");--> statement-breakpoint
CREATE INDEX "purchase_items_product_idx" ON "purchase_items" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchases_number_uq" ON "purchases" USING btree ("purchase_number");--> statement-breakpoint
CREATE INDEX "purchases_supplier_idx" ON "purchases" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "purchases_date_idx" ON "purchases" USING btree ("purchase_date");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_payments_number_uq" ON "supplier_payments" USING btree ("payment_number");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_payments_reverses_uq" ON "supplier_payments" USING btree ("reverses_payment_id") WHERE "supplier_payments"."reverses_payment_id" is not null;--> statement-breakpoint
CREATE INDEX "supplier_payments_purchase_idx" ON "supplier_payments" USING btree ("purchase_id");--> statement-breakpoint
CREATE INDEX "supplier_payments_paid_idx" ON "supplier_payments" USING btree ("paid_at");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_user_idx" ON "audit_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "backup_runs_created_idx" ON "backup_runs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_conflicts_key_uq" ON "sync_conflicts" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "sync_conflicts_status_idx" ON "sync_conflicts" USING btree ("status","created_at");