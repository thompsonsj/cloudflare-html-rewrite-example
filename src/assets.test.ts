import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from './assets';
import { classifyPath } from './paths';
import type { Env } from './types/env';

const env: Env = { ENVIRONMENT: 'production', ORIGIN_URL: 'https://tt.payloadcms.app' };
const BASE = 'https://assets.teamtailorcdn.com';

afterEach(() => {
	vi.unstubAllGlobals();
});

function mockOrigin(response: Response) {
	const fetchMock = vi.fn(async (_input: RequestInfo, _init?: RequestInit) => response);
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

describe('classifyPath', () => {
	it('allows form assets', () => {
		expect(classifyPath('/forms/tt-form.95a2a26e.min.js')).toBe('forms');
		expect(classifyPath('/forms/tt-completion-action.js')).toBe('forms');
	});

	it('allows files from known upload collections', () => {
		expect(classifyPath('/api/email/file/header.png')).toBe('upload');
		expect(classifyPath('/api/media/file/teamtailor-reqruitment-stages-ats.png')).toBe('upload');
		expect(classifyPath('/api/logo-images/file/logo.svg')).toBe('upload');
	});

	it('rejects the CMS admin, API and unknown collections', () => {
		expect(classifyPath('/')).toBeNull();
		expect(classifyPath('/forms/')).toBeNull();
		expect(classifyPath('/admin')).toBeNull();
		expect(classifyPath('/api/users')).toBeNull();
		expect(classifyPath('/api/users/me')).toBeNull();
		expect(classifyPath('/api/users/file/x.png')).toBeNull();
		expect(classifyPath('/api/media/123')).toBeNull();
		expect(classifyPath('/api/media/file/')).toBeNull();
		expect(classifyPath('/api/graphql')).toBeNull();
		expect(classifyPath('/en/cookie-policy/')).toBeNull();
	});

	it('rejects encoded traversal', () => {
		expect(classifyPath('/forms/%2e%2e/admin')).toBeNull();
		expect(classifyPath('/api/media/file/%2e%2e%2f%2e%2e%2fusers')).toBeNull();
		expect(classifyPath('/forms/%E0%A4%A')).toBeNull();
	});
});

describe('worker', () => {
	it('returns 404 without calling the origin for disallowed paths', async () => {
		const fetchMock = mockOrigin(new Response('should not be called'));
		const res = await worker.fetch(new Request(`${BASE}/admin`), env);
		expect(res.status).toBe(404);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('returns 405 for writes', async () => {
		const fetchMock = mockOrigin(new Response('x'));
		const res = await worker.fetch(new Request(`${BASE}/forms/a.js`, { method: 'POST', body: 'x' }), env);
		expect(res.status).toBe(405);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('answers CORS preflight', async () => {
		const res = await worker.fetch(new Request(`${BASE}/forms/a.js`, { method: 'OPTIONS' }), env);
		expect(res.status).toBe(204);
		expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
	});

	it('proxies form assets with a short cache and no cookies either way', async () => {
		const fetchMock = mockOrigin(
			new Response('console.log(1)', {
				status: 200,
				headers: { 'Content-Type': 'application/javascript', 'Set-Cookie': 'payload-token=secret' },
			})
		);
		const res = await worker.fetch(
			new Request(`${BASE}/forms/tt-form.js?v=2`, { headers: { Cookie: 'payload-token=abc', Authorization: 'Bearer x', Accept: '*/*' } }),
			env
		);

		expect(res.status).toBe(200);
		expect(await res.text()).toBe('console.log(1)');
		expect(res.headers.get('Set-Cookie')).toBeNull();
		expect(res.headers.get('Cache-Control')).toBe('public, max-age=300');
		expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
		expect(res.headers.get('Content-Security-Policy')).toBeNull();

		const [originRequest, init] = fetchMock.mock.calls[0] as [Request, RequestInit & { cf: { cacheTtlByStatus: Record<string, number> } }];
		expect(originRequest.url).toBe('https://tt.payloadcms.app/forms/tt-form.js?v=2');
		expect(originRequest.headers.get('Cookie')).toBeNull();
		expect(originRequest.headers.get('Authorization')).toBeNull();
		expect(originRequest.headers.get('Accept')).toBe('*/*');
		expect(init.cf.cacheTtlByStatus['200-299']).toBe(300);
	});

	it('proxies upload files with a longer cache and a sandboxing CSP', async () => {
		const fetchMock = mockOrigin(new Response('png', { status: 200, headers: { 'Content-Type': 'image/png' } }));
		const res = await worker.fetch(new Request(`${BASE}/api/email/file/header.png`), env);

		expect(res.status).toBe(200);
		expect(res.headers.get('Cache-Control')).toBe('public, max-age=3600');
		expect(res.headers.get('Content-Security-Policy')).toContain('sandbox');
		const [originRequest, init] = fetchMock.mock.calls[0] as [Request, RequestInit & { cf: { cacheTtlByStatus: Record<string, number> } }];
		expect(originRequest.url).toBe('https://tt.payloadcms.app/api/email/file/header.png');
		expect(init.cf.cacheTtlByStatus['200-299']).toBe(86_400);
	});

	it('does not let browsers cache origin errors', async () => {
		mockOrigin(new Response('missing', { status: 404 }));
		const res = await worker.fetch(new Request(`${BASE}/api/media/file/missing.png`), env);
		expect(res.status).toBe(404);
		expect(res.headers.get('Cache-Control')).toBe('no-store');
	});

	it('only resizes images from allowed upload paths', async () => {
		const fetchMock = mockOrigin(new Response('x'));
		const denied = await worker.fetch(new Request(`${BASE}/img/admin/logo.png`), env);
		expect(denied.status).toBe(404);
		const deniedForms = await worker.fetch(new Request(`${BASE}/img/forms/logo.png`), env);
		expect(deniedForms.status).toBe(404);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('resizes allowed upload images from the origin without forwarding cookies', async () => {
		const fetchMock = mockOrigin(new Response('img', { status: 200, headers: { 'Content-Type': 'image/webp' } }));
		const res = await worker.fetch(
			new Request(`${BASE}/img/api/media/file/photo.jpg?width=400`, { headers: { Cookie: 'payload-token=abc', Accept: 'image/webp' } }),
			env
		);
		expect(res.status).toBe(200);
		const [originRequest, init] = fetchMock.mock.calls[0] as [Request, RequestInit & { cf: { image: Record<string, unknown> } }];
		expect(originRequest.url).toBe('https://tt.payloadcms.app/api/media/file/photo.jpg');
		expect(originRequest.headers.get('Cookie')).toBeNull();
		expect(init.cf.image.width).toBe(400);
	});

	it('serves a health check', async () => {
		const res = await worker.fetch(new Request(`${BASE}/healthz`), env);
		expect(res.status).toBe(200);
	});
});
