from selenium.webdriver.common.by import By

from pages.base_page import BasePage


class LoginPage(BasePage):
    """The Swag Labs sign-in form."""

    USERNAME = (By.CSS_SELECTOR, "[data-test='username']")
    PASSWORD = (By.CSS_SELECTOR, "[data-test='password']")
    LOGIN_BUTTON = (By.CSS_SELECTOR, "[data-test='login-button']")
    ERROR = (By.CSS_SELECTOR, "[data-test='error']")

    def open(self):
        """Open the sign-in page."""
        super().open("")

    def sign_in(self, user, password):
        """Submit the form with the given credentials."""
        self.type(self.USERNAME, user)
        self.type(self.PASSWORD, password)
        self.click(self.LOGIN_BUTTON)

    def error_text(self):
        """Return the sign-in error message."""
        return self.text_of(self.ERROR)
