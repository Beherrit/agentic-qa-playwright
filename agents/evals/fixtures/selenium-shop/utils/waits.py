from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait


def wait_for_visible(driver, locator, timeout=7):
    """Block until the element is visible and return it."""
    return WebDriverWait(driver, timeout).until(EC.visibility_of_element_located(locator))


def wait_for_url_contains(driver, text, timeout=7):
    """Block until the current URL contains the given text."""
    return WebDriverWait(driver, timeout).until(EC.url_contains(text))


def wait_for_text(driver, locator, text, timeout=7):
    """Block until the element's text contains the given text."""
    return WebDriverWait(driver, timeout).until(
        EC.text_to_be_present_in_element(locator, text)
    )
