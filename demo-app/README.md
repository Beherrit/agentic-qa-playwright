# Pantry demo shop

Pantry is a small grocery shop built to be tested. It has a real JSON API, a browser frontend that uses only that API, bugs that can be switched on deliberately, and one feature that can be switched on later. Tests can be written against the feature before it exists, then watched going green once the flag is on.

It has no npm dependencies and no build step. It needs Node 22 or newer.

## Run it

```
node demo-app/server.mjs
```

The shop is then at http://localhost:4173. Settings are environment variables:

| Variable   | Meaning                                         | Default |
| ---------- | ----------------------------------------------- | ------- |
| `PORT`     | Port to listen on                               | 4173    |
| `BUGS`     | Comma-separated bug names to switch on          | none    |
| `FEATURES` | Comma-separated feature names to switch on      | none    |

PowerShell example:

```
$env:BUGS = "sort-price,tax-rounding"; $env:FEATURES = "search"; node demo-app/server.mjs
```

Unknown bug or feature names stop the server with an error, so a typo cannot silently test nothing.

From code, `start({ port, bugs, features })` in `server.mjs` returns the `http.Server`. Use `port: 0` for a random free port and read it from `server.address().port` after the `listening` event.

## Accounts

| Username  | Password    | Result                                  |
| --------- | ----------- | --------------------------------------- |
| `shopper` | `pantry123` | Signs in                                |
| `locked`  | `pantry123` | Refused with "Sorry, this user has been locked out" |

The password is also printed on the sign-in page. The session is an HttpOnly cookie named `sid`. Carts and orders live in memory per session and disappear when the server stops.

## API

All bodies are JSON. Errors are `{ "error": "message" }`. Routes marked "session" return 401 when not signed in.

| Method | Path                    | Notes                                                                 |
| ------ | ----------------------- | --------------------------------------------------------------------- |
| POST   | `/api/login`            | `{username, password}`. 200 `{username}`, 401 bad credentials, 403 locked |
| POST   | `/api/logout`           | 200                                                                   |
| GET    | `/api/session`          | Session. 200 `{username}`                                             |
| GET    | `/api/config`           | 200 `{features}`. The frontend reads this to know if search is on     |
| GET    | `/api/products`         | `?sort=name-asc\|name-desc\|price-asc\|price-desc` (default `name-asc`), `&q=` when search is on. 200 `{products}`, 400 bad sort |
| GET    | `/api/products/:id`     | 200 product, 404                                                      |
| GET    | `/api/cart`             | Session. 200 `{items, count, itemTotal}`                              |
| POST   | `/api/cart`             | Session. `{productId}`. 201 cart, 400 missing id, 404 unknown product. Adding a product already in the cart changes nothing |
| DELETE | `/api/cart/:productId`  | Session. 200 cart, 404 if the product is not in the cart              |
| POST   | `/api/orders`           | Session. `{firstName, lastName, postcode}`. 201 `{id, itemTotal, tax, total}`, 400 validation or empty cart. Empties the cart |
| GET    | `/api/orders`           | Session. 200 `{orders}`                                               |
| GET    | `/api/test/state`       | 200 `{bugs, features}`, what is switched on                           |
| POST   | `/api/test/reset`       | Clears every session's cart and orders. Sessions stay signed in       |

Prices, `itemTotal`, `tax` and `total` are integer cents. Tax is 8% of the item total, rounded to the nearest cent. Order ids start at 1001 and restart there after a reset.

Products: id, name, description, price, category. There are 8, with ids 1 to 8.

## Pages

The frontend is one page with hash routes: `#/login`, `#/products`, `#/product/:id`, `#/cart`, `#/checkout`, `#/order/:id`. Elements a test needs carry a `data-test` attribute: `username`, `password`, `login`, `product-card`, `product-name`, `product-price`, `add-to-cart`, `remove-from-cart`, `sort`, `cart-badge`, `cart-item`, `cart-total`, `checkout`, `first-name`, `last-name`, `postcode`, `place-order`, `error`, `order-confirmation`, `item-total`, `tax`, `total`, `sign-out`, and when search is on, `product-search` and `no-results`. Error messages appear in an element with `role="alert"`.

## Seeded bugs

All off by default. Each one is a single small mistake, marked `// BUG(<name>)` in the code.

| Name                | What it breaks                                                                 | Where                    |
| ------------------- | ------------------------------------------------------------------------------ | ------------------------ |
| `sort-price`        | Price sorting compares prices as strings, so 10.99 sorts before 2.49           | `lib/catalog.mjs`        |
| `tax-rounding`      | Tax is truncated instead of rounded, so a 2.49 item total has 0.19 tax, not 0.20 | `lib/pricing.mjs`      |
| `cart-remove`       | Removing an item removes the first item in the cart instead of the chosen one  | `lib/cart.mjs`           |
| `postcode-optional` | Checkout accepts an empty postcode                                             | `lib/validation.mjs`     |
| `badge-stale`       | The cart count from the API does not go down after a removal, so the header badge stays high | `lib/cart.mjs` |

Search the code with `grep -rn "BUG(" demo-app` to see them. Tests can read which are active from `GET /api/test/state`.

## Feature flag

`search` (env `FEATURES=search`). Off by default: the page has no search box and the API ignores `q`. On: a search box above the product list (`data-test="product-search"`, placeholder "Search products") narrows the list to products whose name contains the text, ignoring case. When nothing matches, "No products found" appears (`data-test="no-results"`). Clearing the box shows every product again.

## Tests

```
npm run demo:test
```

The unit tests in `test/lib.test.mjs` cover the pure logic in `lib/` with no server. `test/api.test.mjs` starts servers on random ports and checks the API, including a second server for each seeded bug and for the search flag.

## Layout

```
demo-app/
  server.mjs        HTTP server, routes, start()
  lib/              catalog, pricing, validation, cart, flags (pure, unit tested)
  public/           index.html, style.css, app.js (no build step)
  test/             node:test suites
```
