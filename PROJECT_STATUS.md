# Project Status — SMARTLIVING BUYNFRY VENTURES POS

Tracks phase-by-phase delivery of the POS and business management system.
Each phase is committed separately once its tests pass.

## Phase 0 — Environment inspection ✅

- Empty working directory; empty remote repository (`github.com/10954065/tymer`).
- Toolchain: Node 24, npm 11, Docker 29 (local PostgreSQL 17 for dev/tests), GitHub CLI.
- Scaffolded Next.js 16.4 (App Router, TypeScript strict, Tailwind v4) and shadcn/ui (Radix, Nova preset).

### Key architecture decisions

| Decision | Choice | Reason |
| --- | --- | --- |
| ORM | Drizzle ORM + `node-postgres` | Thin SQL layer, explicit queries, portable to any PostgreSQL (Neon pooled URL works unchanged). |
| Money | Integer pesewas (`bigint`) | No floating-point arithmetic anywhere. BigInt for multiplication/division rounding. |
| Auth | Own server-side sessions (hashed tokens in PostgreSQL) + bcrypt | No paid auth provider; authorization enforced server-side on every action. |
| Caching | `cacheComponents: false`, `unstable_cache` + tags | Every page is session-gated; explicit tag invalidation after each transaction keeps figures exact. |
| Integrity | DB triggers + CHECK constraints | Ledgers are append-only, financial records cannot be deleted, sale snapshots are immutable. |
| Offline | Service worker + Dexie (IndexedDB) queue + idempotency keys | Sales recorded offline are replayed safely; conflicts are kept for owner review. |
| Files | S3-compatible object storage (e.g. Cloudflare R2), local disk in dev | Keeps images out of PostgreSQL storage. |

## Phased plan

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Foundation, architecture, schema, migrations, integrity triggers | ✅ Complete |
| 2 | Authentication, sessions, roles & permissions, staff management | ✅ Complete |
| 3 | Business settings, app shell, dashboard | ✅ Complete |
| 4 | Products, categories, inventory ledger, zero-stock archiving | ✅ Complete |
| 5 | Suppliers, stock purchases, supplier payments | ✅ Complete |
| 6 | POS checkout, sales, receipts, returns, voids | ✅ Complete |
| 7 | Customers, orders, payments ledger | ✅ Complete |
| 8 | Expenses, cash reconciliation | ✅ Complete |
| 9 | Financial reports, analytics, PDF/Excel/CSV export | ✅ Complete |
| 10 | PWA, offline queue, synchronisation, conflict review | ⏳ |
| 11 | Audit trail UI, security hardening, DB health & optimisation | ⏳ |
| 12 | Backups, deployment, documentation, final verification | ⏳ |

---

## Phase 1 — Foundation, schema and migrations ✅

**Implemented**

- Project scaffold, strict TypeScript, Tailwind v4, shadcn/ui component set.
- Domain schema (Drizzle) split by area: `auth`, `catalog`, `sales`, `orders`, `finance`, `system`.
- Migration `0000_initial_schema` (tables, indexes, CHECK constraints, document-number sequences).
- Migration `0001_integrity_guards` (append-only ledgers, delete protection, frozen financial
  columns, self-referencing reversal FKs, default settings row and expense categories).
- Money utilities (pesewas parsing/formatting, BigInt rounding, pro-rata allocation).
- Business date utilities (Africa/Accra, DD/MM/YYYY, day/week/month/year ranges).
- Pooled database client tuned for Neon scale-to-zero (short idle timeout, small pool).
- Test harness: Vitest against a real local PostgreSQL; migrations rebuilt on every run.

**Files**: `src/server/db/**`, `drizzle/**`, `src/lib/{money,dates,errors,utils}.ts`, `scripts/migrate.ts`,
`docker-compose.yml`, `scripts/docker-init.sql`, `vitest.config.ts`, `tests/**`, `DATABASE_DESIGN.md`.

**Migrations**: `0000_initial_schema`, `0001_integrity_guards`.

**Tests**: 37 passing (money, dates, schema integrity: append-only ledgers, delete protection,
balance checks, SKU uniqueness, payment sign rules, immutable sales/expenses, sequences). `tsc --noEmit` clean.

**Unresolved**: none.

---

## Phase 2 — Authentication, roles and staff management ✅

**Implemented**

- Server-side sessions: 256-bit random cookie token, only its SHA-256 hash stored; `httpOnly`, `sameSite=lax`,
  `secure` in production; sliding expiry refreshed at most hourly (minimises database writes).
- bcrypt (cost 12) password hashing, password policy, timing-equalised unknown-user path.
- Account lockout after 5 failed attempts (15 minutes) plus per-IP in-memory rate limit on sign-in.
- Forced password change for staff created/reset by the owner.
- Role/permission matrix (`OWNER`, `MANAGER`, `CASHIER`, `INVENTORY_STAFF`) shared by server and navigation.
  Every page calls `requirePagePermission`, every action calls `requireActionPermission`.
