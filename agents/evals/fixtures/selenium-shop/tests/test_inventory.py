import pytest

from utils.checks import assert_badge_shows, assert_names_sorted
from utils.data import PRODUCT_NAMES

pytestmark = pytest.mark.regression


def test_sort_by_name_descending(logged_in):
    """Sorting Z to A reverses the alphabetical order."""
    logged_in.sort_by("za")
    assert_names_sorted(logged_in.item_names(), reverse=True)


def test_add_to_cart_updates_badge(logged_in):
    """The cart badge counts each product added."""
    logged_in.add_to_cart(PRODUCT_NAMES[0])
    assert_badge_shows(logged_in, 1)
    logged_in.add_to_cart(PRODUCT_NAMES[1])
    assert_badge_shows(logged_in, 2)


def test_six_products_listed(logged_in):
    """The catalogue shows all six products."""
    assert len(logged_in.item_names()) == 6
