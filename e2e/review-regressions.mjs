/** Browser regressions for the review of existing features. No external services. */
export async function reviewRegressions(context, base, check, watchConsole) {
  const page = await context.newPage();
  const noise = [];
  watchConsole(page, noise);
  await page.goto(`${base}/smoke.html`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!document.querySelector("map0-viewer")?.api);
  await page.evaluate(() => {
    document.querySelector("map0-viewer").config = {
      version: 1, map: { center: [0, 0], zoom: 3 }, basemaps: [
        { type: "empty", id: "empty" }, { type: "style", id: "broken-style", url: "/review-missing-style.json" },
      ],
      search: { provider: { url: "/review-search?q={query}", format: "geojson" } },
      i18n: { locale: "en" }, permalink: true,
      layers: [{ type: "geojson", id: "review", data: { type: "FeatureCollection", features: [] } }],
    };
  });
  await page.waitForFunction(() => document.querySelector("map0-viewer")?.api?.config.layers[0]?.id === "review");

  // A pending service answer must not reopen the search after Escape.
  await page.evaluate(() => {
    const original = window.fetch;
    window.fetch = (url, options) => String(url).includes("/review-search")
      ? new Promise(resolve => { window.finishReviewSearch = () => resolve(new Response(JSON.stringify({
        type: "FeatureCollection", features: [{ type: "Feature", properties: { name: "Late answer" }, geometry: { type: "Point", coordinates: [0, 0] } }],
      }), { headers: { "content-type": "application/json" } })); })
      : original(url, options);
  });
  const search = page.locator("map0-viewer input[type=search]");
  await page.locator("map0-viewer .search-field").click();
  await search.fill("Vienna");
  await page.waitForFunction(() => !!window.finishReviewSearch);
  await search.press("Escape");
  await page.evaluate(async () => {
    window.finishReviewSearch();
    await new Promise(resolve => setTimeout(resolve, 50));
    await document.querySelector("map0-viewer").updateComplete;
  });
  check("a dismissed search ignores a late service response", await page.locator("map0-viewer [role=option]").count() === 0);

  // Concurrent URL additions retain separate IDs and their current share state.
  const sharing = await page.evaluate(async () => {
    const { api } = document.querySelector("map0-viewer");
    const ids = await Promise.all([
      api.addLayer({ type: "geojson", title: "Same name", data: "/data/vienna.geojson" }),
      api.addLayer({ type: "geojson", title: "Same name", data: "/data/vienna.geojson" }),
    ]);
    api.setLayerVisibility(ids[0], false);
    api.setLayerOpacity(ids[0], 0.35);
    const raw = new URL(api.getShareUrl()).hash.split("map0-2=")[1]?.split("&")[0]
      ?? new URL(api.getShareUrl()).hash.split("map0=")[1]?.split("&")[0];
    const state = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(raw.replaceAll("-", "+").replaceAll("_", "/")), c => c.charCodeAt(0))));
    return { ids, shared: state.u.find(layer => layer.id === ids[0]) };
  });
  check("concurrent additions with the same title both mount", sharing.ids.every(Boolean) && new Set(sharing.ids).size === 2);
  check("share links keep the current visibility and opacity of added URL layers", sharing.shared.visible === false && sharing.shared.opacity === 0.35);

  /* Kick the dialog off and wait for its render below — awaiting openDialog()'s own promise
     failed once in CI with "Resulting promise was garbage collected" (run 34331759922). */
  await page.evaluate(() => { void document.querySelector("map0-viewer").openDialog("add"); });
  await page.waitForSelector("map0-add-layer input[type=url]");
  const staleCandidates = await page.evaluate(async () => {
    const dialog = document.querySelector("map0-viewer").shadowRoot.querySelector("map0-add-layer");
    let complete;
    const answer = new Promise(resolve => { complete = resolve; });
    dialog.loadWms = async () => answer;
    dialog.url = "https://example.org/first";
    const pending = dialog.load();
    await new Promise(resolve => setTimeout(resolve, 50));
    const input = dialog.querySelector("input[type=url]");
    input.value = "https://example.org/second";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    complete({ candidates: [{ name: "old", title: "Old layer", selected: true }], infoFormat: "text/html" });
    await pending;
    await dialog.updateComplete;
    return dialog.querySelectorAll(".add-row").length;
  });
  check("editing a service URL discards its pending capabilities response", staleCandidates === 0);

  const failedAdd = await page.evaluate(async () => {
    const dialog = document.querySelector("map0-viewer").shadowRoot.querySelector("map0-add-layer");
    let closed = false;
    dialog.addEventListener("close", () => { closed = true; });
    dialog.core = { addLayer: async () => null };
    dialog.candidates = [{ name: "broken", title: "Broken layer", selected: true }];
    await dialog.add();
    await dialog.updateComplete;
    return { closed, error: dialog.querySelector("[role=alert]")?.textContent };
  });
  check("a failed service-layer addition leaves a readable error in the dialog", !failedAdd.closed && !!failedAdd.error);

  const abandonedUrl = await page.evaluate(async () => {
    const dialog = document.querySelector("map0-viewer").shadowRoot.querySelector("map0-add-layer");
    let added = 0;
    dialog.core = { addLayer: async () => { added++; return "late"; } };
    const original = window.fetch;
    let finish;
    window.fetch = (url, options) => String(url).includes("/review-late.geojson")
      ? new Promise(resolve => { finish = resolve; }) : original(url, options);
    dialog.service = "geojson";
    dialog.url = "/review-late.geojson";
    await dialog.updateComplete;
    const pending = dialog.addGeoJsonUrl();
    const deadline = performance.now() + 5000;
    while (!finish) {
      if (performance.now() > deadline) throw new Error("GeoJSON request did not start");
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    const input = dialog.querySelector(".url-row input");
    input.value = "/another.geojson";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    finish(new Response(JSON.stringify({ type: "FeatureCollection", features: [] })));
    await pending;
    return added;
  });
  check("editing a GeoJSON URL cancels its pending addition", abandonedUrl === 0);

  await page.evaluate(() => {
    const viewer = document.querySelector("map0-viewer");
    const original = window.fetch;
    window.fetch = (url, options) => String(url).includes("/review-missing-style.json")
      ? Promise.resolve(new Response("unavailable", { status: 503 })) : original(url, options);
    window.reviewBasemapError = null;
    viewer.api.events.on("error", event => { window.reviewBasemapError = event.message; });
    viewer.api.setBasemap("broken-style");
  });
  await page.waitForFunction(() => !!window.reviewBasemapError);
  check("a failed basemap switch reports an error and keeps the current map", await page.evaluate(() =>
    window.reviewBasemapError.includes("503") && document.querySelector("map0-viewer").api.basemaps.current.value === "empty"));
  check("no console errors during existing-feature regression checks", noise.length === 0, noise.join(" | "));
  await page.close();

  const malformed = await context.newPage();
  const encoded = Buffer.from(JSON.stringify({ v: [0, 0, 3], l: { review: null } })).toString("base64url");
  await malformed.goto(`${base}/smoke.html#map0=${encoded}`, { waitUntil: "domcontentloaded" });
  await malformed.waitForFunction(() => document.querySelector("map0-viewer")?.shadowRoot.querySelector(".maplibregl-canvas") &&
    window.__events.some(event => event.type === "map0:ready"));
  check("a malformed shared layer state falls back to the configured map", await malformed.evaluate(() =>
    document.querySelector("map0-viewer").api.layers.state.value.length === 2));
  await malformed.close();
}
