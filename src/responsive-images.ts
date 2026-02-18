/**
 * Rewrites <img> elements whose src (and optionally srcset) point at
 * cdn.prod.website-files.com to use transformation URLs (Cloudflare or Netlify)
 * so the browser never loads from that CDN. Supports both plain img and existing
 * responsive markup (srcset/sizes); preserves widths and sizes when present.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/HTML/Guides/Responsive_images
 * @see https://docs.netlify.com/build/image-cdn/overview/
 */

import type { HTMLElement } from 'node-html-parser';
import type { Env } from './types/env';

/** Img src prefix we rewrite to transformation URLs (Cloudflare or Netlify). */
export const CDN_SOURCE_PREFIX = 'https://cdn.prod.website-files.com/';

/** Widths (px) used for srcset when the img has no existing srcset. */
const RESPONSIVE_WIDTHS = [400, 800, 1200];

/** Default width for src fallback when no srcset, or for x-descriptor fallback. */
const DEFAULT_WIDTH = 800;

/** Default quality when IMAGE_REWRITE_QUALITY is not set. */
const DEFAULT_QUALITY = 85;

/** Fit mode: preserve aspect ratio, scale down only. */
const FIT = 'contain';

/** Default sizes when the img has no sizes attribute. */
const DEFAULT_SIZES =
	'(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 800px';

/** Extension → format for "preserve" mode. Netlify/Cloudflare use jpeg not jpg. */
const EXT_TO_FORMAT: Record<string, string> = {
	jpg: 'jpeg',
	jpeg: 'jpeg',
	png: 'png',
	webp: 'webp',
	gif: 'gif',
	avif: 'avif',
};

function getQuality(env: Env): number {
	const q = env.IMAGE_REWRITE_QUALITY;
	if (q == null || q === '') return DEFAULT_QUALITY;
	const n = parseInt(q, 10);
	return Number.isFinite(n) && n >= 1 && n <= 100 ? n : DEFAULT_QUALITY;
}

function getFormatFromUrl(url: string): string | undefined {
	try {
		const pathname = new URL(url).pathname;
		const ext = pathname.replace(/.*\.([a-z0-9]+)$/i, '$1').toLowerCase();
		return EXT_TO_FORMAT[ext];
	} catch {
		return undefined;
	}
}

/**
 * Build a single transformation URL for the given original image URL and width.
 * Quality and format come from env (IMAGE_REWRITE_QUALITY, IMAGE_REWRITE_FORMAT).
 */
function buildTransformUrl(
	originalSrc: string,
	width: number,
	backend: 'cloudflare' | 'netlify',
	workerOrigin: string,
	env: Env
): string {
	const quality = getQuality(env);
	const formatMode = env.IMAGE_REWRITE_FORMAT ?? 'auto';
	const format =
		formatMode === 'preserve' ? getFormatFromUrl(originalSrc) : undefined;

	if (backend === 'netlify') {
		const base = (env.NETLIFY_IMAGE_CDN_BASE ?? '').replace(/\/$/, '');
		if (!base) return originalSrc;
		const params = new URLSearchParams();
		params.set('url', originalSrc);
		params.set('w', String(width));
		params.set('q', String(quality));
		params.set('fit', FIT);
		if (format) params.set('fm', format);
		return `${base}/.netlify/images?${params.toString()}`;
	}

	let pathname: string;
	try {
		pathname = new URL(originalSrc).pathname;
	} catch {
		return originalSrc;
	}
	pathname = pathname.startsWith('/') ? pathname.slice(1) : pathname;
	const origin = workerOrigin.replace(/\/$/, '');
	const params = new URLSearchParams();
	params.set('width', String(width));
	params.set('quality', String(quality));
	params.set('fit', FIT);
	if (format) params.set('format', format);
	return `${origin}/img/${pathname}?${params.toString()}`;
}

/** One entry from a parsed srcset: url and width (from "500w") or implied width (from "1x"/"2x"). */
interface SrcSetEntry {
	url: string;
	width: number;
	descriptor: string; // "500w" or "2x" etc., for rebuilding srcset string
}

/**
 * Parse a srcset attribute value into entries. Handles "url 500w, url2 800w" and "url 1x, url2 2x".
 * For x-descriptors we use 800 * density (e.g. 1x → 800, 2x → 1600).
 */
