export interface Env {
	ENVIRONMENT: 'production' | 'development';
	SHOP_URL?: string;
	DEBUG_LOGS?: string;
	GTM_CONTAINER_ID?: string;
	/** Base URL for image transformation origin (e.g. https://storage.example.com/bucket). When set, /img/* is handled by the image worker. */
	IMAGE_ORIGIN_URL?: string;
	/** If set, HTML is rewritten to replace cdn.prod.website-files.com img src with responsive img (srcset/sizes) using this backend. */
	IMAGE_REWRITE_BACKEND?: 'cloudflare' | 'netlify';
	/** For IMAGE_REWRITE_BACKEND=netlify: base URL of the site (e.g. https://www.teamtailor.com). Transform URLs are {base}/.netlify/images?url=... */
	NETLIFY_IMAGE_CDN_BASE?: string;
	/** Quality for rewritten images (1–100). Default 85. */
	IMAGE_REWRITE_QUALITY?: string;
	/** "auto" = content negotiation (AVIF/WebP when supported). "preserve" = keep original format from file extension. */
	IMAGE_REWRITE_FORMAT?: 'auto' | 'preserve';
	/** When "1" or "true" (default), do not rewrite SVG URLs in HTML — leave them pointing at the origin CDN. SVGs have no transform/quality; set to "0"/"false" to rewrite SVGs to /img/... so they are served by the worker as-is. */
	IMAGE_REWRITE_IGNORE_SVG?: string;
	/** Comma-separated list of CSS class names. If an img has any of these classes, its sizes attribute is set to a full-width value so the browser picks a larger srcset candidate (fixes e.g. Webflow hero images that use small sizes). */
	IMAGE_REWRITE_FULL_WIDTH_CLASSES?: string;
}
