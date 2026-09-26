import { test } from "node:test";
import assert from "node:assert/strict";
import { setup, flush, empty } from "./support/session.mjs";
import { STATUS_IDS } from "../src/shared.mjs";

const item = (id) => ({
  id: String(id),
  title: `条目${id}`,
  link: `/subject/${id}`,
  cover: "",
});
const page = (items, totalPages = 1, reliable = true) => ({
  items,
  pageInfo: { totalPages, reliable },
});
const ids = (session, status) =>
  session.storage.getItems(status)?.map(({ id }) => id);
const meta = { fingerprint: "[]", totalPages: 1 };

async function settle(requests, status, result = empty) {
  const request = requests.find((r) => r.status === status && !r.handled);
  assert.ok(request, `expected ${status} request`);
  request.handled = true;
  request.resolve(result);
  await flush();
}

test("known pages run concurrently, failed page cancels siblings and preserves cached data", async () => {
  const { dom, session, requests, click } = setup({ ignoreAbort: true });
  session.storage.commitStatus("wish", [item(1), item(2), item(3)], meta);
  click(".ark-gacha-launcher");
  await flush();
  await settle(requests, "wish", page([item(4)]));
  await settle(requests, "wish", page([item(4)], 5));
  assert.deepEqual(
    requests.slice(2).map(({ page }) => page),
    [2, 3, 4, 5],
  );
  requests[2].reject(new Error("HTTP 403"));
  await flush();
  assert.ok(requests[3].signal.aborted);
  requests[3].resolve(page([item(5)], 5));
  requests[4].resolve(page([item(6)], 5));
  requests[5].resolve(page([item(7)], 5));
  await flush();
  assert.deepEqual(ids(session, "wish"), ["1", "2", "3"]);
  assert.ok(document.querySelector('[data-action="keep"]'));
  dom.window.close();
});

test("unknown pagination discovers denominator atomically, counts terminal empty page", async () => {
  const { dom, session, requests, click } = setup();
  click(".ark-gacha-launcher");
  await flush();
  assert.match(
    document.querySelector("#ark-gacha-progress").textContent,
    /0\/1/,
  );
  const seen = [];
  const progressNode = document.querySelector("#ark-gacha-progress");
  const observer = new dom.window.MutationObserver(() =>
    seen.push(progressNode.textContent),
  );
  observer.observe(progressNode, {
    childList: true,
    characterData: true,
    subtree: true,
  });
  await settle(requests, "wish", page([item(1)], 1, false));
  assert.match(
    document.querySelector("#ark-gacha-progress").textContent,
    /1\/2/,
  );
  assert.equal(requests[1].page, 2);
  await settle(requests, "wish", page([item(2)], 1, false));
  assert.ok(
    !seen.some((message) => /2\/2 页/.test(message)),
    "no transient completed denominator",
  );
  assert.match(
    document.querySelector("#ark-gacha-progress").textContent,
    /2\/3/,
  );
  await settle(requests, "wish", page([], 1, false));
  assert.deepEqual(ids(session, "wish"), ["1", "2"]);
  assert.equal(requests.length, 3);
  observer.disconnect();
  dom.window.close();
});

test("without foreground work progress follows the most recently updated background task", async () => {
  const { dom, requests, click } = setup();
  click(".ark-gacha-launcher");
  await flush();
  click('[data-status="do"]');
  await flush();
  click('[data-status="collect"]');
  await flush();
  await settle(requests, "collect");
  await settle(requests, "do", page([item(2)], 1, false));
  await settle(requests, "wish", page([item(1)], 1, false));
  assert.match(
    document.querySelector("#ark-gacha-progress").textContent,
    /想看.*1\/2/,
  );
  await settle(requests, "do", page([item(3)], 1, false));
  assert.match(
    document.querySelector("#ark-gacha-progress").textContent,
    /在看.*2\/3/,
  );
  dom.window.close();
});

