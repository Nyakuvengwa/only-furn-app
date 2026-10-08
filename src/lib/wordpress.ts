/**
 * Server-only WordPress / WooCommerce REST client.
 *
 * Only the public Store API needs no credentials, so the client works on a
 * fresh clone. Once WC_CONSUMER_KEY / WC_CONSUMER_SECRET are present the
 * authenticated `wc/v3` routes take over automatically — callers do not change.
 *
 * Nothing here may be imported from a hydrated component: the credentials are
 * read through `import.meta.env` without a `PUBLIC_` prefix, so Vite strips them
 * from client bundles, and `import.meta.env.SSR` guards the whole module.
 */

if (!import.meta.env.SSR) {
  throw new Error("src/lib/wordpress.ts is server-only and must not be imported in client-side code.");
}

/* -------------------------------------------------------------------------- */
/* Configuration                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Resolve a configuration variable, preferring the runtime environment.
 *
 * Astro statically replaces `import.meta.env.X` when the build runs, so a
 * variable that is absent at build time is compiled in as `undefined` and the
 * server never looks at it again. Reading `process.env` first is what makes
 * these runtime values, so the catalogue is fetched live from WordPress and new
 * products appear without rebuilding the image. An empty string is treated as
 * unset, because that is what an unset CI variable becomes.
 */
function readEnv(key: string): string | undefined {
  const runtime = typeof process !== "undefined" ? process.env[key] : undefined;
  if (runtime) return runtime;
  return import.meta.env[key] || undefined;
}

const rawUrl = readEnv("WORDPRESS_URL") || "https://onlyfurn.co.za";

/** WordPress origin, always without a trailing slash. */
export const WORDPRESS_URL = rawUrl.replace(/\/+$/, "");

const CONSUMER_KEY = readEnv("WC_CONSUMER_KEY");
const CONSUMER_SECRET = readEnv("WC_CONSUMER_SECRET");
const TOKEN_ENDPOINT = readEnv("WC_AUTH_TOKEN_ENDPOINT")?.trim();
const CACHE_TTL = Number(readEnv("WORDPRESS_CACHE_TTL") || 300) || 0;

/** True when `wc/v3` calls can be authenticated. Drives the endpoint fallback. */
export const HAS_WC_CREDENTIALS = Boolean(CONSUMER_KEY && CONSUMER_SECRET);

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export interface Money {
  /** Minor units, e.g. `"199900"` for R1999.00. */
  price: string;
  regular_price: string;
  sale_price: string;
  currency_code: string;
  currency_minor_unit: number;
}

export interface WpImage {
  id: number;
  /** Absolute URL on the WordPress origin. Remote — not an Astro asset. */
  src: string;
  thumbnail: string;
  srcset: string;
  sizes: string;
  alt: string;
  name: string;
}

export interface WpTerm {
  id: number;
  name: string;
  slug: string;
  link?: string;
  parent?: number;
  count?: number;
}

export interface WpProduct {
  id: number;
  name: string;
  slug: string;
  /** Absolute URL on the WordPress site. */
  permalink: string;
  type: string;
  sku: string;
  /** HTML fragment, not plain text. */
  short_description: string;
  description: string;
  on_sale: boolean;
  prices: Money;
  /** ZAR minor units → major units, for display and JSON-LD. */
  price: number;
  regularPrice: number;
  currency: string;
  images: WpImage[];
  categories: WpTerm[];
  tags: WpTerm[];
  brands: WpTerm[];
  is_purchasable: boolean;
  is_in_stock: boolean;
  stock_status: string;
  weight: string;
  dimensions: { length: string; width: string; height: string };
  /** Not every product has attribute taxonomies; treat as optional. */
  attributes?: WpTerm[] | null;
}

export interface WpCategory extends WpTerm {
  /** `wc/v3` returns this; the Store API does not. Optional by design. */
  parent?: number;
  count?: number;
}

/**
 * A WordPress user. Field names follow `wp/v2/users`, a superset of the
 * overlapping `wc/v3/customers` fields.
 */
export interface WpCustomer {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  name: string;
  /** `wp/v2/users` only. */
  slug?: string;
  roles?: string[];
  capabilities?: Record<string, boolean>;
  billing?: Record<string, string>;
  shipping?: Record<string, string>;
}

interface WcCredentials {
  consumerKey: string;
  consumerSecret: string;
}

/** Thrown for non-2xx responses so callers can branch on `status`. */
export class WordPressApiError extends Error {
  readonly status: number;
  readonly endpoint: string;

  constructor(status: number, endpoint: string, message: string) {
    super(message);
    this.name = "WordPressApiError";
    this.status = status;
    this.endpoint = endpoint;
  }
}

/* -------------------------------------------------------------------------- */
/* Request plumbing                                                           */
/* -------------------------------------------------------------------------- */

