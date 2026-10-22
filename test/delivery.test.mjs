import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { environment, flush } from "./support/session.mjs";
import { GachaStorage } from "../src/collection-cache.mjs";

const item = (id) => ({
  id: String(id),
  title: `旧条目${id}`,
  link: `/subject/${id}`,
  cover: "",
});

test("generated IIFE draws from IndexedDB while a changed first page is reused for a background update", async () => {
  const source = await readFile("src/index.user.js", "utf8");
  const dom = environment();
  const storage = new GachaStorage("test", "anime");
  await storage.commitStatus("wish", [1, 2, 3].map(item), {
    fingerprint: "old",
    totalPages: 1,
  });
  const requests = [];
  let releaseUpdate;
  const updateGate = new Promise((resolve) => {
    releaseUpdate = resolve;
  });
  const list = (ids) =>
    `<ul id="browserItemList">${ids.map((id) => `<li class="item"><h3><a href="/subject/${id}">新条目${id}</a></h3></li>`).join("")}</ul><div class="p_edge">1 / 2</div>`;
  dom.window.fetch = async (url) => {
    requests.push(url);
    const second = url.includes("?page=2");
    if (second) await updateGate;
    return {
      ok: true,
      text: async () =>
        url.startsWith("/subject/")
          ? `<div id="headerSubject"><h1><a href="${url}">作品</a></h1></div><div class="global_score"><span class="number">8.3</span></div><ul id="infobox"><li>放送开始: 2020-01-01</li><li>话数: 12</li></ul>`
          : list(second ? [3] : [1, 2]).replace(
              "1 / 2",
              second ? "2 / 2" : "1 / 2",
            ),
    };
  };
  dom.window.eval(source);
  await flush();
  document.querySelector(".ark-gacha-launcher").click();
  await flush();
  assert.equal(document.querySelector("#ark-gacha-run-3").disabled, false);
  document.querySelector("#ark-gacha-run-3").click();
  await new Promise((resolve) => setTimeout(resolve, 750));
  assert.equal(document.querySelectorAll(".ark-gacha-card").length, 3);
  assert.match(document.querySelector(".ark-gacha-card").textContent, /旧条目/);
  releaseUpdate();
  await flush();
  const reopened = new GachaStorage("test", "anime");
  await reopened.loadStatuses(["wish"]);
  assert.equal(reopened.getItems("wish")[0].title, "新条目1");
  document.querySelector("#ark-gacha-run-3").click();
  await new Promise((resolve) => setTimeout(resolve, 750));
  assert.match(document.querySelector(".ark-gacha-card").textContent, /新条目/);
  assert.match(
    document.querySelector(".ark-gacha-card").textContent,
    /评分：8.3/,
  );
  assert.equal(requests.filter((url) => url.startsWith("/subject/")).length, 3);
  assert.deepEqual(
    requests.filter((url) => url.startsWith("/anime/")),
    ["/anime/list/test/wish", "/anime/list/test/wish?page=2"],
  );
  assert.equal(dom.window.localStorage.length, 0);
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
