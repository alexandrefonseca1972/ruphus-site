import assert from "node:assert/strict";
import { siteSlug } from "@/proxy";

// subdomínio de site
assert.equal(siteSlug("barbeariasoul.ruphus.site"), "barbeariasoul");
assert.equal(siteSlug("agrolar-pet-shop-banho-tosa-e-atendimento-veteri.ruphus.site"), "agrolar-pet-shop-banho-tosa-e-atendimento-veteri");
assert.equal(siteSlug("barbeariasoul.ruphus.site:3000"), "barbeariasoul");
// app: apex, www e previews continuam no Next
assert.equal(siteSlug("ruphus.site"), null);
assert.equal(siteSlug("www.ruphus.site"), null);
assert.equal(siteSlug("app.ruphus.site"), null);
assert.equal(siteSlug("siteflow-ruphus-projects.vercel.app"), null);
assert.equal(siteSlug("localhost:3000"), null);
// domínio de outra pessoa não vira site
assert.equal(siteSlug("barbeariasoul.ruphus.site.evil.com"), null);
assert.equal(siteSlug("a.b.ruphus.site"), null);
console.log("proxy ok");
