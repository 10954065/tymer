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
| 5 | Suppliers, stock purchases, supplier payments | ⏳ |
| 6 | POS checkout, sales, receipts, returns, voids | ⏳ |
| 7 | Customers, orders, payments ledger | ⏳ |
| 8 | Expenses, cash reconciliation | ⏳ |
| 9 | Financial reports, analytics, PDF/Excel/CSV export | ⏳ |
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
