/**
 * Image transformations worker (Cloudflare Image Resizing).
 * Based on: https://medium.com/@nfarina/hosting-and-transforming-images-at-scale-with-cloudflare-1aaeb97651bc
 *
 * Fetches origin images from IMAGE_ORIGIN_URL + path, applies resize/format options
 * from the query string, and caches both the origin fetch and the transformed result
 * via cacheEverything and cacheTtlByStatus.
 *
 * Usage: /img/<path-to-image>?width=800&height=600&fit=cover&quality=85
 * Route this worker on a path (e.g. /img/*) or subdomain (e.g. images.example.com/*).
 */

import type { Env } from './types/env';

/** Raster image extensions: apply Cloudflare Image Resizing. */
const RASTER_EXT_RE = /\.(jpe?g|png|gif|webp|avif)$/i;
/** SVG: serve as-is from origin (no transformation or quality). */
const SVG_EXT_RE = /\.svg$/i;
/** AVIF source: serve as-is (no transform); Cloudflare can sanitize SVG but AVIF transform is overkill. */
const AVIF_EXT_RE = /\.avif$/i;
/** Cloudflare AVIF hard limit (longest side). Beyond this we force WebP. @see https://developers.cloudflare.com/images/transform-images/#format-limitations */
const AVIF_MAX_WIDTH = 1200;

/** One year TTL for successful image responses */
const CACHE_TTL_OK = 31_536_000;
/** Short TTL for client errors (e.g. 404) */
const CACHE_TTL_CLIENT_ERROR = 60;
/** Do not cache server errors */
const CACHE_TTL_SERVER_ERROR = 0;

export interface ImageEnv extends Env {
	IMAGE_ORIGIN_URL: string;
}

/**
 * Parses query string and Accept header into Cloudflare Image Resizing options.
 * @see https://developers.cloudflare.com/images/transform-images/transform-via-workers
 */
function getImageOptions(request: Request, url: URL): Record<string, unknown> {
	const options: Record<string, unknown> = {};

	if (url.searchParams.has('width')) {
		const w = url.searchParams.get('width');
		options.width = w === 'auto' ? 'auto' : parseInt(w ?? '0', 10) || undefined;
	}
	if (url.searchParams.has('height')) {
		const h = url.searchParams.get('height');
		options.height = parseInt(h ?? '0', 10) || undefined;
	}
	if (url.searchParams.has('fit')) {
		const fit = url.searchParams.get('fit');
		if (['scale-down', 'contain', 'cover', 'crop', 'pad', 'squeeze'].includes(fit ?? '')) {
			options.fit = fit;
		}
	}
	if (url.searchParams.has('quality')) {
		const q = url.searchParams.get('quality');
		options.quality = parseInt(q ?? '0', 10) || undefined;
	}
	if (url.searchParams.has('format')) {
		options.format = url.searchParams.get('format');
	} else {
		// Content negotiation: prefer AVIF then WebP
		const accept = request.headers.get('Accept') ?? '';
		if (/image\/avif/.test(accept)) options.format = 'avif';
		else if (/image\/webp/.test(accept)) options.format = 'webp';
	}
	// Cloudflare AVIF hard limit: beyond AVIF_MAX_WIDTH use WebP to avoid failed or fallback encodes
	const w = options.width as number | undefined;
	if (options.format === 'avif' && typeof w === 'number' && w > AVIF_MAX_WIDTH) {
		options.format = 'webp';
	}
	if (url.searchParams.has('dpr')) {
		const dpr = parseFloat(url.searchParams.get('dpr') ?? '1');
		if (dpr >= 0.5 && dpr <= 3) options.dpr = dpr;
	}
	if (url.searchParams.has('blur')) {
		const blur = parseInt(url.searchParams.get('blur') ?? '0', 10);
		if (blur >= 1 && blur <= 250) options.blur = blur;
	}
	if (url.searchParams.has('gravity')) {
		options.gravity = url.searchParams.get('gravity');
	}
	if (url.searchParams.has('anim')) {
		options.anim = url.searchParams.get('anim') !== 'false';
	}

	return options;
}

