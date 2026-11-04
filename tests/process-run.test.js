'use strict';
// Exercises the serverless handler with a fake Supabase client (no network needed).
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const RUN = '3d4dc578-670d-4a9c-9020-94e26d3be389';
let db; // per-test fake database state

function fakeClient() {
  const builder = (table) => {
    const state = { table, head: false, single: false, range: null };
    const b = {
      select(_cols, opts) { state.head = Boolean(opts && opts.head); return b; },
      eq() { return b; }, or() { return b; }, order() { return b; },
      range(from, to) { state.range = [from, to]; return b; },
      maybeSingle() { state.single = true; return b; },
      then(resolve, reject) { return Promise.resolve(db.query(state)).then(resolve, reject); },
    };
    return b;
  };
  return {
    auth: { getUser: async () => db.user },
    from: builder,
    rpc: async (name, args) => { db.rpcCalls.push({ name, args }); return db.rpcResult; },
  };
}

const realLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === '@supabase/supabase-js') return { createClient: () => fakeClient() };
  return realLoad.call(this, request, ...rest);
};
const handler = require('../api/process-run');

const makeRes = () => {
  const res = { headers: {}, statusCode: 200, body: null };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
};
const call = async (req) => { const res = makeRes(); await handler({ method: 'POST', headers: { authorization: 'Bearer t' }, body: { run_id: RUN }, ...req }, res); return res; };

const tx = (id, side, amount, description, date = '2026-01-01') =>
  ({ id, source_side: side, amount, description, transaction_date: date, reference: null, currency: 'USD', normalized_data: {} });

test.beforeEach(() => {
  process.env.REACT_APP_SUPABASE_URL = 'https://x.supabase.co';
  process.env.REACT_APP_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
  db = {
    user: { data: { user: { id: 'u1' } }, error: null },
    rpcCalls: [],
    rpcResult: { data: { run_id: RUN, match_groups: 1 }, error: null },
    runStatus: 'draft',
    txs: [tx('a1', 'a', 100, 'Pay A'), tx('b1', 'b', 100, 'Pay A')],
    query({ table, head, single, range }) {
      if (table === 'reconciliation_runs') return { data: this.runStatus ? { id: RUN, organization_id: 'o', workspace_id: 'w', status: this.runStatus } : null, error: null };
      if (table === 'transactions' && head) return { count: this.txs.length, error: null };
      if (table === 'transactions') return { data: this.txs.slice(range[0], range[1] + 1), error: null };
      if (table === 'reconciliation_rules') return { data: [], error: null };
      throw new Error(`unexpected table ${table}`);
    },
  };
});

test('rejects non-POST, missing token and malformed run id', async () => {
  assert.equal((await call({ method: 'GET' })).statusCode, 405);
  assert.equal((await call({ headers: {} })).statusCode, 401);
  assert.equal((await call({ body: { run_id: 'nope' } })).statusCode, 400);
  assert.equal((await call({ body: '{bad json' })).statusCode, 400);
});

test('expired session -> 401', async () => {
  db.user = { data: { user: null }, error: { message: 'jwt expired' } };
  assert.equal((await call()).statusCode, 401);
});

test('run invisible under RLS -> 404; already processed -> 409', async () => {
  db.runStatus = null;
  assert.equal((await call()).statusCode, 404);
  db.runStatus = 'prepared';
  assert.equal((await call()).statusCode, 409);
});

test('empty run -> 400, oversized run -> 413', async () => {
  db.txs = [];
  assert.equal((await call()).statusCode, 400);
  db.txs = new Array(5001).fill(0).map((_, i) => tx(`x${i}`, 'a', 1, 'x'));
  assert.equal((await call()).statusCode, 413);
});

test('success: matches are sent to apply_run_matches with ids, scores and statuses only', async () => {
  const res = await call();
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'success');
  assert.equal(db.rpcCalls.length, 1);
  const { name, args } = db.rpcCalls[0];
  assert.equal(name, 'apply_run_matches');
  assert.equal(args.p_run_id, RUN);
  assert.equal(args.p_matches.length, 1);
  assert.deepEqual(Object.keys(args.p_matches[0]).sort(), ['explanation', 'left_id', 'right_id', 'score', 'status']);
  assert.equal(args.p_matches[0].status, 'accepted');
});

test('paginates transaction reads beyond 1000 rows', async () => {
  db.txs = [];
  for (let i = 0; i < 1200; i++) { db.txs.push(tx(`a${i}`, 'a', 1000 + i, `Item ${i}`)); db.txs.push(tx(`b${i}`, 'b', 1000 + i, `Item ${i}`)); }
  const res = await call();
  assert.equal(res.statusCode, 200);
  assert.equal(db.rpcCalls[0].args.p_matches.length, 1200);
});

test('database permission error maps to 403; unexpected errors are not leaked', async () => {
  db.rpcResult = { data: null, error: { code: '42501', message: 'Run not found or access denied' } };
  assert.equal((await call()).statusCode, 403);
  db.rpcResult = { data: null, error: { code: 'XX000', message: 'secret internal detail' } };
  const res = await call();
  assert.equal(res.statusCode, 500);
  assert.ok(!JSON.stringify(res.body).includes('secret'));
});

test('missing configuration -> 500 without crashing', async () => {
  delete process.env.REACT_APP_SUPABASE_URL;
  assert.equal((await call()).statusCode, 500);
});
