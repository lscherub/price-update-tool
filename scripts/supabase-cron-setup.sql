-- =============================================================================
-- Supabase Cron (pg_cron) + pg_net + Supabase Vault Setup
-- Genesis Pricing Application — Automated Price Update Reminders
-- =============================================================================
-- Run this in the Supabase Dashboard -> SQL Editor (as postgres).
-- NEVER commit real secret values to GitHub. Replace the two placeholder values
-- in Step 2 directly inside the Supabase SQL Editor before executing.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- STEP 1: Ensure required extensions are enabled (safe & idempotent)
-- -----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- -----------------------------------------------------------------------------
-- STEP 2: Store the Vercel endpoint URL and shared CRON_SECRET in Supabase Vault
-- -----------------------------------------------------------------------------
-- Remove any prior versions of these two Vault secrets so re-running is safe:
DELETE FROM vault.secrets
WHERE name IN ('calendar_cron_endpoint_url', 'calendar_cron_secret');

-- Replace BOTH placeholder values below before running in Supabase SQL Editor:
--   1) Your deployed Vercel URL + /api/cron/process-reminders
--   2) The EXACT same CRON_SECRET value configured in Vercel Environment Variables
SELECT vault.create_secret(
  'https://YOUR-APP.vercel.app/api/cron/process-reminders',
  'calendar_cron_endpoint_url',
  'Genesis Pricing reminder processor endpoint'
);

SELECT vault.create_secret(
  'REPLACE_WITH_YOUR_VERCEL_CRON_SECRET',
  'calendar_cron_secret',
  'Shared Bearer secret matching Vercel CRON_SECRET'
);

-- -----------------------------------------------------------------------------
-- STEP 3: Schedule the pg_cron job (initially EVERY MINUTE for testing)
-- -----------------------------------------------------------------------------
-- Unschedule first if a job with this name already exists:
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-price-update-reminders') THEN
    PERFORM cron.unschedule('process-price-update-reminders');
  END IF;
END $$;

-- Schedule every minute ('* * * * *') for end-to-end testing:
SELECT cron.schedule(
  'process-price-update-reminders',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'calendar_cron_endpoint_url' LIMIT 1),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'calendar_cron_secret' LIMIT 1)
    ),
    body := jsonb_build_object('source', 'supabase-pg-cron', 'triggeredAt', now()),
    timeout_milliseconds := 25000
  ) AS request_id;
  $$
);

-- =============================================================================
-- STEP 4: Changing Frequency for Normal Production Operation
-- =============================================================================
-- Delivery delay expectations by frequency:
--   '* * * * *'     -> Every minute        (up to ~1 minute delay — best for testing)
--   '*/5 * * * *'   -> Every 5 minutes     (up to 5 minutes delay — great for custom times)
--   '*/15 * * * *'  -> Every 15 minutes    (up to 15 minutes delay — balanced production default)
--   '0 * * * *'     -> Every hour          (up to 1 hour delay)
--   '0 16 * * *'    -> Daily at 16:00 UTC  (8 AM PST / 9 AM PDT; custom afternoon reminders
--                                           could wait up to ~24 hours until next run)
--
-- To change frequency without touching app code, run ONE of these in SQL Editor:
--
--   SELECT cron.schedule('process-price-update-reminders', '*/5 * * * *',  command) FROM cron.job WHERE jobname = 'process-price-update-reminders';
--   SELECT cron.schedule('process-price-update-reminders', '*/15 * * * *', command) FROM cron.job WHERE jobname = 'process-price-update-reminders';
--   SELECT cron.schedule('process-price-update-reminders', '0 * * * *',    command) FROM cron.job WHERE jobname = 'process-price-update-reminders';
--   SELECT cron.schedule('process-price-update-reminders', '0 16 * * *',   command) FROM cron.job WHERE jobname = 'process-price-update-reminders';
--
-- To pause/disable completely:
--   SELECT cron.unschedule('process-price-update-reminders');

-- =============================================================================
-- STEP 5: Verification Queries
-- =============================================================================
-- Check registered job:
--   SELECT jobid, jobname, schedule, active FROM cron.job;
-- Check recent pg_cron runs:
--   SELECT jobid, status, return_message, start_time, end_time FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10;
-- Check pg_net HTTP responses from Vercel:
--   SELECT id, status_code, content, error_msg, created FROM net._http_response ORDER BY created DESC LIMIT 10;
