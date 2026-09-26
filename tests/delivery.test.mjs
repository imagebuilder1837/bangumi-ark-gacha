import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { environment, flush } from "./support/session.mjs";
import { GachaStorage } from "../src/collection-cache.mjs";

test("generated IIFE validates changed cache, refreshes and renders drawn cards", async () => {
  const source = await readFile("src/index.user.js", "utf8");
  const dom = environment();
  const storage = new GachaStorage("test", "anime");
  storage.commitStatus(
    "wish",
    [{ id: "1", title: "旧条目", link: "/subject/1", cover: "" }],
    { fingerprint: "old" },
  );
  const requests = [];
  const list = (title) =>
    `<ul id="browserItemList">${[1, 2, 3].map((id) => `<li class="item"><h3><a href="/subject/${id}">${title}${id}</a></h3></li>`).join("")}</ul><div class="p_edge">1 / 1</div>`;
  dom.window.fetch = async (url) => {
    requests.push(url);
    return {
      ok: true,
      text: async () =>
        url.startsWith("/subject/")
          ? '<div class="global_score"><span class="number">8.3</span></div><ul id="infobox"><li>放送开始: 2020-01-01</li><li>话数: 12</li></ul>'
          : list("新条目"),
    };
  };
  dom.window.eval(source);
  await flush();
  document.querySelector(".ark-gacha-launcher").click();
  await flush();
  assert.equal(document.querySelector("#ark-gacha-confirm").hidden, false);
  document.querySelector('[data-action="refresh"]').click();
  await flush();
  assert.equal(storage.getItems("wish").length, 3);
  document.querySelector("#ark-gacha-run-3").click();
  await new Promise((resolve) => setTimeout(resolve, 700));
  assert.equal(document.querySelectorAll(".ark-gacha-card").length, 3);
  assert.match(document.querySelector(".ark-gacha-card").textContent, /新条目/);
  assert.match(
    document.querySelector(".ark-gacha-card").textContent,
    /评分：8.3/,
  );
  assert.equal(requests.filter((url) => url.startsWith("/subject/")).length, 3);
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
