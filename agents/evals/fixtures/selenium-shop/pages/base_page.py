import time

from selenium.common.exceptions import NoSuchElementException
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait


class BasePage:
    """Shared helpers for every page object."""

    def __init__(self, driver, config):
        self.driver = driver
        self.base_url = config["base_url"].rstrip("/")
        self.wait = WebDriverWait(driver, config["timeouts"]["explicit"])

    def open(self, path=""):
        """Navigate to a path under the base URL."""
        self.driver.get(f"{self.base_url}/{path.lstrip('/')}")

    def find(self, locator):
        """Return the element once it is visible."""
        return self.wait.until(EC.visibility_of_element_located(locator))

    def click(self, locator):
        """Click the element once it is clickable."""
        self.wait.until(EC.element_to_be_clickable(locator)).click()

    def type(self, locator, text):
        """Clear the field and type the text into it."""
        field = self.find(locator)
        field.clear()
        field.send_keys(text)

    def text_of(self, locator):
        """Return the visible text of the element."""
        return self.find(locator).text

    def find_with_retry(self, locator, attempts=3):
        """Look the element up, retrying with a short sleep between attempts."""
        for attempt in range(attempts):
            try:
                return self.driver.find_element(*locator)
            except NoSuchElementException:
                if attempt == attempts - 1:
                    raise
                time.sleep(0.5)
