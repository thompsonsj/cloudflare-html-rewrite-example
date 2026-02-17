export interface Env {
	ENVIRONMENT: 'production' | 'development';
	SHOP_URL?: string;
	DEBUG_LOGS?: string;
	GTM_CONTAINER_ID?: string;
	/** Base URL for image transformation origin (e.g. https://storage.example.com/bucket). When set, /img/* is handled by the image worker. */
	IMAGE_ORIGIN_URL?: string;
}
