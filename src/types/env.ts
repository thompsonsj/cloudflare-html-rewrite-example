export interface Env {
	ENVIRONMENT: 'production' | 'development';
	/** Origin the worker proxies, without a trailing slash. Currently the Payload CMS on Payload Cloud: https://tt.payloadcms.app */
	ORIGIN_URL: string;
	/** "1" or "true" to log each request decision. */
	DEBUG_LOGS?: string;
}
