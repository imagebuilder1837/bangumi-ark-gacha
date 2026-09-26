import { test } from "node:test";
import assert from "node:assert/strict";
import { setup, flush, empty } from "./support/session.mjs";

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
