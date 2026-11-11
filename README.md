# teamtailor-assets

A Cloudflare Worker that serves public assets from the Payload CMS on a stable domain we control:

**https://teamtailorcdn.com/** → `https://tt.payloadcms.app/`

Use `teamtailorcdn.com` URLs anywhere an asset is embedded outside the CMS: MCAE (Account Engagement) forms, layouts and emails, email signatures and templates. If the CMS ever moves, change `ORIGIN_URL` in `wrangler.toml` and redeploy; every published link keeps working.

> This repo previously held the Webflow HTML-rewrite worker for teamtailorcdn.com. That site has been retired; the old code is in git history.

## What it serves

| Path | Origin | Cache (edge / browser) |
| --- | --- | --- |
| `/forms/*` | MCAE form styles and scripts built by marketingcms (`packages/ui-forms` → `public/forms`) | 5 min / 5 min |
| `/api/<collection>/file/*` | Payload upload files (email images, media, logos, headshots…) | 1 day / 1 hour |
| `/img/api/<collection>/file/*?width=…` | The same upload files, resized by Cloudflare Image Resizing | 1 year |
| `/healthz` | Health check | none |

Everything else returns **404**, including the Payload admin and API. Only `GET`, `HEAD` and `OPTIONS` are accepted.

The upload collections allowed are listed in `src/paths.ts` (`UPLOAD_COLLECTIONS`). When a new upload collection is added in marketingcms, add its slug there and redeploy.

### Examples

```
https://teamtailorcdn.com/forms/tt-form.95a2a26e.min.js
https://teamtailorcdn.com/api/email/file/header.png
https://teamtailorcdn.com/img/api/media/file/photo.jpg?width=800&quality=80
```

Image options for `/img/*`: `width`, `height`, `fit` (scale-down, contain, cover, crop, pad, squeeze), `quality`, `format`, `dpr`, `blur`, `gravity`, `anim`. Without `format`, AVIF or WebP is chosen from the browser's `Accept` header.

## Security

- Request cookies and `Authorization` headers are never forwarded to the origin, and `Set-Cookie` from the origin is never returned. CMS sessions cannot leak through this domain.
- Uploaded files get a sandboxing `Content-Security-Policy`, so an uploaded HTML or SVG file cannot run script on this domain.
- All responses carry `X-Robots-Tag: noindex` and `X-Content-Type-Options: nosniff`.
- CORS is open (`Access-Control-Allow-Origin: *`) because these are public assets loaded from MCAE and email clients.

## Caching notes

Form assets are built without content hashes, so a marketingcms deploy keeps the same file names. Their 5-minute TTL means a deploy is live within about 5 minutes. Upload files are cached for a day at the edge; if a file is replaced under the same name, purge it in Cloudflare (Caching → Configuration → Custom purge) or wait a day.

## Develop and deploy

Requirements: Node.js and access to the Teamtailor Cloudflare account (the one with the teamtailorcdn.com zone).

```sh
npm install
npm test                 # unit tests (paths, headers, caching)
npm run typecheck
npm run dev              # local dev against tt.payloadcms.app
npm run deploy:dev       # deploys teamtailor-assets-dev on *.workers.dev
npm run deploy:production
```

## Checking it works

```sh
curl -sI https://teamtailorcdn.com/healthz
curl -sI https://teamtailorcdn.com/forms/tt-form.95a2a26e.min.js
curl -sI https://teamtailorcdn.com/admin            # expect 404
```

Logs: Cloudflare dashboard → Workers & Pages → teamtailor-assets → Logs.
