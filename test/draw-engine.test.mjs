import { test } from "node:test";
import assert from "node:assert/strict";
import { GachaStorage } from "../src/collection-cache.mjs";
import { DrawEngine } from "../src/draw-engine.mjs";
import { browser } from "./support/browser.mjs";

test("sampling produces every ordered pair equally without changing the pool", () => {
  const items = Object.freeze(["a", "b", "c"]);
  const outcomes = new Map();
  for (let first = 0; first < 3; first++) {
    for (let second = 0; second < 2; second++) {
      const values = [(first + 0.5) / 3, (second + 0.5) / 2];
      const engine = new DrawEngine({ random: () => values.shift() });
      const selected = engine.sample(items, 2);
      assert.equal(new Set(selected).size, 2);
      const key = selected.join("");
      outcomes.set(key, (outcomes.get(key) ?? 0) + 1);
    }
  }
  assert.deepEqual([...outcomes.keys()].sort(), [
    "ab",
    "ac",
    "ba",
    "bc",
    "ca",
    "cb",
  ]);
  assert.ok([...outcomes.values()].every((count) => count === 1));
});

test("sampling handles empty, zero, singleton and oversized draws", () => {
  for (const random of [() => 0, () => 1 - Number.EPSILON]) {
    const engine = new DrawEngine({ random });
    assert.deepEqual(engine.sample([], 10), []);
    assert.deepEqual(engine.sample(["a", "b"], 0), []);
    assert.deepEqual(engine.sample(["a"], 10), ["a"]);
    const items = Object.freeze(["a", "b", "c", "d"]);
    const selected = engine.sample(items, 10);
    assert.deepEqual([...selected].sort(), [...items]);
  }
});

test("sampling only reads the requested entries from a large pool", () => {
  const reads = [];
  const items = new Proxy(
    { length: 100000 },
    {
      get(target, key) {
        if (key === "length") return target.length;
        reads.push(key);
        return key;
      },
    },
  );
  let calls = 0;
  const engine = new DrawEngine({
    random: () => {
      calls++;
      return 1 - Number.EPSILON;
    },
  });
  const selected = engine.sample(items, 3);
  assert.deepEqual(selected, ["99999", "0", "1"]);
  assert.deepEqual(reads, selected);
  assert.equal(calls, 3);
});

test("cards fetches scores only for sampled items in draw order", async () => {
  const fetched = [];
  const engine = new DrawEngine({
    random: () => 1 - Number.EPSILON,
    storage: {
      loadSubject: async () => null,
      saveSubjectMeta() {},
    },
    client: {
      async fetchSubject(id) {
        fetched.push(id);
        return { resolved: true, hasScore: false };
      },
    },
  });
  const items = Object.freeze(
    ["1", "2", "3", "4"].map((id) => ({ id, link: `/subject/${id}` })),
  );
  const cards = await engine.cards(items, 2);
  assert.deepEqual(
    cards.map((card) => card.id),
    ["4", "1"],
  );
  assert.deepEqual(fetched, ["4", "1"]);
});

test("malformed cached score is fetched again before drawing", async () => {
  const dom = browser();
  const storage = new GachaStorage("test", "anime", {
    indexedDB: null,
    legacy: dom.window.localStorage,
    now: () => now,
  });
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
  const storage = new GachaStorage("test", "anime", {
    indexedDB: null,
    legacy: dom.window.localStorage,
    now: () => now,
  });
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
  const storage = new GachaStorage("test", "anime", {
    indexedDB: null,
    legacy: dom.window.localStorage,
    now: () => now,
  });
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