- `proxy.ts` performs optimistic redirects only; authorisation always happens on the server.
- Staff & Permissions page: create, edit role/details, deactivate, reset password, unlock; last-owner and
  self-deactivation protection; role changes sign the user out everywhere; all changes audited (changed fields only).
- App shell: collapsible sidebar filtered by role, mobile sheet navigation, light/dark theme, user menu.
- Design system: warm linen ground, white surfaces, charcoal text, forest-green accent, Fraunces + Geist.
- Safe action error handling (`runAction`): business errors shown, database/unknown errors never leaked.
- Seed script creating the first owner from environment variables.

**Files**: `src/server/auth/**`, `src/server/services/{auth,users,audit,settings}.ts`, `src/server/actions/{run,auth,users}.ts`,
`src/proxy.ts`, `src/lib/{permissions,navigation}.ts`, `src/lib/validation/**`, `src/components/app/**`,
`src/app/(auth)/login/**`, `src/app/(app)/{layout,loading,error}.tsx`, `src/app/(app)/{staff,account,no-access}/**`, `scripts/seed.ts`.

**Migrations**: none.

**Tests**: 59 passing (auth: sign-in, generic errors, lockout, expiry, deactivation, password change; staff:
creation, duplicates, last-owner rule, self-deactivation, session revocation on role change, password reset,
bootstrap; permission matrix). `tsc`, `eslint`, `next build` clean. Manual browser check: login → forced password
change → staff creation.

**Unresolved**: none.

---

## Phase 3 — Business settings and dashboard ✅

**Implemented**

- Financial engine (`src/server/services/reports/financials.ts`): one aggregated SQL round-trip per period for
  gross sales, discounts, returns, order revenue (on completion only), net revenue, tax, COGS (historical cost
  snapshots, restocked returns, order product and direct costs), gross profit, operating expenses (reversals net out,
  stock purchases excluded), net operating profit and cash collected. Plus receivables (sales, completed orders,
  open orders, customer credit), inventory valuation (qty × weighted-average cost), daily trend and payment-method split.
- Dashboard: today's revenue / collected / gross profit, receivables, inventory value, monthly revenue, gross profit,
  operating expenses, net operating profit, low-stock list, recent sales and a 30-day revenue vs gross-profit chart.
  Cached with `unstable_cache` (tag `dashboard`), invalidated by every financial transaction, 5-minute fallback.
- Business settings page (owner only): business details, receipt footer, tax rate, cashier discount limit,
  default reorder level, negative-stock policy. Whitelisted fields, audited changes, cache invalidation.
- Shared UI: `StatCard`, `Money`, chart tooltip, dashboard hero.

**Files**: `src/server/services/reports/{financials,dashboard}.ts`, `src/server/queries/{dashboard,settings}.ts`,
`src/server/actions/settings.ts`, `src/server/cache.ts`, `src/lib/validation/settings.ts`, `src/app/(app)/{dashboard,settings}/**`,
`src/components/app/{money,stat-card}.tsx`.

**Migrations**: none.

**Tests**: 69 passing, including a hand-calculated financial scenario (discounted sale, partial payment, voided sale,
return + refund, completed order with direct cost, open order deposit, expense correction, out-of-period expense) checking
revenue, COGS, gross/net profit, cash collected, receivables, inventory valuation, payment-method split and daily trend.
`tsc`, `eslint`, `next build` clean. Browser check of dashboard and settings save (audit row verified in PostgreSQL).

**Unresolved**: none.

---

## Phase 4 — Products, categories and inventory ✅

**Implemented**

- `applyStockChange`: the single path for stock changes. Locks the product row (`SELECT … FOR UPDATE`), blocks
  negative stock unless the business setting allows it, updates quantity and status, writes exactly one ledger row.
- **Automatic zero-stock archiving**: when stock reaches zero an ACTIVE product becomes `OUT_OF_STOCK`, leaves the
  POS catalogue, `out_of_stock_at` is recorded and an audit entry written. SKU, prices, sales, movements and profit history are untouched.
- **Restock & reactivate**: `receiveStock` adds stock to the existing record (never a duplicate), recomputes the
  weighted-average cost (with price history) and returns the product to the catalogue. Manually archived/discontinued
  products only return when reactivation is explicitly requested.
- Damage, loss and manual adjustments with mandatory reasons; manual archive / discontinue / reactivate.
- Product CRUD with SKU auto-generation, case-insensitive unique SKU, unique barcode, price change history.
- Lifetime product statistics: opening stock, purchased, sold, returned, written off, revenue, COGS, gross profit, last sale.
- Categories with product counts. Inventory page: stock on hand with valuation, low stock, archived/out-of-stock
  view (with dates and "History & restock"), and the keyset-paginated movement ledger with type filters.
