"""Tests for the grocery list (src/aicity/grocery.py). Temporary databases only."""

from datetime import UTC, datetime, timedelta

import pytest

from aicity.db import DbKind, open_database
from aicity.grocery import GroceryError, GroceryItem, GroceryItemNotFound, GroceryStore


class Clock:
    def __init__(self) -> None:
        self.now = datetime(2026, 11, 29, 15, 0, tzinfo=UTC)

    def __call__(self) -> datetime:
        self.now += timedelta(seconds=1)  # every change a second apart, so order is clear
        return self.now


@pytest.fixture
def store(tmp_path):
    conn = open_database(tmp_path / "personal.db", DbKind.PERSONAL)
    yield GroceryStore(conn, clock=Clock())
    conn.close()


def names(store) -> list[tuple[str, bool]]:
    return [(i.name, i.ticked) for i in store.items()]


def test_add_and_list(store):
    eggs = store.add("Eggs")
    store.add("  Rice ")
    assert eggs == GroceryItem(id=eggs.id, name="Eggs", ticked=False)
    assert names(store) == [("Eggs", False), ("Rice", False)]
    assert store.open_count() == 2


def test_unticked_first_then_ticked_in_the_order_ticked(store):
    a, b, c = store.add("A"), store.add("B"), store.add("C")
    store.set_ticked(b.id, True)
    store.set_ticked(a.id, True)
    assert names(store) == [("C", False), ("B", True), ("A", True)]
    assert c.ticked is False


def test_a_duplicate_is_not_added_twice(store):
    eggs = store.add("Eggs")
    assert store.add("eggs").id == eggs.id
    assert store.add(" EGGS ").id == eggs.id
    assert names(store) == [("Eggs", False)]


def test_a_ticked_duplicate_comes_back_unticked(store):
    eggs = store.add("Eggs")
    store.set_ticked(eggs.id, True)
    again = store.add("eggs")
    assert (again.id, again.ticked) == (eggs.id, False)


def test_a_cleared_item_can_be_added_again_as_new(store):
    eggs = store.add("Eggs")
    store.remove(eggs.id)
    assert store.add("Eggs").id != eggs.id


def test_tick_and_untick(store):
    eggs = store.add("Eggs")
    assert store.set_ticked(eggs.id, True).ticked is True
    assert store.open_count() == 0
    assert store.set_ticked(eggs.id, False).ticked is False


def test_remove_hides_it(store):
    eggs = store.add("Eggs")
    store.add("Rice")
    store.remove(eggs.id)
    assert names(store) == [("Rice", False)]


def test_clear_ticked(store):
    eggs, rice = store.add("Eggs"), store.add("Rice")
    store.add("Milk")
    store.set_ticked(eggs.id, True)
    store.set_ticked(rice.id, True)
    assert store.clear_ticked() == 2
    assert names(store) == [("Milk", False)]


def test_clear_ticked_with_nothing_ticked(store):
    store.add("Milk")
    assert store.clear_ticked() == 0
    assert names(store) == [("Milk", False)]


@pytest.mark.parametrize("name", ["", "   ", "x" * 101])
def test_bad_names_are_refused(store, name):
    with pytest.raises(GroceryError, match="1 to 100 characters"):
        store.add(name)


def test_a_cleared_item_cannot_be_changed(store):
    eggs = store.add("Eggs")
    store.remove(eggs.id)
    with pytest.raises(GroceryError, match="taken off the list"):
        store.set_ticked(eggs.id, True)
    with pytest.raises(GroceryError, match="taken off the list"):
        store.remove(eggs.id)


def test_unknown_item(store):
    with pytest.raises(GroceryItemNotFound):
        store.set_ticked(999, True)
    with pytest.raises(GroceryItemNotFound):
        store.remove(999)
