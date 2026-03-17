/**
 * Path and locale handling for canonical and hreflang links.
 * Strips Webflow locale path segments so subpages like /de/demo produce
 * hreflang paths /en/demo, /de/demo, etc. (not /en/de/demo).
 *
 * Webflow locale path segments (stripped from request path):
 * en (replaces root), en-us, de, fr, es
 */

/** First path segments that indicate a Webflow locale; strip them to get the locale-agnostic path. */
export const WEBFLOW_LOCALE_SEGMENTS = [
	'en',
	'en-us',
	'de',
	'fr',
	'es',
] as const;

/**
 * Returns the path suffix used to build canonical and hreflang URLs.
 * - Root "/" or "" → "/" (so /en/, /de/, etc.)
 * - /de/demo or /en/demo/ → "/demo/" (so /en/demo/, /de/demo/, etc.)
 * - Paths without a known Webflow locale prefix are left as-is (with trailing slash).
 */
export function getPathSuffix(pathname: string): string {
	const normalized = pathname === '/' ? '' : pathname.replace(/\/$/, '');
	if (normalized === '') return '/';

	const segments = normalized.split('/').filter(Boolean);
	if (segments.length === 0) return '/';

	const first = segments[0].toLowerCase();
	const isWebflowLocale = (WEBFLOW_LOCALE_SEGMENTS as readonly string[]).includes(first);
	if (isWebflowLocale) {
		const rest = segments.slice(1);
		return rest.length > 0 ? `/${rest.join('/')}/` : '/';
	}

	return `/${segments.join('/')}/`;
}

/**
 * Returns the English path used for canonical and x-default (e.g. /en/ or /en/demo/).
 */
export function getEnPath(pathSuffix: string): string {
	return pathSuffix === '/' ? '/en/' : `/en${pathSuffix}`;
}
