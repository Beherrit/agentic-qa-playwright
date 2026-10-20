def assert_badge_shows(inventory, count):
    """Assert the cart badge shows the expected number."""
    actual = inventory.badge_count()
    assert actual == count, f"expected cart badge {count}, found {actual}"


def assert_on_page(driver, fragment):
    """Assert the current URL contains the fragment."""
    assert fragment in driver.current_url, f"{fragment!r} not in {driver.current_url}"


def assert_names_sorted(names, reverse=False):
    """Assert the names are already in alphabetical order."""
    assert names == sorted(names, reverse=reverse), f"names not sorted: {names}"
