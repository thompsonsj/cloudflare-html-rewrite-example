# PR Summary: Detect whether images should be transformed

**Downloadable summary** of the change that bases image transformation on the origin’s responsive HTML so we only transform when the origin URL encodes that width; other entries use passthrough URLs and are still cached on Cloudflare.

---

## Summary

The worker now **detects whether each srcset entry should be transformed** by checking if the origin URL encodes the same width as the descriptor (e.g. `-p-2600` in the path for 2600w). Entries that don’t match (e.g. 3840w pointing at `...-min.avif`) get **passthrough URLs** (no query params) instead of transform URLs, so the worker caches the origin file without requesting a resize. This avoids scale-up failures and keeps all widths in the srcset while still caching on Cloudflare.

---

## Problem

- Origin HTML often has a srcset with widths like 500w, 800w, … 2600w, 3840w where the **largest** entry points at a “full size” file (e.g. `...-min.avif`) with no `-p-3840` in the path.
- Requesting `?width=3840` for that file can cause Cloudflare Image Resizing to fail (e.g. scale-up or format limits).
- We wanted to avoid serving the origin image as a fallback (bandwidth goal) and instead **never request** unsupported transforms.

---

## Approach

1. **Parse origin width from URL**  
   Extract a pre-rendered width from the path when present, e.g. `-p-2600` in `...-p-2600.avif` → `2600`. No pattern (e.g. `...-min.avif`) → no width.

2. **Transform only when URL and descriptor match**  
   An entry is **transformable** when `getWidthFromOriginUrl(entry.url) === entry.width`. Only those entries get transform query params (`width`, `quality`, `fit`, `format`).

3. **Passthrough for the rest**  
   Entries that are not transformable (e.g. 3840w with `...-min.avif`) get a **passthrough** URL: same worker path but **no query parameters**. The image worker fetches the origin file once and caches it; no resize is requested. The entry stays in the srcset so the browser can still select that width and we still cache on Cloudflare.

---

## Code changes

### `src/responsive-images.ts`

- **`getWidthFromOriginUrl(url)`**  
  Returns the number from a `-p-(\d+)` segment in the URL path, or `undefined` if missing. Used to know which widths the origin actually provides.

- **`canTransformEntry(entry)`**  
  `true` when the entry’s URL encodes the same width as the descriptor (`getWidthFromOriginUrl(entry.url) === entry.width`). Drives both picture and non-picture rewrite.

- **Picture path**  
  - **AVIF source:** All entries stay; on Cloudflare every AVIF URL is a passthrough (no params), so every width is available and cached.  
  - **WebP source:** Only entries with `canTransformEntry` get transform URLs (500–2600 in the example); 3840 is only in the AVIF source.  
  - **Fallback `<img>`:** Uses the WebP srcset and first WebP or passthrough URL as `src`.

- **Non-picture path**  
  For each srcset entry: if transformable → `buildTransformUrl(...)`; otherwise → `buildPassthroughUrl(...)`. No entries are dropped; `img` `src` is transform or passthrough for the first entry as appropriate.

### `src/images.ts`

- **Transform fallback removed**  
  The previous behavior of serving the origin image when the resize request returned 5xx has been removed to avoid extra bandwidth; we rely on not requesting unsupported transforms instead.

### Docs

- **`docs/responsive-image-rewrite-example.md`**  
  Updated to describe origin-width detection, passthrough for non-transformable entries, AVIF source with all widths (passthrough), and WebP source with only transformable widths.

- **`README.md`**  
  Updated to state that non-matching entries get a passthrough URL (no query params) so the worker caches without transform.

---

## Resulting behaviour

| Origin entry     | URL pattern     | Worker URL type   | Cached as        |
|------------------|-----------------|-------------------|------------------|
| 500w             | `...-p-500.avif`| Transform         | Resized + format |
| 2600w            | `...-p-2600.avif`| Transform        | Resized + format |
| 3840w            | `...-min.avif`  | Passthrough       | Origin file      |

- No entries are dropped; the full srcset is preserved.
- No transform is requested for widths the origin doesn’t encode in the URL, so scale-up and related errors are avoided.
- All requested URLs still go through the worker and are cached on Cloudflare.

---

## Files touched

- `src/responsive-images.ts` – origin-width parsing, `canTransformEntry`, picture/non-picture use of transform vs passthrough
- `src/images.ts` – removal of 5xx → serve-origin fallback
- `README.md` – description of passthrough for non-transformable entries
- `docs/responsive-image-rewrite-example.md` – worked example updated for new behaviour
- `docs/PR-summary-transform-detection.md` – this summary
