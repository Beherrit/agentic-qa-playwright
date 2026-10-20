# selenium-shop

Selenium 4 + pytest suite for Swag Labs (https://www.saucedemo.com).
Install with `pip install -r requirements.txt`, then run `pytest -m smoke` (or `-m regression`, `-m cart`).
Set `SAUCE_USER` to sign in as a different user and `BASE_URL` to point at another deployment.
The users, the shared password and the default base URL live in config.yaml.
Browser, headless mode, window size and timeouts are also read from config.yaml.
Grid run: `SELENIUM_HUB=http://hub:4444/wd/hub pytest -n 4` builds a Remote driver against the hub; without SELENIUM_HUB the suite uses grid.hub_url from config.yaml.
tests/test_checkout_flow.py runs on one shared session, in order (test_1 to test_4), so its tests depend on each other.
