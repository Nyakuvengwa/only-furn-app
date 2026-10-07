/**
 * Smoke test for src/lib/wordpress.ts against the live site.
 * Transpiles the TypeScript client with the project's own TypeScript, then
 * exercises the public read paths and the expected failure paths.
 */
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

const source = readFileSync("src/lib/wordpress.ts", "utf8")
  // Plain node has no import.meta.env, so hand the module a stand-in.
  .replace(/if \(!import\.meta\.env\.SSR\) \{[\s\S]*?\n\}\n/, "")
  .replace(/import\.meta\.env\./g, "__env.");

const { outputText, diagnostics } = ts.transpileModule(source, {
  compilerOptions: { target: "es2022", module: "esnext" },
  reportDiagnostics: true,
});

if (diagnostics?.length) {
  console.error("transpile diagnostics:", diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, " ")));
  process.exit(1);
}

const dir = mkdtempSync(join(tmpdir(), "wpc-"));
const file = join(dir, "wordpress.mjs");
writeFileSync(file, `const __env = process.env;\n${outputText}`);

const wp = await import(`file://${file.replace(/\\/g, "/")}`);

console.log("WORDPRESS_URL          =", wp.WORDPRESS_URL);
console.log("HAS_WC_CREDENTIALS     =", wp.HAS_WC_CREDENTIALS);

const t0 = Date.now();
const products = await wp.getProducts({ perPage: 100 });
console.log("getProducts            ->", products.length, "items in", Date.now() - t0, "ms");

const p = products[0];
console.log("first product          ->", p.name);
console.log("  slug                 ->", p.slug);
console.log("  price                ->", p.currency, p.price, "(regular", p.regularPrice + ")");
console.log("  images               ->", p.images.length, p.images[0]?.src);
console.log("  categories           ->", p.categories.map((c) => c.slug).join(", "));
console.log("  in_stock / purchasable ->", p.is_in_stock, "/", p.is_purchasable);
console.log("  entity decoded       ->", p.name.includes("\u2013") ? "yes" : "NO");
console.log("  shortDescription     ->", JSON.stringify(wp.htmlToText(p.short_description).slice(0, 70)));

const t1 = Date.now();
await wp.getProducts({ perPage: 100 });
console.log("cached getProducts     ->", Date.now() - t1, "ms");

const one = await wp.getProductBySlug("onlyfurn-lola-dining-chair");
console.log("getProductBySlug       ->", one ? `${one.id} ${one.name}` : "undefined");

const missing = await wp.getProductBySlug("does-not-exist-xyz");
console.log("unknown slug           ->", missing === undefined ? "undefined (correct)" : "LEAKED");

const byId = await wp.getProductById(products[0].id);
console.log("getProductById         ->", byId ? `${byId.id} ${byId.slug}` : "undefined");

const cats = await wp.getCategories();
console.log("getCategories          ->", cats.length, cats.map((c) => `${c.slug}(${c.count})`).join(" "));

const live = await wp.getCategoriesWithProducts();
console.log("categories w/ products ->", live.map((c) => c.slug).join(", "));

const chairs = await wp.getProducts({ categorySlug: "office-chairs", perPage: 3 });
console.log("filter by categorySlug ->", chairs.length, chairs[0]?.slug);

console.log("htmlToText             ->", JSON.stringify(wp.htmlToText("<p>Solid <strong>oak</strong> &#8211; 40&#215;60cm.</p>")));

try {
  await wp.loginCustomer("nobody@example.com", "wrong-password");
  console.log("loginCustomer          -> UNEXPECTEDLY SUCCEEDED");
} catch (error) {
  console.log("loginCustomer          ->", error.name, error.status);
}

wp.clearCache();
console.log("clearCache             -> ok");