- Image storage outside PostgreSQL: browser-side WebP compression (≤800px), authenticated upload with magic-byte
  validation, S3-compatible driver (Cloudflare R2) or local disk in development, authenticated file serving.
- Cost prices are hidden from (and cannot be changed by) roles without `products:view_cost`.

**Files**: `src/server/services/{inventory,products,categories,suppliers}.ts`, `src/server/actions/products.ts`,
`src/server/storage/index.ts`, `src/app/api/{uploads,files}/**`, `src/lib/client/image.ts`, `src/lib/validation/products.ts`,
`src/app/(app)/{products,categories,inventory}/**`, `src/components/app/{product-form,image-upload,product-thumb,status-badges,pagination-links,search-box}.tsx`.

**Migrations**: none (schema from Phase 1).

**Tests**: 86 passing. New: opening stock ledger entry, automatic archive at zero (catalogue exclusion, audit,
preserved history), negative stock prevention and override, restock + reactivation with weighted-average cost,
manual-archive protection, damage/loss/adjustment rules, **12 concurrent sales of 5 units → exactly 5 succeed**,
ledger = quantity invariant, product statistics, SKU generation/uniqueness, price history, list filters, categories.
Browser check: product creation → detail page with ledger.

**Unresolved**: none.

---

## Phase 5 — Suppliers and stock purchases ✅

**Implemented**

- Suppliers (name, contact person, phone, email, address, notes, active flag) with purchase totals and outstanding balances.
- Purchases: `DRAFT` (ordered / on the way) → `RECEIVED` (stock in, weighted-average cost, sold-out products reactivated,
  ledger rows referencing the purchase) or `CANCELLED` (drafts only, no outstanding payments). Received purchases are final (DB trigger).
- Multi-line purchase form with searchable product picker, auto-filled unit cost and live total; optional "received now".
- Supplier payment ledger (append-only): partial payments, overpayment prevention, reversals via equal negative entries.
- Purchases are **not** operating expenses and are not COGS; they raise inventory value. COGS is recognised at sale.

**Files**: `src/server/services/{suppliers,purchases}.ts`, `src/server/actions/purchases.ts`, `src/lib/validation/purchases.ts`,
`src/components/app/product-picker.tsx`, `src/app/(app)/{suppliers,purchases}/**`, route-level `loading.tsx` files.

**Migrations**: none.

**Tests**: 93 passing. New: drafts do not move stock; receiving updates stock, ledger and weighted-average cost and
reactivates sold-out products; double receive blocked; purchases excluded from expenses/COGS; payments, overpayment
guard, reversals (and double reversal guard); draft editing; cancellation rules; duplicate/empty line validation.

**Unresolved**: none.

---

## Phase 6 — POS checkout, sales, receipts, returns and voids ✅

**Implemented**

- Atomic checkout (`services/sales.ts`): idempotency check → product row locks in stable order → server-side prices
  → line + cart discounts (pro-rata, exact) and tax per line → cashier discount limit → sale + immutable item snapshots
  (name, SKU, unit cost, unit price, discount, tax, line total) → stock deduction through the ledger (auto-archive at zero)
  → payments (multiple methods, cash change, partial payment only for named customers) → audit. Any failure rolls back everything.
- Duplicate prevention: unique idempotency key per sale; concurrent duplicates resolve to the original sale
  (unique-violation recovery); the POS keeps the key across retries and renews it only after success.
- POS terminal: product grid with images and stock, search, category chips, barcode scanner support (scan + Enter adds
  by barcode/SKU), cart with quantity/line discounts/cart discount, live totals using the same pricing code as the
  server, customer search and quick-add, split-payment checkout with change due, mobile bottom-sheet cart.
- Sales history with period filters (today/week/month/year/custom), search, unpaid filter; sale detail with snapshots,
  payments, returns; printable 80 mm receipt.
- Returns: partial/multiple returns with exact cumulative pro-rata values, restock only goods accepted back
  (CUSTOMER_RETURN at original cost), refunds capped by what was paid, revenue and COGS adjusted in the return period.
- Voids (manager/owner): stock restored with REVERSAL movements, receipts reversed, sale excluded from revenue.
- Balance payments and payment reversals (append-only; originals never edited).
- Shared customers and payments services (used fully in Phase 7).

**Files**: `src/lib/pricing.ts`, `src/server/services/{sales,returns,payments,customers}.ts`, `src/server/actions/sales.ts`,
`src/server/queries/catalog.ts`, `src/lib/validation/sales.ts`, `src/app/(app)/{pos,sales}/**`, `src/app/receipts/[id]/**`,
`src/components/app/{money-dialogs,period-picker}.tsx`.

**Migrations**: none.

