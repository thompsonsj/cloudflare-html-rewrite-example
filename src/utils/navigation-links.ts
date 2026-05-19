/**
 * Rewrites teamtailorcdn.com navigation URLs to www.teamtailor.com.
 * Image paths (/img/*) on the CDN host are left unchanged.
 */

export const TEAMTAILOR_CDN_HOST = 'teamtailorcdn.com';
export const TEAMTAILOR_SITE_ORIGIN = 'https://www.teamtailor.com';
const IMAGE_PATH_PREFIX = '/img/';

/** True if pathname is the image worker route (not a page link). */
function isImagePath(pathname: string): boolean {
	return pathname === IMAGE_PATH_PREFIX || pathname.startsWith(`${IMAGE_PATH_PREFIX}`);
}

/** Add trailing slash for page paths; leave asset paths with a file extension unchanged. */
function normalizePagePath(pathname: string): string {
	if (pathname === '' || pathname === '/') return '/en/';
	if (pathname.endsWith('/')) return pathname;
	const lastSegment = pathname.split('/').filter(Boolean).pop() ?? '';
	if (lastSegment.includes('.')) return pathname;
	return `${pathname}/`;
}

/**
 * If href points at teamtailorcdn.com (and is not /img/*), return the www.teamtailor.com URL.
 * Otherwise return null (no rewrite).
 */
export function rewriteTeamtailorCdnNavigationUrl(href: string): string | null {
	const trimmed = href.trim();
	if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('mailto:') || trimmed.startsWith('tel:')) {
		return null;
	}

	let parsed: URL;
	try {
		if (trimmed.startsWith('//')) {
			parsed = new URL(`https:${trimmed}`);
		} else if (trimmed.startsWith('/')) {
			// Relative site path on the CDN host (Webflow internal links)
			parsed = new URL(trimmed, `https://${TEAMTAILOR_CDN_HOST}`);
		} else {
			parsed = new URL(trimmed);
		}
	} catch {
		return null;
	}

	if (parsed.hostname.toLowerCase() !== TEAMTAILOR_CDN_HOST) {
		return null;
	}

	if (isImagePath(parsed.pathname)) {
		return null;
	}

	const path = normalizePagePath(parsed.pathname);
	return `${TEAMTAILOR_SITE_ORIGIN}${path}${parsed.search}${parsed.hash}`;
}

/** Rewrite href on all <a> elements that point at teamtailorcdn.com. Returns count updated. */
export function rewriteNavigationLinks(root: {
	querySelectorAll: (sel: string) => Array<{ getAttribute: (name: string) => string | undefined; setAttribute: (name: string, value: string) => void }>;
}): number {
	const anchors = root.querySelectorAll('a[href]');
	let count = 0;
	for (const anchor of anchors) {
		const href = anchor.getAttribute('href');
		if (!href) continue;
		const rewritten = rewriteTeamtailorCdnNavigationUrl(href);
		if (rewritten) {
			anchor.setAttribute('href', rewritten);
			count++;
		}
	}
	return count;
}
