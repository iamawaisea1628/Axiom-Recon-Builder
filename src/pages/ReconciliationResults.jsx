import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import '../styles/ReconciliationResults.css';

const PAGE = 1000; // PostgREST returns at most 1000 rows per request
const UNMATCHED_LIMIT = 500;
const LEGACY_MAX = { amount: 50, date: 20, reference: 20, description: 10 }; // runs created by engine v1
const LABELS = { amount: 'Amount', date: 'Date', reference: 'Reference', description: 'Description' };

const money = (value, currency = 'USD') =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'USD' }).format(Number(value || 0));
const number = (value) => Number(value || 0).toLocaleString();
const sideOf = (group, side) => group.transactions.find((transaction) => transaction.side === side) || {};

async function fetchAll(buildQuery) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await buildQuery().range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}

const flattenGroup = (group) => ({
  ...group,
  transactions: (group.items || [])
    .map((item) => item.transaction)
    .filter(Boolean)
    .map((t) => ({
      id: t.id, side: t.source_side, date: t.transaction_date, amount: t.amount,
      description: t.description, reference: t.reference, currency: t.currency,
    })),
});

export default function ReconciliationResults({ runId, membership, onNavigate }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('all');
  const [saving, setSaving] = useState('');

  // Row Level Security limits every query below to the caller's organization.
  const load = useCallback(async (silent = false) => {
    if (!runId) { setLoading(false); return; }
    if (!silent) setLoading(true);
    setError('');
    try {
      const [runResult, groups, unmatchedResult] = await Promise.all([
        supabase.from('reconciliation_runs')
          .select('id,name,status,period_start,period_end,source_a_balance,source_b_balance,outstanding_difference,total_transactions,matched_transactions,average_confidence,workspace:workspaces(name,base_currency)')
          .eq('id', runId).maybeSingle(),
        fetchAll(() => supabase.from('match_groups')
          .select('id,confidence,status,explanation,items:match_group_items(transaction:transactions(id,source_side,transaction_date,amount,description,reference,currency))')
          .eq('run_id', runId).order('confidence', { ascending: false }).order('id')),
        supabase.from('transactions')
          .select('id,source_side,transaction_date,amount,description,reference,currency', { count: 'exact' })
          .eq('run_id', runId).eq('status', 'unmatched').order('transaction_date').order('id').limit(UNMATCHED_LIMIT),
      ]);
      if (runResult.error) throw runResult.error;
      if (unmatchedResult.error) throw unmatchedResult.error;
      if (!runResult.data) throw new Error('Run not found or access denied.');
      setData({
        run: { ...runResult.data, workspace_name: runResult.data.workspace?.name, base_currency: runResult.data.workspace?.base_currency },
        groups: groups.map(flattenGroup),
        unmatched: unmatchedResult.data || [],
        unmatchedTotal: unmatchedResult.count ?? (unmatchedResult.data || []).length,
      });
    } catch (err) {
      setError(err.message || 'Unable to load results.');
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => { load(); }, [load]);

  const decide = async (groupId, decision) => {
    setSaving(groupId);
    setError('');
    try {
      const { error: rpcError } = await supabase.rpc('decide_match', { p_run_id: runId, p_group_id: groupId, p_decision: decision });
      if (rpcError) throw rpcError;
      await load(true);
    } catch (err) {
      setError(err.message || 'Unable to save decision.');
    } finally {
      setSaving('');
    }
  };

  const groups = useMemo(() => data?.groups.filter((group) => tab === 'all' || group.status === tab) || [], [data, tab]);
  const counts = useMemo(
    () => Object.fromEntries(['accepted', 'suggested', 'rejected'].map((status) => [status, data?.groups.filter((group) => group.status === status).length || 0])),
    [data],
  );

  if (loading) return <div className="portal-loading"><span />Preparing reconciliation results…</div>;
  if (!runId) {
    return (
      <div className="portal-empty">
        <i>RC</i><b>No reconciliation selected</b><span>Start a reconciliation to create reviewable results.</span>
        <button className="primary" onClick={() => onNavigate('reconciliation')}>New reconciliation</button>
      </div>
    );
  }
  if (!data) {
    return (
      <main className="results-page">
        <div className="portal-alert"><b>Results unavailable.</b><span>{error}</span><button onClick={() => load()}>Retry</button></div>
      </main>
    );
  }

  const { run, unmatched, unmatchedTotal } = data;
  const currency = run.base_currency || 'USD';
  const canDecide = ['owner', 'admin', 'preparer', 'reviewer'].includes(membership?.role)
    && ['prepared', 'in_review', 'returned'].includes(run.status);

  return (
    <main className="results-page">
      <section className="results-heading">
        <div>
          <button onClick={() => onNavigate('reconciliation')}>← Reconciliations</button>
          <small>{run.workspace_name} · {run.period_start} to {run.period_end}</small>
          <h2>{run.name}</h2>
          <p>Prepared for review. Suggestions remain recommendations until an authorized user accepts them.</p>
        </div>
        <span className="status-chip">{String(run.status).replace('_', ' ')}</span>
      </section>

      {error && <div className="portal-alert"><b>Action not saved.</b><span>{error}</span><button onClick={() => setError('')}>Dismiss</button></div>}

      <section className="result-kpis">
        <article><small>Source A balance</small><b>{money(run.source_a_balance, currency)}</b></article>
        <article><small>Source B balance</small><b>{money(run.source_b_balance, currency)}</b></article>
        <article className={Number(run.outstanding_difference) ? 'warning' : 'good'}><small>Outstanding difference</small><b>{money(run.outstanding_difference, currency)}</b></article>
        <article><small>Transactions</small><b>{number(run.total_transactions)}</b></article>
        <article><small>Matched transactions</small><b>{number(run.matched_transactions)}</b></article>
        <article><small>Average confidence</small><b>{Number(run.average_confidence || 0).toFixed(1)}%</b></article>
      </section>

      <div className="recommendation-note">
        <b>Explainable recommendation</b>
        <span>The matching engine compares amount, date, reference, and description. It never posts entries or approves accounting decisions.</span>
      </div>

      <section className="workbench">
        <header>
          <div><small>REVIEW WORKBENCH</small><h3>Candidate matches</h3></div>
          <span>{groups.length} groups shown</span>
        </header>
        <nav>
          {[['all', 'All'], ['accepted', 'Accepted'], ['suggested', 'Suggested'], ['rejected', 'Rejected']].map(([value, label]) => (
            <button className={tab === value ? 'active' : ''} onClick={() => setTab(value)} key={value}>
              {label}<i>{value === 'all' ? data.groups.length : counts[value]}</i>
            </button>
          ))}
        </nav>
        <div className="match-list">
          {groups.map((group) => {
            const left = sideOf(group, 'a');
            const right = sideOf(group, 'b');
            const explanation = group.explanation || {};
            return (
              <article className="match-row" key={group.id}>
                <div className="transaction">
                  <span>A</span>
                  <div><b>{left.description || 'No description'}</b><small>{left.date} · {left.reference || 'No reference'}</small></div>
                  <strong>{money(left.amount, left.currency || currency)}</strong>
                </div>
                <div className="match-score">
                  <b>{Number(group.confidence).toFixed(1)}%</b>
                  <span className={`decision ${group.status}`}>{group.status}</span>
                </div>
                <div className="transaction">
                  <span>B</span>
                  <div><b>{right.description || 'No description'}</b><small>{right.date} · {right.reference || 'No reference'}</small></div>
                  <strong>{money(right.amount, right.currency || currency)}</strong>
                </div>
                <div className="score-detail">
                  {Object.keys(LABELS).map((key) => {
                    const part = explanation[key] || {};
                    const max = part.max ?? LEGACY_MAX[key];
                    return <span key={key}>{LABELS[key]} <b>{max === 0 ? 'n/a' : `${part.score ?? 0}/${max}`}</b></span>;
                  })}
                </div>
                {explanation.amount?.sign_flipped && (
                  <div className="rule-applied"><b>Opposite signs</b><span>The amounts are equal in size but one is a debit and the other a credit. Confirm before accepting.</span></div>
                )}
                {explanation.ambiguity && (
                  <div className="rule-applied"><b>Other close candidates</b><span>{explanation.ambiguity.competing_candidates} other transaction(s) could match equally well, so this was not accepted automatically.</span></div>
                )}
                {explanation.rule && (
                  <div className="rule-applied">
                    <b>Rule applied: {explanation.rule.name}</b>
                    <span>
                      {String(explanation.rule.action).replaceAll('_', ' ')} · {Number(explanation.rule.confidence_adjustment) >= 0 ? '+' : ''}{explanation.rule.confidence_adjustment} confidence
                      {explanation.rule.require_approval ? ' · reviewer approval required' : ''}
                    </span>
                  </div>
                )}
                {canDecide && (
                  <div className="match-actions">
                    <button disabled={saving === group.id} onClick={() => decide(group.id, 'rejected')}>Reject</button>
                    <button className="primary" disabled={saving === group.id} onClick={() => decide(group.id, 'accepted')}>
                      {saving === group.id ? 'Saving…' : 'Accept match'}
                    </button>
                  </div>
                )}
              </article>
            );
          })}
          {!groups.length && (
            <div className="portal-empty"><i>✓</i><b>No matches in this view</b><span>Choose another status tab to continue reviewing.</span></div>
          )}
        </div>
      </section>

      <section className="unmatched">
        <header>
          <div><small>OPEN ITEMS</small><h3>Unmatched transactions</h3></div>
          <b>{number(unmatchedTotal)}</b>
        </header>
        <div className="unmatched-table">
          <table>
            <thead><tr><th>Source</th><th>Date</th><th>Description</th><th>Reference</th><th>Amount</th><th>Status</th></tr></thead>
            <tbody>
              {unmatched.map((item) => (
                <tr key={item.id}>
                  <td><span>{String(item.source_side).toUpperCase()}</span></td>
                  <td>{item.transaction_date}</td>
                  <td>{item.description}</td>
                  <td>{item.reference || '—'}</td>
                  <td>{money(item.amount, item.currency || currency)}</td>
                  <td>Unmatched</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {unmatchedTotal > unmatched.length && <p>Showing the first {number(unmatched.length)} of {number(unmatchedTotal)} unmatched transactions.</p>}
        {!unmatchedTotal && <p>Every imported transaction is currently part of a candidate match.</p>}
      </section>
    </main>
  );
}
