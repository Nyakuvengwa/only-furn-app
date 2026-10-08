/**
 * Catalogue data layer.
 *
 * Products now come from WordPress via src/lib/wordpress.ts. This module owns
 * the translation from the WooCommerce shape to the shape the theme's
 * components already expect, so pages and components read the same
 * `Product` type they did when the catalogue was local markdown.
 */

import {
  getCategories,
  getProductBySlug,
  getProducts as fetchWpProducts,
  htmlToText,
  type WpCategory,
  type WpImage,
  type WpProduct,
} from "@/lib/wordpress";
import { siteConfig } from "@/config/site";

export interface ProductImage {
  /** Absolute URL on the WordPress origin. */
  src: string;
  /**
   * WordPress's ~150-300px crop. Used for small slots such as the cart drawer
   * thumbnail, where the full-size original would be wildly oversized.
   */
  thumbnail?: string;
  /** Alt text, falling back to a descriptive phrase when WordPress has none. */
  alt: string;
  /** WordPress-generated `srcset`, when the source provides one. */
  srcset?: string;
  sizes?: string;
}

export interface Product {
  id: number;
  slug: string;
  name: string;
  /** Canonical URL on the WordPress site, used for JSON-LD. */
  permalink: string;
  sku: string;
  /** Top-level category, e.g. "Dining Furniture". */
  collection: string;
  /** Leaf category, e.g. "Dining Chairs". */
  category: string;
  /** Every category name on the product. */
  categories: string[];
  /** Price in major units, ready for Intl formatting. */
  price: number;
  regularPrice: number;
  onSale: boolean;
  currency: string;
  /** Plain text, stripped from the WordPress HTML excerpt. */
  shortDescription: string;
  /** Plain text, stripped from the WordPress HTML description. */
  description: string;
  /** Sanitised HTML description, for the one place that renders rich copy. */
  descriptionHtml: string;
  images: ProductImage[];
  /** WooCommerce stock status, e.g. "instock". */
  stockStatus: string;
  inStock: boolean;
  purchasable: boolean;
  /** Product attributes. Empty on this catalogue, but rendered when present. */
  attributes: { name: string; options: string[] }[];
}

/* -------------------------------------------------------------------------- */
/* Mapping                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Keeps a slim set of tags that WordPress content and WooCommerce copy
 * legitimately use. Anything else is dropped rather than passed to
 * set:html, so a compromised description field cannot inject script.
 */
function sanitiseHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "");
}

/** Single place that derives a responsive `srcset`, if WordPress supplied one. */
function toProductImage(image: WpImage, productName: string, index: number): ProductImage {
  return {
    src: image.src,
    thumbnail: image.thumbnail || undefined,
    // WordPress alt text is frequently empty; fall back to something useful
    // rather than shipping an unlabeled image.
    alt: image.alt?.trim() || `${productName} — view ${index + 1}`,
    srcset: image.srcset || undefined,
    sizes: image.sizes || undefined,
  };
}

/**
 * Splits a product's categories into its leaf ("Dining Chairs") and the
 * top-level range it sits under ("Dining Furniture").
 *
 * `wc/v3` returns only id/name/slug on a product's categories, with no `parent`
 * link, so the hierarchy comes from the category index rather than the product.
 *
 * A term that *has* a parent is a child; a term with no parent is a root. Terms
 * missing from the index are treated as children, so an uncategorised product
 * reports its own term as the category rather than an empty string.
 */
function splitCategories(terms: { id: number; name: string }[], categoryIndex: Map<number, WpCategory>) {
  const isRoot = (term: { id: number }) => {
    const parentId = categoryIndex.get(term.id)?.parent;
    return typeof parentId !== "number" || parentId === 0;
  };

  const children = terms.filter((term) => !isRoot(term));
  const roots = terms.filter(isRoot);

  return {
    category: children[0]?.name ?? roots[0]?.name ?? terms[0]?.name ?? "Uncategorised",
    collection: roots[0]?.name ?? children[0]?.name ?? terms[0]?.name ?? "Uncategorised",
    all: terms.map((term) => term.name),
  };
}

function mapProduct(raw: WpProduct, categoryIndex: Map<number, WpCategory>): Product {
  const { category, collection, all } = splitCategories(raw.categories, categoryIndex);
  const shortDescription = htmlToText(raw.short_description) || htmlToText(raw.description);

  return {
    id: raw.id,
    slug: raw.slug,
    name: raw.name,
    permalink: raw.permalink,
    sku: raw.sku,
    collection,
    category,
    categories: all,
    price: raw.price,
    regularPrice: raw.regularPrice,
    onSale: raw.on_sale && raw.price < raw.regularPrice,
    currency: raw.currency,
    shortDescription,
    description: htmlToText(raw.description) || shortDescription,
    descriptionHtml: sanitiseHtml(raw.description),
    images: raw.images.map((image, index) => toProductImage(image, raw.name, index)),
    stockStatus: raw.stock_status,
    inStock: raw.is_in_stock,
    purchasable: raw.is_purchasable,
    attributes: normaliseAttributes(raw.attributes),
  };
}

