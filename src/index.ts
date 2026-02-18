import { parse } from 'node-html-parser';
import { Env } from './types/env';
import { handleImageRequest } from './images';
import { rewriteResponsiveImages } from './responsive-images';
import { matchesDisabledRoute } from './utils/routes';

const IMAGE_PATH_PREFIX = '/img/';

export default {
	async fetch(request: Request, env: Env) {
		const url = new URL(request.url);

		// Image transformations: when IMAGE_ORIGIN_URL is set and path is /img/*, serve resized images
		if (env.IMAGE_ORIGIN_URL && url.pathname.startsWith(IMAGE_PATH_PREFIX)) {
			const imagePath = url.pathname.slice(IMAGE_PATH_PREFIX.length);
			return handleImageRequest(request, env as Env & { IMAGE_ORIGIN_URL: string }, imagePath);
		}

		let response: Response;
		const debugLogs = env.DEBUG_LOGS === '1' || env.DEBUG_LOGS === 'true';
		const debug = (message: string, ...args: unknown[]) => {
			if (debugLogs) {
				console.log(`[html-rewrite] ${message}`, ...args);
			}
		};
		const rawPath = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '');
		const enPath = rawPath === '' ? '/en/' : `/en${rawPath}/`;
		const pathSuffix = enPath.replace(/^\/en/, '');
		const alternateLanguages = ['en', 'en-us', 'da', 'de', 'es', 'fi', 'fr', 'it', 'nl', 'no', 'sv'];
		debug('url.pathname:', url.pathname);
		debug('enPath:', enPath, 'pathSuffix:', pathSuffix);

		// In development, construct request and add suppress header to get non-modified HTML
		// In production, pass request to origin server as is
		if (env.ENVIRONMENT === 'development') {
			debug('env=development, adding suppress header and proxying');
			const headers = new Headers(request.headers);
			headers.set('X-Suppress-HTML-Rewrite', '1');
			const devRequest = new Request(request, { headers });

			const upstreamUrl = `${env.SHOP_URL!.replace(/\/$/, '')}${url.pathname}${url.search}${url.hash}`;
			debug('upstream URL (dev):', upstreamUrl);
			response = await fetch(upstreamUrl, devRequest);
		} else {
			debug('env=production, fetching origin');
			response = await fetch(request);
			debug('upstream URL (prod):', response.url);
		}

		// If request has suppress header (see above), it should pass through
		if (request.headers.get('X-Suppress-HTML-Rewrite') === '1') {
			debug('bail: suppress header on request');
			return response;
		}

		// If response is not ok, it should pass through
		if (!response.ok) {
			debug('bail: response not ok', response.status, response.statusText);
			return response;
		}

		// If response is not HTML, it should pass through
		const contentType = response.headers.get('Content-Type');
		if (!contentType?.startsWith('text/html')) {
			debug('bail: non-HTML content-type', contentType ?? 'missing');
			return response;
		}

		// Pass through system or asset URLs. These should be ideally never reached in the first place, see README.md
		if (matchesDisabledRoute(url)) {
			debug('bail: matches disabled route', url.pathname);
			return response;
		}

		// Load page with node-html-parser
		const html = await response.text();
		const root = parse(html);
		debug('parsed HTML length:', html.length);

		// Update <head> canonical/alternate tags
		const head = root.querySelector('head');
		debug('head element found:', Boolean(head));
		const existingLinks = head?.querySelectorAll('link[rel="canonical"], link[rel="alternate"]') ?? [];
		for (const link of existingLinks) {
			link.remove();
		}
		debug('removed links:', existingLinks.length);
		if (existingLinks.length > 0) {
			debug(
				'removed link HTML:',
				existingLinks.map((link) => link.toString()).join(' | ')
			);
		}

		const alternateLinks = alternateLanguages
			.map((lang) => `<link rel="alternate" hreflang="${lang}" href="https://www.teamtailor.com/${lang}${pathSuffix}">`)
			.join('');
		const headLinks = [
			`<link rel="canonical" href="https://www.teamtailor.com${enPath}">`,
			alternateLinks,
			`<link rel="alternate" hreflang="x-default" href="https://www.teamtailor.com${enPath}">`,
		].join('');
		head?.insertAdjacentHTML('beforeend', headLinks);
		debug('injected links for:', enPath);
		debug('injected link HTML:', headLinks);

		// Inject Google Tag Manager
		const gtmId = env.GTM_CONTAINER_ID ?? 'GTM-593GQ2S';
		const gtmScript = `<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${gtmId}');</script>`;
		head?.insertAdjacentHTML('beforeend', gtmScript);

		// Rewrite cdn.prod.website-files.com images to responsive img (srcset/sizes) via Cloudflare or Netlify Image CDN
		if (env.IMAGE_REWRITE_BACKEND) {
			const rewritten = rewriteResponsiveImages(root, request.url, env);
			debug('responsive images rewritten:', rewritten);
		}

		// Add content to header
		const header = root.querySelector('#header');
		header?.insertAdjacentHTML('afterend', '<div class="container"><h1>Hello from Cloudflare Workers using node-html-parser</h1></div>');
		debug('header element found:', Boolean(header));

		// Return modified HTML
		return new Response(root.toString(), response);
	},
};
