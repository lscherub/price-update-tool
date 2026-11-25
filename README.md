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
npm run seed   # no DATABASE_URL -> creates data/store.json + admin@example.com / admin123
npm run dev
npm test
```

`npm run seed` picks its target from the environment: with `DATABASE_URL` set it
seeds PostgreSQL and requires `ADMIN_EMAIL`/`ADMIN_PASSWORD` (nothing is
hardcoded); without it, it seeds the local `data/store.json` file store.

All API routes check `DATABASE_URL`: if set they use Prisma/Postgres, otherwise the local `data/store.json` file store. In production the file store is refused with `503 DatabaseUnavailable`.

## Production (Vercel + Supabase Postgres)

> **Seeing `P1001: Can't reach database server at db.<ref>.supabase.co:5432`?**
> That means `DATABASE_URL` is the **direct** connection string. Serverless
> functions on Vercel can't reliably reach it — switch `DATABASE_URL` to the
> **Supavisor transaction pooler** URI (port **6543**, `?pgbouncer=true`).
> Visit `/api/health` on your deployment for an automated diagnosis.
>
> **Production never uses the JSON file store.** If `DATABASE_URL` is missing on
> Vercel, every API route returns `503 DatabaseUnavailable` (fail closed) instead
> of silently writing to an ephemeral filesystem.

### 1. Create the database

1. Create the Supabase project (note the region — it must match the pooler host).
2. Project Settings → Database → Connection string, and copy **two** URIs:
   - **Transaction pooler** (port `6543`, ends with `?pgbouncer=true`) → this is
     the app's `DATABASE_URL` on Vercel.
   - **Direct connection** (port `5432`, host `db.<ref>.supabase.co`) → used only
     from your machine for migrations and seeding.
3. URL-encode special characters in the password (`@` → `%40`, `:` → `%3A`, …).

### 2. Apply migrations (from your machine, against the DIRECT 5432 URL)

```bash
# 0001_init creates the schema; 0002_unique_sku dedupes any existing duplicate
# SKUs and enforces one row per SKU. Both are idempotent.
DATABASE_URL="postgresql://postgres:[PASSWORD]@db.<ref>.supabase.co:5432/postgres" \
  npx prisma migrate deploy
```

Expected: `2 migrations found … Applying migration 0002_unique_sku`. The
migration keeps the newest row per duplicate SKU, re-points its price-update
rows to the survivor and then creates the `Product_sku_key` unique index — so it
cannot fail because of pre-existing duplicates.

If your database was previously created with `prisma db push`, baseline it once
so Prisma records the state instead of re-creating tables:

```bash
DATABASE_URL="postgresql://postgres:[PASSWORD]@db.<ref>.supabase.co:5432/postgres" \
  npx prisma migrate resolve --applied 0001_init
```

### 3. Seed (optional) — admin user comes from env, never from code

```bash
DATABASE_URL="postgresql://postgres:[PASSWORD]@db.<ref>.supabase.co:5432/postgres" \
ADMIN_EMAIL="you@example.com" \
ADMIN_PASSWORD="<a-strong-password-min-8-chars>" \
  npm run seed
```

### 4. Configure Vercel

| Variable | Value | Environments |
| --- | --- | --- |
| `DATABASE_URL` | Supabase **transaction pooler** URI (port `6543`, `?pgbouncer=true`) | Production, Preview, Development |
| `AUTH_SECRET` | `openssl rand -base64 48` (min 32 chars) — same value per environment family | Production, Preview, Development |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | only needed for `npm run seed`; not required at runtime | — |
| `SMTP2GO_API_KEY` | SMTP2GO API key (`Sending → API Keys`), server-only | Production, Preview |
| `SMTP2GO_FROM_EMAIL` | Verified sender email or address on a verified sender domain in SMTP2GO | Production, Preview |
| `SMTP2GO_FROM_NAME` | Sender display name (e.g. `Genesis Nutrition`) | Production, Preview |
| `APP_BASE_URL` | Full app URL for secure worksheet links in reminder emails | Production, Preview |
| `CRON_SECRET` | `openssl rand -hex 32` — authenticates Vercel Cron (`Authorization: Bearer`) | Production, Preview |
| `REMINDER_EMAILS_ENABLED` | Set to `true` after test verification to enable automated cron email sends | Production |

#### Price Update Calendar & Automated Reminders (Vercel Cron + SMTP2GO)

- **Sender Verification**: SMTP2GO requires `SMTP2GO_FROM_EMAIL` to be either a verified single sender or on a verified sender domain (DNS CNAME records for SPF/DKIM under **Sending → Verified Senders**). An API key alone will not guarantee delivery without sender verification.
- **Vercel Cron (`vercel.json`)**: Configured to run `/api/cron/process-reminders` every 15 minutes (`*/15 * * * *`, requires Vercel Pro). If deploying on Vercel Hobby (which restricts crons to once daily), update the `schedule` in `vercel.json` to a daily expression such as `0 16 * * *` (8:00 AM PST / 9:00 AM PDT) or invoke `/api/cron/process-reminders` from an external scheduler with `Authorization: Bearer <CRON_SECRET>`.
- **Testing Safely**: Keep `REMINDER_EMAILS_ENABLED="false"` while verifying setup, use **Settings → Price Update Calendar & Notifications → Send Test Email** with a test address, then set `REMINDER_EMAILS_ENABLED="true"` and redeploy.

Deploy/redeploy after saving the variables (env changes need a new build).

### 5. Verify the deployment

1. `GET https://<app>/api/health` → `{"ok":true,"db":{"configured":true,"reachable":true,…}}`.
   A `503` returns the exact remediation steps (pooler URI, paused project, wrong
   region, unencoded password).
2. Open `/login` → **First run? Create admin account** (only possible while the
   `AppUser` table is empty; afterwards account creation requires an admin session).
3. Upload an inventory file, create a price update, and download the POS CSV /
   Store Count PDF.

See `.env.example` for a copy-pasteable template.

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
