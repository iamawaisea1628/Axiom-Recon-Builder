# Axiom Recon Builder — Supabase and Vercel setup

## 1. Run the SQL files

Open the Axiom Recon Builder project in Supabase, then go to **SQL Editor**. Run these files in order:

1. `001_core_saas_schema.sql`
2. `002_rls_and_onboarding.sql`
3. `003_seed_plans_and_verify.sql`

Do not run them in the Muddarris/Quran Mentor database. The final script shows verification results. All listed tables should have RLS enabled, the missing-index query should return no rows, and four plans should be listed.

## 2. Obtain the correct keys

In Supabase, open **Project → Connect** or **Settings → API Keys** and copy:

- Project URL, such as `https://PROJECT_REF.supabase.co`
- Publishable key (`sb_publishable_...`), safe for the browser when RLS is enabled
- Secret key (`sb_secret_...`), backend only
- Transaction-pooler database URL from **Connect → ORMs → Transaction pooler**

Never put the secret key or database password in React variables.

## 3. Configure the React frontend in Vercel

In Vercel, open the frontend project → **Settings → Environment Variables** and add:

```text
REACT_APP_SUPABASE_URL=https://PROJECT_REF.supabase.co
REACT_APP_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxxxx
REACT_APP_API_URL=https://YOUR-BACKEND-DOMAIN
```

Apply them to Production, Preview and Development as needed, then redeploy. Create React App only exposes variables beginning with `REACT_APP_`.

## 4. Configure the Flask backend

In Railway/Render/Vercel Functions (wherever the Flask API runs), add:

```text
SUPABASE_URL=https://PROJECT_REF.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxxxx
SUPABASE_SECRET_KEY=sb_secret_xxxxx
DATABASE_URL=postgresql://postgres.PROJECT_REF:PASSWORD@POOLER_HOST:6543/postgres?sslmode=require
SECRET_KEY=a-long-random-fallback-secret
FRONTEND_URL=https://YOUR-FRONTEND-DOMAIN
```

Use the transaction pooler on port `6543` for a serverless or autoscaling backend. Keep all backend values secret. The frontend never needs `DATABASE_URL`, `SUPABASE_SECRET_KEY`, or `SECRET_KEY`.

## 5. Configure Supabase Auth URLs

In Supabase → **Authentication → URL Configuration**:

- Site URL: your production Vercel frontend URL
- Redirect URLs: production URL plus preview/local URLs you intentionally use

In **Authentication → Providers → Email**, enable email confirmations before production. Configure custom SMTP before a public launch.

## 6. Repository deployment flow

The repository code expects the three React environment variables and the four backend variables above. After they are configured:

1. Merge the Supabase integration PR.
2. Redeploy the frontend and backend.
3. Register a new test account.
4. Confirm the email if confirmation is enabled.
5. Complete organization onboarding.
6. Confirm that rows appear in `profiles`, `organizations`, `organization_members`, `subscriptions`, and `workspaces`.

## Security boundaries

- The publishable key is intentionally used in the browser; RLS provides row authorization.
- The Supabase secret key bypasses RLS and must remain backend-only.
- Authorization uses `organization_members`, never user-editable metadata.
- Customer financial rows inherit an `organization_id` and are protected by membership policies.
- Admin/support access requires a separate controlled-access implementation; do not use the secret key for casual customer impersonation.
