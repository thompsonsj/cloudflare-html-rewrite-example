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
4. Run `npm run test` to run canonical/hreflang path tests.

The upstream origin is defined by `SHOP_URL` in `wrangler.toml`.

Note: local development works best in Safari; Chrome DevTools may request a `.well-known/appspecific/...` URL that can interfere with rewrites.

## Configuration

`wrangler.toml` controls the worker environment:

- `ENVIRONMENT`: `production` or `development`
- `SHOP_URL`: upstream origin for local proxying
- `DEBUG_LOGS`: set to `1` or `true` to enable verbose logs
- `IMAGE_ORIGIN_URL`: optional base URL for image transformation (e.g. `https://storage.googleapis.com/your-bucket`). When set, requests to `/img/*` are served as resized images.
- `IMAGE_REWRITE_BACKEND`: optional `"cloudflare"` or `"netlify"`. When set, HTML is rewritten so that all `cdn.prod.website-files.com` image URLs (in `src` and/or `srcset`) are replaced with transformation URLs (see below).
- `NETLIFY_IMAGE_CDN_BASE`: for `IMAGE_REWRITE_BACKEND=netlify` only; base URL of the site (e.g. `https://www.teamtailor.com`). Transform URLs are `{base}/.netlify/images?url=...`.
- `IMAGE_REWRITE_QUALITY`: optional quality for rewritten images, 1–100 (default 85). Applies to lossy formats where the backend supports it.
- `IMAGE_REWRITE_FORMAT`: optional `"auto"` or `"preserve"`. `auto` (default): no format is set in the URL so the transformation service uses content negotiation (AVIF/WebP when the browser supports it). `preserve`: output format is derived from the source file extension (png, jpeg, webp, gif) so the original format is kept.
- `IMAGE_REWRITE_IGNORE_SVG`: optional, default `"1"`/`"true"`. When on, SVG URLs are **not** rewritten in HTML (they stay pointing at the origin CDN). SVGs have no transform or quality settings; turning this off (`"0"`/`"false"`) rewrites SVG URLs to `/img/...` so the worker serves them as-is (no transformation).
- `IMAGE_REWRITE_FULL_WIDTH_CLASSES`: optional, comma-separated list of CSS class names. If an `<img>` has any of these classes, its `sizes` attribute is **overridden** to a full-width value (`(max-width: 2400px) 100vw, 2400px`) so the browser selects a larger image from `srcset` (e.g. fixes Webflow hero images that ship with a small `sizes` like `240px`).
- `IMAGE_REWRITE_PICTURE_FALLBACKS`: optional, default `"1"`/`"true"`. When on, rewritten images are wrapped in `<picture>` with `<source type="image/avif">` and `<source type="image/webp">` so browsers that don’t support AVIF get WebP instead of a broken image. AVIF is only used for widths ≤ 1200px (Cloudflare [format limits](https://developers.cloudflare.com/images/transform-images/#format-limitations)); the AVIF source has `media="(max-width: 1200px)"` so larger viewports use the WebP source and the browser can select higher-resolution WebP (e.g. 2400w). Set to `"0"`/`"false"` to keep a single `<img>` with content negotiation.

## Responsive image rewrite

When `IMAGE_REWRITE_BACKEND` is set, the worker rewrites every `<img>` that references `https://cdn.prod.website-files.com/` (in `src` or in `srcset`) so the browser never loads from that CDN — **except SVG URLs when `IMAGE_REWRITE_IGNORE_SVG` is on (default)**. SVGs are not transformed or quality-adjusted; with ignore on, they are left pointing at the origin CDN.

For a worked example (input markup → how it’s processed → output with `<picture>` and WebP fallbacks), see [Responsive image rewrite example](docs/responsive-image-rewrite-example.md).

- **Plain `<img src="...">`** (no srcset): the `src` is replaced and a `srcset` is added with widths 400, 800, 1200 and a default `sizes` attribute.
- **Existing responsive `<img src="..." srcset="... 500w, ... 800w, ..." sizes="...">`**: each CDN URL in `src` and `srcset` is replaced with a transformation URL at the **same width** (or density). The existing `sizes` is kept unless the img has a class listed in `IMAGE_REWRITE_FULL_WIDTH_CLASSES`, in which case `sizes` is set to a full-width value so the browser picks a larger image (fixes e.g. Webflow full-width heroes that use a small `sizes`). Only entries whose URL encodes that width (e.g. `-p-2600` in the path for 2600w) get transform query params; entries like `...-min.avif` for 3840w get a passthrough URL (no query params) so the worker caches the origin file without transform, avoiding scale-up while still caching on Cloudflare.
Quality and format are controlled by `IMAGE_REWRITE_QUALITY` and `IMAGE_REWRITE_FORMAT` (see Configuration above). When `IMAGE_REWRITE_PICTURE_FALLBACKS` is on (default), each rewritten image becomes a `<picture>` with explicit AVIF and WebP sources so older browsers get WebP instead of AVIF-only content.

- **Cloudflare** (`IMAGE_REWRITE_BACKEND=cloudflare`): Transform URLs are `{request-origin}/img/{pathname-of-cdn-url}?width=...&quality=...&fit=contain` (and optional `format=` when using preserve). Requires `IMAGE_ORIGIN_URL` set to `https://cdn.prod.website-files.com` so `/img/*` can fetch from that origin.
- **Netlify** (`IMAGE_REWRITE_BACKEND=netlify`): Transform URLs are `{NETLIFY_IMAGE_CDN_BASE}/.netlify/images?url={encoded-src}&w=...&q=...&fit=contain` (and optional `fm=` when using preserve). Use when the same site is proxied on Netlify and you want [Netlify Image CDN](https://docs.netlify.com/build/image-cdn/overview/).

## Image transformations

When `IMAGE_ORIGIN_URL` is set, the worker also handles **image resizing** at the path prefix `/img/`. It uses [Cloudflare Image Resizing](https://developers.cloudflare.com/images/transform-images/transform-via-workers/) and caches both the origin fetch and the transformed result (see [Hosting and transforming images at scale with Cloudflare](https://medium.com/@nfarina/hosting-and-transforming-images-at-scale-with-cloudflare-1aaeb97651bc)).

- **URL format:** `/img/<path-to-image>?width=800&height=600&fit=cover&quality=85` (raster only; SVG has no query params).
- **Query params (raster):** `width`, `height`, `fit` (scale-down, contain, cover, crop, pad, squeeze), `quality`, `format`, `dpr`, `blur`, `gravity`, `anim`.
- **SVG:** Requests for `.svg` are served **as-is** from the origin (no transformation or quality). This fixes SVGs showing as empty when sent through the image pipeline.
- **AVIF source:** Requests for `.avif` are served **as-is** from the origin (no transformation), so the worker is used only for caching and delivery.
- **AVIF width limit:** Per [Cloudflare format limits](https://developers.cloudflare.com/images/transform-images/#format-limitations), AVIF has a 1200px hard limit on the longest side. When the requested width exceeds that, the worker forces WebP instead of AVIF.
- **Content negotiation:** `Accept: image/avif` or `image/webp` is honored when `format` is not in the query.
- **Origin:** The path after `/img/` is appended to `IMAGE_ORIGIN_URL` (e.g. `/img/uploads/photo.jpg` → `IMAGE_ORIGIN_URL/uploads/photo.jpg`). Only images from that origin host are allowed.

To use a dedicated subdomain (e.g. `images.example.com`), add a Workers Route for that host to this same worker and either use a path like `images.example.com/uploads/photo.jpg` with a small code change to treat the full path as the image path, or keep using `example.com/img/uploads/photo.jpg`.

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

For subpages, Webflow locale path segments (`en-gb`, `en-us`, `de-de`, `fr-fr`, `es-es`) are stripped so that the same page in every locale points to the locale-agnostic path. For example, a request to `/de-de/demo` produces canonical and hreflang URLs like `/en/demo/`, `/de/demo/`, `/es/demo/` (the `de-de` segment is not repeated in the URLs). Run `npm run test` to assert homepage and subpage behaviour.