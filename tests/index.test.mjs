import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { GachaSession } from "../src/gacha-session.mjs";
import { GachaStorage } from "../src/collection-cache.mjs";
import { createBangumiClient } from "../src/bangumi-client.mjs";
import { DrawEngine } from "../src/draw-engine.mjs";

const flush = () => new Promise((resolve) => setImmediate(resolve));
const empty = { items: [], pageInfo: { reliable: true, totalPages: 1 } };
function environment() {
  const dom = new JSDOM(
    "<!doctype html><html><head></head><body></body></html>",
    { url: "https://bgm.tv/anime/list/test/wish", runScripts: "outside-only" },
  );
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.DOMParser = dom.window.DOMParser;
  dom.window.requestAnimationFrame = (callback) => {
    callback();
    return 1;
  };
  dom.window.cancelAnimationFrame = () => {};
  return dom;
}
function setup({ ignoreAbort = false } = {}) {
  const dom = environment();
  const requests = [];
  const client = {
    fetchListPage(status, page, signal) {
      return new Promise((resolve, reject) => {
        requests.push({ status, page, signal, resolve, reject });
        if (!ignoreAbort)
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
      });
    },
    fetchSubject: async () =>
      new DOMParser().parseFromString(
        '<div class="global_score"><span class="number">8.3</span></div><ul id="infobox"><li>放送开始: 2020-01-01</li><li>话数: 12</li></ul>',
        "text/html",
      ),
  };
  const session = new GachaSession(
    { userId: "test", subjectType: "anime", status: "wish" },
    { client },
  );
  const click = (selector) => document.querySelector(selector).click();
  return { dom, session, requests, click };
}

test("first load continues behind closed modal; reopening does not restart completed sync", async () => {
  const { dom, session, requests, click } = setup();
  click(".ark-gacha-launcher");
  await flush();
  assert.match(
    document.querySelector("#ark-gacha-progress").textContent,
    /同步 \[想看\] 第 1 页/,
  );
  click(".ark-gacha-mask");
  assert.equal(requests[0].signal.aborted, false);
  click(".ark-gacha-launcher");
  await flush();
  assert.equal(requests.length, 1);
  requests[0].resolve(empty);
  await flush();
  assert.equal(session.loaded, true);
  assert.ok(session.storage.getMeta("wish"));
  requests[1].resolve(empty);
  await flush();
  click(".ark-gacha-mask");
  click(".ark-gacha-launcher");
  await flush();
  assert.equal(requests.length, 2);
  dom.window.close();
});

test("stopping, reopening, and failed first load preserve retry semantics", async () => {
  const { dom, requests, click } = setup();
  click(".ark-gacha-launcher");
  await flush();
  click("#ark-gacha-stop");
  await flush();
  assert.equal(requests[0].signal.aborted, true);
  click(".ark-gacha-mask");
  click(".ark-gacha-launcher");
  await flush();
  assert.equal(requests.length, 2);
  requests[1].reject(new Error("network failure"));
  await flush();
  click(".ark-gacha-mask");
  click(".ark-gacha-launcher");
  await flush();
  assert.equal(requests.length, 3);
  click("#ark-gacha-stop");
  await flush();
  dom.window.close();
});

test("switching status cancels old sync and gives the new status progress", async () => {
  const { dom, requests, click, session } = setup();
  click(".ark-gacha-launcher");
  await flush();
  click('[data-status="do"]');
  await flush();
  assert.equal(requests[0].signal.aborted, true);
  assert.equal(requests[1].status, "do");
  assert.match(
    document.querySelector("#ark-gacha-progress").textContent,
    /同步 \[在看\] 第 1 页/,
  );
  requests[1].resolve(empty);
  await flush();
  assert.equal(session.storage.getMeta("wish"), null);
  assert.ok(session.storage.getMeta("do"));
  requests[2].resolve(empty);
  await flush();
  dom.window.close();
});

test("late validation cannot replace manual refresh progress", async () => {
  const { dom, requests, click } = setup({ ignoreAbort: true });
  click(".ark-gacha-launcher");
  await flush();
  requests[0].resolve(empty);
  await flush();
  click("#ark-gacha-refresh");
  await flush();
  assert.equal(requests[1].signal.aborted, true);
  requests[1].reject(new Error("late failure"));
  await flush();
  assert.match(
    document.querySelector("#ark-gacha-progress").textContent,
    /同步 \[想看\] 第 1 页/,
  );
  requests[2].resolve(empty);
  await flush();
  assert.match(
    document.querySelector("#ark-gacha-progress").textContent,
    /全量刷新完成/,
  );
  dom.window.close();
});

test("changed first page asks for confirmation; choosing cache retains the original items", async () => {
  const { dom, requests, click, session } = setup();
  const item = { id: "1", title: "第一部", link: "/subject/1", cover: "" };
  click(".ark-gacha-launcher");
  await flush();
  requests[0].resolve({ ...empty, items: [item] });
  await flush();
  requests[1].resolve({ ...empty, items: [{ ...item, title: "改名" }] });
  await flush();
  assert.equal(document.querySelector("#ark-gacha-confirm").hidden, false);
  click('[data-action="keep"]');
  assert.equal(session.storage.getItems("wish")[0].title, "第一部");
  dom.window.close();
});

test("real HTML list/score parsing and card interaction use actual selectors", async () => {
  const dom = environment();
  const list =
    '<ul id="browserItemList"><li class="item"><h3><a href="/subject/42">作品名</a></h3><img class="cover" src="/r/100/pic/cover.jpg"></li></ul><div class="p_edge">1 / 2</div>';
  const score =
    '<div id="ChartWarpper"><div class="global_score"><span class="number">8.3</span></div></div><ul id="infobox"><li>放送开始: 2020-01-01</li><li>话数: 12</li></ul>';
  const calls = [];
  const client = createBangumiClient({
    subjectType: "anime",
    userId: "test",
    transport: async (url) => {
      calls.push(url);
      return {
        ok: true,
        text: async () => (url.includes("subject") ? score : list),
      };
    },
  });
  const page = await client.fetchListPage("wish", 1);
  assert.equal(page.items[0].title, "作品名");
  assert.equal(page.pageInfo.totalPages, 2);
  const storage = new GachaStorage("test", "anime");
  const engine = new DrawEngine({ client, storage, subjectType: "anime" });
  const cards = await engine.cards(page.items, 1);
  assert.equal(cards[0].star, 6);
  const session = new GachaSession(
    { userId: "test", subjectType: "anime", status: "wish" },
    { storage, client },
  );
  let opened;
  dom.window.open = (url) => {
    opened = url;
    return {};
  };
  session.view.showCards(cards, 3);
  assert.match(document.querySelector(".ark-gacha-card").textContent, /作品名/);
  document.querySelector(".ark-gacha-card").click();
  assert.equal(opened, "https://bgm.tv/subject/42");
  assert.deepEqual(calls, ["/anime/list/test/wish", "/subject/42"]);
  dom.window.close();
});

test("generated IIFE starts on the supported route and does not duplicate launcher", async () => {
  const source = await readFile("src/index.user.js", "utf8");
  const dom = environment();
  dom.window.fetch = async () => ({
    ok: true,
    text: async () =>
      '<ul id="browserItemList"></ul><div class="p_edge">1 / 1</div>',
  });
  dom.window.eval(source);
  await flush();
  dom.window.eval(source);
  await flush();
  assert.equal(
    document.querySelectorAll('[data-bangumi-ark-gacha="launcher"]').length,
    1,
  );
  dom.window.close();
});
