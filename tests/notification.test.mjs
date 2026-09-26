import { test } from "node:test";
import assert from "node:assert/strict";
import { setup, flush, empty } from "./support/session.mjs";

function clock() {
  let time = 0;
  const timers = [];
  return {
    browser: {
      setTimeout(fn, ms) {
        timers.push({ fn, at: time + ms });
        return timers.length;
      },
      clearTimeout() {},
    },
    advance(ms) {
      time += ms;
      while (timers.some((timer) => timer.at <= time)) {
        const index = timers.findIndex((timer) => timer.at <= time);
        timers.splice(index, 1)[0].fn();
      }
    },
  };
}

test("completion notices show FIFO for five seconds each, login overlays without pausing", async () => {
  const timer = clock();
  const { dom, session, requests, click } = setup({ browser: timer.browser });
  click('[data-status="all"]');
  await flush();
  requests.find((r) => r.status === "wish").resolve(empty);
  requests.find((r) => r.status === "collect").resolve(empty);
  await flush();
  const progress = () =>
    document.querySelector("#ark-gacha-progress").textContent;
  assert.match(progress(), /想看.*完成/);
  session.view.setLoginNotice("请先登录 Bangumi");
  timer.advance(5000);
  assert.equal(progress(), "请先登录 Bangumi");
  session.view.setLoginNotice(null);
  assert.match(progress(), /看过.*完成/);
  timer.advance(5000);
  assert.match(progress(), /\d+\/\d+ 页/);
  dom.window.close();
});
