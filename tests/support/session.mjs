import { JSDOM } from "jsdom";
import { GachaSession } from "../../src/gacha-session.mjs";

export const flush = () => new Promise((resolve) => setImmediate(resolve));
export const empty = { items: [], pageInfo: { reliable: true, totalPages: 1 } };
export function environment() {
  const dom = new JSDOM(
    "<!doctype html><html><head></head><body></body></html>",
    { url: "https://bgm.tv/anime/list/test/wish", runScripts: "outside-only" },
  );
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.DOMParser = dom.window.DOMParser;
  dom.window.requestAnimationFrame = (callback) => {
    callback();
    return 1;
  };
  dom.window.cancelAnimationFrame = () => {};
  return dom;
}
export function setup({ ignoreAbort = false } = {}) {
  const dom = environment();
  const requests = [];
  const client = {
    fetchListPage(status, page, signal) {
      return new Promise((resolve, reject) => {
        requests.push({ status, page, signal, resolve, reject });
        if (!ignoreAbort)
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
      });
    },
    fetchSubject: async () =>
      new DOMParser().parseFromString(
        '<div class="global_score"><span class="number">8.3</span></div><ul id="infobox"><li>放送开始: 2020-01-01</li><li>话数: 12</li></ul>',
        "text/html",
      ),
  };
  const session = new GachaSession(
    { userId: "test", subjectType: "anime", status: "wish" },
    { client },
  );
  const click = (selector) => document.querySelector(selector).click();
  return { dom, session, requests, click };
}
