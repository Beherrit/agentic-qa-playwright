# Product brief: Swag Labs

Swag Labs (https://www.saucedemo.com) is a small demo web shop run by Sauce Labs for people to practise test
automation on. It is stable, public, and resets itself: nothing a test does there is kept between sessions.

## What a shopper can do

- Sign in with a username and password.
- Browse a list of six products, each with a name, description, price and picture.
- Sort the list by name (A to Z, Z to A) or by price (low to high, high to low).
- Open a product to see its detail page.
- Add products to the cart and remove them, from the list, the detail page or the cart.
- Check out: enter first name, last name and postal code, review the order with tax and total, and finish.
- Open the side menu to go back to all items, log out, or reset the app state.

## Accounts

The login page lists the demo accounts. They all share one password, also shown on the login page, and the suite
reads it from `fixtures/personas.ts`.

| Account | What it is for |
|---|---|
| `standard_user` | Works as intended. This is the default for tests. |
| `locked_out_user` | Cannot sign in; sees a "locked out" message. |
| `problem_user` | Signs in, but parts of the shop are broken on purpose. |
| `performance_glitch_user` | Works, but pages respond slowly. |
| `error_user` | Some actions fail on purpose. |
| `visual_user` | Layout and images are wrong on purpose. |

Only `standard_user` describes how the shop is supposed to behave. The others exist to give tests something to catch.

## Things worth knowing

- There is no API to set up data through. Tests go through the UI.
- The cart is kept in the browser, so it survives a reload but not a new browser context.
- Prices are fixed. Tax on the checkout overview is 8% of the item total, rounded to cents.
- The shop has no stock, no quantities above one per product, no payment step and no order history.