function parseSrcSet(srcset: string): SrcSetEntry[] {
	const entries: SrcSetEntry[] = [];
	const parts = srcset.split(',').map((p) => p.trim()).filter(Boolean);
	for (const part of parts) {
		// Last token is the descriptor (e.g. "500w" or "1.5x"); rest is URL (may contain spaces in theory, but CDN URLs don't)
		const lastSpace = part.lastIndexOf(' ');
		if (lastSpace === -1) continue;
		const url = part.slice(0, lastSpace).trim();
		const descriptor = part.slice(lastSpace + 1).trim();
		const wMatch = descriptor.match(/^(\d+)w$/i);
		const xMatch = descriptor.match(/^(\d+(?:\.\d+)?)x$/i);
		let width: number;
		if (wMatch) {
			width = parseInt(wMatch[1], 10);
		} else if (xMatch) {
			width = Math.round(parseFloat(xMatch[1]) * DEFAULT_WIDTH);
		} else {
			width = DEFAULT_WIDTH;
		}
		if (url && Number.isFinite(width)) {
			entries.push({ url, width, descriptor });
		}
	}
	return entries;
}

/**
 * Returns true if this img should be rewritten: src or any srcset URL is from our CDN.
 */
function imgUsesCdn(img: HTMLElement): boolean {
	const src = img.getAttribute('src');
	if (src?.startsWith(CDN_SOURCE_PREFIX)) return true;
	const srcset = img.getAttribute('srcset');
	if (!srcset) return false;
	const entries = parseSrcSet(srcset);
	return entries.some((e) => e.url.startsWith(CDN_SOURCE_PREFIX));
}

/**
 * Rewrite one <img>: replace CDN URLs in src and srcset with transformation URLs.
 * Preserves existing sizes when present; uses default widths when img has no srcset.
 * Mutates the element in place.
 */
function rewriteImgElement(
	img: HTMLElement,
	backend: 'cloudflare' | 'netlify',
	workerOrigin: string,
	env: Env
): void {
	const src = img.getAttribute('src');
	const srcsetAttr = img.getAttribute('srcset');

	// Case 1: img has srcset with CDN URLs — rewrite each entry, keep widths and order
	if (srcsetAttr && srcsetAttr.includes(CDN_SOURCE_PREFIX)) {
		const entries = parseSrcSet(srcsetAttr);
		const newEntries: string[] = [];
		for (const { url, width, descriptor } of entries) {
			if (url.startsWith(CDN_SOURCE_PREFIX)) {
				newEntries.push(
					`${buildTransformUrl(url, width, backend, workerOrigin, env)} ${descriptor}`
				);
			} else {
				newEntries.push(`${url} ${descriptor}`);
			}
		}
		const newSrcset = newEntries.join(', ');
		img.setAttribute('srcset', newSrcset);
		// Fallback src: use first CDN URL rewritten at its width, or first entry
		const firstCdn = entries.find((e) => e.url.startsWith(CDN_SOURCE_PREFIX));
		const fallbackSrc = firstCdn
			? buildTransformUrl(
					firstCdn.url,
					firstCdn.width,
					backend,
					workerOrigin,
					env
				)
			: (src && src.startsWith(CDN_SOURCE_PREFIX)
					? buildTransformUrl(
							src,
							DEFAULT_WIDTH,
							backend,
							workerOrigin,
							env
						)
					: src);
		if (fallbackSrc) img.setAttribute('src', fallbackSrc);
		if (!img.getAttribute('sizes')) img.setAttribute('sizes', DEFAULT_SIZES);
		return;
	}

	// Case 2: plain img (no srcset or srcset without CDN) — only src is CDN
	if (!src || !src.startsWith(CDN_SOURCE_PREFIX)) return;

	const defaultUrl = buildTransformUrl(
		src,
		DEFAULT_WIDTH,
		backend,
		workerOrigin,
		env
	);
	const srcsetEntries = RESPONSIVE_WIDTHS.map(
		(w) =>
			`${buildTransformUrl(src, w, backend, workerOrigin, env)} ${w}w`
	);
	img.setAttribute('src', defaultUrl);
	img.setAttribute('srcset', srcsetEntries.join(', '));
	img.setAttribute('sizes', img.getAttribute('sizes') ?? DEFAULT_SIZES);
}

/**
 * Find all img elements that reference cdn.prod.website-files.com (in src or srcset)
 * and rewrite them to use the configured transformation backend. Preserves existing
 * responsive structure (widths, sizes) when present.
 */
export function rewriteResponsiveImages(
	root: { querySelectorAll: (sel: string) => HTMLElement[] },
	requestUrl: string,
	env: Env
): number {
	const backend = env.IMAGE_REWRITE_BACKEND;
	if (!backend || (backend === 'netlify' && !env.NETLIFY_IMAGE_CDN_BASE)) {
		return 0;
	}

	let workerOrigin: string;
	try {
		workerOrigin = new URL(requestUrl).origin;
	} catch {
		return 0;
	}

	const imgs = root.querySelectorAll('img');
	let count = 0;
	for (const img of imgs) {
		if (imgUsesCdn(img)) {
			rewriteImgElement(img, backend, workerOrigin, env);
			count++;
		}
	}
	return count;
}
