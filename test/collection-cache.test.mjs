import { test } from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import { GachaStorage } from "../src/collection-cache.mjs";
import { browser } from "./support/browser.mjs";
import { controlledDatabase } from "./support/storage.mjs";

const meta = { fingerprint: "[]", totalPages: 1 };
const now = Date.parse("2026-01-01T00:00:00Z");
const score = (subjectId, fetchedAt = now) => ({
  version: 3,
  subjectId,
  fetchedAt,
  score: 8.3,
  hasScore: true,
  date: "2020-01-01",
  isPartial: false,
  totalEpisodes: 12,
  resolved: true,
  source: "subject",
});
const item = (id) => ({
  id: String(id),
  title: `条目${id}`,
  link: `/subject/${id}`,
  cover: "",
});

test("a committed collection is available to a new cache without localStorage writes", async () => {
  const dom = browser();
  const indexedDB = new IDBFactory();
  const options = { indexedDB, legacy: dom.window.localStorage };
  const cache = new GachaStorage("test", "anime", options);
  assert.equal(await cache.commitStatus("wish", [item(10)], meta), true);
  const reopened = new GachaStorage("test", "anime", options);
  await reopened.loadStatuses(["wish"]);
  assert.deepEqual(reopened.getItems("wish"), [item(10)]);
  assert.equal(dom.window.localStorage.length, 0);
  dom.window.close();
});

test("maintenance migrates other scopes without replacing database data and removes only recognized unusable legacy caches", async () => {
  const dom = browser();
  const legacy = dom.window.localStorage;
  const indexedDB = new IDBFactory();
  const options = { indexedDB, legacy, now: () => now };
  const cache = new GachaStorage("test", "anime", options);
  const other = new GachaStorage("other", "book", options);
  await other.commitStatus("wish", [item(99)], meta);
  legacy.setItem(
    "bangumi-ark-gacha:record:other:book:wish",
    JSON.stringify({ items: [item(1)], meta }),
  );
  legacy.setItem(
    "bangumi-ark-gacha:record:other:book:collect",
    JSON.stringify({ items: [], meta }),
  );
  legacy.setItem("bangumi-ark-gacha:subject:42", JSON.stringify(score("42")));
  legacy.setItem(
    "bangumi-ark-gacha:subject:43",
    JSON.stringify(score("43", now - 72 * 60 * 60 * 1000)),
  );
  legacy.setItem("bangumi-ark-gacha:list:test:anime:do", "[]");
  legacy.setItem("bangumi-ark-gacha:unknown", "keep");
  legacy.setItem("unrelated", "keep");
  await cache.maintain();
  const reopened = new GachaStorage("other", "book", options);
  await reopened.loadStatuses(["wish", "collect", "do"]);
  assert.deepEqual(reopened.getItems("wish"), [item(99)]);
  assert.deepEqual(reopened.getStatus("collect").items, []);
  assert.equal(reopened.getStatus("do"), null);
  assert.deepEqual(await reopened.loadSubject("42"), score("42"));
  assert.equal(await reopened.loadSubject("43"), null);
  assert.deepEqual(Object.keys(legacy).sort(), [
    "bangumi-ark-gacha:unknown",
    "unrelated",
  ]);
  dom.window.close();
});

test("maintenance physically removes expired scores in batches without deleting fresh scores or collections", async () => {
  let clock = now;
  const options = {
    indexedDB: new IDBFactory(),
    legacy: null,
    now: () => clock,
  };
  const cache = new GachaStorage("test", "anime", options);
  await cache.commitStatus("wish", [item(1)], meta);
  await Promise.all(
    Array.from({ length: 60 }, (_, i) =>
      cache.saveSubjectMeta(String(i + 1), score(String(i + 1))),
    ),
  );
  clock += 72 * 60 * 60 * 1000;
  await cache.saveSubjectMeta("100", score("100", clock));
  await cache.maintain();
  const reopened = new GachaStorage("test", "anime", options);
  await reopened.loadStatuses(["wish"]);
  assert.deepEqual(reopened.getItems("wish"), [item(1)]);
  assert.equal((await reopened.loadSubject("100")).score, 8.3);
  clock = now; // Correcting the clock cannot revive records already cleaned up.
  const corrected = new GachaStorage("test", "anime", options);
  assert.equal(await corrected.loadSubject("1"), null);
  assert.equal(await corrected.loadSubject("60"), null);
});

test("an upgrade in another tab closes the connection without losing this page's candidates", async () => {
  const indexedDB = new IDBFactory();
  const cache = new GachaStorage("test", "anime", { indexedDB, legacy: null });
  await cache.commitStatus("wish", [item(1)], meta);
  await new Promise((resolve, reject) => {
    const request = indexedDB.open("bangumi-ark-gacha", 2);
    request.onblocked = () => reject(new Error("old tab blocked upgrade"));
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
  });
  assert.deepEqual(cache.getItems("wish"), [item(1)]);
  assert.match(cache.persistenceState().error.message, /升级|更新/);
});

test("migration leaves future cache formats and unrelated keys untouched", async () => {
  const dom = browser();
  const legacy = dom.window.localStorage;
  legacy.setItem(
    "bangumi-ark-gacha:subject:42",
    JSON.stringify({ ...score("42"), version: 999 }),
  );
  legacy.setItem(
    "bangumi-ark-gacha:record:test:anime:wish",
    JSON.stringify({ items: [item(1)], meta: { ...meta, version: 999 } }),
  );
  const cache = new GachaStorage("test", "anime", {
    indexedDB: new IDBFactory(),
    legacy,
    now: () => now,
  });
  await cache.maintain();
  assert.equal(legacy.length, 2);
  dom.window.close();
});

