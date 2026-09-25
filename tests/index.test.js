const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Minimal DOM adapter: keep the real launcher/mask listeners and async sync flow.
class Element {
  constructor() {
    this.style = { removeProperty() {} };
    this.dataset = {};
    this.classList = { toggle() {} };
    this.listeners = {};
    this.children = new Map();
  }
  addEventListener(type, listener) { this.listeners[type] = listener; }
  click() { this.listeners.click?.({ target: this }); }
  appendChild() {}
  replaceChildren() {}
  querySelector(selector) {
    if (!this.children.has(selector)) this.children.set(selector, new Element());
    return this.children.get(selector);
  }
  querySelectorAll(selector) { return selector === '.ark-gacha-tab' ? (this.tabs ?? []) : []; }
}

function setup({ ignoreAbort = false } = {}) {
  const source = fs.readFileSync('src/index.user.js', 'utf8');
  const data = new Map();
  const context = vm.createContext({
    AbortController, DOMException, URL, console,
    window: {
      location: { pathname: '/anime/list/test/wish' },
      addEventListener() {}, requestAnimationFrame() { return 1; },
      cancelAnimationFrame() {}, setTimeout, clearTimeout,
    },
    document: {
      body: new Element(), head: new Element(),
      createElement: () => {
        const element = new Element();
        element.tabs = ['wish', 'do'].map((status) => {
          const tab = new Element();
          tab.dataset.status = status;
          return tab;
        });
        return element;
      }, querySelector: () => null,
    },
    localStorage: {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => data.set(key, value),
      removeItem: (key) => data.delete(key),
    },
  });
  // Expose the private class without changing the shipped userscript.
  vm.runInContext(source.replace('  waitForDom().then(() => {',
    '  globalThis.GachaApp = GachaApp; return;\n  waitForDom().then(() => {'), context);
  const app = new context.GachaApp({ userId: 'test', subjectType: 'anime', status: 'wish' });
  const requests = [];
  app.fetchListPage = (status, page, signal) => new Promise((resolve, reject) => {
    requests.push({ status, page, signal, resolve });
    if (!ignoreAbort) signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  });
  return { app, requests };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

test('reopening during initial sync keeps progress visible and the original request alive', async () => {
  const { app, requests } = setup();
  app.launcher.click();
  await flush();
  assert.match(app.ui.progress.textContent, /同步 \[想看\] 第 1 页/);
  assert.equal(app.ui.progressWrap.hidden, false);
  app.ui.mask.click();
  assert.equal(app.ui.mask.style.display, 'none');
  assert.equal(requests[0].signal.aborted, false, 'closing must not cancel sync');
  app.launcher.click();
  await flush();
  assert.equal(app.ui.mask.style.display, 'flex');
  assert.equal(app.ui.progressWrap.hidden, false, 'sync progress must remain visible after reopening');
  assert.equal(requests[0].signal.aborted, false, 'reopening must not restart sync');
  assert.equal(requests.length, 1);
  assert.equal(app.busy, true);
  requests[0].resolve({ items: [], pageInfo: { reliable: true, totalPages: 1 } });
  await flush();
  assert.equal(app.loaded, true);
  assert.equal(app.busy, false);
  assert.ok(app.storage.getMeta('wish'), 'background sync commits its cache');
  app.stopOperations(false);
  await flush();
  app.ui.mask.click();
  app.launcher.click();
  await flush();
  assert.equal(requests.length, 2, 'completed sync is not repeated on reopening');
});

test('stopping a sync keeps the modal idle and reopening retries unfinished status', async () => {
  const { app, requests } = setup();
  app.launcher.click();
  await flush();
  app.ui.stop.click();
  await flush();
  assert.equal(requests[0].signal.aborted, true);
  assert.equal(app.ui.progressWrap.hidden, true);
  assert.equal(app.ui.progress.textContent, '已停止当前操作');
  app.ui.mask.click();
  app.launcher.click();
  await flush();
  assert.equal(requests.length, 2);
  assert.equal(app.ui.progressWrap.hidden, false);
  assert.equal(app.ui.progress.textContent, '同步 [想看] 第 1 页...');
  requests[1].resolve({ items: [], pageInfo: { reliable: true, totalPages: 1 } });
  await flush();
  assert.equal(app.loaded, true);
  app.stopOperations(false);
  await flush();
});

test('reopening while cached first-page validation is running shows its progress', async () => {
  const { app, requests } = setup();
  app.launcher.click();
  await flush();
  requests[0].resolve({ items: [], pageInfo: { reliable: true, totalPages: 1 } });
  await flush();
  app.ui.mask.click();
  app.launcher.click();
  await flush();
  assert.equal(requests.length, 2, 'reopening does not restart first-page validation');
  assert.equal(requests[1].signal.aborted, false);
  assert.match(app.ui.progress.textContent, /核验 \[想看\] 最新第一页/);
  assert.equal(app.ui.progressWrap.hidden, false);
  app.ui.stop.click();
  await flush();
  assert.equal(requests[1].signal.aborted, true);
});

test('stale validation cannot hide the progress of a manual refresh', async () => {
  const { app, requests } = setup();
  app.launcher.click();
  await flush();
  requests[0].resolve({ items: [], pageInfo: { reliable: true, totalPages: 1 } });
  await flush();
  assert.equal(requests.length, 2, 'cached status begins first-page validation');
  app.ui.refresh.click();
  await flush();
  assert.equal(requests[1].signal.aborted, true);
  assert.equal(requests.length, 3);
  assert.equal(app.ui.progressWrap.hidden, false);
  assert.match(app.ui.progress.textContent, /同步 \[想看\] 第 1 页/);
  requests[2].resolve({ items: [], pageInfo: { reliable: true, totalPages: 1 } });
  await flush();
  assert.equal(app.ui.progressWrap.hidden, true);
  assert.equal(app.ui.progress.textContent, '✅ 全量刷新完成');
});

test('a late validation network failure cannot overwrite manual refresh progress', async () => {
  const { app, requests } = setup({ ignoreAbort: true });
  app.launcher.click();
  await flush();
  requests[0].resolve({ items: [], pageInfo: { reliable: true, totalPages: 1 } });
  await flush();
  app.ui.refresh.click();
  await flush();
  assert.equal(requests[1].signal.aborted, true);
  assert.equal(requests.length, 3);
  requests[1].resolve(Promise.reject(new Error('late network failure')));
  await flush();
  assert.match(app.ui.progress.textContent, /同步 \[想看\] 第 1 页/);
  assert.equal(app.ui.progressWrap.hidden, false);
  requests[2].resolve({ items: [], pageInfo: { reliable: true, totalPages: 1 } });
  await flush();
  assert.equal(app.ui.progress.textContent, '✅ 全量刷新完成');
});

test('switching tabs cancels old sync without hiding the new tab progress', async () => {
  const { app, requests } = setup();
  app.launcher.click();
  await flush();
  app.ui.mask.tabs[1].click();
  await flush();
  assert.equal(requests[0].signal.aborted, true);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].status, 'do');
  assert.equal(app.ui.progressWrap.hidden, false);
  assert.match(app.ui.progress.textContent, /同步 \[在看\] 第 1 页/);
  requests[1].resolve({ items: [], pageInfo: { reliable: true, totalPages: 1 } });
  await flush();
  assert.equal(app.loaded, true);
  assert.equal(app.storage.getMeta('wish'), null);
  assert.ok(app.storage.getMeta('do'));
  app.ui.stop.click();
  await flush();
});

test('a failed first sync can be retried by reopening without retaining the error UI', async () => {
  const { app, requests } = setup();
  app.launcher.click();
  await flush();
  requests[0].resolve(Promise.reject(new Error('network failure')));
  await flush();
  assert.equal(app.ui.progressWrap.hidden, true);
  app.ui.mask.click();
  app.launcher.click();
  await flush();
  assert.equal(app.ui.progressWrap.hidden, false);
  assert.equal(requests.length, 2);
  app.ui.stop.click();
  await flush();
});
