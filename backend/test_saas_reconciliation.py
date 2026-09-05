from datetime import date

from backend.saas_reconciliation import build_matches, score_pair


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