/**
 * Handles a single request for image transformation.
 * @param request - Incoming request (path + query define image and transform options)
 * @param env - Worker env with IMAGE_ORIGIN_URL
 * @param pathWithoutPrefix - Path segment for the image (e.g. "uploads/photo.jpg")
 */
export async function handleImageRequest(
	request: Request,
	env: ImageEnv,
	pathWithoutPrefix: string
): Promise<Response> {
	// Prevent request loops: if this request came from image resizing, fetch origin without transforming
	if (/image-resizing/.test(request.headers.get('Via') ?? '')) {
		const originUrl = `${env.IMAGE_ORIGIN_URL.replace(/\/$/, '')}/${pathWithoutPrefix.replace(/^\//, '')}`;
		return fetch(originUrl, { headers: request.headers });
	}

	const path = pathWithoutPrefix.replace(/^\//, '');
	if (!path) {
		return new Response('Missing image path', { status: 400 });
	}

	if (!RASTER_EXT_RE.test(path) && !SVG_EXT_RE.test(path)) {
		return new Response('Unsupported image type', { status: 400 });
	}

	const originBase = env.IMAGE_ORIGIN_URL.replace(/\/$/, '');
	const originUrl = `${originBase}/${path}`;

	let parsed: URL;
	try {
		parsed = new URL(originUrl);
	} catch {
		return new Response('Invalid image origin URL', { status: 500 });
	}

	// Restrict to same host or allow list (article used example.com only)
	const allowedHost = new URL(originBase).hostname;
	if (parsed.hostname !== allowedHost) {
		return new Response('Disallowed image source', { status: 403 });
	}

	const imageRequest = new Request(originUrl, {
		headers: request.headers,
	});

	// SVG: no transformation — fetch from origin and serve as-is
	if (SVG_EXT_RE.test(path)) {
		const response = await fetch(imageRequest, {
			cf: {
				cacheEverything: true,
				cacheTtlByStatus: {
					'200-299': CACHE_TTL_OK,
					'300-399': 300,
					'400-499': CACHE_TTL_CLIENT_ERROR,
					'500-599': CACHE_TTL_SERVER_ERROR,
				},
			},
		});
		if (!response.ok && !response.redirected) return response;
		const out = new Response(response.body, response);
		out.headers.set('Content-Type', response.headers.get('Content-Type') ?? 'image/svg+xml');
		out.headers.set('Cache-Control', 'public, max-age=31536000, immutable');
		return out;
	}

	// AVIF source: serve as-is only when no format conversion is requested. When format=webp (or format=avif) is in the query, use normal transform so Cloudflare can convert AVIF → WebP for fallbacks.
	const requestUrl = new URL(request.url);
	const avifPassthrough =
		AVIF_EXT_RE.test(path) && !requestUrl.searchParams.has('format');

	if (avifPassthrough) {
		const response = await fetch(imageRequest, {
			cf: {
				cacheEverything: true,
				cacheTtlByStatus: {
					'200-299': CACHE_TTL_OK,
					'300-399': 300,
					'400-499': CACHE_TTL_CLIENT_ERROR,
					'500-599': CACHE_TTL_SERVER_ERROR,
				},
			},
		});
		if (!response.ok && !response.redirected) return response;
		const out = new Response(response.body, response);
		out.headers.set('Content-Type', response.headers.get('Content-Type') ?? 'image/avif');
		out.headers.set('Cache-Control', 'public, max-age=31536000, immutable');
		return out;
	}

	const imageOptions = getImageOptions(request, requestUrl);

	// Raster (or AVIF with format=webp): fetch with Cloudflare Image Resizing + cache
	const response = await fetch(imageRequest, {
		cf: {
			image: imageOptions as Record<string, string | number | boolean>,
			cacheEverything: true,
			cacheTtlByStatus: {
				'200-299': CACHE_TTL_OK,
				'300-399': 300,
				'400-499': CACHE_TTL_CLIENT_ERROR,
				'500-599': CACHE_TTL_SERVER_ERROR,
			},
		},
	});

	if (!response.ok && !response.redirected) {
		return response;
	}

	// Optionally set browser Cache-Control (CDN is already caching via cacheTtlByStatus)
	const out = new Response(response.body, response);
	out.headers.set('Cache-Control', 'public, max-age=31536000, immutable');
	return out;
}
