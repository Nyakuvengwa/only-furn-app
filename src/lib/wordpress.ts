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

const rawUrl = import.meta.env.WORDPRESS_URL ?? "https://onlyfurn.co.za";

/** WordPress origin, always without a trailing slash. */
export const WORDPRESS_URL = rawUrl.replace(/\/+$/, "");

const CONSUMER_KEY = import.meta.env.WC_CONSUMER_KEY as string | undefined;
const CONSUMER_SECRET = import.meta.env.WC_CONSUMER_SECRET as string | undefined;
const TOKEN_ENDPOINT = (import.meta.env.WC_AUTH_TOKEN_ENDPOINT as string | undefined)?.trim();
const CACHE_TTL = Number(import.meta.env.WORDPRESS_CACHE_TTL ?? 300) || 0;

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

export interface WpCustomer {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  name: string;
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
    headers,
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
  /** `wc/v3` shape, used when credentials are present. */
  regular_price?: string;
  price?: string;
  price_html?: string;
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

function toMajorUnits(value: string | undefined, minorUnit: number): number {
  if (!value) return 0;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return minorUnit > 0 ? numeric / 10 ** minorUnit : numeric;
}

function normaliseProduct(raw: RawStoreProduct): WpProduct {
  const minorUnit = raw.prices?.currency_minor_unit ?? 2;
  const currency = raw.prices?.currency_code ?? "ZAR";

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
    prices: raw.prices ?? {
      price: "0",
      regular_price: "0",
      sale_price: "0",
      currency_code: currency,
      currency_minor_unit: minorUnit,
    },
    price: toMajorUnits(raw.prices?.price ?? raw.price, minorUnit),
    regularPrice: toMajorUnits(raw.prices?.regular_price ?? raw.regular_price, minorUnit),
    currency,
    images: raw.images ?? [],
    categories: raw.categories ?? [],
    tags: raw.tags ?? [],
    brands: raw.brands ?? [],
    is_purchasable: raw.is_purchasable ?? true,
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
 * Catalogue read path. Prefers authenticated `wc/v3` (complete data) and falls
 * back to the public Store API, which needs no credentials and is sufficient
 * for every field the theme renders.
 */
async function listProducts(query: ProductQuery = {}): Promise<WpProduct[]> {
  const params = {
    page: query.page ?? 1,
    per_page: query.perPage ?? 20,
    category: query.category ?? query.categorySlug,
    search: query.search,
    orderby: query.orderby,
    order: query.order,
    exclude: query.exclude,
    include: query.include,
    on_sale: query.onSale,
  };

  if (HAS_WC_CREDENTIALS) {
    const raw = await request<RawStoreProduct[]>("/wc/v3/products", { query: params, authenticated: true });
    return raw.map(normaliseProduct);
  }

  const raw = await request<RawStoreProduct[]>("/wc/store/v1/products", { query: params });
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
  const params = { slug, per_page: 1 };
  const raw = HAS_WC_CREDENTIALS
    ? await request<RawStoreProduct[]>("/wc/v3/products", { query: params, authenticated: true })
    : await request<RawStoreProduct[]>("/wc/store/v1/products", { query: params });

  return raw[0] ? normaliseProduct(raw[0]) : undefined;
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

/**
 * Exchanges credentials for a bearer token.
 *
 * The site has no JWT plugin yet, so `/wp-json/jwt-auth/v1/token` 404s today.
 * Once a token endpoint is enabled this is the only function that changes.
 */
export async function loginCustomer(username: string, password: string): Promise<string> {
  if (!TOKEN_ENDPOINT) {
    throw new WordPressApiError(501, TOKEN_ENDPOINT ?? "token", "WC_AUTH_TOKEN_ENDPOINT is not configured.");
  }

  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ username, password }),
  });

  if (!response.ok) {
    throw new WordPressApiError(
      response.status,
      TOKEN_ENDPOINT,
      "Sign-in failed. Check the credentials, or whether a JWT plugin is active on WordPress.",
    );
  }

  const payload = (await response.json()) as { token?: string };
  if (!payload.token) {
    throw new WordPressApiError(response.status, TOKEN_ENDPOINT, "The token endpoint returned no token.");
  }

  return payload.token;
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