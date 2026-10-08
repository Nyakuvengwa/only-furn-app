/**
 * Central theme configuration.
 *
 * Everything a new site normally needs to change lives here: the studio name,
 * navigation, footer, contact details, commerce defaults, and which products
 * are promoted on the homepage and in the mobile menu. Components read from
 * this file rather than hardcoding copy, so renaming or re-scoping the theme
 * does not mean editing markup.
 *
 * The canonical domain is NOT here — it is `site` in astro.config.mjs, so
 * there is only ever one source of truth for it.
 */

export interface NavItem {
  label: string;
  href: string;
}

export interface FooterColumn {
  heading: string;
  links: NavItem[];
}

export const siteConfig = {
  /** Studio name. Used in the wordmark, metadata, JSON-LD and the footer. */
  name: "Onlyfurn",

  /** One-line positioning statement. Emitted as the Organization slogan. */
  tagline: "Furniture, made by hand",

  /** Homepage hero copy. */
  hero: {
    headline: "Furniture built for the way you actually live",
    subheadline:
      "Dining and office seating, designed in South Africa and shipped nationwide — solid timber, honest construction, and a price you can read at a glance.",
  },

  /** Default meta description for pages that do not set their own. */
  description:
    "Onlyfurn — dining and office furniture in South Africa. Solid timber seating built to last, with nationwide delivery.",

  /** Default <title> for pages that do not set their own. */
  defaultTitle: "Onlyfurn — Dining and office furniture in South Africa",

  /** Contact address, linked in the footer and on the studio page. */
  email: "email@example.com",

  /** Used for Organization JSON-LD. */
  location: {
    region: "Gauteng",
    country: "ZA",
  },

  /**
   * Product ranges promoted on the homepage. `name` must match a WordPress
   * product category exactly; ranges with no products are dropped at build.
   */
  ranges: [
    {
      name: "Office Chairs",
      blurb:
        "Ergonomic desk seating built around a supportive frame and a seat that stays comfortable through a long day.",
    },
    {
      name: "Dining Furniture",
      blurb:
        "Dining chairs and tables in oak, walnut and painted finishes, sized for everyday family meals and long dinners.",
    },
  ],

  /** Browser theme colour. Keep in step with `--canvas` in src/styles.css. */
  themeColor: "#f4f4f2",

  /**
   * Fallback social share card, served from public/. Used by any page that
   * does not pass its own `image` — product pages pass their photography, so
   * this covers the homepage, catalogue, studio, cart and 404.
   */
  socialImage: {
    src: "/og-image.png",
    width: 1200,
    height: 630,
    alt: "Onlyfurn — dining and office furniture in South Africa",
  },

  /** Primary navigation, in order. Also drives the mobile menu. */
  navigation: [
    { label: "Index", href: "/" },
    { label: "Catalogue", href: "/catalog" },
    { label: "Studio", href: "/about" },
  ] satisfies NavItem[],

  /** Short paragraph in the first footer column. */
  footerBlurb:
    "Dining and office seating in solid timber, designed in South Africa and shipped nationwide.",

  /** Footer link columns. Add or remove columns freely. */
  footerColumns: [
    {
      heading: "Catalogue",
      links: [
        { label: "All pieces", href: "/catalog" },
        { label: "The studio", href: "/about" },
        { label: "Your cart", href: "/cart" },
      ],
    },
    {
      heading: "Enquiries",
      links: [
        { label: "Custom orders", href: "/about#studio" },
        { label: "Trade portal", href: "/about#studio" },
        { label: "Studio visits", href: "/about#studio" },
      ],
    },
    {
      heading: "Elsewhere",
      links: [{ label: "Instagram", href: "https://www.instagram.com/" }],
    },
  ] satisfies FooterColumn[],

  /** Commerce defaults. Mirrors the WooCommerce store settings. */
  commerce: {
    /** BCP 47 locale used to format every price. */
    locale: "en-ZA",
    /** ISO 4217 currency code. */
    currency: "ZAR",
    /** Flat delivery charge added once when the cart is not empty. */
    shippingFlatRate: 120,
  },

  /**
   * Which products the theme promotes. Each value is a WordPress product slug,
   * so it must match the slug in the WordPress admin. A slug that does not
   * resolve fails the build rather than rendering an empty section.
   */
  featured: {
    /** Three cards in the homepage "in the workshop" grid. */
    homepageGrid: ["vertex-office-chair", "summit-office-chair", "sterling-office-chair"],
    /** The single large piece given its own homepage section. */
    homepageSolo: "onlyfurn-lola-dining-chair",
    /** The piece shown at the foot of the mobile menu. */
    mobileMenu: "onlyfurn-jade-dining-chair",
  },
} as const;

export type SiteConfig = typeof siteConfig;

/**
 * Builds a page <title> in the theme's house format: "Page — Studio Name".
 * Change the separator here to restyle every title at once.
 */
export function pageTitle(page: string): string {
  return `${page} — ${siteConfig.name}`;
}
