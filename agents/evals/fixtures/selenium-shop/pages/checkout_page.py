from selenium.webdriver.common.by import By

from pages.base_page import BasePage


class CheckoutPage(BasePage):
    """The checkout information, overview and complete steps."""

    FIRST_NAME = (By.CSS_SELECTOR, "[data-test='firstName']")
    LAST_NAME = (By.CSS_SELECTOR, "[data-test='lastName']")
    POSTAL_CODE = (By.CSS_SELECTOR, "[data-test='postalCode']")
    CONTINUE_BUTTON = (By.CSS_SELECTOR, "[data-test='continue']")
    FINISH_BUTTON = (By.CSS_SELECTOR, "[data-test='finish']")
    COMPLETE_HEADER = (By.CSS_SELECTOR, "[data-test='complete-header']")

    def fill_information(self, first, last, postal):
        """Fill the first name, last name and postal code fields."""
        self.type(self.FIRST_NAME, first)
        self.type(self.LAST_NAME, last)
        self.type(self.POSTAL_CODE, postal)

    def continue_(self):
        """Submit the information step."""
        self.click(self.CONTINUE_BUTTON)

    def finish(self):
        """Place the order from the overview step."""
        self.click(self.FINISH_BUTTON)

    def complete_header_text(self):
        """Return the confirmation heading."""
        return self.text_of(self.COMPLETE_HEADER)
