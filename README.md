# Price Update Tool (Next.js + TypeScript + PostgreSQL)

Replaces the Excel/VBA price-update workbook with a fast server-side web app.

## Stack

- Next.js 16 (App Router) + TypeScript + Tailwind
- PostgreSQL via Supabase (Prisma ORM) — with automatic local JSON-file fallback when `DATABASE_URL` is unset, so the app runs immediately for development
- Decimal-safe pricing (`decimal.js` + NUMERIC columns), bulk server-side batch processing, indexed lookups
- PDF generation (`pdf-lib`), Excel/CSV import (`xlsx`), JWT auth (`jose` + `bcryptjs`)

## Quick start (local, no DB required)

```bash
npm install
npm run seed
npm run dev
npm test
```

Seed creates `data/store.json` with sample products + `admin@example.com / admin123`.

All API routes check `DATABASE_URL`: if set they use Prisma/Postgres, otherwise the local `data/store.json` file store.

## Production (Vercel + Supabase Postgres)

> **Seeing `P1001: Can't reach database server at db.<ref>.supabase.co:5432`?**
> That means `DATABASE_URL` is the **direct** connection string. Serverless
> functions on Vercel can't reliably reach it — switch `DATABASE_URL` to the
> **Supavisor transaction pooler** URI (port **6543**, `?pgbouncer=true`).
> Visit `/api/health` on your deployment for an automated diagnosis.

1. In Supabase: Project Settings → Database → Connection string → copy the
   **Transaction pooler** URI
   (`postgresql://postgres.<ref>:[PASSWORD]@aws-0-<region>.pooler.supabase.com:6543/postgres?pgbouncer=true`).
   If your password contains special characters, URL-encode them.
2. In Vercel: set `DATABASE_URL` to that pooler URI (Production + Preview +
   Development) plus `AUTH_SECRET`, then **redeploy**.
3. Run migrations/seed **from your own machine** using the **direct**
   (port 5432) URL — never from serverless:
   `DATABASE_URL="postgresql://postgres:[PASSWORD]@db.<ref>.supabase.co:5432/postgres" npm run prisma:deploy`
4. Also check: Supabase project is not paused, and the pooler host region
   matches your project.
5. Open `/login` and create the first admin account.

See `.env.example`.

## Workflow

1. Inventory: upload POS export, then inactive SKU list (marks `isInactive`, never deletes).
2. Vendor Discounts: add/edit default discounts.
3. New Price Update: create session, paste rows or upload vendor file. Server normalizes SKUs in bulk, matches via indexed query, calculates prices.
4. Session review: 15 exact columns, editable cells highlighted, filters, manual Cleaned-SKU override (flagged, never overwritten).
5. Exports: POS CSV, Store Count CSV/PDF (excludes inactive; blank New Price when no list change).

## Pricing logic

- normalizeSku: trim, remove spaces/hyphens, remove final char (string-safe).
- Our New List Price = ROUND(vendor - vendor*discount/100, 2)
- Our New Retail Price = Our New List Price / divisor (default 0.605)
- Nearest 9: nearest price ending in 9 cents (ties up); exact .09 hit moves down (58.09 -> 57.99).
