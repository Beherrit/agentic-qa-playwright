import os
from pathlib import Path

import pytest
import yaml
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.support.ui import WebDriverWait
from webdriver_manager.chrome import ChromeDriverManager

from pages.inventory_page import InventoryPage
from pages.login_page import LoginPage

CONFIG_PATH = Path(__file__).parent / "config.yaml"


def load_config():
    """Read config.yaml and apply the BASE_URL and SAUCE_USER overrides."""
    with open(CONFIG_PATH, encoding="utf-8") as handle:
        data = yaml.safe_load(handle)
    data["base_url"] = os.environ.get("BASE_URL", data["base_url"])
    data["default_user"] = os.environ.get("SAUCE_USER", data["users"]["standard"])
    return data


@pytest.fixture(scope="session")
def config():
    """Session-wide configuration dictionary."""
    return load_config()


def make_driver(config):
    """Build a Remote driver when a Grid hub is configured, else local Chrome."""
    options = Options()
    if config["headless"]:
        options.add_argument("--headless=new")
    options.add_argument("--disable-gpu")
    hub = os.environ.get("SELENIUM_HUB") or config.get("grid", {}).get("hub_url")
    if hub:
        browser = webdriver.Remote(command_executor=hub, options=options)
    else:
        service = Service(ChromeDriverManager().install())
        browser = webdriver.Chrome(service=service, options=options)
    browser.set_window_size(config["window"]["width"], config["window"]["height"])
    browser.implicitly_wait(config["timeouts"]["implicit"])
    browser.set_page_load_timeout(config["timeouts"]["page_load"])
    return browser


@pytest.fixture
def driver(config):
    """A fresh browser session per test, quit afterwards."""
    browser = make_driver(config)
    yield browser
    browser.quit()


@pytest.fixture(scope="class")
def shared_driver(config):
    """One browser session for a whole test class, signed in once."""
    browser = make_driver(config)
    login = LoginPage(browser, config)
    login.open()
    login.sign_in(config["default_user"], config["password"])
    yield browser
    browser.quit()


@pytest.fixture
def wait(driver, config):
    """Explicit wait bound to the configured timeout."""
    return WebDriverWait(driver, config["timeouts"]["explicit"])


@pytest.fixture
def logged_in(driver, config):
    """Sign in as the default user and return the inventory page."""
    login = LoginPage(driver, config)
    login.open()
    login.sign_in(config["default_user"], config["password"])
    inventory = InventoryPage(driver, config)
    assert inventory.title_text() == "Products"
    return inventory
