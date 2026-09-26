import { GachaSession } from "./gacha-session.mjs";
import { GachaStorage } from "./collection-cache.mjs";
import { createBangumiClient } from "./bangumi-client.mjs";
import { STATUS_IDS } from "./shared.mjs";
const ROUTE_RE =
  /\/(anime|book|game|real|music)\/list\/([^/]+)(?:\/([^/]+))?(?:\/|$)/;
function start() {
  const match = window.location.pathname.match(ROUTE_RE);
  if (!match) return;
  const route = {
    subjectType: match[1],
    userId: match[2],
    status: STATUS_IDS.includes(match[3]) ? match[3] : "wish",
  };
  waitForDom().then(() => {
    if (
      !document.body ||
      document.body.querySelector('[data-bangumi-ark-gacha="launcher"]')
    )
      return;
    const browser = {
      origin: window.location.origin,
      parse: (html) => new DOMParser().parseFromString(html, "text/html"),
      setTimeout: (fn, ms) => window.setTimeout(fn, ms),
      clearTimeout: (id) => window.clearTimeout(id),
    };
    new GachaSession(route, {
      storage: new GachaStorage(route.userId, route.subjectType),
      client: createBangumiClient({ ...route, browser }),
      browser,
    });
  });
}
function waitForDom() {
  if (document.body) return Promise.resolve();
  return new Promise((resolve) => {
    const started = Date.now();
    const check = () => {
      if (document.body || Date.now() - started > 10000) {
        resolve();
        return;
      }
      window.setTimeout(check, 50);
    };
    check();
  });
}

start();