**Tests**: 109 passing. New: cart pricing (discount allocation, tax, exact totals), tender settlement (change, cash-only
over-tender), full sale with snapshots/ledger/payments, snapshot immutability after product edits, partial + balance
payments, multiple payment methods, cashier discount limit, triple concurrent submission → one sale, 5 concurrent
devices for 2 units → 2 sales and auto-archive, configured tax, returns (restocked vs damaged, refund cap, exact
partial splits, over-return guard), voids, payment reversal. Browser check: scan-to-cart → checkout → receipt.

**Unresolved**: none.

---

## Phase 7 — Customers, orders and payments ✅

**Implemented**

- Customer profiles (name, unique phone, email, address, notes) with lifetime spend, outstanding balance, repeat
  badge, purchase/order/payment history; sorting by name, top spenders and balances owed.
- Orders for custom decoration work: products (stock items) and services, agreed price, estimated materials and labour,
  expected completion, collection/delivery details, internal notes. Lifecycle NEW → DEPOSIT_PAID (on first payment)
  → IN_PROGRESS → READY → COMPLETED, or CANCELLED.
- Deposits and additional payments go to the payment ledger — **never revenue by themselves**. Revenue is recognised
  when the order is completed; stocked items are then deducted with cost snapshots. Direct costs are expenses linked
  to the order (Phase 8). Order profitability: estimated vs actual (price − products used − direct costs).
- Cancellation with capped refunds; edits blocked below the amount already paid; completed/cancelled orders are final.
- Payments ledger page: per-method totals, filters by period and method, links to sales and orders. No double counting:
  every payment belongs to exactly one sale or one order (DB constraint).

**Files**: `src/server/services/orders.ts`, `src/server/actions/orders.ts`, `src/lib/validation/orders.ts`,
`src/app/(app)/{orders,customers,payments}/**`, `src/components/app/order-status-badge.tsx`.

**Migrations**: none.

**Tests**: 114 passing. New: deposit is cash not revenue; completion recognises revenue, deducts stock with cost snapshot,
includes direct costs in COGS; receivables split between open and completed orders; multiple payments and overpayment
guard; cancellation refund cap and no revenue; edits never below amount paid; customer spend and balance summary.

**Unresolved**: none.

---

## Phase 8 — Expenses and cash management ✅

**Implemented**

- Expenses with category, date, payment method, optional order link (direct order cost), optional receipt attachment
  (compressed image or PDF in object storage) and notes. Default categories seeded (rent, utilities, transport, salaries…).
- Corrections never edit money: a reversal entry (same date, negative) plus an optional replacement; non-financial
  details editable with audit. Order-linked expenses are excluded from operating expenses and included in order COGS.
- Expenses page: period filter, operating vs direct totals, category breakdown, receipt links, reversal action.
- Daily cash reconciliation: opening float (suggested from the previous count), live cash received / refunds / cash
  expenses / cash supplier payments, expected closing, counted cash, difference with mandatory explanation; closing
  snapshots the figures and makes the day final (DB trigger). History of all reconciliations with staff responsible.

**Files**: `src/server/services/{expenses,cash}.ts`, `src/server/actions/expenses.ts`, `src/lib/validation/expenses.ts`,
`src/app/(app)/{expenses,cash}/**`.

**Migrations**: none.

**Tests**: 118 passing. New: expenses reduce net operating profit; reversal + replacement keeps exact totals and history;
detail-only edits; cash movements by method, expected closing, difference explanation rule, final closed day, one session per day.

**Unresolved**: none.

---

## Phase 9 — Financial reports and analytics ✅

**Implemented**

- Report engine (`services/reports/tables.ts`) producing typed tables for: profit & loss, sales by day/week/month,
  product performance (best sellers first, slow movers flagged, net of returns, margin), inventory valuation,
  stock movements by type, payment methods, operating expenses by category, customer balances, order profitability.
- Reports page: daily/weekly/monthly/yearly/custom periods, KPI strip (net revenue, COGS, gross profit, operating
  expenses, net operating profit), revenue/profit chart, report navigation, totals rows.
- Exports from the same data: CSV (UTF-8 BOM, formula-injection safe), Excel (exceljs, typed number formats),
  PDF (generated in the browser with jsPDF so the server does no heavy work), and print stylesheet. Exports are
  permission-checked, rate-limited and audited.

**Files**: `src/server/services/reports/{tables,export}.ts`, `src/app/api/exports/[report]/route.ts`, `src/app/(app)/reports/**`.

**Migrations**: none.

**Tests**: 122 passing. New: P&L lines equal the financial summary; product performance nets returns and computes
margin; slow movers flagged; every report builds; inventory totals; CSV escaping/injection guard; valid XLSX output.
(Hand-calculated examples for revenue, COGS, gross/net profit, receivables and valuation were added in Phases 3, 6 and 7.)

**Unresolved**: none.
