'use strict';
/**
 * Deterministic, explainable reconciliation matcher.
 *
 * Pure functions only (no I/O) so the logic is unit-testable and safe to run
 * inside a serverless function. AI is intentionally NOT used for accounting
 * decisions.
 *
 * Scoring (points, before normalisation):
 *   amount 50 · date 20 · reference 20 · description 10
 * Components that carry no information (no reference on either side, empty
 * descriptions) are removed from the denominator, so a transaction pair is not
 * capped below the auto-accept threshold just because it has no reference.
 *
 * Safety rules for accounting data:
 *   - An equal amount alone is never enough: a pair needs a date within 3 days,
 *     a matching reference, or a similar description.
 *   - Different currencies are never paired.
 *   - A pair is only auto-accepted (or auto-excluded) when the amounts agree
 *     within AMOUNT_TOLERANCE. A 1% amount difference can never be auto-accepted.
 *   - Equal absolute amounts with opposite signs are only ever "suggested".
 *   - If another candidate scores within AMBIGUITY_MARGIN for the same
 *     transaction, an auto-accept is downgraded to "suggested".
 */

const AUTO_ACCEPT_THRESHOLD = 95;
const SUGGEST_THRESHOLD = 60;
const AMOUNT_TOLERANCE = 0.01; // major currency units
const AMBIGUITY_MARGIN = 5;
const MAX_TRANSACTIONS = 5000;
const UNITS = 10000; // amounts are compared as integers in 1/10,000 units
const WEIGHTS = { amount: 50, date: 20, reference: 20, description: 10 };
const METHOD = 'deterministic_v2';

const toUnits = (value) => Math.round(Number(value) * UNITS);
const round2 = (n) => Math.round(n * 100) / 100;

const normalize = (value) =>
  String(value == null ? '' : value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function bigrams(text) {
  const map = new Map();
  for (let i = 0; i < text.length - 1; i++) {
    const g = text.slice(i, i + 2);
    map.set(g, (map.get(g) || 0) + 1);
  }
  return map;
}

/** Dice coefficient over character bigrams; `A`/`B` are precomputed bigram maps. */
function dice(a, b, A = bigrams(a), B = bigrams(b)) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  let overlap = 0;
  for (const [g, n] of A) overlap += Math.min(n, B.get(g) || 0);
  return (2 * overlap) / (a.length - 1 + (b.length - 1));
}

const sortTokens = (s) => s.split(' ').sort().join(' ');

/** 0..1 text similarity; word order is ignored by also comparing sorted tokens. */
function similarity(a, b) {
  return Math.max(dice(a, b), dice(sortTokens(a), sortTokens(b)));
}

function preparedSimilarity(a, b) {
  return Math.max(dice(a._desc, b._desc, a._bg, b._bg), dice(a._descSorted, b._descSorted, a._bgSorted, b._bgSorted));
}

function daysBetween(a, b) {
  const parse = (d) => {
    const [y, m, day] = String(d).slice(0, 10).split('-').map(Number);
    return Date.UTC(y, m - 1, day);
  };
  return Math.abs(Math.round((parse(a) - parse(b)) / 86400000));
}

/** Prepare a transaction row once so pair scoring is cheap. */
function prepare(tx) {
  const desc = normalize(tx.description);
  const descSorted = sortTokens(desc);
  return {
    ...tx,
    _units: toUnits(tx.amount),
    _ref: normalize(tx.reference),
    _desc: desc,
    _descSorted: descSorted,
    _bg: bigrams(desc),
    _bgSorted: bigrams(descSorted),
    _currency: String(tx.currency || '').toUpperCase(),
  };
}

/**
 * Score one pair. Returns null when the pair must never be matched
 * (different currency, or amounts too far apart to be the same transaction).
 */
