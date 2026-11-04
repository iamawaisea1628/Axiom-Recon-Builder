# Deployment guide (Vercel + Supabase)

Everything runs on two free-tier-friendly services. There is nothing else to host.

## 1. Create the Supabase project

Use a **dedicated** Supabase project for Axiom Recon Builder. Do not run these scripts in a project that already holds other applications' tables.

In **SQL Editor**, run these files from `database/sql/` in order, one at a time:

1. `001_core_saas_schema.sql` — tables, indexes, grants
2. `002_rls_and_onboarding.sql` — tenant isolation (RLS), profile trigger, `create_organization_with_owner()`
3. `003_seed_plans_and_verify.sql` — plan data and verification queries
4. `004_run_processing_rpcs.sql` — `apply_run_matches()` and `decide_match()`

After step 3 the verification queries should show: every listed table with `rowsecurity = true`, **no rows** from the missing-index query, and four plans.

> If `001` stops with "Legacy Axiom transactions table detected", the project contains tables from an older prototype. Rename or drop them first, or use a fresh project.

## 2. Collect two values

In Supabase → **Project Settings → API Keys** (or **Connect**):

- Project URL, e.g. `https://abcdxyz.supabase.co`
- Publishable key (`sb_publishable_…`)

These are the only values the app needs. Do **not** copy the secret key or the database password anywhere.

## 3. Deploy on Vercel

1. Push this repository to GitHub.
2. In Vercel: **Add New → Project →** import the repository. Leave the framework as detected (Create React App); `vercel.json` already sets the build command and the function timeout.
3. Under **Environment Variables**, add for Production, Preview and Development:

   | Name | Value |
   |---|---|
   | `REACT_APP_SUPABASE_URL` | your project URL |
   | `REACT_APP_SUPABASE_PUBLISHABLE_KEY` | your publishable key |

4. Deploy. The `/api/process-run` function reuses these two variables, so nothing else is required.

## 4. Configure Supabase Auth

Supabase → **Authentication → URL Configuration**:

- **Site URL:** your production Vercel URL
- **Redirect URLs:** the production URL plus any preview/local URLs you use (for example `http://localhost:3000`)

Under **Authentication → Providers → Email**, enable email confirmation before going public and set up custom SMTP (the built-in mailer is heavily rate-limited).

## 5. Smoke test

1. Open the site and create an account (confirm the email if confirmation is on).
2. Complete onboarding — this creates your organization, a trial subscription and your first workspace.
3. Create a reconciliation, upload two CSV files with `date`, `description`, `amount` columns, and import.
4. Click **Run matching**. You should land on the results page with scored matches.
5. In Supabase **Table Editor**, confirm rows in `organizations`, `match_groups` and `audit_logs`.

Sample files for step 3:

```csv
date,description,amount,reference
2026-01-15,ABC Corp Payment,1000.00,INV-1001
2026-01-16,Wire transfer XYZ,500.50,INV-1002
2026-01-17,Check 4521,2500.00,
```

```csv
date,description,amount,reference
2026-01-15,Payment ABC Corp,1000.00,INV-1001
2026-01-16,XYZ Co wire,500.50,INV-1002
2026-01-18,Check payment 4521,2500.00,
```

## Local development

```bash
npm install
cp .env.example .env.local     # add the two values
npx vercel dev                 # first run asks you to link the project; serves app + /api together
```

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| White page / "not configured" message | The two `REACT_APP_` variables are missing. Add them in Vercel and **redeploy** (they are baked in at build time). |
| "Run matching" says *Not found* or returns the app's HTML | You are running `npm start`, which does not serve `/api`. Use `npx vercel dev`, or test on a deployment. |
| `Run not found or access denied` | Your role cannot process runs (owner, admin and preparer can) or the run belongs to another organization. |
| `Only draft or failed runs can be processed` | The run was already processed. Create a new run to reprocess. |
| Login links redirect to the wrong site | Update **Site URL** and **Redirect URLs** in Supabase Auth. |
| `function ... does not exist` from Supabase | `004_run_processing_rpcs.sql` has not been run. |
| Processing times out on a very large file | Runs are limited to 5,000 transactions. Split the period, or raise `maxDuration` in `vercel.json` if your plan allows. |
