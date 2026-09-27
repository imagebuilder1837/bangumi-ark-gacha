import {
  STATUS_IDS,
  statusLabelsFor,
  uniqueItems,
  firstPageFingerprint,
  firstPageSnapshot,
} from "./shared.mjs";
import { GachaStorage } from "./collection-cache.mjs";
import { createBangumiClient } from "./bangumi-client.mjs";
import { PageScheduler } from "./page-scheduler.mjs";
import { DrawEngine } from "./draw-engine.mjs";
import { GachaView } from "./gacha-view.mjs";
import { createBrowserAdapter } from "./browser-adapter.mjs";

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
      browser = createBrowserAdapter(),
    } = {},
  ) {
    this.userId = appRoute.userId;
    this.subjectType = appRoute.subjectType;
    this.currentStatus = appRoute.status;
    this.statusLabels = statusLabelsFor(this.subjectType);
    this.storage = storage || new GachaStorage(this.userId, this.subjectType);
    this.client = client || createBangumiClient({ ...appRoute, browser });
    this.scheduler = new PageScheduler(this.client);
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
    this.busy = false;
    this.selectionId = 0;
    this.tasks = new Map();
    this.progressVersion = 0;
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
    this.view.hideConfirm();
    this.refreshPool();
    this.updateResultMessage();
    this.acquire(false);
  }
  updateResultMessage() {
    if (!this.view.hasResultMessage()) return;
    this.view.setResultMessage(
      this.complete
        ? this.pool.length
          ? "数据已就绪，选择三连或十连开始抽卡"
          : "该收藏状态暂无条目"
        : "正在获取收藏数据...",
    );
  }
  focus() {
    const foreground = this.targetStatuses().filter((status) =>
      this.tasks.has(status),
    );
    this.scheduler.setForeground(foreground);
    const visible =
      foreground
        .map((status) => this.tasks.get(status))
        .find((task) => task.progress) ||
      [...this.tasks.values()]
        .filter((task) => task.progress)
        .sort((a, b) => b.progressUpdated - a.progressUpdated)[0];
    this.view.setProgressVisible(this.tasks.size > 0);
    if (visible) this.view.setStatus(visible.progress);
  }
  acquire(refresh) {
    const statuses = this.targetStatuses();
    const intent = this.currentStatus === "all" ? { failed: false } : null;
    for (const status of statuses) {
      const existing = this.tasks.get(status);
      if (existing) {
        if (!intent) existing.independent = true;
        else existing.intents.add(intent);
        if (refresh && existing.mode === "check") {
          existing.controller.abort();
          this.tasks.delete(status);
          this.startTask(
            status,
            "update",
            existing.independent,
            intent,
            existing.intents,
          );
        }
      } else {
        this.startTask(
          status,
          refresh || !this.storage.getStatus(status) ? "update" : "check",
          !intent,
          intent,
        );
      }
    }
    this.focus();
  }
  startTask(status, mode, independent, intent, previousIntents = []) {
    const task = {
      status,
      mode,
      independent,
      intents: new Set(intent ? [...previousIntents, intent] : previousIntents),
      controller: new AbortController(),
      progress: "",
      promise: null,
    };
    this.tasks.set(status, task);
    task.promise = this.runTask(task);
    return task.promise;
  }
  progress(task, done, total, checking = false) {
    task.progress = `${checking ? "核验" : "同步"} [${this.statusLabels[task.status]}] ${done}/${total} 页`;
    task.progressUpdated = ++this.progressVersion;
    this.focus();
  }
  async runTask(task) {
    const { status, controller } = task;
    try {
      if (task.mode === "check") {
        this.progress(task, 0, 1, true);
        const remote = await this.scheduler.request(
          status,
          1,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        this.progress(task, 1, 1, true);
        const meta = this.storage.getMeta(status);
        if (!meta || firstPageFingerprint(remote.items) !== meta.fingerprint)
          task.mode = "update";
      }
      if (task.mode === "update") {
        const result = await this.fetchAllStatus(task);
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
      }
      if (!controller.signal.aborted) {
        this.view.setLoginNotice(null);
        this.view.notify(
          `✅ [${this.statusLabels[status]}] ${task.mode === "check" ? "核验" : "全量更新"}完成`,
        );
        if (this.targetStatuses().includes(status)) this.updateResultMessage();
      }
    } catch (error) {
      if (!controller.signal.aborted && this.tasks.get(status) === task)
        this.fail(task, error);
    } finally {
      if (this.tasks.get(status) === task) this.tasks.delete(status);
      this.focus();
    }
  }
  fail(task, error) {
    const limited = error.status === 429;
    const affected = [...task.intents].filter((intent) => !intent.failed);
    for (const intent of affected) intent.failed = true;
    const currentAffected =
      this.targetStatuses().includes(task.status) ||
      (limited &&
        [...this.tasks.values()].some(
          (other) =>
            other !== task && this.targetStatuses().includes(other.status),
        )) ||
      (this.currentStatus === "all" && affected.length > 0);
    this.view.addLog(
      `[${this.statusLabels[task.status]}] 获取失败：${error.message}`,
      true,
    );
    if (error.code === "LOGIN_REQUIRED")
      this.view.setLoginNotice(error.message);
    for (const other of this.tasks.values()) {
      if (other === task) continue;
      if (
        limited ||
        (affected.some((intent) => other.intents.has(intent)) &&
          !other.independent &&
          [...other.intents].every((intent) => intent.failed))
      ) {
        other.controller.abort();
        this.tasks.delete(other.status);
      }
    }
    task.controller.abort();
    if (currentAffected) {
      this.refreshPool();
      this.loaded = false;
      this.view.showFailure(this.complete);
    }
  }
  async fetchAllStatus(task) {
    const { status, controller } = task;
    const signal = controller.signal;
    this.progress(task, 0, 1);
    const first = await this.scheduler.request(status, 1, signal);
    if (signal.aborted) return;
    const { totalPages, reliable } = first.pageInfo;
    if (
      !Number.isSafeInteger(totalPages) ||
      totalPages < 1 ||
      (reliable &&
        (totalPages > MAX_FALLBACK_PAGES ||
          (first.pageInfo.currentPage != null &&
            first.pageInfo.currentPage !== 1)))
    )
      throw new Error("分页数据无效");
    const signatures = new Set([firstPageFingerprint(first.items)]);
    const pages = new Map([[1, first.items]]);
    const recordPage = (page, items) => {
      const signature = firstPageFingerprint(items);
      if (items.length && signatures.has(signature))
        throw new Error(`第 ${page} 页重复，无法确认分页末页`);
      signatures.add(signature);
      pages.set(page, items);
    };
    if (reliable) {
      if (!first.items.length && totalPages !== 1)
        throw new Error("分页数据矛盾");
      this.progress(task, 1, totalPages);
      const remaining = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);
      await Promise.all(
        remaining.map(async (page) => {
          const result = await this.scheduler.request(status, page, signal);
          if (signal.aborted) return;
          if (
            result.pageInfo.reliable &&
            (result.pageInfo.totalPages !== totalPages ||
              (result.pageInfo.currentPage != null &&
                result.pageInfo.currentPage !== page))
          )
            throw new Error("分页数据矛盾");
          if (!result.items.length)
            throw new Error(`第 ${page} 页为空，分页数据可能不完整`);
          recordPage(page, result.items);
          this.progress(task, pages.size, totalPages);
        }),
      );
    } else {
      let page = 1;
      let discoveredTotalPages = null;
      while (true) {
        if (signal.aborted) return;
        if (!pages.get(page).length) {
          this.progress(task, page, page);
          break;
        }
        if (page === MAX_FALLBACK_PAGES) throw new Error("分页超过安全上限");
        if (page === 1) this.progress(task, page, page + 1);
        ++page;
        const result = await this.scheduler.request(status, page, signal);
        if (signal.aborted) return;
        if (result.pageInfo.reliable) {
          const { totalPages: reportedTotal, currentPage } = result.pageInfo;
          if (
            !Number.isSafeInteger(reportedTotal) ||
            reportedTotal > MAX_FALLBACK_PAGES ||
            reportedTotal < page ||
            (currentPage != null && currentPage !== page) ||
            (discoveredTotalPages !== null &&
              reportedTotal !== discoveredTotalPages)
          )
            throw new Error("分页数据矛盾");
          discoveredTotalPages = reportedTotal;
        }
        if (!result.items.length && discoveredTotalPages !== null)
          throw new Error("分页数据矛盾");
        recordPage(page, result.items);
        if (!result.items.length || page === discoveredTotalPages) {
          this.progress(task, page, page);
          break;
        }
        if (page === MAX_FALLBACK_PAGES) throw new Error("分页超过安全上限");
        this.progress(task, page, page + 1);
      }
    }
    return {
      items: uniqueItems(
        [...pages.entries()]
          .sort(([a], [b]) => a - b)
          .flatMap(([, items]) => items),
      ),
      totalPages: pages.size,
      snapshot: firstPageSnapshot(first.items, this.now),
    };
  }
  forceRefresh() {
    this.view.hideConfirm();
    this.acquire(true);
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
