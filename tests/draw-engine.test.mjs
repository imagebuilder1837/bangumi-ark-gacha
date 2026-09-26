import { test } from "node:test";
import assert from "node:assert/strict";
import { GachaStorage } from "../src/collection-cache.mjs";
import { DrawEngine } from "../src/draw-engine.mjs";
import { browser } from "./support/browser.mjs";

test("score cache is reused until the original seven-day boundary", async () => {
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
