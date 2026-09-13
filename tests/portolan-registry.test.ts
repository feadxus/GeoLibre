import assert from "node:assert/strict";
import test from "node:test";
import { loadPortolanIndex, PORTOLAN_REGISTRY_URL } from "../packages/plugins/src/plugins/stac-api";

test("Portolan discovery reads only catalog links and resolves relative URLs", async () => {
  const controller = new AbortController();
  const catalogs = await loadPortolanIndex(async (input, init) => {
    assert.equal(input, PORTOLAN_REGISTRY_URL);
    assert.equal(init?.signal, controller.signal);
    return Response.json({
      type: "Catalog",
      links: [
        { rel: "self", href: PORTOLAN_REGISTRY_URL },
        {
          rel: "child",
          href: "https://utrecht.blob.core.windows.net/catalog/catalog.json",
          title: "Utrecht",
        },
        { rel: "child", href: "./example/catalog.json", title: "Example" },
        { rel: "child", href: "javascript:alert(1)", title: "Invalid" },
        { rel: "child", href: "https://example.org/catalog.json" },
        { rel: "item", href: "./item.json", title: "Not a catalog" },
        null,
      ],
    });
  }, controller.signal);
  assert.equal(catalogs.length, 3);
  assert.equal(catalogs[0].title, "Example");
  assert.equal(catalogs[0].url, new URL("./example/catalog.json", PORTOLAN_REGISTRY_URL).href);
  assert.ok(catalogs.every((catalog) => catalog.access === "public" && !catalog.isApi));
  assert.ok(catalogs.some((catalog) => catalog.title === "https://example.org/catalog.json"));
});

test("Portolan discovery reports HTTP and invalid registry responses", async () => {
  await assert.rejects(
    loadPortolanIndex(async () => new Response("", { status: 503 })),
    /503/,
  );
  for (const value of [null, [], {}, { type: "Catalog", links: null }]) {
    await assert.rejects(
      loadPortolanIndex(async () => Response.json(value)),
      /invalid catalog list/,
    );
  }
  assert.deepEqual(
    await loadPortolanIndex(async () => Response.json({ type: "Catalog", links: [] })),
    [],
  );
});
