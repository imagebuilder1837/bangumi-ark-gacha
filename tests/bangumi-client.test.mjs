import { test } from "node:test";
import assert from "node:assert/strict";
import { createBangumiClient } from "../src/bangumi-client.mjs";
import { browser } from "./support/browser.mjs";

test("subject request returns parsed score and release data, not a DOM document", async () => {
  const dom = browser();
  const client = createBangumiClient({
    subjectType: "anime",
    userId: "test",
    transport: async () => ({
      ok: true,
      text: async () =>
        '<div class="global_score"><span class="number">8.3</span></div><ul id="infobox"><li>放送开始: 2020-01-01</li><li>话数: 12</li></ul>',
    }),
  });
  assert.deepEqual(await client.fetchSubject("42"), {
    score: 8.3,
    hasScore: true,
    date: "2020-01-01",
    isPartial: false,
    totalEpisodes: 12,
    resolved: true,
    source: "subject",
  });
  dom.window.close();
});

test("client accepts an injected browser parser, origin and timeout clock", async () => {
  const dom = browser();
  const timers = new Map();
  const browserAdapter = {
    origin: "https://bgm.tv",
    parse: (html) =>
      new dom.window.DOMParser().parseFromString(html, "text/html"),
    setTimeout(callback, delay) {
      assert.equal(delay, 10000);
      timers.set(1, callback);
      return 1;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  };
  const client = createBangumiClient({
    subjectType: "anime",
    userId: "test",
    browser: browserAdapter,
    transport: async () => ({
      ok: true,
      text: async () =>
        '<ul id="browserItemList"><li class="item"><h3><a href="/subject/1">作品</a></h3><img class="cover" src="/pic/cover.jpg"></li></ul><div id="multipage"><a href="?page=2">2</a></div>',
    }),
  });
  const previousWindow = globalThis.window;
  const previousParser = globalThis.DOMParser;
  globalThis.window = undefined;
  globalThis.DOMParser = undefined;
  let page;
  try {
    page = await client.fetchListPage("wish", 1);
  } finally {
    globalThis.window = previousWindow;
    globalThis.DOMParser = previousParser;
  }
  assert.equal(page.items[0].cover, "https://bgm.tv/pic/cover.jpg");
  assert.equal(page.pageInfo.totalPages, 2);
  assert.equal(timers.size, 0);
  dom.window.close();
});

test("list timeout starts on dispatch and uses the injected clock", async () => {
  const dom = browser();
  let timeout;
  const client = createBangumiClient({
    subjectType: "anime",
    userId: "test",
    browser: {
      origin: "https://bgm.tv",
      parse: (html) =>
        new dom.window.DOMParser().parseFromString(html, "text/html"),
      setTimeout(fn, ms) {
        assert.equal(ms, 10000);
        timeout = fn;
        return 1;
      },
      clearTimeout() {},
    },
    transport: (url, { signal }) =>
      new Promise((resolve, reject) =>
        signal.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        }),
      ),
  });
  const pending = client.fetchListPage("wish", 1);
  assert.equal(typeof timeout, "function");
  timeout();
  await assert.rejects(pending, /请求超时/);
  dom.window.close();
});

test("HTTP errors are rejected rather than reported as an empty page", async () => {
  const dom = browser();
  const client = createBangumiClient({
    subjectType: "anime",
    userId: "test",
    transport: async () => ({ ok: false, status: 403 }),
  });
  await assert.rejects(client.fetchListPage("wish", 1), /HTTP 403/);
  dom.window.close();
});
