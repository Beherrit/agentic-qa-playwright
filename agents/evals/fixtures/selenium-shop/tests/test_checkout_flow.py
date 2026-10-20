import time

import pytest

from pages.cart_page import CartPage
from pages.checkout_page import CheckoutPage
from pages.inventory_page import InventoryPage
from utils.data import checkout_form
from utils.waits import wait_for_url_contains

BACKPACK = "Sauce Labs Backpack"


@pytest.mark.regression
class TestCheckoutFlow:
    """Checkout runs in order on one shared session."""

    def test_1_add_backpack(self, shared_driver, config):
        """Adding the backpack puts one item in the cart badge."""
        inventory = InventoryPage(shared_driver, config)
        inventory.add_to_cart(BACKPACK)
        assert inventory.badge_count() == 1

    def test_2_cart_holds_backpack(self, shared_driver, config):
        """The cart opened on the same session lists the backpack."""
        InventoryPage(shared_driver, config).open_cart()
        cart = CartPage(shared_driver, config)
        assert BACKPACK in cart.item_names()

    def test_3_checkout_information(self, shared_driver, config):
        """Filling the information step leads to the overview."""
        CartPage(shared_driver, config).checkout()
        form = checkout_form()
        checkout = CheckoutPage(shared_driver, config)
        checkout.fill_information(form["first_name"], form["last_name"], form["postal_code"])
        checkout.continue_()
        wait_for_url_contains(shared_driver, "checkout-step-two", config["timeouts"]["explicit"])
        assert "checkout-step-two" in shared_driver.current_url

    def test_4_finish_shows_thank_you(self, shared_driver, config):
        """Finishing the order shows the thank-you heading."""
        checkout = CheckoutPage(shared_driver, config)
        checkout.finish()
        time.sleep(2)
        assert checkout.complete_header_text() == "Thank you for your order!"
