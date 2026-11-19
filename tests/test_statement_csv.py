"""Tests for reading and sorting a chequing statement CSV.

Every CSV here is written in the test with invented values: never copied from a
real statement.
"""

from datetime import date

import pytest

from aicity.settings import MainJob, PaySchedule
from aicity.statement_csv import (
    MAX_BYTES,
    StatementError,
    classify,
    read_statement,
    row_key,
)

HEADER = "date,transaction,description,amount,balance,currency\n"
MAIN = MainJob("Day job", "DAY JOB PAY")
SCHEDULES = {
    "platform_a": PaySchedule("platform_a", "Platform A", 5, (5, 6), (3, 4), "NIMBUS LABS")
}


def csv(*lines: str, header: str = HEADER) -> bytes:
    return (header + "\n".join(lines) + "\n").encode()


def test_rows_are_read():
    [row] = read_statement(csv("2026-03-20,Deposit,DAY JOB PAY 123,2100.00,5000.00,CAD"))
    assert (row.line, row.day, row.amount_cents, row.balance_cents, row.currency) == (
        2,
        date(2026, 3, 20),
        210000,
        500000,
        "CAD",
    )


def test_headers_in_any_case_and_order():
    header = "Currency,AMOUNT,Description,Date,Balance,Transaction\n"
    [row] = read_statement(csv("CAD,12.50,Something,2026-03-20,100,Deposit", header=header))
    assert (row.amount_cents, row.description) == (1250, "Something")


def test_byte_order_mark_is_ignored():
    [row] = read_statement(b"\xef\xbb\xbf" + csv("2026-03-20,Deposit,X,1,1,CAD"))
    assert row.amount_cents == 100


def test_quoted_description_with_commas():
    [row] = read_statement(csv('2026-03-20,Deposit,"NIMBUS LABS, INC",1,1,CAD'))
    assert row.description == "NIMBUS LABS, INC"


def test_blank_lines_are_skipped():
    rows = read_statement(csv("2026-03-20,Deposit,X,1,1,CAD", "", "2026-03-21,Deposit,Y,2,3,CAD"))
    assert [r.amount_cents for r in rows] == [100, 200]


def test_empty_balance_is_allowed():
    [row] = read_statement(csv("2026-03-20,Deposit,X,1,,CAD"))
    assert row.balance_cents is None


@pytest.mark.parametrize(
    "line",
    [
        '2026-03-20,Deposit,X,"1,234.56",1,CAD',
        "2026-03-20,Deposit,X,$12,1,CAD",
        "2026-03-20,Deposit,X,12.345,1,CAD",
        "2026-02-30,Deposit,X,1,1,CAD",
        "20-03-2026,Deposit,X,1,1,CAD",
        "2026-03-20,Deposit,X,1",
    ],
)
def test_bad_rows_name_the_line_not_the_content(line):
    with pytest.raises(StatementError) as exc:
        read_statement(csv("2026-03-20,Deposit,OK,1,1,CAD", line))
    assert "line 3" in str(exc.value)
    assert "Deposit" not in str(exc.value)


def test_missing_header_is_named():
    with pytest.raises(StatementError) as exc:
        read_statement(
            csv(
                "2026-03-20,Deposit,X,1,CAD",
                header="date,transaction,description,amount,currency\n",
            )
        )
    assert "balance" in str(exc.value)


def test_too_big_is_refused():
    with pytest.raises(StatementError):
        read_statement(b"x" * (MAX_BYTES + 1))


def test_not_text_is_refused():
    with pytest.raises(StatementError):
        read_statement(b"\xff\xfe\x00garbage")


def test_classify_sorts_rows():
    rows = read_statement(
        csv(
            "2026-03-06,Deposit,Day Job Pay 1,2100.00,1,CAD",
            "2026-03-09,Deposit,nimbus labs payout,450.10,1,CAD",
            "2026-03-10,Deposit,REFUND STORE,12.00,1,CAD",
            "2026-03-10,Purchase,COFFEE,-4.50,1,CAD",
            "2026-03-11,Deposit,NIMBUS LABS,10.00,1,USD",
        )
    )
    c = classify(rows, MAIN, SCHEDULES)
    assert [r.amount_cents for r in c.main_job] == [210000]
    assert [r.amount_cents for r in c.platform["platform_a"]] == [45010]
    assert [r.amount_cents for r in c.other_income] == [1200]
    assert (c.spending, c.other_currency) == (1, 1)


def test_main_job_wins_when_both_match():
    rows = read_statement(csv("2026-03-06,Deposit,DAY JOB PAY NIMBUS LABS,1,1,CAD"))
    c = classify(rows, MAIN, SCHEDULES)
    assert len(c.main_job) == 1 and c.platform == {}


def test_without_matching_words_everything_is_other_income():
    rows = read_statement(csv("2026-03-06,Deposit,DAY JOB PAY,1,1,CAD"))
    c = classify(rows, None, {})
    assert len(c.other_income) == 1


def test_row_key_is_stable_and_sensitive():
    a = read_statement(csv("2026-03-06,Deposit,X,1.00,10.00,CAD"))[0]
    b = read_statement(csv("2026-03-06,Deposit,X,1,10,CAD"))[0]
    c = read_statement(csv("2026-03-06,Deposit,X,1.00,11.00,CAD"))[0]
    assert row_key(a) == row_key(b)  # same values, written differently
    assert row_key(a) != row_key(c)
    assert len(row_key(a)) == 64
