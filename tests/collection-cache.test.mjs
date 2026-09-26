import { test } from "node:test";
import assert from "node:assert/strict";
import { GachaStorage } from "../src/collection-cache.mjs";
import { browser } from "./support/browser.mjs";

const meta = { fingerprint: "[]", totalPages: 1 };
const item = (id) => ({
  id: String(id),
  title: `条目${id}`,
  link: `/subject/${id}`,
  cover: "",
});

test("a failed atomic status write leaves old data, without affecting another status", () => {
  const dom = browser();
  const backing = dom.window.localStorage;
  let fail = false;
  const adapter = {
    getItem: (key) => backing.getItem(key),
    setItem: (key, value) => {
      if (fail && key.includes(":record:") && key.endsWith(":wish"))
        throw new Error("quota");
      backing.setItem(key, value);
    },
    removeItem: (key) => backing.removeItem(key),
  };
  const cache = new GachaStorage("test", "anime", adapter);
  cache.commitStatus("wish", [item(10)], meta);
  cache.commitStatus("do", [], meta);
  fail = true;
  assert.throws(() => cache.commitStatus("wish", [item(11)], meta), /quota/);
  assert.deepEqual(cache.getItems("wish"), [item(10)]);
  assert.deepEqual(cache.getItems("do"), []);
  assert.ok(cache.getStatus("do"));
  dom.window.close();
});

test("migrates only valid legacy list and metadata; empty is complete, missing and corrupt are not", () => {
  const dom = browser();
  const cache = new GachaStorage("test", "anime", dom.window.localStorage);
  cache.writeJson(cache.listKey("wish"), [item(1)]);
  cache.writeJson(cache.metaKey("wish"), meta);
  assert.deepEqual(cache.getItems("wish"), [item(1)]);
  assert.ok(dom.window.localStorage.getItem(cache.recordKey("wish")));
  cache.writeJson(cache.metaKey("do"), meta);
  assert.equal(cache.getStatus("do"), null);
  cache.writeJson(cache.listKey("do"), [{ id: "bad", link: "oops" }]);
  assert.equal(cache.getStatus("do"), null);
  cache.commitStatus("collect", [], meta);
  assert.deepEqual(cache.getStatus("collect").items, []);
  dom.window.close();
});
