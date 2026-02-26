/**
 * Rewrites <img> elements whose src (and optionally srcset) point at
 * cdn.prod.website-files.com to use transformation URLs (Cloudflare or Netlify)
 * so the browser never loads from that CDN. Supports both plain img and existing
 * responsive markup (srcset/sizes); preserves widths and sizes when present.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/HTML/Guides/Responsive_images
 * @see https://docs.netlify.com/build/image-cdn/overview/
 */

import { parse } from 'node-html-parser';
import type { HTMLElement } from 'node-html-parser';
import type { Env } from './types/env';

/** Cloudflare AVIF hard limit; only use format=avif for widths ≤ this in picture fallbacks. */
const AVIF_MAX_WIDTH = 1200;

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

/** Sizes for full-width images (e.g. hero); cap at 2400px so the browser doesn't over-fetch on very wide screens. */
const FULL_WIDTH_SIZES = '(max-width: 2400px) 100vw, 2400px';

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

function isSvgUrl(url: string): boolean {
	try {
		return /\.svg$/i.test(new URL(url).pathname);
	} catch {
		return false;
	}
}

function isAvifUrl(url: string): boolean {
	try {
		return /\.avif$/i.test(new URL(url).pathname);
	} catch {
		return false;
	}
}

/** When true, SVG URLs are left as-is (not rewritten). Default true. */
function ignoreSvg(env: Env): boolean {
	const v = env.IMAGE_REWRITE_IGNORE_SVG;
	return v === undefined || v === '' || v === '1' || v.toLowerCase() === 'true';
}

/** True if this CDN URL should be rewritten (not skipped as SVG when ignore SVG is on). */
function shouldRewriteUrl(url: string, env: Env): boolean {
	if (!url.startsWith(CDN_SOURCE_PREFIX)) return false;
	if (isSvgUrl(url) && ignoreSvg(env)) return false;
	return true;
}

function pictureFallbacksEnabled(env: Env): boolean {
	const v = env.IMAGE_REWRITE_PICTURE_FALLBACKS;
	return v === undefined || v === '' || v === '1' || v.toLowerCase() === 'true';
}