function scorePair(a, b) {
  if (a._currency && b._currency && a._currency !== b._currency) return null;

  const diff = Math.abs(a._units - b._units);
  const absA = Math.abs(a._units);
  const absB = Math.abs(b._units);
  const exactAmount = diff <= AMOUNT_TOLERANCE * UNITS;
  let amountScore;
  let signFlipped = false;
  if (exactAmount) {
    amountScore = WEIGHTS.amount;
  } else if (a._units !== 0 && Math.sign(a._units) !== Math.sign(b._units) &&
             Math.abs(absA - absB) <= AMOUNT_TOLERANCE * UNITS) {
    // Same magnitude, opposite sign (bank debit vs ledger credit): plausible but never automatic.
    signFlipped = true;
    amountScore = WEIGHTS.amount * 0.7;
  } else {
    const relative = diff / Math.max(absA, absB, UNITS);
    amountScore = Math.max(0, WEIGHTS.amount - relative * 500);
  }
  if (amountScore <= 0) return null; // >=10% apart: not a candidate

  const days = daysBetween(a.transaction_date, b.transaction_date);
  const dateScore = Math.max(0, WEIGHTS.date - days * 5);

  const refAvailable = Boolean(a._ref && b._ref);
  let refScore = 0;
  if (refAvailable) {
    if (a._ref === b._ref) refScore = WEIGHTS.reference;
    else if (Math.min(a._ref.length, b._ref.length) >= 4 &&
             (a._ref.includes(b._ref) || b._ref.includes(a._ref))) refScore = WEIGHTS.reference / 2;
  }

  const descAvailable = Boolean(a._desc && b._desc);
  const descSimilarity = descAvailable ? preparedSimilarity(a, b) : 0;
  const descScore = descSimilarity * WEIGHTS.description;

  // An amount alone is not evidence (round amounts repeat constantly): require
  // at least one corroborating signal before a pair becomes a candidate.
  if (dateScore <= 0 && refScore <= 0 && descSimilarity < 0.5) return null;

  const available = WEIGHTS.amount + WEIGHTS.date +
    (refAvailable ? WEIGHTS.reference : 0) + (descAvailable ? WEIGHTS.description : 0);
  const earned = amountScore + dateScore + refScore + descScore;
  const total = round2(Math.min(100, (earned / available) * 100));

  return {
    score: total,
    exactAmount,
    explanation: {
      amount: { score: round2(amountScore), max: WEIGHTS.amount, difference: diff / UNITS, sign_flipped: signFlipped },
      date: { score: round2(dateScore), max: WEIGHTS.date, difference_days: days },
      reference: { score: refScore, max: refAvailable ? WEIGHTS.reference : 0, available: refAvailable, exact: refScore === WEIGHTS.reference },
      description: { score: round2(descScore), max: descAvailable ? WEIGHTS.description : 0, available: descAvailable },
      method: METHOD,
    },
  };
}

// ---------------------------------------------------------------- rules ---

const asNumber = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value == null || String(value).trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const parseUtcDate = (d) => {
  const [y, m, day] = String(d).slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, day);
};

function conditionValue(condition, left, right) {
  const field = condition.field;
  switch (field) {
    case 'amount': return Math.abs(Number(left.amount));
    case 'amount_difference': return Math.abs(Number(left.amount) - Number(right.amount));
    case 'date_difference':
      return Math.abs(Math.round((parseUtcDate(left.transaction_date) - parseUtcDate(right.transaction_date)) / 86400000));
    case 'account':
    case 'vendor':
      return [left, right].map((t) => (t.normalized_data || {})[field] || '').filter(Boolean).join(' | ');
    case 'currency': return `${left.currency || ''} | ${right.currency || ''}`;
    case 'source': return 'a | b';
    default: return `${left[field] == null ? '' : left[field]} | ${right[field] == null ? '' : right[field]}`;
  }
}

function conditionMatches(condition, left, right) {
  const actual = conditionValue(condition, left, right);
  const expected = condition.value == null ? '' : condition.value;
  const operator = condition.operator || 'equals';
  const actualNumber = asNumber(actual);
  const expectedNumber = asNumber(expected);
  if (operator === 'within') return actualNumber !== null && expectedNumber !== null && Math.abs(actualNumber) <= Math.abs(expectedNumber);
  if (operator === 'greater_than') return actualNumber !== null && expectedNumber !== null && actualNumber > expectedNumber;
  if (operator === 'less_than') return actualNumber !== null && expectedNumber !== null && actualNumber < expectedNumber;
  const actualText = normalize(actual);
  const expectedText = normalize(expected);
  if (operator === 'contains') return Boolean(expectedText) && actualText.includes(expectedText);
  if (operator === 'begins_with') return Boolean(expectedText) && actualText.startsWith(expectedText);
  if (operator === 'regex') {
    const pattern = String(expected);
    if (pattern.length > 200) return false;
    try { return new RegExp(pattern, 'i').test(String(actual).slice(0, 500)); } catch (_) { return false; }
  }
  if (actualNumber !== null && expectedNumber !== null) return actualNumber === expectedNumber;
  return actualText === expectedText;
}

function ruleMatches(rule, left, right) {
  const conditions = rule.conditions || {};
  const groups = Array.isArray(conditions.groups) ? conditions.groups : [];
  if (!groups.length) return false;
  const results = groups.map((c) => conditionMatches(c, left, right));
  return conditions.logic === 'or' ? results.some(Boolean) : results.every(Boolean);
}

