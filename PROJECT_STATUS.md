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
| 2 | Authentication, sessions, roles & permissions, staff management | ⏳ |
| 3 | Business settings, app shell, dashboard | ⏳ |
| 4 | Products, categories, inventory ledger, zero-stock archiving | ⏳ |
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