/** WooCommerce reports attributes as terms; the theme only needs name/options. */
function normaliseAttributes(attributes: WpProduct["attributes"]): Product["attributes"] {
  if (!Array.isArray(attributes)) return [];

  return attributes
    .map((attribute) => ({
      name: attribute.name,
      options: [attribute.slug].filter(Boolean),
    }))
    .filter((attribute) => attribute.options.length > 0);
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

let categoryIndex: Map<number, WpCategory> | undefined;

/** Category id → term, used to resolve the parent/leaf split. */
async function getCategoryIndex(): Promise<Map<number, WpCategory>> {
  if (categoryIndex) return categoryIndex;

  const categories: WpCategory[] = await getCategories();
  categoryIndex = new Map(categories.map((category) => [category.id, category]));

  return categoryIndex;
}

/** Every published product, in the order WordPress returns them. */
export async function getProducts(): Promise<Product[]> {
  const index = await getCategoryIndex();
  const raw = await fetchWpProducts({ perPage: 100 });
  return raw.map((product) => mapProduct(product, index));
}

/** One product by slug, or `undefined` when WordPress has no such product. */
export async function getProduct(slug: string): Promise<Product | undefined> {
  const index = await getCategoryIndex();
  const raw = await getProductBySlug(slug);
  return raw ? mapProduct(raw, index) : undefined;
}

/** Slugs for `getStaticPaths`. */
export async function getProductSlugs(): Promise<string[]> {
  return (await getProducts()).map((product) => product.slug);
}

/* -------------------------------------------------------------------------- */
/* Derivation                                                                 */
/* -------------------------------------------------------------------------- */

/** Products sharing a category with `slug`, topped up to `limit`. */
export function getRelated(products: Product[], slug: string, limit = 3): Product[] {
  const current = products.find((product) => product.slug === slug);
  if (!current) return products.slice(0, limit);

  return products
    .filter((product) => product.slug !== slug)
    .sort((a, b) => {
      const aScore = a.category === current.category ? -1 : 1;
      const bScore = b.category === current.category ? -1 : 1;
      return aScore - bScore;
    })
    .slice(0, limit);
}

export interface CatalogueFilters {
  categories: string[];
  collections: string[];
}

/** Filter values for the catalogue page, derived from live data. */
export function getProductFilters(products: Product[]): CatalogueFilters {
  const sort = (values: string[]) => [...new Set(values)].sort((a, b) => a.localeCompare(b));

  return {
    categories: sort(products.map((product) => product.category)),
    collections: sort(products.map((product) => product.collection)),
  };
}

/**
 * Resolves a configured slug, failing the build when it does not exist.
 * Kept from the markdown era so a bad `siteConfig.featured` entry still fails
 * loudly instead of rendering an empty section.
 */
export function requireProduct(products: Product[], slug: string): Product {
  const product = products.find((entry) => entry.slug === slug);
  if (!product) {
    throw new Error(
      `siteConfig.featured references "${slug}", but no such product exists in WordPress. Check the slug in the WordPress admin or change siteConfig.featured.`,
    );
  }
  return product;
}

/* -------------------------------------------------------------------------- */
/* Formatting                                                                 */
/* -------------------------------------------------------------------------- */

const priceFormatters = new Map<string, Intl.NumberFormat>();

export function formatPrice(value: number, currency: string = siteConfig.commerce.currency): string {
  let formatter = priceFormatters.get(currency);

  if (!formatter) {
    formatter = new Intl.NumberFormat(siteConfig.commerce.locale, {
      style: "currency",
      currency,
      // Rand amounts here are whole numbers, so drop the cents unless the
      // product actually carries a fraction.
      maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
    });
    priceFormatters.set(currency, formatter);
  }

  return formatter.format(value);
}

/**
 * Spec rows for the product detail page.
 *
 * Only rows with real values appear: this catalogue has no material, finish or
 * lead-time data in WordPress, and rendering empty rows would be worse than
 * showing fewer.
 */
export function getProductSpecs(product: Product): [string, string][] {
  const specs: [string, string][] = [];

  if (product.sku) specs.push(["SKU", product.sku]);
  if (product.collection) specs.push(["Range", product.collection]);
  if (product.category) specs.push(["Type", product.category]);

  for (const attribute of product.attributes) {
    specs.push([attribute.name, attribute.options.join(", ")]);
  }

  specs.push(["Availability", product.inStock ? "In stock" : "Out of stock"]);

  return specs;
}

/** Compact meta line for cart rows and the drawer. */
export function getProductMeta(product: Product): string {
  return [product.collection, product.category].filter(Boolean).join(" · ");
}

/** Serialisable snapshot for the client-side cart scripts. */
export function productForJson(product: Product) {
  return {
    slug: product.slug,
    name: product.name,
    collection: product.collection,
    category: product.category,
    sku: product.sku,
    price: product.price,
    currency: product.currency,
    shortDescription: product.shortDescription,
    meta: getProductMeta(product),
    image: product.images[0]?.src ?? "",
  };
}