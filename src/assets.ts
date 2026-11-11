/**
 * teamtailor-assets: a CDN in front of the Payload CMS for public assets.
 *
 * Serves https://teamtailorcdn.com/<path> from ORIGIN_URL/<path> for:
 *   - /forms/*                     MCAE form styles and scripts (ui-forms)
 *   - /api/<collection>/file/*     Payload upload files (email images, media, logos...)
 *   - /img/<one of the above>      the same files, resized by Cloudflare Image Resizing
 *
 * Everything else returns 404. Request cookies and auth headers are never sent to
 * the origin, and origin cookies are never sent back, so the CMS session cannot leak
 * through this domain.
 *
 * Why: emails, signatures and MCAE form pages need a stable asset host that we
 * control. If the CMS moves, change ORIGIN_URL and every existing link keeps working.
 */

import type { Env } from './types/env';
import { classifyPath, type AssetKind } from './paths';
import { handleImageRequest } from './images';

const IMG_PREFIX = '/img/';

/**
 * Edge and browser cache lifetimes, in seconds.
 * Form assets are built without content hashes, so a rebuild keeps the same file
 * names: keep their TTL short so a marketingcms deploy shows up within minutes.
 */
const CACHE: Record<AssetKind, { edge: number; browser: number }> = {
	forms: { edge: 300, browser: 300 },
	upload: { edge: 86_400, browser: 3_600 },
};
const CACHE_TTL_CLIENT_ERROR = 60;

/** Request headers worth forwarding to the origin. Everything else (cookies, auth) is dropped. */
const FORWARDED_REQUEST_HEADERS = ['accept', 'accept-language', 'range', 'if-none-match', 'if-modified-since', 'user-agent'];

/** Origin response headers that must not reach the client. */
const STRIPPED_RESPONSE_HEADERS = ['set-cookie', 'x-powered-by'];

const CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
	'Access-Control-Max-Age': '86400',
	'Timing-Allow-Origin': '*',
};

/** Uploaded files are user-supplied: never let an uploaded HTML/SVG file run script on this domain. */
const UPLOAD_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox";

function plain(status: number, body: string, extra: Record<string, string> = {}): Response {
	return new Response(body, {
		status,
		headers: {
			'Content-Type': 'text/plain; charset=utf-8',
			'Cache-Control': 'no-store',
			'X-Robots-Tag': 'noindex',
			...CORS_HEADERS,
			...extra,
		},
	});
}

/** Builds a header-safe request to the origin for the given path and query. */
export function buildOriginRequest(request: Request, originBase: string, pathAndQuery: string): Request {
	const headers = new Headers();
	for (const name of FORWARDED_REQUEST_HEADERS) {
		const value = request.headers.get(name);
		if (value) headers.set(name, value);
	}
	return new Request(`${originBase}${pathAndQuery}`, {
		method: request.method === 'HEAD' ? 'HEAD' : 'GET',
		headers,
		redirect: 'follow',
	});
}

/** Copies an origin response, removing unsafe headers and applying our cache and security headers. */
export function finaliseResponse(origin: Response, kind: AssetKind): Response {
	const response = new Response(origin.body, origin);
	for (const name of STRIPPED_RESPONSE_HEADERS) response.headers.delete(name);
	for (const [name, value] of Object.entries(CORS_HEADERS)) response.headers.set(name, value);
	response.headers.set('X-Robots-Tag', 'noindex');
	response.headers.set('X-Content-Type-Options', 'nosniff');

	if (origin.ok) {
		response.headers.set('Cache-Control', `public, max-age=${CACHE[kind].browser}`);
	} else {
		response.headers.set('Cache-Control', 'no-store');
	}

	if (kind === 'upload') {
		response.headers.set('Content-Security-Policy', UPLOAD_CSP);
	}
	return response;
}

/** Strips unsafe headers and applies security headers to an image response. Cache-Control is set by the image handler. */
function finaliseImage(response: Response): Response {
	const out = new Response(response.body, response);
	for (const name of STRIPPED_RESPONSE_HEADERS) out.headers.delete(name);
	for (const [name, value] of Object.entries(CORS_HEADERS)) out.headers.set(name, value);
	out.headers.set('X-Robots-Tag', 'noindex');
	out.headers.set('X-Content-Type-Options', 'nosniff');
	out.headers.set('Content-Security-Policy', UPLOAD_CSP);
	return out;
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		const debug = env.DEBUG_LOGS === '1' || env.DEBUG_LOGS === 'true';
		const originBase = (env.ORIGIN_URL || '').replace(/\/$/, '');

		if (!originBase) {
			return plain(500, 'ORIGIN_URL is not configured');
		}

		if (request.method === 'OPTIONS') {
			return new Response(null, { status: 204, headers: CORS_HEADERS });
		}
		if (request.method !== 'GET' && request.method !== 'HEAD') {
			return plain(405, 'Method not allowed', { Allow: 'GET, HEAD, OPTIONS' });
		}

		if (url.pathname === '/healthz') {
			return plain(200, 'ok');
		}

		// Resized images: /img/api/<collection>/file/<name>?width=...
		if (url.pathname.startsWith(IMG_PREFIX)) {
			const originPath = '/' + url.pathname.slice(IMG_PREFIX.length);
			if (classifyPath(originPath) !== 'upload') {
				if (debug) console.log('[assets] 404 img', url.pathname);
				return plain(404, 'Not found');
			}
			const { headers } = buildOriginRequest(request, originBase, originPath);
			const safeRequest = new Request(request.url, { method: 'GET', headers });
			const imageResponse = await handleImageRequest(safeRequest, { ...env, IMAGE_ORIGIN_URL: originBase }, originPath);
			return finaliseImage(imageResponse);
		}

		const kind = classifyPath(url.pathname);
		if (!kind) {
			if (debug) console.log('[assets] 404', url.pathname);
			return plain(404, 'Not found');
		}

		const originRequest = buildOriginRequest(request, originBase, url.pathname + url.search);
		if (debug) console.log('[assets]', kind, originRequest.url);

		const origin = await fetch(originRequest, {
			cf: {
				cacheEverything: true,
				cacheTtlByStatus: {
					'200-299': CACHE[kind].edge,
					'404': CACHE_TTL_CLIENT_ERROR,
					'400-499': 0,
					'500-599': 0,
				},
			},
		});

		return finaliseResponse(origin, kind);
	},
};
