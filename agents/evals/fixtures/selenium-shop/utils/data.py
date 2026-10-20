import random

FIRST_NAMES = ["Ada", "Grace", "Linus", "Margaret", "Alan"]
LAST_NAMES = ["Lovelace", "Hopper", "Torvalds", "Hamilton", "Turing"]
POSTAL_CODES = ["80202", "82001", "10001", "94105"]

PRODUCT_NAMES = [
    "Sauce Labs Backpack",
    "Sauce Labs Bike Light",
    "Sauce Labs Bolt T-Shirt",
]


def first_name():
    """Return a first name for the checkout form."""
    return random.choice(FIRST_NAMES)


def last_name():
    """Return a last name for the checkout form."""
    return random.choice(LAST_NAMES)


def postal_code():
    """Return a postal code for the checkout form."""
    return random.choice(POSTAL_CODES)


def checkout_form():
    """Return a complete set of checkout form values."""
    return {
        "first_name": first_name(),
        "last_name": last_name(),
        "postal_code": postal_code(),
    }


def product_slug(product_name):
    """Turn a product name into the slug used in data-test attributes."""
    return product_name.lower().replace(" ", "-")
