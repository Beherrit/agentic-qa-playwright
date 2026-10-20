from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import Select

from pages.base_page import BasePage
from utils.data import product_slug


class InventoryPage(BasePage):
    """The product listing shown after sign-in."""

    TITLE = (By.CSS_SELECTOR, ".title")
    SORT_SELECT = (By.CSS_SELECTOR, "[data-test='product-sort-container']")
    ITEM_NAMES = (By.CSS_SELECTOR, ".inventory_item_name")
    ADD_BUTTONS = (By.CSS_SELECTOR, "[data-test^='add-to-cart']")
    CART_BADGE = (By.CSS_SELECTOR, ".shopping_cart_badge")
    CART_LINK = (By.CSS_SELECTOR, ".shopping_cart_link")

    def title_text(self):
        """Return the page heading."""
        return self.text_of(self.TITLE)

    def sort_by(self, value):
        """Pick a sort option by its value, such as 'za'."""
        Select(self.find(self.SORT_SELECT)).select_by_value(value)

    def item_names(self):
        """Return the product names in the order shown."""
        elements = self.wait.until(EC.presence_of_all_elements_located(self.ITEM_NAMES))
        return [element.text for element in elements]

    def add_to_cart(self, product_name):
        """Add the named product to the cart."""
        slug = product_slug(product_name)
        self.click((By.CSS_SELECTOR, f"[data-test='add-to-cart-{slug}']"))

    def add_button_count(self):
        """Return how many products can still be added."""
        return len(self.driver.find_elements(*self.ADD_BUTTONS))

    def badge_count(self):
        """Return the cart badge number, or 0 when no badge is shown."""
        badges = self.driver.find_elements(*self.CART_BADGE)
        return int(badges[0].text) if badges else 0

    def open_cart(self):
        """Go to the cart page."""
        self.click(self.CART_LINK)
        self.wait.until(EC.url_contains("cart.html"))