const cache = new Map<string, { expires: number; value: unknown }>();

/** Base64 for ASCII input, using whichever primitive the runtime provides. */
function toBase64(value: string): string {
  if (typeof btoa === "function") return btoa(value);
  return Buffer.from(value).toString("base64");
}

function basicAuth({ consumerKey, consumerSecret }: WcCredentials): string {
  return `Basic ${toBase64(`${consumerKey}:${consumerSecret}`)}`;
}

interface RequestOptions {
  /** Query values. Arrays become repeated keys, which WooCommerce expects. */
  query?: Record<string, string | number | boolean | (string | number)[] | undefined>;
  method?: "GET" | "POST";
  /** JSON body for POST requests. */
  body?: unknown;
  /** Bearer token for customer-scoped routes. */
  token?: string;
  /** Send WooCommerce consumer credentials. Implied by authenticated calls. */
  authenticated?: boolean;
  /** Bypass the in-process cache. */
  noCache?: boolean;
  /** Extra headers, merged last so they win. */
  headers?: Record<string, string>;
}

function buildUrl(path: string, query: RequestOptions["query"]): string {
  const url = new URL(`${WORDPRESS_URL}/wp-json${path}`);

  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      value.forEach((entry) => url.searchParams.append(key, String(entry)));
    } else {
      url.searchParams.set(key, String(value));
    }
  }

  return url.href;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { query, method = "GET", body, token, authenticated = false } = options;
  const url = buildUrl(path, query);
  const extraHeaders = options.headers ?? {};

  if (method === "GET" && !options.noCache && CACHE_TTL > 0) {
    const hit = cache.get(url);
    if (hit && hit.expires > Date.now()) return hit.value as T;
  }

  const headers: Record<string, string> = { Accept: "application/json" };

  if (authenticated) {
    if (!HAS_WC_CREDENTIALS) {
      throw new WordPressApiError(
        401,
        path,
        `WC_CONSUMER_KEY / WC_CONSUMER_SECRET are not set, so ${path} cannot be authenticated.`,
      );
    }
    headers.Authorization = basicAuth({ consumerKey: CONSUMER_KEY!, consumerSecret: CONSUMER_SECRET! });
  }

  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetch(url, {
    method,
    headers: { ...headers, ...extraHeaders },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const payload = await response.json();
      if (payload?.message) message = `${response.status} — ${payload.message}`;
    } catch {
      // Non-JSON error body; the status line is all we have.
    }
    throw new WordPressApiError(response.status, path, message);
  }

  const value = (await response.json()) as T;

  if (method === "GET" && CACHE_TTL > 0 && !options.noCache) {
    cache.set(url, { expires: Date.now() + CACHE_TTL * 1000, value });
  }

  return value;
}

/* -------------------------------------------------------------------------- */
/* Normalisation                                                              */
/* -------------------------------------------------------------------------- */

interface RawStoreProduct {
  id: number;
  name: string;
  slug: string;
  permalink: string;
  type: string;
  sku: string;
  short_description: string;
  description: string;
  on_sale: boolean;
  prices: Money;
  images?: WpImage[];
  categories?: WpTerm[];
  tags?: WpTerm[];
  brands?: WpTerm[];
  is_purchasable?: boolean;
  is_in_stock?: boolean;
  stock_status?: string;
  weight?: string;
  dimensions?: { length: string; width: string; height: string };
  attributes?: WpTerm[] | null;
  /** `wc/v3` shape, used when credentials are present. Prices are major units. */
  regular_price?: string;
  price?: string;
  price_html?: string;
  /** `wc/v3` spells this `purchasable`; the Store API uses `is_purchasable`. */
  purchasable?: boolean;
  manage_stock?: boolean;
  stock_quantity?: number | null;
  date_created?: string;
  date_modified?: string;
}

const EMPTY_DIMENSIONS = { length: "", width: "", height: "" };

/**
 * Strips HTML entities and tags so component props stay plain text.
 * WordPress titles arrive as `Onlyfurn &#8211; Lola Dining Chair`.
 */
export function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

/** Collapses an HTML fragment to plain text for meta descriptions and cards. */
export function htmlToText(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " "));
}

