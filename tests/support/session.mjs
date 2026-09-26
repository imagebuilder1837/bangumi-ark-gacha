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
export function setup({ ignoreAbort = false, browser } = {}) {
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
    fetchSubject: async () => ({
      score: 8.3,
      hasScore: true,
      date: "2020-01-01",
      isPartial: false,
      totalEpisodes: 12,
      resolved: true,
      source: "subject",
    }),
  };
  const session = new GachaSession(
    { userId: "test", subjectType: "anime", status: "wish" },
    {
      client,
      browser: browser || {
        setTimeout: (fn) => {
          queueMicrotask(fn);
          return 1;
        },
        clearTimeout() {},
      },
    },
  );
  const click = (selector) => document.querySelector(selector).click();
  return { dom, session, requests, click };
}
