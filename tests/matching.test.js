'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildMatches, scorePair, prepare, conditionMatches } = require('../api/_lib/matching');

let n = 0;
const tx = (amount, date, description, extra = {}) => ({
  id: `t${++n}`, amount, transaction_date: date, description, reference: null, currency: 'USD', normalized_data: {}, ...extra,
});
const one = (a, b, rules = []) => buildMatches([a], [b], rules)[0];

test('identical pair without a reference reaches 100 and is auto-accepted', () => {
  const m = one(tx('1000', '2026-01-15', 'ABC Corp Payment'), tx('1000', '2026-01-15', 'ABC Corp Payment'));
  assert.equal(m.score, 100);
  assert.equal(m.status, 'accepted');
});

test('matching reference raises confidence; differing reference lowers it', () => {
  const same = one(tx('50', '2026-01-02', 'Invoice', { reference: 'INV-1001' }), tx('50', '2026-01-02', 'Invoice', { reference: 'INV-1001' }));
  const diff = one(tx('50', '2026-01-02', 'Invoice', { reference: 'INV-1001' }), tx('50', '2026-01-02', 'Invoice', { reference: 'INV-9999' }));
  assert.equal(same.score, 100);
  assert.ok(diff.score < same.score);
  assert.notEqual(diff.status, 'accepted');
});

test('a 1% amount difference is never auto-accepted, even with matching date/reference/description', () => {
  const m = one(tx('1000', '2026-01-15', 'ABC', { reference: 'R1' }), tx('1010', '2026-01-15', 'ABC', { reference: 'R1' }));
  assert.ok(m.score >= 90, `score was ${m.score}`);
  assert.equal(m.status, 'suggested');
});

test('amounts 10% or more apart are not candidates', () => {
  assert.equal(buildMatches([tx('100', '2026-01-01', 'x')], [tx('120', '2026-01-01', 'x')]).length, 0);
});

test('opposite signs with equal magnitude are suggested, never accepted', () => {
  const m = one(tx('-1000', '2026-01-15', 'ABC Corp'), tx('1000', '2026-01-15', 'ABC Corp'));
  assert.ok(m);
  assert.equal(m.status, 'suggested');
  assert.equal(m.explanation.amount.sign_flipped, true);
});

test('different currencies are never paired', () => {
  assert.equal(buildMatches([tx('10', '2026-01-01', 'x', { currency: 'USD' })], [tx('10', '2026-01-01', 'x', { currency: 'EUR' })]).length, 0);
});

test('same amount but unrelated description and far date stays below suggestion threshold', () => {
  assert.equal(buildMatches([tx('75', '2026-01-01', 'Rent payment')], [tx('75', '2026-02-20', 'Office chairs')]).length, 0);
});

test('word order does not matter for descriptions', () => {
  const m = one(tx('20', '2026-01-01', 'XYZ Co payment'), tx('20', '2026-01-01', 'Payment XYZ Co'));
  assert.equal(m.explanation.description.score, 10);
});

test('ambiguous duplicates are downgraded to suggested', () => {
  const a = [tx('100', '2026-01-05', 'Subscription')];
  const b = [tx('100', '2026-01-05', 'Subscription'), tx('100', '2026-01-05', 'Subscription')];
  const [m] = buildMatches(a, b);
  assert.equal(m.status, 'suggested');
  assert.equal(m.explanation.ambiguity.competing_candidates, 1);
});

test('matching is one-to-one and picks the best date for repeated amounts', () => {
  const A = [1, 2, 3].map((i) => tx('100', `2026-01-0${i}`, `Pay ${i}`));
  const B = [1, 2, 3].map((i) => tx('100', `2026-01-0${i}`, `Pay ${i}`));
  const matches = buildMatches(A, B);
  assert.equal(matches.length, 3);
  assert.equal(new Set(matches.map((m) => m.right.id)).size, 3);
  matches.forEach((m) => assert.equal(m.left.description, m.right.description));
});

test('rule can auto-match only when amounts agree', () => {
  const rule = { id: 'r1', name: 'Stripe', conditions: { logic: 'and', groups: [{ field: 'description', operator: 'contains', value: 'stripe' }] }, actions: { type: 'auto_match', confidence_adjustment: 0 } };
  const exact = one(tx('80', '2026-01-01', 'Stripe payout'), tx('80', '2026-01-04', 'Stripe settlement'), [rule]);
  assert.equal(exact.status, 'accepted');
  assert.equal(exact.explanation.rule.name, 'Stripe');
  const off = one(tx('80', '2026-01-01', 'Stripe payout'), tx('80.50', '2026-01-02', 'Stripe settlement'), [rule]);
  assert.equal(off.status, 'suggested');
});

test('require_approval keeps a rule match as suggested; exclude removes the pair from matching', () => {
  const base = { id: 'r2', name: 'Fees', conditions: { logic: 'and', groups: [{ field: 'description', operator: 'begins_with', value: 'bank fee' }] } };
  const a = tx('5', '2026-01-01', 'Bank fee'), b = tx('5', '2026-01-01', 'Bank fee');
  assert.equal(one(a, b, [{ ...base, actions: { type: 'auto_match', require_approval: true } }]).status, 'suggested');
  assert.equal(one(a, b, [{ ...base, actions: { type: 'exclude' } }]).status, 'excluded');
});

test('rule confidence adjustment is clamped to +/-50 and to 0..100', () => {
  const rule = { id: 'r3', name: 'Boost', conditions: { groups: [{ field: 'amount', operator: 'greater_than', value: '1' }] }, actions: { type: 'suggest', confidence_adjustment: 999 } };
  const m = one(tx('10', '2026-01-01', 'abc'), tx('10', '2026-01-03', 'abc'), [rule]);
  assert.ok(m.score <= 100);
  assert.equal(m.explanation.rule.confidence_adjustment, 50);
});

test('condition operators', () => {
  const l = tx('100', '2026-01-01', 'Acme Ltd', { normalized_data: { vendor: 'acme' } });
  const r = tx('100.5', '2026-01-03', 'ACME LIMITED');
  const c = (field, operator, value) => conditionMatches({ field, operator, value }, l, r);
  assert.ok(c('amount_difference', 'within', '1'));
  assert.ok(!c('amount_difference', 'within', '0.1'));
  assert.ok(c('date_difference', 'less_than', '3'));
  assert.ok(c('vendor', 'equals', 'acme'));
  assert.ok(c('description', 'regex', 'acme\\s+ltd'));
  assert.ok(!c('description', 'regex', '('), 'invalid regex must not throw');
  assert.ok(!c('description', 'contains', ''), 'empty needle never matches');
});

test('float noise in money values does not break exact-amount detection', () => {
  const a = prepare(tx('0.1', '2026-01-01', 'x'));
  const b = prepare(tx('0.1000000000000001', '2026-01-01', 'x'));
  assert.equal(scorePair(a, b).exactAmount, true);
});

test('performance: 2000 x 2000 pairs completes quickly', () => {
  const A = [], B = [];
  for (let i = 0; i < 2000; i++) {
    A.push(tx(String(10 + i), `2026-01-${String(1 + (i % 28)).padStart(2, '0')}`, `Customer payment ${i}`));
    B.push(tx(String(10 + i), `2026-01-${String(1 + (i % 28)).padStart(2, '0')}`, `Customer payment ${i}`));
  }
  const t0 = Date.now();
  const matches = buildMatches(A, B);
  const ms = Date.now() - t0;
  assert.equal(matches.length, 2000);
  assert.ok(ms < 5000, `took ${ms}ms`);
  console.log(`  2000x2000 matched in ${ms}ms`);
});
