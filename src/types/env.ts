export interface Env {
	ENVIRONMENT: 'production' | 'development';
	SHOP_URL?: string;
	DEBUG_LOGS?: string;
	GTM_CONTAINER_ID?: string;
}
