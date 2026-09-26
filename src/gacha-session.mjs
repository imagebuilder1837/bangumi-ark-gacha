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
const FETCH_INTERVAL_MS = 350;
const MAX_FALLBACK_PAGES = 10000;
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    let timer;
    const onAbort = () => {
      window.clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
      const error = new Error("Aborted");
      error.name = "AbortError";
      reject(error);
    };
    const done = () => {
      if (signal) signal.removeEventListener("abort", onAbort);
      resolve();
    };
    timer = window.setTimeout(done, ms);
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
  });
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
    } = {},
  ) {
    this.userId = appRoute.userId;
    this.subjectType = appRoute.subjectType;
    this.currentStatus = appRoute.status;
    this.statusLabels = statusLabelsFor(this.subjectType);
    this.storage = storage || new GachaStorage(this.userId, this.subjectType);
    this.client = client || createBangumiClient(appRoute);
    this.now = now;
    this.engine = new DrawEngine({
      storage: this.storage,
      client: this.client,
      subjectType: this.subjectType,
      now,
      random,
    });
    this.pool = [];
    this.logs = [];
    this.flowId = 0;
    this.abortController = null;
    this.drawAbortController = null;
    this.titleHeightFrame = null;
    this.busy = false;
    this.loaded = false;
    this.pendingChanges = [];
    this.view = createView(this);
  }

  open() {
    if (!this.loaded && !this.busy) this.loadView();
  }

  targetStatuses() {
    return this.currentStatus === "all"
      ? [...STATUS_IDS]
      : [this.currentStatus];
  }

  selectStatus(status) {
    if (!STATUS_IDS.includes(status) && status !== "all") return;
    this.stopOperations(false);
    this.currentStatus = status;
    this.view.selectStatus(status);
    this.loaded = false;
    this.loadView();
  }

  isActive(flowId) {
    return flowId === this.flowId;
  }

  stopOperations(showMessage = true) {
    ++this.flowId;
    if (this.abortController) this.abortController.abort();
    if (this.drawAbortController) this.drawAbortController.abort();
    this.abortController = null;
    this.drawAbortController = null;
    this.busy = false;
    this.view.setProgressVisible(false);
    this.view.updateButtons();
    if (showMessage) this.view.setStatus("已停止当前操作", true);
  }

  async loadPool(statuses) {
    const pools = [];
    for (const status of statuses) pools.push(...this.storage.getItems(status));
    this.pool = uniqueItems(pools);
    this.view.updateInfo();
    this.view.updateButtons();
  }

  createController() {
    if (this.abortController) this.abortController.abort();
    this.abortController = new AbortController();
    return this.abortController;
  }

  async loadView() {
    this.stopOperations(false);
    const flowId = this.flowId;
    this.pendingChanges = [];
    this.view.hideConfirm();
    this.view.clearLogs();
    this.view.setResultMessage("读取本地缓存中...");
    this.view.setStatus("读取本地缓存中...");
    this.view.setProgressVisible(true);
    this.busy = true;
    this.view.updateButtons();

    const statuses = this.targetStatuses();
    await this.loadPool(statuses);
    if (!this.isActive(flowId)) return;

    const missing = statuses.filter((status) => {
      return !this.storage.getMeta(status);
    });

    if (this.pool.length > 0)
      this.view.setResultMessage("缓存已载入，正在后台核验最新第一页...");

    let controller = null;
    try {
      if (missing.length) {
        this.view.setStatus("首次使用，开始全量同步...");
        controller = this.createController();
        await this.syncStatuses(missing, {
          signal: controller.signal,
          manual: false,
          flowId,
        });
        if (!this.isActive(flowId)) return;
        await this.loadPool(statuses);
      }

      this.busy = false;
      this.view.setProgressVisible(false);
      this.loaded = true;
      this.view.updateButtons();
      if (this.pool.length)
        this.view.setResultMessage("数据已就绪，选择三连或十连开始抽卡");
      else this.view.setResultMessage("该收藏状态暂无条目");
      this.view.setStatus(
        missing.length ? "✅ 全量同步完成" : "缓存可用，后台核验中",
      );

      if (this.isActive(flowId)) this.startValidation(statuses, flowId);
    } catch (error) {
      if (!this.isActive(flowId)) return;
      if (error.name === "AbortError") {
        this.view.setStatus("已停止同步", true);
      } else {
        this.view.addLog(`同步失败：${error.message}`, true);
        this.view.setStatus("同步失败，仍保留可用缓存", true);
        if (this.pool.length)
          this.view.setResultMessage("同步失败，当前仍可使用本地缓存");
        else this.view.setResultMessage("暂无可用缓存，请检查网络后刷新");
      }
      this.busy = false;
      this.view.setProgressVisible(false);
      this.view.updateButtons();
    } finally {
      if (this.abortController === controller) this.abortController = null;
    }
  }

  async fetchAllStatus(status, signal) {
    const statusName = this.statusLabels[status] || status;
    this.view.setStatus(`同步 [${statusName}] 第 1 页...`);
    const first = await this.client.fetchListPage(status, 1, signal, true);
    const allItems = [...first.items];
    const seenPageSignatures = new Set([firstPageFingerprint(first.items)]);
    const { totalPages, reliable } = first.pageInfo;
    const upperBound = reliable ? totalPages : MAX_FALLBACK_PAGES;

    if (reliable) {
      for (let page = 2; page <= totalPages; page += 1) {
        if (signal.aborted) throw new DOMException("Aborted", "AbortError");
        await sleep(FETCH_INTERVAL_MS, signal);
        this.view.setStatus(
          `同步 [${statusName}] 第 ${page}/${totalPages} 页...`,
        );
        const result = await this.client.fetchListPage(
          status,
          page,
          signal,
          true,
        );
        if (!result.items.length) {
          if (page < totalPages)
            throw new Error(`第 ${page} 页为空，分页数据可能不完整`);
          break;
        }
        const signature = firstPageFingerprint(result.items);
        if (seenPageSignatures.has(signature))
          throw new Error(`第 ${page} 页重复，已停止以保护旧缓存`);
        seenPageSignatures.add(signature);
        allItems.push(...result.items);
      }
    } else {
      let page = 2;
      while (page <= upperBound) {
        if (signal.aborted) throw new DOMException("Aborted", "AbortError");
        await sleep(FETCH_INTERVAL_MS, signal);
        this.view.setStatus(
          `同步 [${statusName}] 第 ${page} 页（未发现可靠末页）...`,
        );
        const result = await this.client.fetchListPage(
          status,
          page,
          signal,
          true,
        );
        if (!result.items.length) break;
        const signature = firstPageFingerprint(result.items);
        if (seenPageSignatures.has(signature)) {
          throw new Error(`第 ${page} 页重复，无法确认分页末页`);
        }
        seenPageSignatures.add(signature);
        allItems.push(...result.items);
        page += 1;
      }
      if (page > MAX_FALLBACK_PAGES)
        throw new Error("分页超过安全上限，已停止同步");
    }

    const items = uniqueItems(allItems);
    return {
      items,
      totalPages: reliable ? totalPages : Math.max(1, seenPageSignatures.size),
      snapshot: firstPageSnapshot(first.items, this.now),
    };
  }

  async syncStatuses(statuses, options) {
    const { signal, manual = false, flowId = this.flowId } = options;
    this.busy = true;
    this.view.setProgressVisible(true);
    this.view.updateButtons();

    for (const status of statuses) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      if (!this.isActive(flowId))
        throw new DOMException("Aborted", "AbortError");

      const oldItems = this.storage.getItems(status);
      const result = await this.fetchAllStatus(status, signal);
      if (signal.aborted || !this.isActive(flowId))
        throw new DOMException("Aborted", "AbortError");
      const meta = {
        version: 2,
        totalPages: result.totalPages,
        fingerprint: result.snapshot.fingerprint,
        firstPage: result.snapshot.items,
        checkedAt: this.now(),
        updatedAt: this.now(),
      };

      this.storage.commitStatus(status, result.items, meta);
      if (manual) {
        const ids = [...oldItems, ...result.items].map((item) => item.id);
        this.storage.clearSubjectMeta(ids);
      }
      await this.loadPool(this.targetStatuses());
    }
  }

  async startValidation(statuses, flowId) {
    if (!this.isActive(flowId) || this.busy) return;
    const controller = this.createController();
    this.view.setProgressVisible(true);
    const changes = [];

    try {
      for (const status of statuses) {
        if (controller.signal.aborted)
          throw new DOMException("Aborted", "AbortError");
        const meta = this.storage.getMeta(status);
        if (!meta) continue;

        const statusName = this.statusLabels[status] || status;
        this.view.setStatus(`核验 [${statusName}] 最新第一页...`);
        const remote = await this.client.fetchListPage(
          status,
          1,
          controller.signal,
          true,
        );
        if (controller.signal.aborted || !this.isActive(flowId)) return;
        const snapshot = firstPageSnapshot(remote.items, this.now);
        const sameAsAccepted = snapshot.fingerprint === meta.fingerprint;

        if (sameAsAccepted) {
          meta.checkedAt = this.now();
          this.storage.writeJson(this.storage.metaKey(status), meta);
        } else {
          changes.push({
            status,
            snapshot,
            totalPages: remote.pageInfo.totalPages,
          });
        }
      }

      if (changes.length && this.isActive(flowId)) {
        this.pendingChanges = changes;
        this.view.showConfirm(changes);
        this.view.setStatus(
          `发现 ${changes.length} 个状态有变化，请选择同步方式`,
        );
      } else if (this.isActive(flowId)) {
        this.view.setStatus("✅ 最新第一页核验完成");
      }
    } catch (error) {
      if (this.isActive(flowId) && error.name !== "AbortError") {
        this.view.addLog(`后台核验失败：${error.message}`, true);
        this.view.setStatus("后台核验失败，继续使用本地缓存", true);
      }
    } finally {
      if (this.isActive(flowId)) {
        if (this.abortController === controller) this.abortController = null;
        this.view.setProgressVisible(false);
        this.view.updateButtons();
      }
    }
  }

  keepCachedChanges() {
    this.pendingChanges = [];
    this.view.hideConfirm();
    this.view.setStatus("已保留本地缓存，下次核验时会再次提示");
  }

  async refreshDetectedChanges() {
    const changes = this.pendingChanges.splice(0);
    this.view.hideConfirm();
    if (!changes.length) return;
    const flowId = ++this.flowId;
    const controller = this.createController();
    this.view.setResultMessage("变化状态全量更新中...");
    try {
      await this.syncStatuses(
        changes.map((change) => change.status),
        {
          signal: controller.signal,
          manual: false,
          flowId,
        },
      );
      if (!this.isActive(flowId)) return;
      this.loaded = true;
      this.view.setProgressVisible(false);
      this.view.setResultMessage("✅ 变化状态已更新，可以继续抽卡");
      this.view.setStatus("✅ 变化状态全量更新完成");
    } catch (error) {
      if (!this.isActive(flowId)) return;
      if (error.name === "AbortError")
        this.view.setStatus("已停止全量更新", true);
      else {
        this.view.addLog(`全量更新失败：${error.message}`, true);
        this.view.setStatus("更新失败，继续使用旧缓存", true);
        this.view.setResultMessage("更新失败，当前仍可使用旧缓存");
      }
    } finally {
      if (!this.isActive(flowId)) return;
      if (this.abortController === controller) this.abortController = null;
      this.busy = false;
      this.view.setProgressVisible(false);
      this.view.updateButtons();
    }
  }

  async forceRefresh() {
    if (this.busy) this.stopOperations(false);
    this.pendingChanges = [];
    this.view.hideConfirm();
    const statuses = this.targetStatuses();
    const flowId = ++this.flowId;
    const controller = this.createController();
    this.view.clearLogs();
    this.view.setResultMessage("准备清理当前作用域并全量刷新...");
    this.view.setStatus("全量刷新中...");
    try {
      await this.syncStatuses(statuses, {
        signal: controller.signal,
        manual: true,
        flowId,
      });
      await this.loadPool(statuses);
      if (!this.isActive(flowId)) return;
      this.loaded = true;
      this.view.setResultMessage(
        this.pool.length ? "✅ 全量刷新完成，可以抽卡" : "该收藏状态暂无条目",
      );
      this.view.setStatus("✅ 全量刷新完成");
    } catch (error) {
      if (!this.isActive(flowId)) return;
      if (error.name === "AbortError")
        this.view.setStatus("已停止全量刷新", true);
      else {
        this.view.addLog(`全量刷新失败：${error.message}`, true);
        this.view.setStatus("刷新失败，已保留旧缓存", true);
        this.view.setResultMessage(
          this.pool.length
            ? "刷新失败，当前仍可使用旧缓存"
            : "刷新失败，请稍后重试",
        );
      }
    } finally {
      if (!this.isActive(flowId)) return;
      if (this.abortController === controller) this.abortController = null;
      this.busy = false;
      this.view.setProgressVisible(false);
      this.view.updateButtons();
    }
  }

  async draw(count) {
    if (this.busy || this.pool.length < count) return;
    this.busy = true;
    const controller = new AbortController();
    this.drawAbortController = controller;
    this.view.updateButtons();
    this.view.clearLogs();
    this.view.setStatus(`正在准备 ${count === 10 ? "十连" : "三连"}...`);
    try {
      this.view.setShuffling(true);
      await sleep(600, controller.signal);
      this.view.setShuffling(false);

      this.view.showPreparingCards(count);
      const cardData = await this.engine.cards(
        this.pool,
        count,
        controller.signal,
      );
      const failed = cardData.filter(
        ({ info }) =>
          info.source === "error" || !info.resolved || !info.hasScore,
      ).length;
      this.view.showCards(cardData, count);
      if (failed) {
        this.view.addLog(`${failed} 个条目评分获取失败，已按黑卡显示`, true);
        this.view.setStatus(`抽卡完成，${failed} 个评分请求失败`, true);
      } else {
        this.view.setStatus("✅ 抽卡完成");
      }
    } catch (error) {
      if (this.drawAbortController !== controller) return;
      if (error.name === "AbortError") {
        this.view.setStatus("抽卡已停止", true);
        this.view.setResultMessage("抽卡已停止");
      } else {
        this.view.addLog(`抽卡失败：${error.message}`, true);
        this.view.setStatus("抽卡失败，请重试", true);
      }
    } finally {
      if (this.drawAbortController === controller) {
        this.drawAbortController = null;
        this.busy = false;
        this.view.updateButtons();
      }
    }
  }
}
