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

import { sitePath } from "@/proxy";
// raiz do site vira o arquivo; assets é compartilhada entre todos os sites
assert.equal(sitePath("lindass", "/"), "/s/lindass/index.html");
assert.equal(sitePath("lindass", "/img/8040045c087e.jpg"), "/s/lindass/img/8040045c087e.jpg");
assert.equal(sitePath("samurai-pet", "/assets/pet/loja-racao-800.jpg"), "/s/assets/pet/loja-racao-800.jpg");
assert.equal(sitePath("samurai-pet", "/assets/fx.js"), "/s/assets/fx.js");
// nome parecido não é a pasta compartilhada
assert.equal(sitePath("lindass", "/assetsfoo/x.png"), "/s/lindass/assetsfoo/x.png");
console.log("sitePath ok");