function toNumber(value: string | undefined): number {
  if (!value) return 0;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

/**
 * The Store API reports money in minor units (`"199900"`) alongside an explicit
 * `currency_minor_unit`; `wc/v3` reports major units (`"1999"`). Dividing is only
 * correct for the Store API shape, so branch on which one arrived.
 */
function toMajorUnits(value: string | undefined, minorUnit: number): number {
  if (!value) return 0;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return minorUnit > 0 ? numeric / 10 ** minorUnit : numeric;
}

function normaliseProduct(raw: RawStoreProduct): WpProduct {
  // Presence of `prices` means the Store API shape (minor units).
  const storeShape = raw.prices !== undefined;
  const minorUnit = storeShape ? (raw.prices.currency_minor_unit ?? 2) : 0;
  const currency = raw.prices?.currency_code ?? "ZAR";
  const price = storeShape ? toMajorUnits(raw.prices.price, minorUnit) : toNumber(raw.price);
  const regularPrice = storeShape
    ? toMajorUnits(raw.prices.regular_price, minorUnit)
    : toNumber(raw.regular_price);

  return {
    id: raw.id,
    name: decodeEntities(raw.name),
    slug: raw.slug,
    permalink: raw.permalink,
    type: raw.type,
    sku: raw.sku,
    short_description: raw.short_description ?? "",
    description: raw.description ?? "",
    on_sale: raw.on_sale ?? false,
    // Keep the declared currency even when synthesising a Money shape, so price
    // formatting and JSON-LD read the same field on both API surfaces.
    prices: raw.prices ?? {
      price: String(price * 10 ** minorUnit),
      regular_price: String(regularPrice * 10 ** minorUnit),
      sale_price: String(price * 10 ** minorUnit),
      currency_code: currency,
      currency_minor_unit: minorUnit,
    },
    price,
    regularPrice,
    currency,
    images: raw.images ?? [],
    categories: raw.categories ?? [],
    tags: raw.tags ?? [],
    brands: raw.brands ?? [],
    is_purchasable: raw.is_purchasable ?? raw.purchasable ?? true,
    is_in_stock: raw.is_in_stock ?? true,
    stock_status: raw.stock_status ?? "instock",
    weight: raw.weight ?? "",
    dimensions: raw.dimensions ?? EMPTY_DIMENSIONS,
    attributes: raw.attributes ?? null,
  };
}

/* -------------------------------------------------------------------------- */
/* Catalogue                                                                  */
/* -------------------------------------------------------------------------- */

export interface ProductQuery {
  page?: number;
  perPage?: number;
  /** Category term id. Takes precedence over `categorySlug`. */
  category?: number;
  /** Category slug. Both API surfaces filter with `category`, which accepts an id or a slug. */
  categorySlug?: string;
  search?: string;
  orderby?: "date" | "title" | "price" | "popularity" | "rating";
  order?: "asc" | "desc";
  exclude?: number[];
  include?: number[];
  onSale?: boolean;
}

/**
 * Resolves a category slug to its term id.
 *
 * The Store API's `category` parameter accepts a slug, but `wc/v3` requires a
 * numeric id, so an authenticated call has to translate first.
 */
async function resolveCategoryId(slug: string): Promise<number | undefined> {
  const categories = await getCategories();
  return categories.find((category) => category.slug === slug)?.id;
}

/**
 * Catalogue read path. Prefers authenticated `wc/v3` (complete data) and falls
 * back to the public Store API, which needs no credentials and is sufficient
 * for every field the theme renders.
 *
 * Callers must never see unpublished products: `wc/v3` returns drafts and
 * private items to an authenticated admin, so status is pinned to `publish`
 * on that path only. The Store API is already publish-only.
 */
async function listProducts(query: ProductQuery = {}): Promise<WpProduct[]> {
  const shared = {
    page: query.page ?? 1,
    per_page: query.perPage ?? 20,
    search: query.search,
    orderby: query.orderby,
    order: query.order,
    exclude: query.exclude,
    include: query.include,
    on_sale: query.onSale,
  };

  if (HAS_WC_CREDENTIALS) {
    let category = query.category;

    if (!category && query.categorySlug) {
      category = await resolveCategoryId(query.categorySlug);
      if (!category) return [];
    }

    const raw = await request<RawStoreProduct[]>("/wc/v3/products", {
      query: { ...shared, status: "publish", category },
      authenticated: true,
    });

    return raw.map(normaliseProduct);
  }

  const raw = await request<RawStoreProduct[]>("/wc/store/v1/products", {
    query: { ...shared, category: query.category ?? query.categorySlug },
  });

  return raw.map(normaliseProduct);
}

/** `GET /wp-json/wc/v3/products` — paginated, normalised product list. */
export function getProducts(query: ProductQuery = {}): Promise<WpProduct[]> {
  return listProducts(query);
}

/**
 * `GET /wp-json/wc/v3/products?slug={slug}`.
 * Resolves to `undefined` when no product matches.
 */
export async function getProductBySlug(slug: string): Promise<WpProduct | undefined> {
  const params = HAS_WC_CREDENTIALS ? { slug, per_page: 1, status: "publish" } : { slug, per_page: 1 };
  const raw = HAS_WC_CREDENTIALS
    ? await request<RawStoreProduct[]>("/wc/v3/products", { query: params, authenticated: true })
    : await request<RawStoreProduct[]>("/wc/store/v1/products", { query: params });

  return raw[0] ? normaliseProduct(raw[0]) : undefined;
}

/** Every published product slug, for `getStaticPaths`. */
export async function getProductSlugs(): Promise<string[]> {
  const products = await listProducts({ perPage: 100 });
  return products.map((product) => product.slug).filter(Boolean);
}

/** `GET /wp-json/wc/v3/products/{id}` — falls back to the Store API by id. */
export async function getProductById(id: number): Promise<WpProduct | undefined> {
  const raw = HAS_WC_CREDENTIALS
    ? await request<RawStoreProduct>(`/wc/v3/products/${id}`, { authenticated: true })
    : await request<RawStoreProduct[]>("/wc/store/v1/products", { query: { include: id, per_page: 1 } });

  const single = Array.isArray(raw) ? raw[0] : raw;
  return single ? normaliseProduct(single) : undefined;
}

/** `GET /wp-json/wc/v3/products/categories` — full category tree. */
export async function getCategories(): Promise<WpCategory[]> {
  if (HAS_WC_CREDENTIALS) {
    return request<WpCategory[]>("/wc/v3/products/categories", {
      query: { per_page: 100, hide_empty: false },
      authenticated: true,
    });
  }

  return request<WpCategory[]>("/wc/store/v1/products/categories", {
    query: { per_page: 100, hide_empty: false },
  });
}

/** Categories that actually have at least one published product. */
export async function getCategoriesWithProducts(): Promise<WpCategory[]> {
  const categories = await getCategories();
  return categories.filter((category) => (category.count ?? Number.MAX_SAFE_INTEGER) > 0);
}

/* -------------------------------------------------------------------------- */
/* Customers                                                                  */
/* -------------------------------------------------------------------------- */

/** HTTP Basic auth from a username and an Application Password. */
function appPasswordAuth(username: string, appPassword: string): string {
  return `Basic ${toBase64(`${username}:${appPassword}`)}`;
}

/**
 * Signs a customer in and verifies the result.
 *
 * This install has no JWT plugin, so `/wp-json/jwt-auth/v1/token` 404s. The
 * working path is WordPress core Application Passwords: verify the supplied
 * password as Basic auth against `/wp/v2/users/me`, then mint a session here.
 * The verification is server-side, so the user's real password is never stored.
 */
export async function loginCustomer(username: string, password: string): Promise<WpCustomer> {
  if (!TOKEN_ENDPOINT) {
    throw new WordPressApiError(501, "token", "WC_AUTH_TOKEN_ENDPOINT is not configured.");
  }

  // 1. Try the configured token endpoint first, if a JWT plugin is active.
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ username, password }),
  });

  if (response.ok) {
    const payload = (await response.json()) as { token?: string };
    if (payload.token) return getCustomerProfile(payload.token);
  }

  // 2. Fall back to Application Password verification via Basic auth. Only
  //    Application Passwords work here — a normal account password fails,
  //    which is why customers must create one in their profile.
  const me = await request<WpCustomer>("/wp/v2/users/me", {
    authenticated: false,
    noCache: true,
    headers: { Authorization: appPasswordAuth(username, password) },
  });

  return me;
}