/** Escape for HTML attribute. */
function escapeAttr(s: string | undefined): string {
	if (s == null) return '';
	return String(s)
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

/** Parse comma-separated full-width class names from env; returns trimmed non-empty list. */
function getFullWidthClasses(env: Env): string[] {
	const raw = env.IMAGE_REWRITE_FULL_WIDTH_CLASSES;
	if (raw == null || raw === '') return [];
	return raw
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
}

/** True if the img has any class that is in the full-width list. */
function imgHasFullWidthClass(img: HTMLElement, env: Env): boolean {
	const classes = getFullWidthClasses(env);
	if (classes.length === 0) return false;
	const classAttr = img.getAttribute('class');
	if (!classAttr) return false;
	const imgClasses = classAttr.split(/\s+/).filter(Boolean);
	return imgClasses.some((c) => classes.includes(c));
}

/** Choose sizes for this img: full-width sizes if class matches, else existing or default. */
function getSizesForImg(img: HTMLElement, env: Env): string {
	if (imgHasFullWidthClass(img, env)) return FULL_WIDTH_SIZES;
	return img.getAttribute('sizes') ?? DEFAULT_SIZES;
}

/**
 * Build a single transformation URL for the given original image URL and width.
 * Quality and format come from env (IMAGE_REWRITE_QUALITY, IMAGE_REWRITE_FORMAT).
 * formatOverride: when building <picture> fallbacks, pass 'avif' or 'webp'. For Cloudflare avif, caller should only use widths ≤ AVIF_MAX_WIDTH.
 */
function buildTransformUrl(
	originalSrc: string,
	width: number,
	backend: 'cloudflare' | 'netlify',
	workerOrigin: string,
	env: Env,
	formatOverride?: 'avif' | 'webp'
): string {
	const quality = getQuality(env);
	const formatMode = env.IMAGE_REWRITE_FORMAT ?? 'auto';
	let format: string | undefined;
	if (formatOverride) {
		format = formatOverride;
	} else {
		format =
			formatMode === 'preserve' ? getFormatFromUrl(originalSrc) : undefined;
	}

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
 * Returns true if this img should be rewritten: src or any srcset URL is from our CDN
 * and should be rewritten (SVG URLs are skipped when IMAGE_REWRITE_IGNORE_SVG is true).
 */
function imgUsesCdn(img: HTMLElement, env: Env): boolean {
	const src = img.getAttribute('src');
	if (src && shouldRewriteUrl(src, env)) return true;
	const srcset = img.getAttribute('srcset');
	if (!srcset) return false;
	const entries = parseSrcSet(srcset);
	return entries.some((e) => shouldRewriteUrl(e.url, env));
}

/**
 * Build <picture> with AVIF (widths ≤ AVIF_MAX_WIDTH for Cloudflare) and WebP fallbacks, then replace img.
 * Only used when picture fallbacks are on and source is not AVIF.
 */
function replaceImgWithPicture(
	img: HTMLElement,
	entries: SrcSetEntry[],
	backend: 'cloudflare' | 'netlify',
	workerOrigin: string,
	env: Env
): void {
	const sizes = getSizesForImg(img, env);
	// AVIF source: only widths ≤ AVIF_MAX_WIDTH (Cloudflare limit); Netlify we cap for consistency
	const avifEntries =
		backend === 'cloudflare'
			? entries.filter((e) => e.width <= AVIF_MAX_WIDTH)
			: entries;
	const webpSrcset = entries
		.map(
			(e) =>
				`${buildTransformUrl(e.url, e.width, backend, workerOrigin, env, 'webp')} ${e.descriptor}`
		)
		.join(', ');
	const avifSrcset =
		avifEntries.length > 0
			? avifEntries
					.map(
						(e) =>
							`${buildTransformUrl(e.url, e.width, backend, workerOrigin, env, 'avif')} ${e.descriptor}`
					)
					.join(', ')
			: '';
	const fallbackSrc = buildTransformUrl(
		entries[0].url,
		entries[0].width,
		backend,
		workerOrigin,
		env,
		'webp'
	);
	const alt = img.getAttribute('alt') ?? '';
	const cls = img.getAttribute('class') ?? '';
	const loading = img.getAttribute('loading') ?? '';
	const pictureHtml =
		avifSrcset === ''
			? `<picture><source type="image/webp" srcset="${escapeAttr(webpSrcset)}"><img src="${escapeAttr(fallbackSrc)}" srcset="${escapeAttr(webpSrcset)}" sizes="${escapeAttr(sizes)}" alt="${escapeAttr(alt)}" class="${escapeAttr(cls)}" loading="${escapeAttr(loading)}"></picture>`
			: `<picture><source type="image/avif" srcset="${escapeAttr(avifSrcset)}"><source type="image/webp" srcset="${escapeAttr(webpSrcset)}"><img src="${escapeAttr(fallbackSrc)}" srcset="${escapeAttr(webpSrcset)}" sizes="${escapeAttr(sizes)}" alt="${escapeAttr(alt)}" class="${escapeAttr(cls)}" loading="${escapeAttr(loading)}"></picture>`;
	const parsed = parse(pictureHtml);
	const picture =
		parsed.tagName?.toLowerCase() === 'picture'
			? parsed
			: parsed.querySelector('picture');
	if (picture) img.replaceWith(picture);
}

/**
 * Rewrite one <img>: replace CDN URLs in src and srcset with transformation URLs.
 * When IMAGE_REWRITE_PICTURE_FALLBACKS is on and source is not AVIF, wrap in <picture> with AVIF + WebP.
 * Mutates the element in place (or replaces with picture).
 */
function rewriteImgElement(
	img: HTMLElement,
	backend: 'cloudflare' | 'netlify',
	workerOrigin: string,
	env: Env
): void {
	const src = img.getAttribute('src');
	const srcsetAttr = img.getAttribute('srcset');

	// Case 1: img has srcset with CDN URLs — rewrite each entry that should be rewritten, keep SVG/origin when ignore SVG
	if (srcsetAttr && srcsetAttr.includes(CDN_SOURCE_PREFIX)) {
		const entries = parseSrcSet(srcsetAttr);
		const toRewrite = entries.filter((e) => shouldRewriteUrl(e.url, env));

		// Picture with AVIF (widths ≤ 1200) + WebP fallback for all sources, including AVIF (worker can convert AVIF → WebP when format=webp)
		if (pictureFallbacksEnabled(env) && toRewrite.length > 0) {
			replaceImgWithPicture(img, toRewrite, backend, workerOrigin, env);
			return;
		}

		const newEntries: string[] = [];
		for (const { url, width, descriptor } of entries) {
			if (shouldRewriteUrl(url, env)) {
				newEntries.push(
					`${buildTransformUrl(url, width, backend, workerOrigin, env)} ${descriptor}`
				);
			} else {
				newEntries.push(`${url} ${descriptor}`);
			}
		}
		const newSrcset = newEntries.join(', ');
		img.setAttribute('srcset', newSrcset);
		const firstToRewrite = entries.find((e) => shouldRewriteUrl(e.url, env));
		const fallbackSrc = firstToRewrite
			? buildTransformUrl(
					firstToRewrite.url,
					firstToRewrite.width,
					backend,
					workerOrigin,
					env
				)
			: (src && shouldRewriteUrl(src, env)
					? buildTransformUrl(
							src,
							DEFAULT_WIDTH,
							backend,
							workerOrigin,
							env
						)
					: src);
		if (fallbackSrc) img.setAttribute('src', fallbackSrc);
		img.setAttribute('sizes', getSizesForImg(img, env));
		return;
	}

	// Case 2: plain img (no srcset or srcset without CDN) — only src is CDN
	if (!src || !shouldRewriteUrl(src, env)) return;

	const syntheticEntries: SrcSetEntry[] = RESPONSIVE_WIDTHS.map((w) => ({
		url: src,
		width: w,
		descriptor: `${w}w`,
	}));

	if (pictureFallbacksEnabled(env)) {
		replaceImgWithPicture(img, syntheticEntries, backend, workerOrigin, env);
		return;
	}

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
	img.setAttribute('sizes', getSizesForImg(img, env));
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
		if (imgUsesCdn(img, env)) {
			rewriteImgElement(img, backend, workerOrigin, env);
			count++;
		}
	}
	return count;
}
