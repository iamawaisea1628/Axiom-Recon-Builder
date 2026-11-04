'use strict';
/**
 * POST /api/process-run   { "run_id": "<uuid>" }   Authorization: Bearer <Supabase access token>
 *
 * Runs the matching engine for a staged reconciliation run.
 *
 * Security model: every database call is made with the CALLER'S Supabase JWT, so
 * Row Level Security decides what can be read. The only write is the
 * apply_run_matches() RPC, which re-checks the caller's role inside the database
 * and recomputes all totals itself. No service-role key exists in this project.
 */
const { createClient } = require('@supabase/supabase-js');
const { buildMatches, MAX_TRANSACTIONS } = require('./_lib/matching');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE = 1000; // PostgREST returns at most 1000 rows per request

const reply = (res, status, body) => res.status(status).json(body);

async function fetchAll(buildQuery) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await buildQuery().range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return reply(res, 405, { status: 'error', message: 'Method not allowed' });
  }

  const url = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.REACT_APP_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    console.error('Supabase environment variables are not configured');
    return reply(res, 500, { status: 'error', message: 'Server is not configured.' });
  }

  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return reply(res, 401, { status: 'error', message: 'Sign in to continue.' });

  const body = typeof req.body === 'string' ? safeJson(req.body) : req.body || {};
  const runId = body.run_id;
  if (!UUID.test(String(runId || ''))) return reply(res, 400, { status: 'error', message: 'A valid run_id is required.' });

  const supabase = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data: auth, error: authError } = await supabase.auth.getUser(token);
    if (authError || !auth?.user) return reply(res, 401, { status: 'error', message: 'Your session has expired. Sign in again.' });

    // RLS: returns nothing unless the caller is an active member of the run's organization.
    const { data: run, error: runError } = await supabase
      .from('reconciliation_runs').select('id,organization_id,workspace_id,status').eq('id', runId).maybeSingle();
    if (runError) throw runError;
    if (!run) return reply(res, 404, { status: 'error', message: 'Run not found or access denied.' });
    if (!['draft', 'failed'].includes(run.status)) {
      return reply(res, 409, { status: 'error', message: 'Only draft or failed runs can be processed.' });
    }

    const { count, error: countError } = await supabase
      .from('transactions').select('id', { count: 'exact', head: true }).eq('run_id', runId);
    if (countError) throw countError;
    if (!count) return reply(res, 400, { status: 'error', message: 'This run has no staged transactions.' });
    if (count > MAX_TRANSACTIONS) {
      return reply(res, 413, { status: 'error', message: `Processing is limited to ${MAX_TRANSACTIONS.toLocaleString('en')} transactions per run.` });
    }

    const transactions = await fetchAll(() => supabase
      .from('transactions')
      .select('id,source_side,transaction_date,amount,description,reference,currency,normalized_data')
      .eq('run_id', runId).order('source_side').order('row_number').order('id'));

    const rules = await fetchAll(() => supabase
      .from('reconciliation_rules').select('id,name,priority,conditions,actions')
      .eq('organization_id', run.organization_id).eq('status', 'active')
      .or(`workspace_id.is.null,workspace_id.eq.${run.workspace_id}`)
      .order('priority').order('id'));

    const sideA = transactions.filter((t) => t.source_side === 'a');
    const sideB = transactions.filter((t) => t.source_side === 'b');
    const matches = buildMatches(sideA, sideB, rules);

    const payload = matches.map((m) => ({
      left_id: m.left.id, right_id: m.right.id, score: m.score, status: m.status, explanation: m.explanation,
    }));
    const { data: result, error: rpcError } = await supabase.rpc('apply_run_matches', {
      p_run_id: runId,
      p_matches: payload,
      p_summary: { active_rules: rules.length, rules_applied: matches.filter((m) => m.ruleAction).length, engine: 'deterministic_v2' },
    });
    if (rpcError) {
      if (rpcError.code === '42501') return reply(res, 403, { status: 'error', message: 'You do not have permission to process this run.' });
      if (rpcError.code === 'P0001') return reply(res, 409, { status: 'error', message: rpcError.message });
      throw rpcError;
    }
    return reply(res, 200, { status: 'success', ...result, active_rules: rules.length });
  } catch (error) {
    console.error('process-run failed', { runId, message: error && error.message, code: error && error.code });
    return reply(res, 500, { status: 'error', message: 'Processing failed. Please retry or contact support.' });
  }
};

function safeJson(text) {
  try { return JSON.parse(text); } catch (_) { return {}; }
}
