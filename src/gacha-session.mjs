import {
  STATUS_IDS,
  statusLabelsFor,
  uniqueItems,
  firstPageFingerprint,
  firstPageSnapshot,
} from "./shared.mjs";
import { GachaStorage } from "./collection-cache.mjs";
import { createBangumiClient } from "./bangumi-client.mjs";
import { DrawEngine } from "./draw-engine.mjs";
import { GachaView } from "./gacha-view.mjs";

const MAX_FALLBACK_PAGES = 10000;
function sleep(ms, browser) {
  return new Promise((resolve) => browser.setTimeout(resolve, ms));
}

export class GachaSession {
  constructor(
    appRoute,
    {
      storage,
      client,
      now = Date.now,
      random = Math.random,
      createView = (session) => new GachaView(session),
      browser = {
        origin: window.location.origin,
        parse: (html) => new DOMParser().parseFromString(html, "text/html"),
        setTimeout: (fn, ms) => window.setTimeout(fn, ms),
        clearTimeout: (id) => window.clearTimeout(id),
      },
    } = {},
  ) {
    this.userId = appRoute.userId;
    this.subjectType = appRoute.subjectType;
    this.currentStatus = appRoute.status;
    this.statusLabels = statusLabelsFor(this.subjectType);
    this.storage = storage || new GachaStorage(this.userId, this.subjectType);
    this.client = client || createBangumiClient({ ...appRoute, browser });
    this.now = now;
    this.browser = browser;
    this.engine = new DrawEngine({
      storage: this.storage,
      client: this.client,
      subjectType: this.subjectType,
      now,
      random,
    });
    this.pool = [];
    this.complete = false;
    this.loaded = false;
    this.busy = false; // drawing only
    this.selectionId = 0;
    this.tasks = new Map();
    this.checking = new Set();
    this.checkGeneration = new Map();
    this.view = createView(this);
  }

