import { describe, it, expect } from 'vitest';
import { rewriteTeamtailorCdnNavigationUrl } from './navigation-links';

describe('rewriteTeamtailorCdnNavigationUrl', () => {
	it('rewrites teamtailorcdn.com page URLs to www.teamtailor.com', () => {
		expect(
			rewriteTeamtailorCdnNavigationUrl(
				'https://teamtailorcdn.com/en/applicant-tracking-system/enterprise'
			)
		).toBe('https://www.teamtailor.com/en/applicant-tracking-system/enterprise/');
	});

	it('rewrites protocol-relative CDN URLs', () => {
		expect(rewriteTeamtailorCdnNavigationUrl('//teamtailorcdn.com/en/pricing')).toBe(
			'https://www.teamtailor.com/en/pricing/'
		);
	});

	it('rewrites relative paths as CDN site paths', () => {
		expect(rewriteTeamtailorCdnNavigationUrl('/en/contact')).toBe(
			'https://www.teamtailor.com/en/contact/'
		);
	});

	it('maps CDN root to www English homepage', () => {
		expect(rewriteTeamtailorCdnNavigationUrl('https://teamtailorcdn.com/')).toBe(
			'https://www.teamtailor.com/en/'
		);
	});

	it('does not rewrite /img/* URLs', () => {
		expect(
			rewriteTeamtailorCdnNavigationUrl(
				'https://teamtailorcdn.com/img/69145ecd988074cf311effb9/foo.webp'
			)
		).toBeNull();
	});

	it('does not rewrite external or already-www URLs', () => {
		expect(rewriteTeamtailorCdnNavigationUrl('https://www.teamtailor.com/en/pricing/')).toBeNull();
		expect(rewriteTeamtailorCdnNavigationUrl('https://support.teamtailor.com/en/')).toBeNull();
		expect(rewriteTeamtailorCdnNavigationUrl('mailto:support@teamtailor.com')).toBeNull();
		expect(rewriteTeamtailorCdnNavigationUrl('#section')).toBeNull();
	});

	it('preserves query and hash', () => {
		expect(rewriteTeamtailorCdnNavigationUrl('https://teamtailorcdn.com/en/demo?x=1#top')).toBe(
			'https://www.teamtailor.com/en/demo/?x=1#top'
		);
	});
});
