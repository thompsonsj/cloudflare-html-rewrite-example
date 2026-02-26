# Responsive image rewrite: worked example

This document walks through how the worker rewrites a single responsive `<img>` that points at `cdn.prod.website-files.com`, including picture fallbacks and the AVIF width limit. It uses a real-world style example (full-width grid image with multiple AVIF sources).

**Important:** The worker only rewrites markup when `src` and/or `srcset` URLs use the origin CDN host `https://cdn.prod.website-files.com/`. If your HTML already contains worker URLs (e.g. `https://yoursite.com/img/...`), that markup was produced by a previous rewrite or another environment; the logic below applies to the **origin** HTML before the worker runs.

---

## 1. Input (origin markup)

The origin sends an `<img>` with a full `srcset` of AVIF URLs and a single `sizes` value:

```html
<figure class="c-case-grid" style="translate: none; rotate: none; scale: none; opacity: 1; transform: translate3d(0px, 0px, 0px);">
  <img
    src="https://cdn.prod.website-files.com/69145ecd988074cf311effb9/6936cefa0e7da753b2c8e43c_teamtailor-career-sites-full-grid-min-p-500.avif"
    loading="lazy"
    width="1920"
    sizes="100vw"
    alt="Collage of diverse career site landing pages featuring job titles, people at work, and application buttons."
    srcset="
      https://cdn.prod.website-files.com/69145ecd988074cf311effb9/6936cefa0e7da753b2c8e43c_teamtailor-career-sites-full-grid-min-p-500.avif 500w,
      https://cdn.prod.website-files.com/69145ecd988074cf311effb9/6936cefa0e7da753b2c8e43c_teamtailor-career-sites-full-grid-min-p-800.avif 800w,
      https://cdn.prod.website-files.com/69145ecd988074cf311effb9/6936cefa0e7da753b2c8e43c_teamtailor-career-sites-full-grid-min-p-1080.avif 1080w,
      https://cdn.prod.website-files.com/69145ecd988074cf311effb9/6936cefa0e7da753b2c8e43c_teamtailor-career-sites-full-grid-min-p-1600.avif 1600w,
      https://cdn.prod.website-files.com/69145ecd988074cf311effb9/6936cefa0e7da753b2c8e43c_teamtailor-career-sites-full-grid-min-p-2000.avif 2000w,
      https://cdn.prod.website-files.com/69145ecd988074cf311effb9/6936cefa0e7da753b2c8e43c_teamtailor-career-sites-full-grid-min-p-2600.avif 2600w,
      https://cdn.prod.website-files.com/69145ecd988074cf311effb9/6936cefa0e7da753b2c8e43c_teamtailor-career-sites-full-grid-min.avif 3840w
    "
    class="c-case-grid_img"
  />
</figure>
```

---

## 2. How the worker processes it

| Step | What happens |
|------|----------------|
| **Match** | `src` and every `srcset` URL start with `https://cdn.prod.website-files.com/` → the image is eligible for rewrite. |
| **No SVG** | None of the URLs are `.svg`, and AVIF is not ignored → all 7 entries are included in `toRewrite`. |
| **Picture fallbacks** | `IMAGE_REWRITE_PICTURE_FALLBACKS` is on (default) → the worker uses `replaceImgWithPicture` instead of a single `<img>`. |
| **Entries** | Parsed `srcset` yields 7 entries: 500w, 800w, 1080w, 1600w, 2000w, 2600w, 3840w. |
| **AVIF width cap** | For Cloudflare, `avifEntries = entries.filter(e => e.width <= 1200)` → **500, 800, 1080** only. Widths 1600, 2000, 2600, 3840 are not used in the AVIF source (see [Cloudflare format limits](https://developers.cloudflare.com/images/transform-images/#format-limitations)). |
| **Sizes** | The image has no class in `IMAGE_REWRITE_FULL_WIDTH_CLASSES` → the existing `sizes="100vw"` is kept. |

---

## 3. Output (after rewrite)

The `<img>` is replaced by a `<picture>` with one AVIF source (widths ≤ 1200), one WebP source (all widths), and an `<img>` fallback so browsers without AVIF support still get an image. Worker origin is assumed to be `https://teamtailorcdn.com`.

```html
<figure class="c-case-grid" style="...">
  <picture>
    <source
      type="image/avif"
      srcset="
        https://teamtailorcdn.com/img/69145ecd988074cf311effb9/6936cefa0e7da753b2c8e43c_teamtailor-career-sites-full-grid-min-p-500.avif?width=500&quality=85&fit=contain&format=avif 500w,
        https://teamtailorcdn.com/img/69145ecd988074cf311effb9/6936cefa0e7da753b2c8e43c_teamtailor-career-sites-full-grid-min-p-800.avif?width=800&quality=85&fit=contain&format=avif 800w,
        https://teamtailorcdn.com/img/69145ecd988074cf311effb9/6936cefa0e7da753b2c8e43c_teamtailor-career-sites-full-grid-min-p-1080.avif?width=1080&quality=85&fit=contain&format=avif 1080w
      "
    />
    <source
      type="image/webp"
      srcset="
        https://teamtailorcdn.com/img/.../...-p-500.avif?width=500&quality=85&fit=contain&format=webp 500w,
        https://teamtailorcdn.com/img/.../...-p-800.avif?width=800&quality=85&fit=contain&format=webp 800w,
        https://teamtailorcdn.com/img/.../...-p-1080.avif?width=1080&quality=85&fit=contain&format=webp 1080w,
        https://teamtailorcdn.com/img/.../...-p-1600.avif?width=1600&quality=85&fit=contain&format=webp 1600w,
        https://teamtailorcdn.com/img/.../...-p-2000.avif?width=2000&quality=85&fit=contain&format=webp 2000w,
        https://teamtailorcdn.com/img/.../...-p-2600.avif?width=2600&quality=85&fit=contain&format=webp 2600w,
        https://teamtailorcdn.com/img/.../...-min.avif?width=3840&quality=85&fit=contain&format=webp 3840w
      "
    />
    <img
      src="https://teamtailorcdn.com/img/.../...-p-500.avif?width=500&quality=85&fit=contain&format=webp"
      srcset="...same 7 WebP URLs as above..."
      sizes="100vw"
      alt="Collage of diverse career site landing pages featuring job titles, people at work, and application buttons."
      class="c-case-grid_img"
      loading="lazy"
    />
  </picture>
</figure>
```

- **AVIF source:** Only 500w, 800w, 1080w (≤ 1200px), so the AVIF width limit is respected.
- **WebP source:** All 7 widths, with `format=webp` so the worker (and Cloudflare) can convert AVIF → WebP where needed.
- **`<img>`:** Uses the WebP URLs so legacy or non-AVIF browsers still receive a valid image.

---

## 4. If you don’t see `<picture>` in production

The rewrite only runs when the HTML the worker receives still has the **origin** CDN in `src`/`srcset`:

- **View Page Source** (not Inspect) and check whether those attributes use `https://cdn.prod.website-files.com/` or already your worker domain.
- If they already point at your worker, the markup is either cached from an earlier request or produced by another config; the logic above applies to the **source** response from your origin (e.g. Webflow/CMS) before any rewrite.
