import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { environment, flush } from "./support/session.mjs";

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
