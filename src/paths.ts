/**
 * Which origin paths the assets worker is allowed to serve.
 *
 * Only public, static assets are proxied. The Payload admin, REST/GraphQL API,
 * auth endpoints and anything else on the origin return 404 from the worker,
 * so the CDN domain can never be used to reach the CMS itself.
 */

/**
 * Payload upload collections whose files are served at /api/<slug>/file/<filename>.
 * Keep in sync with the upload collections in the marketingcms repo
 * (src/collections/** with `upload` set).
 */
export const UPLOAD_COLLECTIONS = [
	'badges',
	'block-screenshots',
	'content-hub-avatars',
	'content-hub-images',
	'email',
	'files',
	'headshots',
	'hero-grid-images',
	'logo-images',
	'marketing-images',
	'marketing-site-images',
	'media',
	'podcast-thumbnails',
	'share-images',
	'video-thumbnails',
] as const;

/** MCAE form styles and scripts built by marketingcms (packages/ui-forms) into public/forms. */
export const FORMS_PREFIX = '/forms/';

export type AssetKind = 'forms' | 'upload';

const UPLOAD_COLLECTION_SET = new Set<string>(UPLOAD_COLLECTIONS);
const UPLOAD_PATH_RE = /^\/api\/([a-z0-9-]+)\/file\/[^/]/;

/**
 * Returns the kind of asset for an allowed path, or null if the path must not be proxied.
 * `pathname` is URL.pathname (already dot-segment normalised by the URL parser).
 */
export function classifyPath(pathname: string): AssetKind | null {
	let decoded: string;
	try {
		decoded = decodeURIComponent(pathname);
	} catch {
		return null;
	}
	// Reject traversal attempts that survive normalisation via encoding (e.g. %2e%2e).
	if (decoded.includes('..') || decoded.includes('\\') || decoded.includes('\0')) {
		return null;
	}

	if (pathname.startsWith(FORMS_PREFIX) && pathname.length > FORMS_PREFIX.length) {
		return 'forms';
	}

	const match = pathname.match(UPLOAD_PATH_RE);
	if (match && UPLOAD_COLLECTION_SET.has(match[1])) {
		return 'upload';
	}

	return null;
}
