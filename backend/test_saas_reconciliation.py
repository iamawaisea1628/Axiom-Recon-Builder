from datetime import date

from backend.saas_reconciliation import build_matches, condition_matches, score_pair


def transaction(identifier, amount, day, reference='', description=''):
    return {
        'id': identifier,
        'amount': amount,
        'transaction_date': date.fromisoformat(day),
        'reference': reference,
        'description': description,
    }


def test_exact_financial_fields_produce_auto_accept_score():
    left = transaction('a1', '1250.00', '2026-08-12', 'INV-1042', 'Northwind monthly invoice')
    right = transaction('b1', '1250.00', '2026-08-12', 'INV-1042', 'Northwind monthly invoice')

    score, explanation = score_pair(left, right)

    assert score == 100.0
    assert explanation['amount']['difference'] == 0.0
    assert explanation['date']['difference_days'] == 0
    assert explanation['reference']['exact'] is True


def test_similar_transaction_is_suggested_not_auto_accepted():
    left = transaction('a1', '450.00', '2026-08-10', '', 'Stripe settlement payout')
    right = transaction('b1', '450.00', '2026-08-11', '', 'Stripe payout settlement')

    matches = build_matches([left], [right])

    assert len(matches) == 1
    assert matches[0]['status'] == 'suggested'
    assert 60 <= matches[0]['score'] < 95


def test_matching_never_reuses_a_transaction():
    left = [
        transaction('a1', '100.00', '2026-08-01', 'ONE', 'First payment'),
        transaction('a2', '100.00', '2026-08-01', 'TWO', 'Second payment'),
    ]
    right = [transaction('b1', '100.00', '2026-08-01', 'ONE', 'First payment')]

    matches = build_matches(left, right)

    assert len(matches) == 1
    assert matches[0]['left']['id'] == 'a1'
    assert matches[0]['right']['id'] == 'b1'


def test_rule_can_promote_low_score_to_review_with_explanation():
    left = transaction('a1', '100.00', '2026-08-01', 'BATCH-77', 'Processor deposit')
    right = transaction('b1', '104.00', '2026-08-04', 'BATCH-77', 'Ledger settlement')
    rule = {'id': 'r1', 'name': 'Reference review', 'conditions': {'logic': 'and', 'groups': [
        {'field': 'reference', 'operator': 'contains', 'value': 'batch 77'}]},
        'actions': {'type': 'suggest', 'confidence_adjustment': 10, 'require_approval': True}}

    matches = build_matches([left], [right], [rule])

    assert len(matches) == 1
    assert matches[0]['status'] == 'suggested'
    assert matches[0]['explanation']['rule']['name'] == 'Reference review'


def test_approval_requirement_blocks_rule_auto_accept():
    left = transaction('a1', '100.00', '2026-08-01', 'ONE', 'First payment')
    right = transaction('b1', '100.00', '2026-08-01', 'ONE', 'First payment')
    rule = {'id': 'r1', 'name': 'Controlled exact match', 'conditions': {'logic': 'and', 'groups': [
        {'field': 'amount_difference', 'operator': 'within', 'value': '0.01'}]},
        'actions': {'type': 'auto_match', 'confidence_adjustment': 0, 'require_approval': True}}

    matches = build_matches([left], [right], [rule])

    assert matches[0]['status'] == 'suggested'
    assert matches[0]['explanation']['rule']['require_approval'] is True


def test_invalid_regex_fails_closed():
    left = transaction('a1', '100.00', '2026-08-01', 'ABC', 'Payment')
    right = transaction('b1', '100.00', '2026-08-01', 'ABC', 'Payment')

    assert condition_matches({'field': 'reference', 'operator': 'regex', 'value': '[invalid'}, left, right) is False


def test_exclude_rule_marks_pair_for_exclusion():
    left = transaction('a1', '25.00', '2026-08-01', 'FEE', 'Bank fee')
    right = transaction('b1', '25.00', '2026-08-01', 'FEE', 'Bank fee')
    rule = {'id': 'r1', 'name': 'Exclude bank fees', 'conditions': {'logic': 'and', 'groups': [
        {'field': 'description', 'operator': 'contains', 'value': 'bank fee'}]},
        'actions': {'type': 'exclude', 'confidence_adjustment': 0, 'require_approval': False}}

    matches = build_matches([left], [right], [rule])

    assert matches[0]['status'] == 'excluded'
    assert matches[0]['rule_action'] == 'exclude'
