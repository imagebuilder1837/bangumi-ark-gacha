import { test } from "node:test";
import assert from "node:assert/strict";
import { PageScheduler } from "../src/page-scheduler.mjs";
import { createBangumiClient } from "../src/bangumi-client.mjs";
import { browser } from "./support/browser.mjs";
import { flush } from "./support/session.mjs";

function fixture() {
  const requests = [];
  const scheduler = new PageScheduler({
    fetchListPage(status, page, signal) {
      return new Promise((resolve) =>
        requests.push({ status, page, signal, resolve }),
      );
    },
  });
  return { scheduler, requests };
}

test("four slots are shared; foreground in flight reserves idle slots and background resumes", async () => {
  const { scheduler, requests } = fixture();
  const controls = Array.from({ length: 6 }, () => new AbortController());
  scheduler.setForeground(["wish"]);
  const pending = controls.map((control, i) =>
    scheduler.request(i ? "do" : "wish", i + 1, control.signal),
  );
  await flush();
  assert.deepEqual(
    requests.map(({ status }) => status),
    ["wish"],
  );
  requests[0].resolve("wish done");
  await flush();
  assert.equal(requests.length, 5);
  controls[5].abort();
  await assert.rejects(pending[5], /Abort/);
  for (const request of requests.slice(1)) request.resolve("done");
  await Promise.all(pending.slice(0, 5));
  await flush();
  assert.equal(requests.length, 5, "cancelled queued requests never dispatch");
});

test("background work resumes by task creation, not a status's earlier history", async () => {
  const { scheduler, requests } = fixture();
  const controls = Array.from({ length: 4 }, () => new AbortController());
  const oldWish = scheduler.request("wish", 1, controls[0].signal);
  await flush();
  requests[0].resolve("done");
  await oldWish;
  await flush();

  scheduler.setForeground(["collect"]);
  const collect = scheduler.request("collect", 1, controls[1].signal);
  const doing = scheduler.request("do", 1, controls[2].signal);
  const newWish = scheduler.request("wish", 1, controls[3].signal);
  await flush();
  assert.deepEqual(
    requests.map(({ status }) => status),
    ["wish", "collect"],
  );
  scheduler.setForeground([]);
  await flush();
  assert.deepEqual(
    requests.map(({ status }) => status),
    ["wish", "collect", "do", "wish"],
  );
  requests.slice(1).forEach((request) => request.resolve("done"));
  await Promise.all([collect, doing, newWish]);
});

test("a replacement task cannot inherit priority from its canceled in-flight predecessor", async () => {
  const { scheduler, requests } = fixture();
  const controls = Array.from({ length: 4 }, () => new AbortController());
  const oldWish = scheduler.request("wish", 1, controls[0].signal);
  await flush();
  scheduler.setForeground(["collect"]);
  const collect = scheduler.request("collect", 1, controls[1].signal);
  const doing = scheduler.request("do", 1, controls[2].signal);
  controls[0].abort();
  await assert.rejects(oldWish, /Abort/);
  const newWish = scheduler.request("wish", 1, controls[3].signal);
  await flush();
  scheduler.setForeground([]);
  await flush();
  assert.deepEqual(
    requests.map(({ status }) => status),
    ["wish", "collect", "do", "wish"],
  );
  requests.forEach((request) => request.resolve("done"));
  await Promise.all([collect, doing, newWish]);
});

test("an uncooperative transport keeps its slot until the aborted request settles", async () => {
  const { scheduler, requests } = fixture();
  const controls = Array.from({ length: 5 }, () => new AbortController());
  const pending = controls.map((control, page) =>
    scheduler.request("wish", page + 1, control.signal),
  );
  await flush();
  assert.equal(requests.length, 4);
  controls[0].abort();
  await assert.rejects(pending[0], /Abort/);
  await flush();
  assert.equal(requests.length, 4);
  requests[0].resolve("late");
  await flush();
  assert.equal(requests.length, 5);
  requests.slice(1).forEach((request) => request.resolve("done"));
  await Promise.all(pending.slice(1));
});

test("queued list pages do not start their HTTP timeout until dispatch", async () => {
  const dom = browser();
  const timers = new Map();
  const dispatched = [];
  let nextTimer = 0;
  const client = createBangumiClient({
    subjectType: "anime",
    userId: "test",
    browser: {
      origin: "https://bgm.tv",
      parse: (html) =>
        new dom.window.DOMParser().parseFromString(html, "text/html"),
      setTimeout(fn, ms) {
        assert.equal(ms, 10000);
        const id = ++nextTimer;
        timers.set(id, fn);
        return id;
      },
      clearTimeout(id) {
        timers.delete(id);
      },
    },
    transport: (url, { signal }) =>
      new Promise((resolve, reject) => {
        dispatched.push({ url, resolve });
        signal.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        });
      }),
  });
  const scheduler = new PageScheduler(client, 1);
  const control = new AbortController();
  const first = scheduler.request("wish", 1, control.signal);
  const second = scheduler.request("wish", 2, control.signal);
  await flush();
  assert.equal(dispatched.length, 1);
  assert.equal(timers.size, 1);
  dispatched[0].resolve({
    ok: true,
    text: async () => '<ul id="browserItemList"></ul>',
  });
  await first;
  await flush();
  assert.equal(dispatched.length, 2);
  assert.equal(timers.size, 1);
  timers.values().next().value();
  await assert.rejects(second, /请求超时/);
  dom.window.close();
});

test("scheduler requests fresh list pages without using the browser cache", async () => {
  const dom = browser();
  const cacheModes = [];
  const client = createBangumiClient({
    subjectType: "anime",
    userId: "test",
    transport: async (_url, { cache }) => {
      cacheModes.push(cache);
      return { ok: true, text: async () => '<ul id="browserItemList"></ul>' };
    },
  });
  const scheduler = new PageScheduler(client);
  await scheduler.request("wish", 1, new AbortController().signal);
  assert.deepEqual(cacheModes, ["no-store"]);
  dom.window.close();
});

test("switching priority does not cancel old in-flight work and lifts queued work", async () => {
  const { scheduler, requests } = fixture();
  const controller = new AbortController();
  scheduler.setForeground(["wish"]);
  const pending = scheduler.request("wish", 1, controller.signal);
  await flush();
  scheduler.setForeground(["do"]);
  const next = scheduler.request("do", 1, controller.signal);
  await flush();
  assert.deepEqual(
    requests.map(({ status }) => status),
    ["wish", "do"],
  );
  assert.equal(requests[0].signal.aborted, false);
  requests.forEach((request) => request.resolve("ok"));
  await Promise.all([pending, next]);
});