/** First matching rule (rules arrive ordered by priority) adjusts the score and may set the outcome. */
function applyRules(pair, left, right, rules) {
  for (const rule of rules) {
    if (!ruleMatches(rule, left, right)) continue;
    const actions = rule.actions || {};
    const adjustment = Math.max(-50, Math.min(50, Number(actions.confidence_adjustment) || 0));
    const score = round2(Math.max(0, Math.min(100, pair.score + adjustment)));
    const action = actions.type || 'suggest';
    const requireApproval = Boolean(actions.require_approval);
    let status = 'suggested';
    if (action === 'exclude' && !requireApproval) status = 'excluded';
    else if (action === 'auto_match' && !requireApproval) status = 'accepted';
    // Safety: rules may not auto-accept or exclude a pair whose amounts differ.
    if ((status === 'accepted' || status === 'excluded') && !pair.exactAmount) status = 'suggested';
    return {
      score,
      status,
      ruleAction: action,
      explanation: {
        ...pair.explanation,
        rule: { id: String(rule.id), name: rule.name, action, confidence_adjustment: adjustment, require_approval: requireApproval },
      },
    };
  }
  return null;
}

// ------------------------------------------------------------- matching ---

function lowerBound(sorted, value) {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]._units < value) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/**
 * Only transactions whose amount could score > 0 are worth comparing: within
 * ~10% (same sign) or equal magnitude with the opposite sign. Binary search over
 * the amount-sorted side keeps large files fast.
 */
function nearbyAmounts(left, sortedB) {
  const a = left._units;
  const width = Math.max(Math.abs(a) / 9, UNITS / 10) + 1;
  const tolerance = AMOUNT_TOLERANCE * UNITS;
  const found = new Set();
  const scan = (low, high) => {
    for (let i = lowerBound(sortedB, low); i < sortedB.length && sortedB[i]._units <= high; i++) found.add(sortedB[i]);
  };
  scan(a - width, a + width);
  scan(-a - tolerance, -a + tolerance);
  return found;
}

/**
 * @param {Array} sourceA transactions (side a)
 * @param {Array} sourceB transactions (side b)
 * @param {Array} rules   active rules ordered by priority
 * @returns {Array<{left,right,score,status,explanation,ruleAction}>} one-to-one matches
 */
function buildMatches(sourceA, sourceB, rules = []) {
  const A = sourceA.map((t, i) => ({ ...prepare(t), _i: i }));
  const B = sourceB.map((t, i) => ({ ...prepare(t), _i: i }));
  const sortedB = [...B].sort((x, y) => x._units - y._units);
  const candidates = [];

  for (const left of A) {
    for (const right of nearbyAmounts(left, sortedB)) {
      const pair = scorePair(left, right);
      if (!pair) continue;
      let { score, explanation } = pair;
      let status = score >= AUTO_ACCEPT_THRESHOLD && pair.exactAmount && !explanation.amount.sign_flipped ? 'accepted' : 'suggested';
      let ruleAction = null;
      const ruled = rules.length ? applyRules(pair, left, right, rules) : null;
      if (ruled) {
        score = ruled.score;
        explanation = ruled.explanation;
        status = ruled.status;
        ruleAction = ruled.ruleAction;
      }
      const keep = status === 'accepted' || status === 'excluded' || score >= SUGGEST_THRESHOLD;
      if (!keep) continue;
      candidates.push({ score, left, right, explanation, status, ruleAction });
    }
  }

  // Deterministic order: best score first, then input order.
  candidates.sort((x, y) => y.score - x.score || x.left._i - y.left._i || x.right._i - y.right._i);

  const byLeft = new Map();
  const byRight = new Map();
  for (const c of candidates) {
    if (!byLeft.has(c.left.id)) byLeft.set(c.left.id, []);
    if (!byRight.has(c.right.id)) byRight.set(c.right.id, []);
    byLeft.get(c.left.id).push(c);
    byRight.get(c.right.id).push(c);
  }

  const usedA = new Set();
  const usedB = new Set();
  const matches = [];
  for (const c of candidates) {
    if (usedA.has(c.left.id) || usedB.has(c.right.id)) continue;
    usedA.add(c.left.id);
    usedB.add(c.right.id);

    let { status, explanation } = c;
    if (status === 'accepted') {
      const rivals = [...byLeft.get(c.left.id), ...byRight.get(c.right.id)]
        .filter((o) => o !== c && o.score >= c.score - AMBIGUITY_MARGIN).length;
      if (rivals) {
        status = 'suggested';
        explanation = { ...explanation, ambiguity: { competing_candidates: rivals, margin: AMBIGUITY_MARGIN } };
      }
    }
    matches.push({
      score: c.score,
      left: strip(c.left),
      right: strip(c.right),
      explanation,
      status,
      ruleAction: c.ruleAction,
    });
  }
  return matches;
}

function strip(tx) {
  const { _units, _ref, _desc, _descSorted, _bg, _bgSorted, _currency, _i, ...rest } = tx; // eslint-disable-line no-unused-vars
  return rest;
}

module.exports = {
  buildMatches, scorePair, prepare, conditionMatches, ruleMatches, normalize, similarity,
  AUTO_ACCEPT_THRESHOLD, SUGGEST_THRESHOLD, AMOUNT_TOLERANCE, AMBIGUITY_MARGIN, MAX_TRANSACTIONS, METHOD,
};
