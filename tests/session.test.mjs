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
  assert.equal(requests.length, 4, "list checks and updates share four slots");
  while (requests.some((request) => !request.handled) || requests.length < 5) {
    const next = requests.find((request) => !request.handled);
    if (next) {
      next.handled = true;
      next.resolve(
        next.status === "wish" ? page([item(1), item(2), item(3)]) : empty,
      );
    }
    await flush();
  }
  assert.equal(session.complete, true);
  assert.equal(session.pool.length, 3);
  dom.window.close();
});

test("manual refresh reuses a covering update instead of replacing it", async () => {
  const { dom, session, requests, click } = setup({ ignoreAbort: true });
  session.storage.commitStatus("wish", [item(1), item(2), item(3)], meta);
  click(".ark-gacha-launcher");
  await flush();
  requests[0].resolve(page([item(4)]));
  await flush();
  const old = requests[1];
  click("#ark-gacha-refresh");
  assert.equal(old.signal.aborted, false);
  assert.equal(requests.length, 2);
  old.resolve(page([item(4), item(5), item(6)]));
  await flush();
  assert.deepEqual(
    session.storage.getItems("wish").map(({ id }) => id),
    ["4", "5", "6"],
  );
  dom.window.close();
});

test("storage failure after all pages leaves old draw candidates and offers cache", async () => {
  const { dom, session, requests, click } = setup();
  const old = [item(1), item(2), item(3)];
  session.storage.commitStatus("wish", old, meta);
  const commit = session.storage.commitStatus.bind(session.storage);
  session.storage.commitStatus = (status, items, nextMeta) => {
    if (items.some(({ id }) => id === "4")) throw new Error("quota");
    commit(status, items, nextMeta);
  };
  click(".ark-gacha-launcher");
  await flush();
  requests[0].resolve(page([item(4)]));
  await flush();
  requests[1].resolve(page([item(4), item(5), item(6)]));
  await flush();
  assert.deepEqual(
    session.pool.map(({ id }) => id),
    ["1", "2", "3"],
  );
  assert.deepEqual(session.storage.getItems("wish"), old);
  assert.equal(document.querySelector("#ark-gacha-run-3").disabled, false);
  assert.ok(document.querySelector('[data-action="keep"]'));
  dom.window.close();
});

test("a published update cannot change a pending draw; late successful scores are cached after switching", async () => {
  const { dom, session, requests, click } = setup();
  const old = [item(1), item(2), item(3)];
  session.storage.commitStatus("wish", old, meta);
  const scores = [];
  session.client.fetchSubject = (id) =>
    new Promise((resolve) => scores.push({ id, resolve }));
  click(".ark-gacha-launcher");
  await flush();
  click("#ark-gacha-run-3");
  await flush();
  assert.equal(scores.length, 3);
  requests[0].resolve(page([item(4), item(5), item(6)]));
  await flush();
  requests[1].resolve(page([item(4), item(5), item(6)]));
  await flush();
  assert.equal(session.pool[0].id, "4");
  click('[data-status="do"]');
  await flush();
  for (const score of scores)
    score.resolve({
      score: 8,
      hasScore: true,
      date: "2020-01-01",
      totalEpisodes: 12,
      resolved: true,
      source: "subject",
    });
  await flush();
  assert.equal(document.querySelectorAll(".ark-gacha-card").length, 0);
  assert.equal(session.storage.getSubjectMeta("1").score, 8);
  requests.at(-1).resolve(empty);
  await flush();
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
  requests[1].resolve(empty);
  await flush();
  assert.equal(document.querySelectorAll(".ark-gacha-card").length, 0);
  dom.window.close();
});
