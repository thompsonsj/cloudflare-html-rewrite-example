# Cloudflare HTML Rewrite Example

This repo demonstrates a Cloudflare Worker that proxies HTML and rewrites the `<head>` to inject canonical and hreflang tags based on the requested path. It is a practical starting point for HTML customizations that must happen before the page reaches the browser.

## Why use a Worker

- Avoid layout shifts caused by client-side DOM changes.
- Reduce client-side work on slower devices and networks.
- Centralize HTML modifications at the edge.

Tradeoff: the HTML response is slightly delayed while it is parsed and rewritten.

## What this worker does

In `src/index.ts`, the worker:

- Proxies the upstream HTML.
- Removes any existing `canonical` and `alternate` tags from `<head>`.
- Injects a new canonical and hreflang set based on the request path.
- Adds a small demo block after `#header` to show the rewrite in action.

## Local development

Requirements:

- Node.js
- A Cloudflare account (free is fine) for `npm run dev:remote`

Steps:

1. Install dependencies: `npm i`
2. Run `npm run dev:remote`
3. Visit <http://localhost:8787/>

The upstream origin is defined by `SHOP_URL` in `wrangler.toml`.

Note: local development works best in Safari; Chrome DevTools may request a `.well-known/appspecific/...` URL that can interfere with rewrites.

## Configuration

`wrangler.toml` controls the worker environment:

- `ENVIRONMENT`: `production` or `development`
- `SHOP_URL`: upstream origin for local proxying
- `DEBUG_LOGS`: set to `1` or `true` to enable verbose logs

## Production use

Requirements:

- A Shoptet project using Cloudflare as a proxy (see [Shoptet docs](https://podpora.shoptet.cz/hc/cs/articles/7128655751826-Cloudflare))
- Cloudflare access with `Cloudflare Workers Admin` rights

Steps:

1. Run `npm run deploy:production`
2. Configure Workers Routes in Cloudflare

When setting routes, exclude common system and asset paths. Recommended disabled routes are listed in `src/config/recommended-disabled-routes.json`, and should be adjusted per project.

Example of typical Workers Routes settings (see [docs](https://developers.cloudflare.com/workers/configuration/routing/routes/) for matching rules):

<img src="docs/img/cloudflare-navigation.png" alt="Cloudflare navigation" style="margin: 20px; padding: 10px; border: 1px solid gray" />

<img src="docs/img/routes-setting.png" alt="Worker Routes settings" style="margin: 20px; padding: 10px; border: 1px solid gray" />

## HTML parsing strategy

This example uses [node-html-parser](https://www.npmjs.com/package/node-html-parser), which parses the whole document into memory. It is flexible and comparable to browser DOM manipulation (`querySelector`, etc.), and is suitable for more complex HTML changes. Average TTFB increase is around 50-70ms.

If you only need simple streaming rewrites, switch to the `with-html-rewriter` branch to use Cloudflare's [HTMLRewriter](https://developers.cloudflare.com/workers/runtime-apis/html-rewriter/). It streams HTML while rewriting, but has more limited capabilities.

## Staging deployments

To deploy a staging worker, use environment variables. In this repo, `npm run deploy:staging` publishes a `workers.dev` URL that runs in dev mode. See Cloudflare docs for environment variables and staging workflows.

## Future enhancements

- Live reload for `dev:remote`
- Unified workflow for HTML, JS, and CSS customization
- GitHub Actions deployment

## Injected content

The worker removes any existing canonical and hreflang tags and injects the following set based on the requested path. Example for `/en/`:

```html
<link rel="canonical" href="https://www.teamtailor.com/en/">
<link rel="alternate" hreflang="en" href="https://www.teamtailor.com/en/">
<link rel="alternate" hreflang="en-us" href="https://www.teamtailor.com/en-us/">
<link rel="alternate" hreflang="da" href="https://www.teamtailor.com/da/">
<link rel="alternate" hreflang="de" href="https://www.teamtailor.com/de/">
<link rel="alternate" hreflang="es" href="https://www.teamtailor.com/es/">
<link rel="alternate" hreflang="fi" href="https://www.teamtailor.com/fi/">
<link rel="alternate" hreflang="fr" href="https://www.teamtailor.com/fr/">
<link rel="alternate" hreflang="it" href="https://www.teamtailor.com/it/">
<link rel="alternate" hreflang="nl" href="https://www.teamtailor.com/nl/">
<link rel="alternate" hreflang="no" href="https://www.teamtailor.com/no/">
<link rel="alternate" hreflang="sv" href="https://www.teamtailor.com/sv/">
<link rel="alternate" hreflang="x-default" href="https://www.teamtailor.com/en/">
```