  targetStatuses() {
    return this.currentStatus === "all"
      ? [...STATUS_IDS]
      : [this.currentStatus];
  }
  refreshPool() {
    const statuses = this.targetStatuses();
    this.complete = statuses.every(
      (status) => this.storage.getStatus(status) !== null,
    );
    this.pool = this.complete
      ? uniqueItems(statuses.flatMap((status) => this.storage.getItems(status)))
      : [];
    this.view.updateInfo();
    this.view.updateButtons();
  }
  open() {
    if (!this.loaded) this.loadView();
  }
  selectStatus(status) {
    if (
      (!STATUS_IDS.includes(status) && status !== "all") ||
      status === this.currentStatus
    )
      return;
    ++this.selectionId;
    this.busy = false;
    this.currentStatus = status;
    this.view.selectStatus(status);
    this.view.hideConfirm();
    this.view.setResultMessage("读取本地缓存中...");
    this.loaded = false;
    this.loadView();
  }
  loadView() {
    this.loaded = true;
    this.refreshPool();
    this.view.setResultMessage(
      this.complete
        ? this.pool.length
          ? "数据已就绪，选择三连或十连开始抽卡"
          : "该收藏状态暂无条目"
        : "正在获取收藏数据...",
    );
    const selection = this.selectionId;
    for (const status of this.targetStatuses()) {
      if (!this.storage.getStatus(status)) this.startTask(status, selection);
      else this.checkStatus(status, selection);
    }
  }
  async checkStatus(status, selection) {
    if (this.checking.has(status) || this.tasks.has(status)) return;
    this.checking.add(status);
    const generation = this.checkGeneration.get(status) || 0;
    const controller = new AbortController();
    try {
      this.view.setProgressVisible(true);
      this.view.setStatus(`核验 [${this.statusLabels[status]}] 最新第一页...`);
      const remote = await this.client.fetchListPage(
        status,
        1,
        controller.signal,
        true,
      );
      const meta = this.storage.getMeta(status);
      if (generation !== (this.checkGeneration.get(status) || 0)) return;
      if (meta && firstPageFingerprint(remote.items) !== meta.fingerprint)
        this.startTask(status, selection);
      else if (selection === this.selectionId)
        this.view.setStatus("✅ 最新第一页核验完成");
    } catch (error) {
      if (generation === (this.checkGeneration.get(status) || 0))
        this.reportFailure(status, selection, error);
    } finally {
      this.checking.delete(status);
      if (!this.tasks.size && !this.checking.size)
        this.view.setProgressVisible(false);
    }
  }
  startTask(status, selection = this.selectionId) {
    if (this.tasks.has(status)) return this.tasks.get(status).promise;
    this.checkGeneration.set(
      status,
      (this.checkGeneration.get(status) || 0) + 1,
    );
    const controller = new AbortController();
    const task = { controller, selection, promise: null };
    this.tasks.set(status, task);
    this.view.setProgressVisible(true);
    task.promise = (async () => {
      try {
        const result = await this.fetchAllStatus(status, controller.signal);
        if (controller.signal.aborted) return;
        this.storage.commitStatus(status, result.items, {
          version: 2,
          totalPages: result.totalPages,
          fingerprint: result.snapshot.fingerprint,
          firstPage: result.snapshot.items,
          checkedAt: this.now(),
          updatedAt: this.now(),
        });
        this.refreshPool();
        if (this.targetStatuses().includes(status)) {
          this.view.setStatus(`✅ [${this.statusLabels[status]}] 全量更新完成`);
          if (this.view.hasResultMessage())
            this.view.setResultMessage(
              this.complete
                ? this.pool.length
                  ? "数据已就绪，选择三连或十连开始抽卡"
                  : "该收藏状态暂无条目"
                : "正在获取收藏数据...",
            );
        }
      } catch (error) {
        if (error.name !== "AbortError")
          this.reportFailure(status, task.selection, error);
      } finally {
        if (this.tasks.get(status) === task) this.tasks.delete(status);
        if (!this.tasks.size && !this.checking.size)
          this.view.setProgressVisible(false);
      }
    })();
    return task.promise;
  }
  reportFailure(status, selection, error) {
    this.view.addLog(
      `[${this.statusLabels[status]}] 获取失败：${error.message}`,
      true,
    );
    if (
      selection !== this.selectionId ||
      !this.targetStatuses().includes(status)
    )
      return;
    this.refreshPool();
    this.loaded = false;
    this.view.setStatus("获取失败，已保留旧缓存", true);
    this.view.showFailure(this.complete);
  }
  async fetchAllStatus(status, signal) {
    const name = this.statusLabels[status];
    this.view.setStatus(`同步 [${name}] 第 1 页...`);
    const first = await this.client.fetchListPage(status, 1, signal, true);
    const allItems = [...first.items];
    const signatures = new Set([firstPageFingerprint(first.items)]);
    const { totalPages, reliable } = first.pageInfo;
    if (!Number.isInteger(totalPages) || totalPages < 1)
      throw new Error("分页数据无效");
    let page = 2;
    const bound = reliable ? totalPages : MAX_FALLBACK_PAGES;
    while (page <= bound && (reliable || first.items.length)) {
      if (signal.aborted) return;
      await sleep(350, this.browser);
      if (signal.aborted) return;
      this.view.setStatus(
        `同步 [${name}] 第 ${page}${reliable ? `/${totalPages}` : ""} 页...`,
      );
      const result = await this.client.fetchListPage(
        status,
        page,
        signal,
        true,
      );
      if (!result.items.length) {
        if (reliable && page < totalPages)
          throw new Error(`第 ${page} 页为空，分页数据可能不完整`);
        break;
      }
      const signature = firstPageFingerprint(result.items);
      if (signatures.has(signature))
        throw new Error(`第 ${page} 页重复，无法确认分页末页`);
      signatures.add(signature);
      allItems.push(...result.items);
      page += 1;
    }
    if (!reliable && page > MAX_FALLBACK_PAGES)
      throw new Error("分页超过安全上限");
    return {
      items: uniqueItems(allItems),
      totalPages: reliable ? totalPages : Math.max(1, signatures.size),
      snapshot: firstPageSnapshot(first.items, this.now),
    };
  }
  async forceRefresh() {
    this.view.hideConfirm();
    return Promise.all(
      this.targetStatuses().map((status) => this.startTask(status)),
    );
  }
  async draw(count) {
    if (this.busy || !this.complete || this.pool.length < count) return;
    this.busy = true;
    const selection = this.selectionId;
    const snapshot = [...this.pool];
    this.view.updateButtons();
    this.view.clearLogs();
    try {
      this.view.setShuffling(true);
      await sleep(600, this.browser);
      if (selection !== this.selectionId) return;
      this.view.setShuffling(false);
      this.view.showPreparingCards(count);
      // Don't abort score requests on selection change: successful late scores remain cacheable.
      const cards = await this.engine.cards(snapshot, count);
      if (selection !== this.selectionId) return;
      this.view.showCards(cards, count);
      const failed = cards.filter(
        ({ info }) => !info.resolved || !info.hasScore,
      ).length;
      if (failed)
        this.view.addLog(`${failed} 个条目评分获取失败，已按黑卡显示`, true);
    } catch (error) {
      if (selection === this.selectionId)
        this.view.addLog(`抽卡失败：${error.message}`, true);
    } finally {
      if (selection === this.selectionId) {
        this.busy = false;
        this.view.updateButtons();
      }
    }
  }
}
