import pytest

from pages.cart_page import CartPage
from pages.inventory_page import InventoryPage

pytestmark = pytest.mark.cart

BACKPACK = "Sauce Labs Backpack"


def badge_count(driver):
    """Return the cart badge number, or 0 when the badge is absent."""
    badges = driver.find_elements(*InventoryPage.CART_BADGE)
    return int(badges[0].text) if badges else 0


def test_added_item_appears_in_cart(logged_in, driver, config):
    """A product added on the listing shows up in the cart."""
    logged_in.add_to_cart(BACKPACK)
    logged_in.open_cart()
    cart = CartPage(driver, config)
    assert BACKPACK in cart.item_names()


def test_remove_item_empties_cart(logged_in, driver, config):
    """Removing the only product leaves an empty cart and no badge."""
    logged_in.add_to_cart(BACKPACK)
    logged_in.open_cart()
    cart = CartPage(driver, config)
    cart.remove(BACKPACK)
    assert cart.item_names() == []
    assert badge_count(driver) == 0