/**
 * `GET /wp-json/wp/v2/users/me` using WP_USERNAME / WP_APP_PASSWORD.
 *
 * A service-account check, not customer auth: it confirms the Application
 * Password handshake succeeded. Never surface the result publicly.
 */
export function getCustomerProfileWithAppPassword(
  username?: string,
  appPassword?: string,
): Promise<WpCustomer> {
  username = username ?? readEnv("WP_USERNAME");
  appPassword = appPassword ?? readEnv("WP_APP_PASSWORD");
  if (!username || !appPassword) {
    throw new WordPressApiError(401, "users/me", "WP_USERNAME / WP_APP_PASSWORD are not set.");
  }

  return request<WpCustomer>("/wp/v2/users/me", {
    noCache: true,
    headers: { Authorization: appPasswordAuth(username, appPassword) },
  });
}

/**
 * `GET /wp-json/wp/v2/users/me` with a bearer token.
 * `wc/v3/customers/me` does not exist on this install (404).
 */
export function getCustomerProfile(token: string): Promise<WpCustomer> {
  return request<WpCustomer>("/wp/v2/users/me", { token, noCache: true });
}

/** `GET /wp-json/wc/v3/customers/{id}` — requires consumer credentials. */
export function getCustomerById(id: number): Promise<WpCustomer> {
  return request<WpCustomer>(`/wc/v3/customers/${id}`, { authenticated: true, noCache: true });
}

/** Clears the in-process response cache. Used by tests and webhook handlers. */
export function clearCache(): void {
  cache.clear();
}