test("a legacy import cannot replace the latest unsaved network collection during retry", async () => {
  const dom = browser();
  const { indexedDB, state } = controlledDatabase();
  state.failWrites = true;
  const options = { indexedDB, legacy: dom.window.localStorage };
  const cache = new GachaStorage("test", "anime", options);
  await cache.commitStatus("wish", [item(20)], meta);
  dom.window.localStorage.setItem(
    "bangumi-ark-gacha:record:test:anime:wish",
    JSON.stringify({ items: [item(1)], meta }),
  );
  await cache.maintain();
  state.failWrites = false;
  await cache.retryPersistence();
  const reopened = new GachaStorage("test", "anime", options);
  await reopened.loadStatuses(["wish"]);
  assert.deepEqual(reopened.getItems("wish"), [item(20)]);
  assert.equal(dom.window.localStorage.length, 0);
  dom.window.close();
});

test("supported legacy records and pairs remain usable beside future-format companions", async () => {
  for (const futureRecord of [false, true]) {
    const dom = browser();
    const legacy = dom.window.localStorage;
    const recordKey = "bangumi-ark-gacha:record:test:anime:wish";
    const listKey = "bangumi-ark-gacha:list:test:anime:wish";
    const metaKey = "bangumi-ark-gacha:meta:test:anime:wish";
    legacy.setItem(
      recordKey,
      JSON.stringify({
        items: [item(1)],
        meta: { ...meta, version: futureRecord ? 999 : 2 },
      }),
    );
    legacy.setItem(listKey, JSON.stringify([item(2)]));
    legacy.setItem(
      metaKey,
      JSON.stringify({ ...meta, version: futureRecord ? 2 : 999 }),
    );
    const cache = new GachaStorage("test", "anime", {
      indexedDB: new IDBFactory(),
      legacy,
    });
    await cache.loadStatuses(["wish"]);
    assert.deepEqual(cache.getItems("wish"), [item(futureRecord ? 2 : 1)]);
    await cache.maintain();
    if (futureRecord) {
      assert.notEqual(legacy.getItem(recordKey), null);
      assert.equal(legacy.getItem(listKey), null);
      assert.equal(legacy.getItem(metaKey), null);
    } else {
      assert.equal(legacy.getItem(recordKey), null);
      assert.notEqual(legacy.getItem(listKey), null);
      assert.notEqual(legacy.getItem(metaKey), null);
    }
    dom.window.close();
  }
});

test("subject metadata survives reopening but expires at its original 72-hour deadline", async () => {
  let clock = now;
  const options = {
    indexedDB: new IDBFactory(),
    legacy: null,
    now: () => clock,
  };
  const cache = new GachaStorage("test", "anime", options);
  await cache.saveSubjectMeta("42", score("42"));
  const reopened = new GachaStorage("other", "book", options);
  assert.deepEqual(await reopened.loadSubject("42"), score("42"));
  clock += 72 * 60 * 60 * 1000;
  assert.equal(await reopened.loadSubject("42"), null);
  await reopened.commitStatus("wish", [], meta);
  assert.equal(await reopened.loadSubject("42"), null);
});

test("an aborted save keeps new candidates usable, old persisted data intact, and can be retried", async () => {
  const { indexedDB, state } = controlledDatabase();
  const options = { indexedDB, legacy: null };
  const cache = new GachaStorage("test", "anime", options);
  await cache.commitStatus("wish", [item(10)], meta);
  state.failWrites = true;
  assert.equal(await cache.commitStatus("wish", [item(11)], meta), false);
  assert.deepEqual(cache.getItems("wish"), [item(11)]);
  assert.equal(cache.persistenceState().pending, true);
  const reopened = new GachaStorage("test", "anime", options);
  await reopened.loadStatuses(["wish"]);
  assert.deepEqual(reopened.getItems("wish"), [item(10)]);
  state.failWrites = false;
  assert.equal(await cache.retryPersistence(), true);
  assert.equal(cache.persistenceState().pending, false);
  const retried = new GachaStorage("test", "anime", options);
  await retried.loadStatuses(["wish"]);
  assert.deepEqual(retried.getItems("wish"), [item(11)]);
});

test("valid legacy pairs migrate atomically; unavailable storage still exposes them without deleting the source", async () => {
  const dom = browser();
  const legacy = dom.window.localStorage;
  const listKey = "bangumi-ark-gacha:list:test:anime:wish";
  const metaKey = "bangumi-ark-gacha:meta:test:anime:wish";
  legacy.setItem(listKey, JSON.stringify([item(1)]));
  legacy.setItem(metaKey, JSON.stringify(meta));
  const { indexedDB, state } = controlledDatabase();
  state.unavailable = true;
  const cache = new GachaStorage("test", "anime", { indexedDB, legacy });
  await cache.loadStatuses(["wish", "do"]);
  assert.deepEqual(cache.getItems("wish"), [item(1)]);
  assert.equal(cache.getStatus("do"), null);
  assert.notEqual(legacy.getItem(listKey), null);
  state.unavailable = false;
  assert.equal(await cache.retryPersistence(), true);
  assert.equal(legacy.getItem(listKey), null);
  assert.equal(legacy.getItem(metaKey), null);
  const reopened = new GachaStorage("test", "anime", { indexedDB, legacy });
  await reopened.loadStatuses(["wish"]);
  assert.deepEqual(reopened.getItems("wish"), [item(1)]);
  dom.window.close();
});
