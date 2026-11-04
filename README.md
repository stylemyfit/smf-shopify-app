# StyleMyFit Shopify app

Adds the StyleMyFit "Find My Perfect Fit" button to Shopify product pages without theme code edits.
The button only appears for products StyleMyFit says are eligible.

It packages the existing manual integration; `smfplugin.js` itself is unchanged:

| Manual integration                                         | This app                                   |
|------------------------------------------------------------|--------------------------------------------|
| `<script src=".../smfplugin.js">` before `</body>` in `theme.liquid` | **App embed** "StyleMyFit" (`target: body`, injected before `</body>`) |
| `<button onclick="openSMF()">` in the product template     | **App block** "StyleMyFit button"          |
| `<div id="stylemyfit-popup">`                              | Rendered by the same app block             |

## Layout

```
smf-shopify-app/
├── shopify.app.test.toml             # TEST app: App Proxy -> be.test.stylemyfit.com, scopes (read_products)
├── shopify.app.prod.toml             # PROD app: App Proxy -> be.stylemyfit.com, scopes (read_products)
└── extensions/smf-theme/             # theme app extension
    ├── shopify.extension.toml
    ├── blocks/smf-embed.liquid       # app embed: loads smfplugin.js + smf-fit-summary.js + smf-button.js
    ├── blocks/smf-button.liquid      # product block: button + #stylemyfit-popup + saved-profile sizes card
    └── assets/smf-button.js, smf-fit-summary.js, smf-button.css,
               smf-logo-white.png, smf-logo-black.png   # wordmark, copied from smf-customer-app-v2/public/brand
```

## How it works

1. The app embed loads `https://plugin.stylemyfit.com/smfplugin.js` and `smf-button.js`.
2. Each button block is rendered **hidden**. `smf-button.js` calls
   `/apps/smf/chek_prd/?pageUrl=<current page URL>`, which is same origin, so there's no CORS.
3. The Shopify App Proxy signs the request and forwards it to
   `https://be.stylemyfit.com/api/v1/plugin/chek_prd/?pageUrl=...&shop=...&signature=...`
   (`be.test.stylemyfit.com` for the test app).
4. The backend verifies the signature and matches the page URL to a product the same way the plugin does
   (normalised URL, or domain + last path segment/handle). It returns a status: `1` not found, `2` found but
   inactive, `3` active (product active, store publishing and not retired), plus `show` (true only for `3`).
   Responses are cached for 5 minutes.
5. Status `3` shows the button. `1` or `2` removes the block (in the theme editor it stays dimmed, and its
   tooltip says whether the product is missing or not Live). If the check can't be reached, the
   "Show button if the check fails" setting decides. Answers are cached per product for the browser session.
6. Click calls `window.MyWidget.initiateHandler()`. The plugin's default `onResult` writes the result into
   `#stylemyfit-popup`. `window.openSMF()` is still defined for old `onclick="openSMF()"` markup.