test("independent wish survives failure of all; only all-owned states cancel", async () => {
  const { dom, session, requests, click } = setup();
  click(".ark-gacha-launcher");
  await flush();
  click('[data-status="all"]');
  await flush();
  assert.equal(requests.filter((r) => r.status === "wish").length, 1);
  const doRequest = requests.find((r) => r.status === "do");
  doRequest.reject(new Error("HTTP 500"));
  await flush();
  assert.equal(requests[0].signal.aborted, false);
  assert.equal(document.querySelector("#ark-gacha-confirm").hidden, false);
  assert.ok(
    requests
      .filter((r) => !["wish", "do"].includes(r.status))
      .every((r) => r.signal.aborted),
  );
  await settle(requests, "wish", page([item(1)]));
  assert.deepEqual(ids(session, "wish"), ["1"]);
  dom.window.close();
});

test("selecting an all-owned state independently keeps it alive after another fails", async () => {
  const { dom, session, requests, click } = setup();
  click('[data-status="all"]');
  await flush();
  click('[data-status="wish"]');
  await flush();
  requests.find((r) => r.status === "do").reject(new Error("offline"));
  await flush();
  assert.equal(requests.find((r) => r.status === "wish").signal.aborted, false);
  assert.equal(document.querySelector("#ark-gacha-confirm").hidden, true);
  await settle(requests, "wish", page([item(1)]));
  assert.deepEqual(ids(session, "wish"), ["1"]);
  dom.window.close();
});

test("a reused independent task failing invalidates all and cancels all-only siblings", async () => {
  const { dom, requests, click } = setup();
  click(".ark-gacha-launcher");
  await flush();
  click('[data-status="all"]');
  await flush();
  requests.find((r) => r.status === "wish").reject(new Error("offline"));
  await flush();
  assert.ok(
    requests.filter((r) => r.status !== "wish").every((r) => r.signal.aborted),
  );
  assert.equal(document.querySelector("#ark-gacha-confirm").hidden, false);
  dom.window.close();
});

test("background failure does not interrupt current scope or reappear on switch", async () => {
  const { dom, requests, click } = setup();
  click(".ark-gacha-launcher");
  await flush();
  click('[data-status="do"]');
  await flush();
  requests[0].reject(new Error("offline"));
  await flush();
  assert.equal(document.querySelector("#ark-gacha-confirm").hidden, true);
  click('[data-status="wish"]');
  await flush();
  assert.equal(document.querySelector("#ark-gacha-confirm").hidden, true);
  assert.equal(requests.filter((r) => r.status === "wish").length, 2);
  dom.window.close();
});

test("429 cancels independent background tasks, but manual refresh can resume", async () => {
  const { dom, session, requests, click } = setup();
  click(".ark-gacha-launcher");
  await flush();
  click('[data-status="do"]');
  await flush();
  requests.find((r) => r.status === "wish").reject(new Error("HTTP 429"));
  await flush();
  assert.ok(requests.find((r) => r.status === "do").signal.aborted);
  click("#ark-gacha-refresh");
  await flush();
  assert.equal(requests.filter((r) => r.status === "do").length, 2);
  await settle(requests.slice(2), "do");
  assert.deepEqual(ids(session, "do"), []);
  dom.window.close();
});

test("background 429 after foreground completion does not prompt a different scope", async () => {
  const { dom, requests, click } = setup();
  click(".ark-gacha-launcher");
  await flush();
  click('[data-status="do"]');
  await flush();
  await settle(requests, "do");
  requests[0].reject(new Error("HTTP 429"));
  await flush();
  assert.equal(document.querySelector("#ark-gacha-confirm").hidden, true);
  dom.window.close();
});

test("completed states remain published when a later all dependency fails", async () => {
  const { dom, session, requests, click } = setup();
  for (const status of STATUS_IDS)
    session.storage.commitStatus(status, [item(1)], meta);
  click('[data-status="all"]');
  click("#ark-gacha-refresh");
  await flush();
  await settle(requests, "wish", page([item(2)]));
  requests.find((r) => r.status === "do").reject(new Error("offline"));
  await flush();
  assert.deepEqual(ids(session, "wish"), ["2"]);
  assert.ok(document.querySelector('[data-action="keep"]'));
  dom.window.close();
});
