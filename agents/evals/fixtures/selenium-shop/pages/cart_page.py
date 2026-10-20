from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC

from pages.base_page import BasePage
from utils.data import product_slug


class CartPage(BasePage):
    """The cart listing before checkout."""

    CART_LIST = (By.CSS_SELECTOR, "[data-test='cart-list']")
    ITEM_NAMES = (By.CSS_SELECTOR, ".inventory_item_name")
    REMOVE_BUTTONS = (By.CSS_SELECTOR, "[data-test^='remove']")
    CHECKOUT_BUTTON = (By.CSS_SELECTOR, "[data-test='checkout']")

    def item_names(self):
        """Return the product names in the cart, empty when it has none."""
        self.find_with_retry(self.CART_LIST)
        return [element.text for element in self.driver.find_elements(*self.ITEM_NAMES)]

    def remove(self, product_name):
        """Remove the named product and wait for its button to go."""
        slug = product_slug(product_name)
        button = (By.CSS_SELECTOR, f"[data-test='remove-{slug}']")
        self.click(button)
        self.wait.until(EC.invisibility_of_element_located(button))

    def checkout(self):
        """Start the checkout flow."""
        self.click(self.CHECKOUT_BUTTON)