7. **Sizes for saved profiles** (`smf-fit-summary.js`, block setting "Show sizes for saved profiles", on by default).
   On status `3`, once the page has loaded and the browser is idle, it adds an invisible iframe
   `<MyWidget.origin>/fit-summary.html?pageUrl=…&origin=…` from `smf-plugin-v2`.
   - **Why an iframe:** saved profiles belong to the plugin's device id, which only the plugin's own origin can
     read (the same partitioned cookie / storage the plugin panel uses on this store).
   - **What the bridge does:** it only answers when `origin` is the product page's own site. It never creates a
     device id. It calls `POST /api/v1/plugin/prediction/fit/summary/` and posts back only the name, shape,
     whether the product is designed for that shape, recommended size and fit label of each profile (same rules
     as the plugin's result page), plus the shapes the product is designed for.
   - **The card:** drawn in a shadow root under the button, same design as the customer app's "Fit guidance" box:
     a fixed title, "Designed with … shapes in mind", and each profile with its shape verdict and size.
     - Profiles slide three at a time (arrows, dots, swipe). Tapping a profile selects it (kept in
       `localStorage` `smf:active-profile`).
     - The round StyleMyFit button (top right) calls `initiateHandler({ profileId, view: "result" })` for the
       selected profile. The bridge returns at most 10 profiles; more show as "+N more", which opens the plugin.
     - Logo: `smf-logo-icon.png`, passed in by the block as `data-smf-icon`.
   - **Caching and refresh:** the data is cached for the browser session for 5 minutes. It's refreshed when the
     plugin fires `smf:widget-closed`; each row shows a spinner meanwhile.
   - **Theme editor:** shows a sample card whose buttons do nothing.

The URL sent is `window.location.href`, the same value the plugin sends as `pageUrl`. A product therefore shows
the button only if StyleMyFit has it under the domain shoppers see (e.g. `lesjumelles.ie`). Previews on
`*.myshopify.com` won't match unless the product is stored with that domain.

## Setup

Prerequisites: a Shopify Partner account, a development store, Node 18+, and the Shopify CLI
(`npm install -g @shopify/cli`).

### Test and prod

Shopify allows one App Proxy URL per app, so there are two Shopify apps, each with its own config file:

| Environment | Config file             | Partner Dashboard app | App Proxy URL                                  | Backend secret               |
|-------------|-------------------------|-----------------------|------------------------------------------------|------------------------------|
| Test        | `shopify.app.test.toml` | StyleMyFit Test       | `https://be.test.stylemyfit.com/api/v1/plugin` | `SHOPIFY_API_SECRET` in `.env.test` |
| Prod        | `shopify.app.prod.toml` | StyleMyFit            | `https://be.stylemyfit.com/api/v1/plugin`      | `SHOPIFY_API_SECRET` in `.env.prod` |

There is no plain `shopify.app.toml`, so every command has to name its environment, either with `--config test|prod`
or after `shopify app config use test|prod`. That way nothing gets deployed to prod by accident.

### Steps (repeat for each environment)

1. Create the app in the Partner Dashboard (**StyleMyFit Test** / **StyleMyFit**), then link it:
   ```
   cd smf-shopify-app
   shopify app config link --config test     # or --config prod
   ```
   This fills `client_id` in that environment's toml.
2. Set that app's **Client secret** on the matching backend as `SHOPIFY_API_SECRET`
   (`.env.test` for test, `.env.prod` for prod). If it's missing or belongs to the other app, the endpoint answers
   `401 {"show": false}` and the button never shows.
3. Deploy the config and extension:
   ```
   shopify app deploy --config test
   shopify app deploy --config prod
   ```
   For local preview on a dev store, use `shopify app dev --config test`.
4. Install the app on the store. It requests the `read_products` scope only.

## Enable on a store

1. **Turn on the app embed:** go to Online Store → Themes → Customize → App embeds → turn on **StyleMyFit**.
   Or use the deep link. Replace `{shop}` with the store's domain and `{API_KEY}` with the `client_id` from
   `shopify.app.test.toml` or `shopify.app.prod.toml`; the test and prod links are different:
   ```
   https://{shop}/admin/themes/current/editor?context=apps&activateAppId={API_KEY}/smf-embed
   ```
   Embed settings:
   - **Enable StyleMyFit**
   - **Eligibility endpoint** (default `/apps/smf/chek_prd/`)
   - **Show button if the check fails** (default off)
2. **Add the button:** open a product template in the theme editor → Add block → Apps → **StyleMyFit button**.
   Drag it where the button should appear. Settings: label, show "using StyleMyFit" logo, logo color (white/black), background color, text color, corner radius.
   Default look: full-width black bar, spaced uppercase label, italic *using* and the white STYLEMYFIT wordmark.
   In the editor, a product that isn't eligible shows the button dimmed so you can still place it. Shoppers
   don't see it at all.
3. Remove any old manual integration from the theme (the `smfplugin.js` script tag, the `openSMF` button and
   `#stylemyfit-popup`). Otherwise the plugin loads twice.

## Backend endpoint

`GET /api/v1/plugin/chek_prd/?pageUrl=<url>` in `smf-django-backend`
(`src/views/plugin/chek_prd_api.py`).

| Case                                            | Response                                                           |
|-------------------------------------------------|--------------------------------------------------------------------|
| Product found, active, store publishing         | `200 {"show": true,  "status": 3, "status_label": "ACTIVE"}`       |
| Product inactive / store unpublished or retired | `200 {"show": false, "status": 2, "status_label": "INACTIVE"}`     |
| Not found                                       | `200 {"show": false, "status": 1, "status_label": "NOT_FOUND"}`    |
| Missing / invalid `pageUrl`                     | `400 {"show": false}`                                              |
| Missing / bad signature, secret not configured  | `401 {"show": false}`                                              |

`show` is kept so older versions of `smf-button.js` keep working. When several products match, a Live one
wins. The lookup is a single `LIMIT 1` query on the `idx_normalised_url` / `idx_domain_slug` indexes.
