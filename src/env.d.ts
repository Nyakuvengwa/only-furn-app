/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

interface ImportMetaEnv {
  /** Origin of the WordPress install. Server-only. */
  readonly WORDPRESS_URL?: string;
  /** WooCommerce REST API consumer key. Server-only. */
  readonly WC_CONSUMER_KEY?: string;
  /** WooCommerce REST API consumer secret. Server-only. */
  readonly WC_CONSUMER_SECRET?: string;
  /** Customer sign-in token endpoint. Server-only. */
  readonly WC_AUTH_TOKEN_ENDPOINT?: string;
  /** WP username, for the Application Password handshake only. */
  readonly WP_USERNAME?: string;
  /** WordPress Application Password. Server-only. */
  readonly WP_APP_PASSWORD?: string;
  /** In-process cache lifetime for catalogue GETs, in seconds. */
  readonly WORDPRESS_CACHE_TTL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}