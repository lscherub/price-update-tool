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

1. Create a Supabase project, copy the Postgres connection string.
2. In Vercel set env vars: `DATABASE_URL`, `AUTH_SECRET`.
3. Run migrations: `DATABASE_URL="..." npm run prisma:deploy`
4. Push to GitHub, import in Vercel, deploy.
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
