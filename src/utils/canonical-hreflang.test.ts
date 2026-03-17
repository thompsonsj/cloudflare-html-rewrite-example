import { describe, it, expect } from 'vitest';
import { getPathSuffix, getEnPath, WEBFLOW_LOCALE_SEGMENTS } from './canonical-hreflang';

const BASE = 'https://www.teamtailor.com';
const ALTERNATE_LANGUAGES = ['en', 'en-us', 'da', 'de', 'es', 'fi', 'fr', 'it', 'nl', 'no', 'sv'];

function buildCanonical(pathSuffix: string): string {
	const enPath = getEnPath(pathSuffix);
	return `${BASE}${enPath}`;
}

function buildHreflangLinks(pathSuffix: string): string[] {
	return ALTERNATE_LANGUAGES.map(
		(lang) => `${BASE}/${lang}${pathSuffix === '/' ? pathSuffix : pathSuffix}`
	);
}

describe('canonical-hreflang', () => {
	describe('getPathSuffix', () => {
		it('returns "/" for root path', () => {
			expect(getPathSuffix('/')).toBe('/');
			expect(getPathSuffix('')).toBe('/');
		});

		it('strips Webflow locale segment so subpage path has no locale prefix', () => {
			expect(getPathSuffix('/de-de/demo')).toBe('/demo/');
			expect(getPathSuffix('/de-de/demo/')).toBe('/demo/');
		});

		it('strips other Webflow locale segments', () => {
			expect(getPathSuffix('/en-gb/about')).toBe('/about/');
			expect(getPathSuffix('/en-us/pricing')).toBe('/pricing/');
			expect(getPathSuffix('/fr-fr/contact')).toBe('/contact/');
			expect(getPathSuffix('/es-es/blog')).toBe('/blog/');
		});

		it('leaves path unchanged when first segment is not a Webflow locale', () => {
			expect(getPathSuffix('/en/demo')).toBe('/en/demo/');
			expect(getPathSuffix('/demo')).toBe('/demo/');
		});
	});

	describe('getEnPath', () => {
		it('returns /en/ for root pathSuffix', () => {
			expect(getEnPath('/')).toBe('/en/');
		});
		it('returns /en/demo/ for /demo/ pathSuffix', () => {
			expect(getEnPath('/demo/')).toBe('/en/demo/');
		});
	});

	describe('homepage: root should map to en links as it does now', () => {
		it('pathSuffix for root is "/"', () => {
			const pathSuffix = getPathSuffix('/');
			expect(pathSuffix).toBe('/');
		});
		it('canonical for root is https://www.teamtailor.com/en/', () => {
			const pathSuffix = getPathSuffix('/');
			expect(buildCanonical(pathSuffix)).toBe('https://www.teamtailor.com/en/');
		});
		it('hreflang URLs for root are /en/, /en-us/, /da/, /de/, /es/, etc.', () => {
			const pathSuffix = getPathSuffix('/');
			const links = buildHreflangLinks(pathSuffix);
			expect(links).toContain('https://www.teamtailor.com/en/');
			expect(links).toContain('https://www.teamtailor.com/en-us/');
			expect(links).toContain('https://www.teamtailor.com/da/');
			expect(links).toContain('https://www.teamtailor.com/de/');
			expect(links).toContain('https://www.teamtailor.com/es/');
			expect(links).toContain('https://www.teamtailor.com/fr/');
			expect(links).toHaveLength(ALTERNATE_LANGUAGES.length);
		});
	});

	describe('subpage /de-de/demo: hreflang paths must not contain de-de', () => {
		it('pathSuffix for /de-de/demo is /demo/ (no de-de)', () => {
			expect(getPathSuffix('/de-de/demo')).toBe('/demo/');
			expect(getPathSuffix('/de-de/demo/')).toBe('/demo/');
		});
		it('canonical is https://www.teamtailor.com/en/demo/', () => {
			const pathSuffix = getPathSuffix('/de-de/demo');
			expect(buildCanonical(pathSuffix)).toBe('https://www.teamtailor.com/en/demo/');
		});
		it('hreflang URLs are /en/demo/, /es/demo/, /de/demo/ etc. (no de-de in path)', () => {
			const pathSuffix = getPathSuffix('/de-de/demo');
			const links = buildHreflangLinks(pathSuffix);
			expect(links).toContain('https://www.teamtailor.com/en/demo/');
			expect(links).toContain('https://www.teamtailor.com/en-us/demo/');
			expect(links).toContain('https://www.teamtailor.com/de/demo/');
			expect(links).toContain('https://www.teamtailor.com/es/demo/');
			expect(links).toContain('https://www.teamtailor.com/fr/demo/');
			// Must not contain de-de in any URL
			links.forEach((href) => {
				expect(href).not.toContain('de-de');
			});
			expect(links).toHaveLength(ALTERNATE_LANGUAGES.length);
		});
	});

	describe('WEBFLOW_LOCALE_SEGMENTS', () => {
		it('includes expected Webflow locale path segments', () => {
			expect(WEBFLOW_LOCALE_SEGMENTS).toContain('en-gb');
			expect(WEBFLOW_LOCALE_SEGMENTS).toContain('en-us');
			expect(WEBFLOW_LOCALE_SEGMENTS).toContain('de-de');
			expect(WEBFLOW_LOCALE_SEGMENTS).toContain('fr-fr');
			expect(WEBFLOW_LOCALE_SEGMENTS).toContain('es-es');
		});
	});
});
