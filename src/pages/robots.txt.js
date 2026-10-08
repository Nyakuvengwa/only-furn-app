export function GET({ site }) {
  const baseUrl = site ?? new URL("https://onlyfurn-app.dzimba.dev");
  const sitemapUrl = new URL("/sitemap.xml", baseUrl);

  return new Response(`User-agent: *\nAllow: /\n\nSitemap: ${sitemapUrl.href}\n`, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
