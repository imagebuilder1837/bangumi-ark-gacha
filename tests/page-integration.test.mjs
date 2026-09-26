import { test } from "node:test";
import assert from "node:assert/strict";
import { GachaSession } from "../src/gacha-session.mjs";
import { GachaStorage } from "../src/collection-cache.mjs";
import { createBangumiClient } from "../src/bangumi-client.mjs";
import { DrawEngine } from "../src/draw-engine.mjs";
import { environment } from "./support/session.mjs";

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
