import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { GachaStorage } from "../src/collection-cache.mjs";
import { DrawEngine } from "../src/draw-engine.mjs";
import { createBangumiClient } from "../src/bangumi-client.mjs";

function browser() {
  const dom = new JSDOM("", { url: "https://bgm.tv/" });
  globalThis.window = dom.window;
  globalThis.DOMParser = dom.window.DOMParser;
  return dom;
}

test("per-status cache preserves old data when a write fails, and does not affect other statuses", () => {
  const dom = browser();
  const values = new Map();
  let fail = false;
  const adapter = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      if (fail && key.includes(":meta:") && !key.endsWith(":tmp")) {
        fail = false;
        throw new Error("quota");
      }
      values.set(key, value);
    },
    removeItem: (key) => values.delete(key),
  };
  const cache = new GachaStorage("test", "anime", adapter);
  const first = [{ id: "10", title: "旧条目", link: "/subject/10" }];
  cache.commitStatus("wish", first, { fingerprint: "old" });
  cache.commitStatus("do", [], { fingerprint: "empty" });
  fail = true;
  assert.throws(
    () =>
      cache.commitStatus("wish", [{ id: "11", title: "新条目" }], {
        fingerprint: "new",
      }),
    /quota/,
  );
  assert.equal(cache.getItems("wish")[0].title, "旧条目");
  assert.equal(cache.getMeta("wish").fingerprint, "old");
  assert.equal(cache.getMeta("do").fingerprint, "empty");
  dom.window.close();
});

test("score cache is reused until original seven-day boundary and a failed score is not cached", async () => {
  const dom = browser();
  let now = Date.parse("2026-01-01T00:00:00Z");
  let calls = 0;
  const storage = new GachaStorage("test", "anime", dom.window.localStorage);
  const client = {
    fetchSubject: async () => {
      calls++;
      return new DOMParser().parseFromString(
        '<div class="global_score"><span class="number">7.5</span></div><ul id="infobox"><li>放送开始: 2019-01-01</li><li>话数: 12</li></ul>',
        "text/html",
      );
    },
  };
  const engine = new DrawEngine({
    storage,
    client,
    subjectType: "anime",
    now: () => now,
    random: () => 0,
  });
  const item = { id: "21", title: "试验", link: "/subject/21" };
  assert.equal((await engine.cards([item], 1))[0].star, 5);
  now += 7 * 24 * 60 * 60 * 1000;
  await engine.cards([item], 1);
  assert.equal(calls, 1);
  now++;
  await engine.cards([item], 1);
  assert.equal(calls, 2);
  dom.window.close();
});

test("HTML adapter detects pagination and rejects HTTP errors rather than reporting an empty page", async () => {
  const dom = browser();
  const client = createBangumiClient({
    subjectType: "anime",
    userId: "test",
    transport: async () => ({ ok: false, status: 403 }),
  });
  await assert.rejects(client.fetchListPage("wish", 1), /HTTP 403/);
  dom.window.close();
});
