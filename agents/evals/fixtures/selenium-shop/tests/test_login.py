import pytest

from pages.inventory_page import InventoryPage
from pages.login_page import LoginPage
from utils.waits import wait_for_url_contains

pytestmark = pytest.mark.smoke


def test_standard_user_lands_on_products(driver, config):
    """A valid user reaches the Products page."""
    login = LoginPage(driver, config)
    login.open()
    login.sign_in(config["users"]["standard"], config["password"])
    wait_for_url_contains(driver, "inventory.html", config["timeouts"]["explicit"])
    inventory = InventoryPage(driver, config)
    assert "inventory.html" in driver.current_url
    assert inventory.title_text() == "Products"


def test_locked_out_user_sees_error(driver, config):
    """A locked-out user is refused with an explanatory message."""
    login = LoginPage(driver, config)
    login.open()
    login.sign_in(config["users"]["locked_out"], config["password"])
    assert "locked out" in login.error_text()


def test_wrong_password_shows_error(driver, config):
    """A bad password produces the credentials-mismatch error."""
    login = LoginPage(driver, config)
    login.open()
    login.sign_in(config["users"]["standard"], "not_the_password")
    assert "do not match" in login.error_text()
