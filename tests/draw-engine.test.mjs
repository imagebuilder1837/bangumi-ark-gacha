import { test } from "node:test";
import assert from "node:assert/strict";
import { GachaStorage } from "../src/collection-cache.mjs";
import { DrawEngine } from "../src/draw-engine.mjs";
import { browser } from "./support/browser.mjs";

test("malformed cached score is fetched again before drawing", async () => {
  const dom = browser();
  const storage = new GachaStorage("test", "anime", dom.window.localStorage);
  const now = Date.parse("2026-01-01T00:00:00Z");
  storage.saveSubjectMeta("21", {
    version: 3,
    subjectId: "21",
    fetchedAt: now - 1000,
    resolved: true,
    score: "broken",
    hasScore: true,
    date: "2019-01-01",
    isPartial: false,
    totalEpisodes: 12,
    source: "subject",
  });
  let calls = 0;
  const engine = new DrawEngine({
    storage,
    client: {
      async fetchSubject() {
        calls++;
        return {
          score: 8.3,
          hasScore: true,
          date: "2019-01-01",
          isPartial: false,
          totalEpisodes: 12,
          resolved: true,
          source: "subject",
        };
      },
    },
    subjectType: "anime",
    now: () => now,
  });
  const [card] = await engine.cards([{ id: "21", link: "/subject/21" }], 1);
  assert.equal(calls, 1);
  assert.equal(card.info.score, 8.3);
  assert.equal(card.star, 6);
  dom.window.close();
});

test("impossible cached release dates are fetched again", async () => {
  const dom = browser();
  const storage = new GachaStorage("test", "anime", dom.window.localStorage);
  const now = Date.parse("2026-01-01T00:00:00Z");
  storage.saveSubjectMeta("21", {
    version: 3,
    subjectId: "21",
    fetchedAt: now - 1000,
    resolved: true,
    score: 7.5,
    hasScore: true,
    date: "2025-02-30",
    isPartial: false,
    totalEpisodes: 12,
    source: "subject",
  });
  let calls = 0;
  const engine = new DrawEngine({
    storage,
    client: {
      async fetchSubject() {
        calls++;
        return {
          score: 7.5,
          hasScore: true,
          date: "2025-02-28",
          isPartial: false,
          totalEpisodes: 12,
          resolved: true,
          source: "subject",
        };
      },
    },
    subjectType: "anime",
    now: () => now,
  });
  const [card] = await engine.cards([{ id: "21", link: "/subject/21" }], 1);
  assert.equal(calls, 1);
  assert.equal(card.info.date, "2025-02-28");
  dom.window.close();
});

test("score cache expires exactly 72 hours after its original fetch", async () => {
  const dom = browser();
  let now = Date.parse("2026-01-01T00:00:00Z");
  let calls = 0;
  const storage = new GachaStorage("test", "anime", dom.window.localStorage);
  const client = {
    fetchSubject: async () => {
      calls++;
      return {
        score: 7.5,
        hasScore: true,
        date: "2019-01-01",
        isPartial: false,
        totalEpisodes: 12,
        resolved: true,
        source: "subject",
      };
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
  now += 72 * 60 * 60 * 1000 - 1;
  await engine.cards([item], 1);
  assert.equal(calls, 1);
  now++;
  await engine.cards([item], 1);
  assert.equal(calls, 2);
  dom.window.close();
});
