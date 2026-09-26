import { test } from "node:test";
import assert from "node:assert/strict";
import { setup, flush, empty } from "./support/session.mjs";
import { STATUS_IDS } from "../src/shared.mjs";

const item = (id, title = `条目${id}`) => ({
  id: String(id),
  title,
  link: `/subject/${id}`,
  cover: "",
});
const page = (items, totalPages = 1) => ({
  items,
  pageInfo: { reliable: true, totalPages },
});
const meta = { fingerprint: "[]", totalPages: 1 };

test("cached items can be drawn while a changed first page updates in the background", async () => {
  const { dom, session, requests, click } = setup();
  session.storage.commitStatus("wish", [item(1), item(2), item(3)], meta);
  click(".ark-gacha-launcher");
  await flush();
  assert.equal(document.querySelector("#ark-gacha-run-3").disabled, false);
  requests[0].resolve(page([item(4)], 2));
  await flush();
  assert.equal(document.querySelector("#ark-gacha-confirm").hidden, true);
  assert.equal(document.querySelector("#ark-gacha-run-3").disabled, false);
  click("#ark-gacha-run-3");
  await flush();
  assert.equal(document.querySelectorAll(".ark-gacha-card").length, 3);
  assert.deepEqual(
    session.storage.getItems("wish").map((x) => x.id),
    ["1", "2", "3"],
  );
  requests[1].reject(new Error("offline"));
  await flush();
  assert.equal(document.querySelectorAll(".ark-gacha-card").length, 3);
  assert.equal(document.querySelector("#ark-gacha-run-3").disabled, false);
  assert.equal(document.querySelector('[data-action="keep"]') !== null, true);
  dom.window.close();
});

test("missing scope has no keep option; reopening a loaded view does not recheck", async () => {
  const { dom, requests, click } = setup();
  click(".ark-gacha-launcher");
  await flush();
  click(".ark-gacha-mask");
  click(".ark-gacha-launcher");
  assert.equal(requests.length, 1);
  requests[0].reject(new Error("offline"));
  await flush();
  assert.equal(document.querySelector('[data-action="keep"]'), null);
  assert.ok(document.querySelector('[data-action="refresh"]'));
  click('[data-action="refresh"]');
  await flush();
  assert.equal(requests.length, 2);
  requests[1].resolve(empty);
  await flush();
  assert.ok(document.querySelector("#ark-gacha-refresh"));
  dom.window.close();
});

test("all needs five complete statuses; empty counts as complete and publication is per status", async () => {
  const { dom, session, requests, click } = setup();
  for (const status of STATUS_IDS.slice(1))
    session.storage.commitStatus(status, [], meta);
  click('[data-status="all"]');
  await flush();
  assert.equal(session.complete, false);
  const missing = requests.find((request) => request.status === "wish");
  missing.resolve(page([item(1), item(2), item(3)]));
  await flush();
  assert.equal(session.complete, true);
  assert.equal(session.pool.length, 3);
  dom.window.close();
});

test("status switch retains old fetch and prevents late draw from replacing new view", async () => {
  const { dom, session, requests, click } = setup();
  session.storage.commitStatus("wish", [item(1), item(2), item(3)], meta);
  click(".ark-gacha-launcher");
  await flush();
  click("#ark-gacha-run-3");
  click('[data-status="do"]');
  await flush();
  assert.equal(requests[0].signal.aborted, false);
  assert.equal(requests[1].status, "do");
  requests[0].resolve(empty);
  requests[1].resolve(empty);
  await flush();
  assert.equal(document.querySelectorAll(".ark-gacha-card").length, 0);
  dom.window.close();
});
