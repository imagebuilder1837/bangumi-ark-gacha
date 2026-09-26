import { test } from "node:test";
import assert from "node:assert/strict";
import { GachaStorage } from "../src/collection-cache.mjs";
import { browser } from "./support/browser.mjs";

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
