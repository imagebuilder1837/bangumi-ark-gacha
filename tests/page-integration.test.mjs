import { test } from "node:test";
import assert from "node:assert/strict";
import { GachaSession } from "../src/gacha-session.mjs";
import { GachaStorage } from "../src/collection-cache.mjs";
import { createBangumiClient } from "../src/bangumi-client.mjs";
import { DrawEngine } from "../src/draw-engine.mjs";
import { environment, flush } from "./support/session.mjs";

test("real request adapter, session and DOM publish a complete state despite another state failing", async () => {
  const dom = environment();
  const requests = [];
  const client = createBangumiClient({
    subjectType: "anime",
    userId: "test",
    transport: (url, { signal }) =>
      new Promise((resolve) => {
        requests.push({ url, signal, resolve });
      }),
  });
  const session = new GachaSession(
    { userId: "test", subjectType: "anime", status: "wish" },
    { client },
  );
  document.querySelector('[data-status="all"]').click();
  await flush();
  const wish = requests.find(({ url }) => url.endsWith("/wish"));
  wish.resolve({
    ok: true,
    text: async () =>
      '<ul id="browserItemList"><li class="item"><h3><a href="/subject/42">新条目</a></h3></li></ul><div class="p_edge">1 / 1</div>',
  });
  await flush();
  const doing = requests.find(({ url }) => url.endsWith("/do"));
  doing.resolve({ ok: false, status: 500 });
  await flush();
  assert.equal(session.storage.getItems("wish")[0].id, "42");
  assert.equal(session.storage.getStatus("do"), null);
  assert.equal(document.querySelector("#ark-gacha-confirm").hidden, false);
  dom.window.close();
});

test("403 and 5xx surface a failure without starting an automatic session retry", async () => {
  for (const status of [403, 503]) {
    const dom = environment();
    const urls = [];
    const client = createBangumiClient({
      subjectType: "anime",
      userId: "test",
      transport: async (url) => {
        urls.push(url);
        return { ok: false, status };
      },
    });
    new GachaSession(
      { userId: "test", subjectType: "anime", status: "wish" },
      { client },
    ).open();
    await flush();
    assert.deepEqual(urls, ["/anime/list/test/wish"]);
    assert.equal(document.querySelector("#ark-gacha-confirm").hidden, false);
    dom.window.close();
  }
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
