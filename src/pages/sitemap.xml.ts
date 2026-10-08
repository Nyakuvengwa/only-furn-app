import type { APIRoute } from "astro";
import { getProductSlugs } from "@/data/products";

export const prerender = false;

const STATIC_ROUTES = ["/", "/about/", "/catalog/"];

/**
 * Sitemap served on demand from the live WordPress catalogue.
 *
 * `@astrojs/sitemap` builds from Astro's routes, and a dynamic route rendered
 * on demand has no known paths, so a product added in WordPress could never
 * appear in a build-time sitemap. Generating it per request keeps it in step
 * with the catalogue without a redeploy.
 */
export const GET: APIRoute = async ({ site }) => {
  const base = site ?? new URL("https://onlyfurn-app.dzimba.dev");
  const origin = base.origin.replace(/\/+$/, "");

  const slugs = await getProductSlugs();
  const paths = [
    ...STATIC_ROUTES,
    ...slugs.map((slug) => `/products/${slug}/`),
  ];

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${paths.map((path) => `  <url><loc>${escapeXml(`${origin}${path}`)}</loc></url>`).join("\n")}
</urlset>
`;

  return new Response(body, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=600",
    },
  });
};

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
