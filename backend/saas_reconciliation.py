import json
from datetime import date
from decimal import Decimal
from difflib import SequenceMatcher
from psycopg2.extras import RealDictCursor

from backend.db import get_db_connection

AUTO_ACCEPT_THRESHOLD = 95.0
SUGGEST_THRESHOLD = 60.0
MAX_SYNC_TRANSACTIONS = 2000


def _json_safe(value):
    if isinstance(value, (Decimal, date)):
        return str(value)
    if isinstance(value, dict):
        return {key: _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    return value


def _normalized(value):
    return ' '.join(''.join(c.lower() if c.isalnum() else ' ' for c in str(value or '')).split())


def score_pair(source_a, source_b):
    """Return an explainable deterministic score; AI is not used for accounting decisions."""
    amount_a, amount_b = Decimal(str(source_a['amount'])), Decimal(str(source_b['amount']))
    amount_difference = abs(amount_a - amount_b)
    amount_score = 50.0 if amount_difference <= Decimal('0.01') else max(0.0, 50.0 - float(amount_difference / max(abs(amount_a), abs(amount_b), Decimal('1'))) * 500)
    date_a, date_b = source_a['transaction_date'], source_b['transaction_date']
    if isinstance(date_a, str):
        date_a = date.fromisoformat(date_a)
    if isinstance(date_b, str):
        date_b = date.fromisoformat(date_b)
    days = abs((date_a - date_b).days)
    date_score = max(0.0, 20.0 - days * 5.0)
    ref_a, ref_b = _normalized(source_a.get('reference')), _normalized(source_b.get('reference'))
    reference_score = 20.0 if ref_a and ref_b and ref_a == ref_b else 0.0
    description_score = SequenceMatcher(None, _normalized(source_a.get('description')), _normalized(source_b.get('description'))).ratio() * 10.0
    total = round(min(100.0, amount_score + date_score + reference_score + description_score), 2)
    return total, {
        'amount': {'score': round(amount_score, 2), 'difference': float(amount_difference)},
        'date': {'score': round(date_score, 2), 'difference_days': days},
        'reference': {'score': reference_score, 'exact': bool(reference_score)},
        'description': {'score': round(description_score, 2)},
        'method': 'deterministic_v1'
    }


def build_matches(source_a, source_b):
    candidates = []
    for left in source_a:
        for right in source_b:
            score, explanation = score_pair(left, right)
            if score >= SUGGEST_THRESHOLD:
                candidates.append((score, left, right, explanation))
    candidates.sort(key=lambda item: item[0], reverse=True)
    used_a, used_b, matches = set(), set(), []
    for score, left, right, explanation in candidates:
        if left['id'] in used_a or right['id'] in used_b:
            continue
        used_a.add(left['id']); used_b.add(right['id'])
        matches.append({'score': score, 'left': left, 'right': right, 'explanation': explanation,
                        'status': 'accepted' if score >= AUTO_ACCEPT_THRESHOLD else 'suggested'})
    return matches


def _authorized_run(cur, run_id, user_id, write=False):
    roles = ('owner', 'admin', 'preparer', 'reviewer') if write else ('owner', 'admin', 'preparer', 'reviewer', 'viewer')
    cur.execute('''
        SELECT r.*, w.name AS workspace_name, w.base_currency
        FROM public.reconciliation_runs r
        JOIN public.workspaces w ON w.id = r.workspace_id AND w.organization_id = r.organization_id
        JOIN public.organization_members m ON m.organization_id = r.organization_id
        WHERE r.id = %s AND m.user_id = %s AND m.status = 'active' AND m.role = ANY(%s)
    ''', (run_id, user_id, list(roles)))
    return cur.fetchone()


def process_saas_run(run_id, user_id):
    conn = get_db_connection()
    if not conn:
        raise RuntimeError('Database connection unavailable')
    try:
        with conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                run = _authorized_run(cur, run_id, user_id, write=True)
                if not run:
                    raise PermissionError('Run not found or access denied')
                if run['status'] not in ('draft', 'failed'):
                    raise ValueError('Only draft or failed runs can be processed')
                cur.execute('SELECT COUNT(*) AS total FROM public.transactions WHERE run_id=%s AND organization_id=%s', (run_id, run['organization_id']))
                total = cur.fetchone()['total']
                if total == 0:
                    raise ValueError('This run has no staged transactions')
                if total > MAX_SYNC_TRANSACTIONS:
                    raise ValueError(f'Synchronous processing is limited to {MAX_SYNC_TRANSACTIONS:,} transactions')
                cur.execute("UPDATE public.reconciliation_runs SET status='processing', updated_at=now() WHERE id=%s", (run_id,))
                cur.execute('''SELECT id, source_side, transaction_date, amount, description, reference, currency
                               FROM public.transactions WHERE run_id=%s AND organization_id=%s ORDER BY id''', (run_id, run['organization_id']))
                transactions = cur.fetchall()
                source_a = [x for x in transactions if x['source_side'] == 'a']
                source_b = [x for x in transactions if x['source_side'] == 'b']
                matches = build_matches(source_a, source_b)
                cur.execute('''DELETE FROM public.match_group_items WHERE match_group_id IN
                               (SELECT id FROM public.match_groups WHERE run_id=%s AND organization_id=%s)''', (run_id, run['organization_id']))
                cur.execute('DELETE FROM public.match_groups WHERE run_id=%s AND organization_id=%s', (run_id, run['organization_id']))
                cur.execute("UPDATE public.transactions SET status='unmatched' WHERE run_id=%s AND organization_id=%s", (run_id, run['organization_id']))
                for match in matches:
                    cur.execute('''INSERT INTO public.match_groups
                        (organization_id,run_id,match_type,confidence,status,explanation,decided_by,decided_at)
                        VALUES (%s,%s,'one_to_one',%s,%s,%s::jsonb,%s,CASE WHEN %s='accepted' THEN now() ELSE NULL END)
                        RETURNING id''', (run['organization_id'], run_id, match['score'], match['status'], json.dumps(match['explanation']),
                                         user_id if match['status'] == 'accepted' else None, match['status']))
                    group_id = cur.fetchone()['id']
                    cur.executemany('INSERT INTO public.match_group_items(match_group_id,transaction_id,organization_id) VALUES (%s,%s,%s)',
                                    [(group_id, match['left']['id'], run['organization_id']), (group_id, match['right']['id'], run['organization_id'])])
                    tx_status = 'matched' if match['status'] == 'accepted' else 'suggested'
                    cur.execute('UPDATE public.transactions SET status=%s WHERE id=ANY(%s)', (tx_status, [match['left']['id'], match['right']['id']]))
                matched_count = sum(2 for x in matches if x['status'] == 'accepted')
                reconciled_amount = sum(abs(Decimal(str(x['left']['amount']))) for x in matches if x['status'] == 'accepted')
                avg_confidence = sum(x['score'] for x in matches) / len(matches) if matches else 0
                cur.execute('SELECT COALESCE(SUM(amount),0) AS balance FROM public.transactions WHERE run_id=%s AND source_side=%s', (run_id, 'a')); balance_a = cur.fetchone()['balance']
                cur.execute('SELECT COALESCE(SUM(amount),0) AS balance FROM public.transactions WHERE run_id=%s AND source_side=%s', (run_id, 'b')); balance_b = cur.fetchone()['balance']
                cur.execute('''UPDATE public.reconciliation_runs SET status='prepared', source_a_balance=%s, source_b_balance=%s,
                    reconciled_amount=%s, outstanding_difference=%s, total_transactions=%s, matched_transactions=%s,
                    average_confidence=%s, updated_at=now() WHERE id=%s''',
                    (balance_a, balance_b, reconciled_amount, balance_a-balance_b, total, matched_count,
                     round(avg_confidence,2), run_id))
                cur.execute('''INSERT INTO public.audit_logs(organization_id,actor_id,action,resource_type,resource_id,after_data)
                               VALUES (%s,%s,'reconciliation.processed','run',%s,%s::jsonb)''',
                            (run['organization_id'], user_id, str(run_id), json.dumps({'total': total, 'groups': len(matches), 'auto_matched': matched_count})))
                return {'run_id': str(run_id), 'total_transactions': total, 'match_groups': len(matches), 'auto_matched': matched_count,
                        'suggested': sum(1 for x in matches if x['status']=='suggested'), 'average_confidence': round(avg_confidence,2)}
    finally:
        conn.close()


def get_saas_run_results(run_id, user_id):
    conn = get_db_connection()
    if not conn:
        raise RuntimeError('Database connection unavailable')
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            run = _authorized_run(cur, run_id, user_id)
            if not run:
                raise PermissionError('Run not found or access denied')
            cur.execute('''SELECT g.id,g.confidence,g.status,g.explanation,
                json_agg(json_build_object('id',t.id,'side',t.source_side,'date',t.transaction_date,'amount',t.amount,
                'description',t.description,'reference',t.reference,'currency',t.currency) ORDER BY t.source_side) AS transactions
                FROM public.match_groups g JOIN public.match_group_items i ON i.match_group_id=g.id
                JOIN public.transactions t ON t.id=i.transaction_id
                WHERE g.run_id=%s AND g.organization_id=%s GROUP BY g.id ORDER BY g.confidence DESC''', (run_id,run['organization_id']))
            groups=cur.fetchall()
            cur.execute('''SELECT id,source_side,transaction_date,amount,description,reference,currency,status
                           FROM public.transactions WHERE run_id=%s AND organization_id=%s AND status='unmatched'
                           ORDER BY transaction_date, id LIMIT 500''',(run_id,run['organization_id']))
            unmatched=cur.fetchall()
            return _json_safe({'run': dict(run), 'groups': [dict(group) for group in groups],
                               'unmatched': [dict(transaction) for transaction in unmatched]})
    finally:
        conn.close()


def decide_saas_match(run_id, group_id, user_id, decision):
    if decision not in ('accepted','rejected'):
        raise ValueError('Decision must be accepted or rejected')
    conn=get_db_connection()
    if not conn: raise RuntimeError('Database connection unavailable')
    try:
        with conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                run=_authorized_run(cur,run_id,user_id,write=True)
                if not run: raise PermissionError('Run not found or access denied')
                cur.execute('''UPDATE public.match_groups SET status=%s,decided_by=%s,decided_at=now()
                               WHERE id=%s AND run_id=%s AND organization_id=%s RETURNING id''',(decision,user_id,group_id,run_id,run['organization_id']))
                if not cur.fetchone(): raise ValueError('Match group not found')
                cur.execute('SELECT transaction_id FROM public.match_group_items WHERE match_group_id=%s',(group_id,));ids=[x['transaction_id'] for x in cur.fetchall()]
                cur.execute('UPDATE public.transactions SET status=%s WHERE id=ANY(%s)',('matched' if decision=='accepted' else 'unmatched',ids))
                cur.execute('''UPDATE public.reconciliation_runs SET
                    matched_transactions=(SELECT COUNT(*) FROM public.transactions WHERE run_id=%s AND status='matched'),
                    reconciled_amount=(SELECT COALESCE(SUM(ABS(amount)),0) FROM public.transactions WHERE run_id=%s AND source_side='a' AND status='matched'),
                    updated_at=now() WHERE id=%s''',(run_id,run_id,run_id))
                cur.execute('''INSERT INTO public.audit_logs(organization_id,actor_id,action,resource_type,resource_id,after_data)
                               VALUES (%s,%s,%s,'match',%s,%s::jsonb)''',(run['organization_id'],user_id,f'match.{decision}',str(group_id),json.dumps({'run_id':str(run_id)})))
                return {'group_id':str(group_id),'status':decision}
    finally: conn.close()
