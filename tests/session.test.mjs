import { test } from "node:test";
import assert from "node:assert/strict";
import { setup, flush, empty } from "./support/session.mjs";

test("draw wait is driven by an injected browser timer", async () => {
  const { dom, session } = setup({
    browser: {
      setTimeout(callback, ms) {
        assert.equal(ms, 600);
        this.fire = callback;
        return 1;
      },
      clearTimeout() {},
    },
  });
  session.pool = [1, 2, 3].map((id) => ({
    id: String(id),
    title: `条目${id}`,
    link: `/subject/${id}`,
  }));
  const drawing = session.draw(3);
  assert.equal(document.querySelectorAll(".ark-gacha-card").length, 0);
  session.browser.fire();
  await drawing;
  assert.equal(document.querySelectorAll(".ark-gacha-card").length, 3);
  dom.window.close();
});

test("pagination wait uses the injected browser timer", async () => {
  const timer = {
    setTimeout(callback, ms) {
      assert.equal(ms, 350);
      this.fire = callback;
      return 1;
    },
    clearTimeout() {},
  };
  const { dom, requests, click } = setup({ browser: timer });
  click(".ark-gacha-launcher");
  await flush();
  requests[0].resolve({
    items: [{ id: "1", title: "首部", link: "/subject/1" }],
    pageInfo: { reliable: true, totalPages: 2 },
  });
  await flush();
  assert.equal(requests.length, 1);
  timer.fire();
  await flush();
  assert.equal(requests[1].page, 2);
  requests[1].resolve(empty);
  await flush();
  requests[2].resolve(empty);
  await flush();
  dom.window.close();
});

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

test("reopening during cached first-page validation retains its progress without another request", async () => {
  const { dom, requests, click } = setup();
  click(".ark-gacha-launcher");
  await flush();
  requests[0].resolve(empty);
  await flush();
  assert.equal(requests.length, 2);
  click(".ark-gacha-mask");
  click(".ark-gacha-launcher");
  await flush();
  assert.equal(requests.length, 2);
  assert.equal(requests[1].signal.aborted, false);
  assert.equal(
    document.querySelector("#ark-gacha-progress-wrap").hidden,
    false,
  );
  assert.match(
    document.querySelector("#ark-gacha-progress").textContent,
    /核验 \[想看\]/,
  );
  requests[1].resolve(empty);
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
