# Axiom Recon Builder

Explainable bank and ledger reconciliation for accounting firms, bookkeeping teams and finance departments.
Upload two CSV files (for example a bank statement and a ledger export), review scored match suggestions,
accept or reject them, and keep an audit trail — per organization, with role-based access.

**Stack:** React (Create React App) · Vercel (hosting + one serverless function) · Supabase (Auth, Postgres, Row Level Security).
There is no separate backend server to run or pay for.

```
Browser (React)
   │  Supabase JS (user's JWT, Row Level Security)  ──►  Supabase  (Auth · Postgres · RLS · RPC functions)
   │                                                        ▲
   └─ POST /api/process-run  ──►  Vercel function ──────────┘  reads with the user's JWT,
                                  (matching engine)            writes through apply_run_matches()
```

- **Reads and edits** (workspaces, runs, rules, exceptions, results) go straight from the browser to Supabase; RLS limits every query to the caller's organization.
- **Matching** runs in one Vercel function, `api/process-run.js`. It uses the caller's own token, so it can never see another organization's data. The results are saved atomically by the database function `apply_run_matches()`, which re-checks the caller's role and recomputes all totals itself.
- **Accept / reject** decisions call the database function `decide_match()`, which also writes the audit log.
- No service-role key, database password or secret of any kind is used by this project.

## Features

- Multi-tenant organizations with roles: owner, admin, preparer, reviewer, viewer
- Workspaces for recurring reconciliations (bank, payment settlement, receivables, payables, intercompany)
- CSV import with column mapping and row-level validation (up to 10 MB per file)
- Deterministic, explainable matching with a per-match score breakdown
- Configurable rules (conditions, confidence adjustment, auto-match / exclude / require approval)
- Review workbench: accept or reject matches, see unmatched items and the outstanding difference
- Exceptions list with comments, run history, dashboard KPIs, plan and trial display
- Audit log for processing and every match decision

## Getting started

Full step-by-step instructions are in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). In short:

1. Create a **dedicated** Supabase project and run the four files in `database/sql/` in order (`001` → `004`) in the SQL Editor.
2. Import this repository into Vercel (framework: Create React App — detected automatically).
3. Add two environment variables in Vercel: `REACT_APP_SUPABASE_URL` and `REACT_APP_SUPABASE_PUBLISHABLE_KEY`.
4. Set Supabase → Authentication → URL Configuration to your Vercel URL, then deploy.

### Local development

```bash
npm install
cp .env.example .env.local        # fill in the two Supabase values
npx vercel dev                    # serves the React app and the /api function together
```

`npm start` runs only the React app; use `vercel dev` whenever you need "Run matching" to work locally.

## How matching works

Every candidate pair gets a score out of 100 from four signals:

| Signal | Points | Notes |
|---|---|---|
| Amount | 50 | Exact within 0.01 = full points; falls to 0 at a 10% difference |
| Date | 20 | −5 points per day apart |
| Reference | 20 | Exact = 20, partial containment = 10. Left out of the score if either side has no reference |
| Description | 10 | Text similarity, ignoring word order. Left out if either description is empty |

Signals that carry no information are removed from the denominator, so a transaction without a reference is not capped below the auto-accept threshold.

Safety rules for accounting data:

- **Auto-accept needs score ≥ 95 _and_ an exact amount.** A pair whose amounts differ can never be accepted automatically, whatever else matches.
- An equal amount alone is not evidence: a pair also needs a date within 3 days, a matching reference, or a similar description.
- Pairs in different currencies are never matched.
- Equal amounts with opposite signs (debit vs credit) are only ever suggested, never accepted automatically.
- If another candidate scores within 5 points for the same transaction, an automatic accept is downgraded to "suggested".
- Rules can adjust a score by at most ±50 and can only auto-match or exclude pairs with an exact amount.
- Matching is one-to-one and deterministic. AI is not used for accounting decisions.

Scores ≥ 60 become suggestions; everything else stays unmatched.

## Testing

```bash
npm test          # matching engine + API handler (Node's built-in test runner, no dependencies)
npm run test:sql  # migrations + RPC behaviour on a scratch PostgreSQL database (needs a local Postgres superuser)
```

`npm test` needs no network and no database. `npm run test:sql` uses a small stand-in for Supabase's `auth` schema
(`tests/sql/harness.sql`) and must never be run against a real Supabase project.

## Project structure

```
api/
  process-run.js         Vercel function: loads a run, runs the matcher, saves results via RPC
  _lib/matching.js       Pure matching engine and rules evaluator
database/sql/            001 schema · 002 RLS + onboarding · 003 plans + checks · 004 processing RPCs
src/
  pages/                 Landing, Login, Onboarding, Dashboard, Workspaces, Reconciliation (import),
                         Results (review), Exceptions, History, Rules, Settings
  components/            Sidebar, UserProfile
  lib/supabaseClient.js  Supabase client + readable configuration error
tests/                   Node tests (engine, handler) and SQL tests
docs/DEPLOYMENT.md       Step-by-step setup
```

## Limits and notes

- Up to **5,000 transactions per run** and 10 MB per CSV file. CSV only (no XLSX yet).
- The Vercel free (Hobby) plan is intended for **non-commercial** use; upgrade before charging customers. Supabase free projects pause after a period of inactivity. Check current plan terms on both sites.
- Plan limits (transactions, workspaces, seats) are displayed but not yet enforced.

## Not built yet

- Submit-for-review / approve workflow (the `approvals` table and run statuses exist)
- Creating exceptions from unmatched transactions
- Plan-limit enforcement and billing
- XLSX import, one-to-many / many-to-many matching, team invitations UI

## Security model

- Row Level Security is enabled on every table; access is derived from `organization_members`, never from user-editable metadata.
- The two browser-visible keys are the Supabase URL and publishable key. Treat everything else as secret.
- `audit_logs` cannot be written by clients; only the SECURITY DEFINER functions write to it, and they authorize the caller first.
- Enable email confirmation and configure custom SMTP in Supabase before a public launch.
