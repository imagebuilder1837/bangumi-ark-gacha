// ==UserScript==
// @name         Bangumi 随机收藏条目扭蛋机（仿粥版本）
// @namespace    https://github.com/imagebuilder1837/bangumi-ark-gacha
// @version      0.1.4
// @description  像方舟抽卡一样随机抽取 Bangumi 收藏条目。
// @author       imagebuilder1837
// @match        https://bgm.tv/*/list/*
// @match        https://bangumi.tv/*/list/*
// @match        https://chii.in/*/list/*
// @run-at       document-idle
// @grant        none
// @license      MIT
// @downloadURL  https://raw.githubusercontent.com/imagebuilder1837/bangumi-ark-gacha/refs/heads/main/src/index.user.js
// @updateURL    https://raw.githubusercontent.com/imagebuilder1837/bangumi-ark-gacha/refs/heads/main/src/index.user.js
// ==/UserScript==

// Generated from src/main.mjs and its module imports. Do not edit; run npm run build.
(function () {
  "use strict";

  const STATUS_IDS = ["wish", "do", "on_hold", "collect", "dropped"];
  const SUBJECT_ACTIONS = {
    anime: "看",
    real: "看",
    game: "玩",
    book: "读",
    music: "听",
  };

  function statusLabelsFor(subjectType) {
    const action = SUBJECT_ACTIONS[subjectType] || "看";
    return {
      all: "全部",
      wish: `想${action}`,
      do: `在${action}`,
      on_hold: "搁置",
      collect: `${action}过`,
      dropped: "抛弃",
    };
  }

  function normalizeCover(src, origin = window.location.origin) {
    if (!src) return "";
    try {
      const url = new URL(src, origin);
      url.pathname = url.pathname.replace(/\/r\/\d+\/pic/, "/pic");
      return url.href;
    } catch (error) {
      return String(src);
    }
  }

  function validCalendarDate(date) {
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date))
      return false;
    const parsed = new Date(`${date}T00:00:00`);
    return (
      !Number.isNaN(parsed.getTime()) &&
      `${String(parsed.getFullYear()).padStart(4, "0")}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}` ===
        date
    );
  }

  function subjectIdFromLink(link) {
    const match = String(link || "").match(/\/subject\/(\d+)/);
    return match ? match[1] : "";
  }

  function normalizeItem(item, origin) {
    if (!item || !item.id) return null;
    return {
      id: String(item.id),
      title: String(item.title || "").trim(),
      link: String(item.link || ""),
      cover: normalizeCover(item.cover || "", origin),
    };
  }

  function uniqueItems(items, origin) {
    const seen = new Set();
    return (Array.isArray(items) ? items : [])
      .map((item) => normalizeItem(item, origin))
      .filter((item) => {
        if (!item || seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      });
  }

  function firstPageFingerprint(items) {
    const core = uniqueItems(items).map((item) => ({
      id: item.id,
      title: item.title,
      link: item.link,
      cover: normalizeCover(item.cover),
    }));
    return JSON.stringify(core);
  }

  function firstPageSnapshot(items, now = Date.now) {
    const normalized = uniqueItems(items);
    return {
      items: normalized,
      fingerprint: firstPageFingerprint(normalized),
      checkedAt: now(),
    };
  }

  const STORAGE_PREFIX = "bangumi-ark-gacha";

  function validItems(items) {
    return (
      Array.isArray(items) &&
      items.every(
        (item) =>
          item &&
          typeof item === "object" &&
          /^\d+$/.test(String(item.id)) &&
          typeof item.title === "string" &&
          typeof item.link === "string" &&
          item.link.includes(`/subject/${item.id}`),
      )
    );
  }
  function validMeta(meta) {
    return (
      meta &&
      typeof meta === "object" &&
      typeof meta.fingerprint === "string" &&
      Number.isInteger(meta.totalPages) &&
      meta.totalPages >= 1
    );
  }

  class GachaStorage {
    constructor(userId, subjectType, storage = localStorage) {
      this.storage = storage;
      this.userId = String(userId);
      this.subjectType = String(subjectType);
    }
    listKey(status) {
      return `${STORAGE_PREFIX}:list:${this.userId}:${this.subjectType}:${status}`;
    }
    metaKey(status) {
      return `${STORAGE_PREFIX}:meta:${this.userId}:${this.subjectType}:${status}`;
    }
    recordKey(status) {
      return `${STORAGE_PREFIX}:record:${this.userId}:${this.subjectType}:${status}`;
    }
    subjectKey(subjectId) {
      return `${STORAGE_PREFIX}:subject:${subjectId}`;
    }
    readJson(key, fallback) {
      try {
        const raw = this.storage.getItem(key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    }
    writeJson(key, value) {
      this.storage.setItem(key, JSON.stringify(value));
    }
    getStatus(status) {
      if (!STATUS_IDS.includes(status)) return null;
      const record = this.readJson(this.recordKey(status), null);
      if (record !== null) {
        return validItems(record?.items) && validMeta(record?.meta)
          ? record
          : null;
      }
      // Old installations stored list and metadata separately. Only migrate a complete pair.
      const items = this.readJson(this.listKey(status), null);
      const meta = this.readJson(this.metaKey(status), null);
      if (!validItems(items) || !validMeta(meta)) return null;
      const migrated = { items: uniqueItems(items), meta };
      try {
        this.writeJson(this.recordKey(status), migrated);
      } catch {
        /* retry on next read */
      }
      return migrated;
    }
    getItems(status) {
      return this.getStatus(status)?.items || [];
    }
    getMeta(status) {
      return this.getStatus(status)?.meta || null;
    }
    getSubjectMeta(subjectId) {
      const meta = this.readJson(this.subjectKey(subjectId), null);
      return meta && typeof meta === "object" ? meta : null;
    }
    saveSubjectMeta(subjectId, meta) {
      try {
        this.writeJson(this.subjectKey(subjectId), meta);
      } catch (error) {
        console.warn("[Bangumi Ark Gacha] 评分缓存写入失败", error);
      }
    }
    commitStatus(status, items, meta) {
      if (
        !STATUS_IDS.includes(status) ||
        !validItems(items) ||
        !validMeta(meta)
      )
        throw new Error("收藏缓存数据无效");
      // A single key is the publication point; an unsuccessful setItem leaves the old record intact.
      this.writeJson(this.recordKey(status), {
        items: uniqueItems(items),
        meta,
      });
    }
  }

  function createBrowserAdapter() {
    return {
      origin: window.location.origin,
      parse: (html) => new DOMParser().parseFromString(html, "text/html"),
      setTimeout: (fn, ms) => window.setTimeout(fn, ms),
      clearTimeout: (id) => window.clearTimeout(id),
    };
  }

  class SubjectParser {
    extractScore(doc) {
      const selectors = [
        "#ChartWarpper .global_score .number",
        "#ChartWarpper .global_score",
        ".global_score .number",
        ".global_rating .number",
        ".global_score",
      ];
      for (const selector of selectors) {
        const node = doc.querySelector(selector);
        if (!node) continue;
        const match = (node.textContent || "").match(
          /(?:^|\s)(10(?:\.0)?|[0-9](?:\.[0-9])?)(?:\s|$)/,
        );
        if (match) return Number(match[1]);
        const loose = (node.textContent || "").match(
          /10(?:\.0)?|[0-9](?:\.[0-9])?/,
        );
        if (loose) return Number(loose[0]);
      }
      return null;
    }

    extractInfoboxField(doc, patterns) {
      const nodes = Array.from(
        doc.querySelectorAll("#infobox li, .infobox li"),
      );
      const node = nodes.find((item) =>
        patterns.some((pattern) => pattern.test(item.textContent || "")),
      );
      if (!node) return null;
      const text = (node.textContent || "").replace(/\s+/g, " ").trim();
      const colon = text.indexOf(":");
      return colon >= 0 ? text.slice(colon + 1).trim() : text;
    }

    extractDateFromDocument(doc) {
      return this.extractInfoboxField(doc, [
        /放送开始/i,
        /放送開始/i,
        /上映年度/i,
        /上映日期/i,
        /上映日/i,
        /发售日/i,
        /发行日期/i,
        /开始日期/i,
        /release date/i,
        /publish date/i,
      ]);
    }

    extractEpisodesFromDocument(doc) {
      const value = this.extractInfoboxField(doc, [
        /集数/i,
        /话数/i,
        /episodes?/i,
        /总集数/i,
      ]);
      if (!value) return null;
      const match = value.match(/\d+/);
      return match ? Number(match[0]) : null;
    }

    validatedDate(year, month, day, isPartial = false) {
      const date = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
      return !validCalendarDate(date)
        ? { date: null, isPartial: false }
        : { date, isPartial };
    }

    normalizeDate(dateValue) {
      if (!dateValue) return { date: null, isPartial: false };
      const dateString = String(dateValue).trim().replace(/T.*$/, "");
      const half = dateString.match(/^(\d{4})\s*[Hh]([12])$/);
      if (half)
        return {
          date: `${half[1]}-${half[2] === "1" ? "01-01" : "07-01"}`,
          isPartial: true,
        };

      const full = dateString.match(/^(\d{4})[-/]([01]?\d)[-/]([0-3]?\d)/);
      if (full) return this.validatedDate(full[1], full[2], full[3]);

      const month = dateString.match(/^(\d{4})[-/]([01]?\d)$/);
      if (month) return this.validatedDate(month[1], month[2], "01", true);
      const cnFull = dateString.match(
        /^(\d{4})年\s*([01]?\d)月\s*([0-3]?\d)日$/,
      );
      if (cnFull) return this.validatedDate(cnFull[1], cnFull[2], cnFull[3]);
      const cnMonth = dateString.match(/^(\d{4})年\s*([01]?\d)月$/);
      if (cnMonth)
        return this.validatedDate(cnMonth[1], cnMonth[2], "01", true);
      const year = dateString.match(/^(\d{4})(?:年)?$/);
      if (year) return { date: `${year[1]}-01-01`, isPartial: true };
      return { date: null, isPartial: false };
    }

    subjectInfoFromDocument(doc) {
      const rawDate = this.extractDateFromDocument(doc);
      const normalizedDate = this.normalizeDate(rawDate);
      const score = this.extractScore(doc);
      const totalEpisodes = this.extractEpisodesFromDocument(doc);
      return {
        score: Number.isFinite(score) && score > 0 ? score : null,
        hasScore: Number.isFinite(score) && score > 0,
        date: normalizedDate.date,
        isPartial: normalizedDate.isPartial,
        totalEpisodes,
        resolved: true,
        source: "subject",
      };
    }
  }

  const PAGE_TIMEOUT_MS = 10000;
  const SCORE_TIMEOUT_MS = 5000;
  function pageNumberFromHref(href, origin = window.location.origin) {
    try {
      const url = new URL(href, origin);
      const page = Number(url.searchParams.get("page"));
      return Number.isFinite(page) && page > 0 ? page : null;
    } catch (error) {
      return null;
    }
  }

  function pageInfo(doc, origin) {
    const edge = doc.querySelector(".p_edge");
    const edgeText = edge ? edge.textContent || "" : "";
    const edgeMatch = edgeText.match(/(\d+)\s*\/\s*(\d+)/);
    if (edgeMatch) {
      return {
        currentPage: Number(edgeMatch[1]),
        totalPages: Number(edgeMatch[2]),
        reliable: true,
      };
    }

    const pageNumbers = Array.from(
      doc.querySelectorAll("#multipage a, #multipage .p"),
    )
      .map(
        (node) =>
          pageNumberFromHref(node.getAttribute("href") || "", origin) ||
          Number(node.textContent),
      )
      .filter((page) => Number.isFinite(page) && page > 0);

    return {
      totalPages: pageNumbers.length ? Math.max(...pageNumbers) : 1,
      reliable: false,
    };
  }

  function parseListPage(doc, origin) {
    const list = doc.querySelector("#browserItemList");
    if (!list) {
      if (doc.querySelector('form[action*="login"], a[href*="/login"]'))
        throw Object.assign(new Error("请先登录 Bangumi"), {
          code: "LOGIN_REQUIRED",
        });
      throw new Error("收藏列表结构无效");
    }
    const entries = Array.from(list.children);
    if (
      entries.some((li) => !li.matches("li.item")) ||
      Array.from(list.childNodes).some(
        (node) => node.nodeType === 3 && node.textContent.trim(),
      )
    )
      throw new Error("收藏列表结构无效");
    if (
      entries.some((li) => {
        const link = li.querySelector("h3 a[href*='/subject/']");
        return (
          !link || !subjectIdFromLink(link.href || link.getAttribute("href"))
        );
      })
    )
      throw new Error("收藏条目结构无效");
    return entries
      .map((li) => {
        const linkElement = li.querySelector("h3 a");
        if (!linkElement) return null;
        const link = linkElement.href || linkElement.getAttribute("href") || "";
        const id = subjectIdFromLink(link);
        if (!id) return null;
        return normalizeItem(
          {
            id,
            title: linkElement.textContent || linkElement.innerText || "",
            link,
            cover: li.querySelector("img.cover")?.getAttribute("src") || "",
          },
          origin,
        );
      })
      .filter(Boolean);
  }

  async function fetchText(url, options = {}, transport = fetch, browser) {
    const { signal, timeoutMs = PAGE_TIMEOUT_MS, cache = "default" } = options;
    const controller = new AbortController();
    let timedOut = false;
    let abortListener = null;
    const timer = browser.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    if (signal) {
      abortListener = () => controller.abort();
      if (signal.aborted) controller.abort();
      else signal.addEventListener("abort", abortListener, { once: true });
    }

    try {
      const response = await transport(url, {
        credentials: "same-origin",
        cache,
        signal: controller.signal,
      });
      if (!response.ok)
        throw Object.assign(new Error(`HTTP ${response.status}`), {
          status: response.status,
        });
      return await response.text();
    } catch (error) {
      if (timedOut) throw new Error(`请求超时：${url}`);
      throw error;
    } finally {
      browser.clearTimeout(timer);
      if (signal && abortListener)
        signal.removeEventListener("abort", abortListener);
    }
  }

  function createBangumiClient({
    subjectType,
    userId,
    transport = fetch,
    browser = createBrowserAdapter(),
  }) {
    return {
      async fetchListPage(status, page, signal, { cache = "default" } = {}) {
        const path = `/${subjectType}/list/${encodeURIComponent(userId)}/${status}`;
        const url = page === 1 ? path : `${path}?page=${page}`;
        const html = await fetchText(
          url,
          { signal, cache },
          transport,
          browser,
        );
        const doc = browser.parse(html);
        return {
          items: uniqueItems(
            parseListPage(doc, browser.origin),
            browser.origin,
          ),
          pageInfo: pageInfo(doc, browser.origin),
        };
      },
      async fetchSubject(subjectId, signal) {
        return new SubjectParser().subjectInfoFromDocument(
          browser.parse(
            await fetchText(
              `/subject/${subjectId}`,
              { signal, timeoutMs: SCORE_TIMEOUT_MS },
              transport,
              browser,
            ),
          ),
        );
      },
    };
  }

  // The single list-request gate for one page. Cancellation removes queued work as well
  // as aborting work already dispatched; the client starts its timeout at dispatch.
  const abortError = () => new DOMException("Aborted", "AbortError");

  class PageScheduler {
    constructor(client, limit = 4) {
      this.client = client;
      this.limit = limit;
      this.queue = [];
      this.running = new Set();
      this.foreground = new Set();
      this.order = new Map();
      this.nextOrder = 0;
    }

    setForeground(statuses) {
      this.foreground = new Set(statuses);
      this.drain();
    }

    request(status, page, signal) {
      if (signal.aborted) return Promise.reject(abortError());
      if (!this.order.has(signal)) this.order.set(signal, this.nextOrder++);
      return new Promise((resolve, reject) => {
        const job = {
          status,
          page,
          signal,
          resolve,
          reject,
          controller: new AbortController(),
        };
        job.abort = () => {
          this.queue = this.queue.filter((entry) => entry !== job);
          job.controller.abort();
          reject(abortError());
          this.releaseOrder(signal);
          this.drain();
        };
        signal.addEventListener("abort", job.abort, { once: true });
        this.queue.push(job);
        this.drain();
      });
    }

    releaseOrder(signal) {
      if (
        !this.queue.some((job) => job.signal === signal) &&
        ![...this.running].some((job) => job.signal === signal)
      )
        this.order.delete(signal);
    }

    drain() {
      while (this.running.size < this.limit && this.queue.length) {
        const foregroundActive =
          [...this.running].some((job) => this.foreground.has(job.status)) ||
          this.queue.some((job) => this.foreground.has(job.status));
        const candidates = this.queue.filter((job) =>
          foregroundActive ? this.foreground.has(job.status) : true,
        );
        if (!candidates.length) return;
        candidates.sort(
          (a, b) => this.order.get(a.signal) - this.order.get(b.signal),
        );
        const job = candidates[0];
        this.queue.splice(this.queue.indexOf(job), 1);
        if (job.signal.aborted) continue;
        this.running.add(job);
        Promise.resolve()
          .then(() => {
            if (job.signal.aborted) throw abortError();
            return this.client.fetchListPage(
              job.status,
              job.page,
              job.controller.signal,
              { cache: "no-store" },
            );
          })
          .then(job.resolve, job.reject)
          .finally(() => {
            job.signal.removeEventListener("abort", job.abort);
            this.running.delete(job);
            this.releaseOrder(job.signal);
            this.drain();
          });
      }
    }
  }

  const SCORE_TTL_MS = 72 * 60 * 60 * 1000;
  const SUBJECT_CACHE_VERSION = 3;
  function validSubjectInfo(info) {
    if (
      typeof info.hasScore !== "boolean" ||
      (info.hasScore
        ? typeof info.score !== "number" ||
          !Number.isFinite(info.score) ||
          info.score <= 0 ||
          info.score > 10
        : info.score !== null) ||
      typeof info.isPartial !== "boolean" ||
      (info.totalEpisodes !== null &&
        (!Number.isSafeInteger(info.totalEpisodes) ||
          info.totalEpisodes < 0)) ||
      (info.date !== null && !validCalendarDate(info.date))
    )
      return false;
    return true;
  }
  class DrawEngine {
    constructor({
      storage,
      client,
      subjectType,
      now = Date.now,
      random = Math.random,
    }) {
      Object.assign(this, { storage, client, subjectType, now, random });
    }
    getCachedSubject(subjectId) {
      const cached = this.storage.getSubjectMeta(subjectId);
      if (
        !cached ||
        cached.version !== SUBJECT_CACHE_VERSION ||
        cached.resolved !== true ||
        cached.subjectId !== String(subjectId) ||
        !validSubjectInfo(cached) ||
        !Number.isFinite(cached.fetchedAt) ||
        cached.fetchedAt < 0
      )
        return null;
      const age = this.now() - cached.fetchedAt;
      return age >= 0 && age < SCORE_TTL_MS ? cached : null;
    }

    async getSubjectInfo(subjectId, signal) {
      const cached = this.getCachedSubject(subjectId);
      if (cached) return cached;

      try {
        const subjectResult = await this.client.fetchSubject(subjectId, signal);
        const stored = {
          version: SUBJECT_CACHE_VERSION,
          subjectId,
          fetchedAt: this.now(),
          ...subjectResult,
        };
        if (stored.resolved) this.storage.saveSubjectMeta(subjectId, stored);
        return stored;
      } catch (error) {
        if (error.name === "AbortError") throw error;
        return {
          version: SUBJECT_CACHE_VERSION,
          subjectId,
          fetchedAt: 0,
          score: null,
          hasScore: false,
          date: null,
          isPartial: false,
          totalEpisodes: null,
          resolved: false,
          source: "error",
          error: error.message || "评分请求失败",
        };
      }
    }

    getStar(info) {
      if (!info || !info.hasScore || !info.date) return 0;
      const releaseDate = new Date(`${info.date}T00:00:00`);
      if (
        Number.isNaN(releaseDate.getTime()) ||
        releaseDate.getTime() > this.now()
      )
        return 0;

      const currentYear = new Date(this.now()).getFullYear();
      const dateYear = Number(String(info.date).slice(0, 4));
      if (info.isPartial && dateYear === currentYear) return 0;
      if (!info.isPartial && info.date === `${currentYear}-01-01`) return 0;
      if (
        this.subjectType === "anime" &&
        (!Number.isFinite(info.totalEpisodes) || info.totalEpisodes === 0)
      )
        return 0;

      if (info.score >= 8) return 6;
      if (info.score >= 7) return 5;
      if (info.score >= 6) return 4;
      if (info.score >= 5) return 3;
      if (info.score >= 4) return 2;
      return 1;
    }

    shuffle(items) {
      const result = [...items];
      for (let index = result.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(this.random() * (index + 1));
        [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
      }
      return result;
    }

    async cards(items, count, signal) {
      const selected = this.shuffle(items).slice(0, count);
      return Promise.all(
        selected.map(async (item) => {
          try {
            const info = await this.getSubjectInfo(
              subjectIdFromLink(item.link) || item.id,
              signal,
            );
            return { ...item, info, star: this.getStar(info) };
          } catch (error) {
            if (error.name === "AbortError") throw error;
            return {
              ...item,
              info: {
                hasScore: false,
                score: null,
                date: null,
                totalEpisodes: null,
                source: "error",
                resolved: false,
              },
              star: 0,
            };
          }
        }),
      );
    }
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  const CSS = `
        .ark-gacha-launcher {
            position: fixed; right: 25px; bottom: 85px; z-index: 9999;
            width: 56px; height: 56px; border: 0; border-radius: 50%;
            color: #fff; background: linear-gradient(135deg, #f09199, #f2a2a9);
            box-shadow: 0 5px 18px rgba(240, 145, 153, .48); cursor: pointer;
            font-size: 28px; line-height: 1; transition: .3s cubic-bezier(.175,.885,.32,1.275);
        }
        .ark-gacha-launcher:hover { transform: translateY(-5px) scale(1.08) rotate(9deg); }
        .ark-gacha-mask {
            position: fixed; inset: 0; z-index: 10000; display: none;
            align-items: center; justify-content: center; padding: 14px;
            background: rgba(0, 0, 0, .74); backdrop-filter: blur(8px);
        }
        .ark-gacha-modal {
            width: 95%; max-width: 800px; max-height: 86vh; overflow-y: auto;
            box-sizing: border-box; padding: 24px; border-radius: 24px;
            background: #fff; color: #333; box-shadow: 0 12px 48px rgba(0,0,0,.24);
            animation: ark-gacha-modal-in .3s ease-out; scrollbar-width: none;
        }
        .ark-gacha-modal::-webkit-scrollbar { display: none; }
        [data-theme='dark'] .ark-gacha-modal, body[data-theme='dark'] .ark-gacha-modal {
            background: #2d2e2f; color: #eee;
        }
        @keyframes ark-gacha-modal-in {
            from { opacity: 0; transform: scale(.95); }
            to { opacity: 1; transform: scale(1); }
        }
        .ark-gacha-tabs {
            display: flex; gap: 4px; margin-bottom: 20px; overflow-x: auto;
            flex-shrink: 0; border-bottom: 2px solid #f1f1f1; scrollbar-width: none;
        }
        [data-theme='dark'] .ark-gacha-tabs, body[data-theme='dark'] .ark-gacha-tabs { border-color: #444; }
        .ark-gacha-tabs::-webkit-scrollbar { display: none; }
        .ark-gacha-tab {
            flex: 0 0 auto; margin: 0; padding: 8px 16px; border: 0; border-bottom: 3px solid transparent;
            border-radius: 0; appearance: none; background: transparent; box-shadow: none;
            color: #888; cursor: pointer; font: inherit; font-size: 14px; line-height: normal;
            white-space: nowrap; transition: .2s;
        }
        .ark-gacha-tab:hover, .ark-gacha-tab.active { color: #f09199; }
        .ark-gacha-tab.active { border-bottom-color: #f09199; font-weight: 700; }
        .ark-gacha-result-grid {
            display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px;
            width: 100%; box-sizing: border-box; padding: 4px; align-content: start; align-items: start;
        }
        .ark-gacha-result-grid.ten-gacha {
            grid-template-columns: repeat(5, minmax(0, 1fr)); grid-template-rows: repeat(2, auto);
        }
        .ark-gacha-message {
            grid-column: 1 / -1; display: flex; align-items: center; justify-content: center;
            box-sizing: border-box; min-height: 300px; padding: 40px 0; color: #aaa; font-size: 14px; text-align: center;
        }
        .ark-gacha-card {
            position: relative; display: flex; flex-direction: column; overflow: hidden;
            min-width: 0; border: 1px solid #eee; border-radius: 10px; background: #fff;
            box-shadow: 0 2px 8px rgba(0,0,0,.04); cursor: pointer; opacity: 0;
            transform: translateY(20px); transition: .3s;
        }
        .ark-gacha-card.card-enter { opacity: 1; transform: translateY(0); }
        .ark-gacha-card:hover { transform: translateY(-6px); border-color: #f09199; box-shadow: 0 12px 28px rgba(240,145,153,.25); }
        [data-theme='dark'] .ark-gacha-card, body[data-theme='dark'] .ark-gacha-card { background: #3a3a3a; border-color: #444; }
        .ark-gacha-cover-box {
            position: relative; display: flex; align-items: center; justify-content: center;
            width: 100%; aspect-ratio: 2 / 2.8; overflow: hidden; background: #f5f5f5;
            border-bottom: 2px solid #f09199;
        }
        [data-theme='dark'] .ark-gacha-cover-box, body[data-theme='dark'] .ark-gacha-cover-box { background: #444; }
        .ark-gacha-cover-img { display: block; width: 100%; height: 100%; object-fit: cover; }
        .ark-gacha-cover-placeholder { color: #aaa; font-size: 24px; }
        .ark-gacha-title {
            position: relative; z-index: 2; display: flex; align-items: center; justify-content: center;
            box-sizing: border-box; min-height: calc(2.4em + 12px); height: var(--ark-gacha-title-height, auto); padding: 6px 4px;
            color: #fff; font-size: 12px; font-weight: 700; line-height: 1.2;
            text-align: center; text-shadow: 0 1px 2px rgba(0,0,0,.55);
            overflow: hidden; overflow-wrap: anywhere; word-break: break-word;
        }
        .ark-gacha-title.title-bg-0star { background: linear-gradient(135deg, #121200, #000); }
        .ark-gacha-title.title-bg-6star { background: linear-gradient(135deg, #ff9c00, #e68a00); }
        .ark-gacha-title.title-bg-5star { background: linear-gradient(135deg, #ffd700, #e6c300); }
        .ark-gacha-title.title-bg-4star { background: linear-gradient(135deg, #9623ff, #851ae6); }
        .ark-gacha-title.title-bg-3star { background: linear-gradient(135deg, #4d88ff, #3a75e6); }
        .ark-gacha-title.title-bg-2star { background: linear-gradient(135deg, #b0c4de, #9fb6cd); }
        .ark-gacha-title.title-bg-1star { background: linear-gradient(135deg, #7f7f7f, #6e6e6e); }
        .ark-gacha-score { padding: 4px; color: #444; font-size: 11px; font-weight: 700; text-align: center; }
        .ark-gacha-score.score-bg-0star { background: rgba(0, 0, 0, .14); }
        .ark-gacha-score.score-bg-1star { background: rgba(127, 127, 127, .14); }
        .ark-gacha-score.score-bg-2star { background: rgba(176, 196, 222, .14); }
        .ark-gacha-score.score-bg-3star { background: rgba(77, 136, 255, .14); }
        .ark-gacha-score.score-bg-4star { background: rgba(150, 35, 255, .14); }
        .ark-gacha-score.score-bg-5star { background: rgba(255, 215, 0, .14); }
        .ark-gacha-score.score-bg-6star { background: rgba(255, 156, 0, .14); }
        [data-theme='dark'] .ark-gacha-score, body[data-theme='dark'] .ark-gacha-score { color: #ddd; }
        .ark-gacha-effect {
            position: absolute; inset: 0; z-index: 1; pointer-events: none; opacity: 0;
            animation: ark-gacha-effect-fade 1.8s ease-out forwards;
        }
        .ark-gacha-effect.effect-0star {
            background: radial-gradient(circle at center, rgba(30,30,30,.82) 0%, rgba(0,0,0,.96) 58%, rgba(0,0,0,1) 100%);
        }
        .ark-gacha-effect.effect-1star {
            background: radial-gradient(circle at center, rgba(127,127,127,.68) 0%, rgba(90,90,90,.88) 58%, rgba(0,0,0,.96) 100%);
        }
        .ark-gacha-effect.effect-2star {
            background: radial-gradient(circle at center, rgba(176,196,222,.68) 0%, rgba(125,145,170,.88) 58%, rgba(0,0,0,.96) 100%);
        }
        .ark-gacha-effect.effect-3star {
            background: radial-gradient(circle at center, rgba(77,136,255,.72) 0%, rgba(48,92,205,.9) 58%, rgba(0,0,0,.96) 100%);
        }
        .ark-gacha-effect.effect-4star {
            background: radial-gradient(circle at center, rgba(150,35,255,.74) 0%, rgba(105,20,190,.92) 58%, rgba(0,0,0,.96) 100%);
        }
        .ark-gacha-effect.effect-5star {
            background: radial-gradient(circle at center, rgba(255,215,0,.76) 0%, rgba(210,160,0,.93) 58%, rgba(0,0,0,.96) 100%);
        }
        .ark-gacha-effect.effect-6star {
            background: radial-gradient(circle at center, rgba(255,156,0,.76) 0%, rgba(215,92,0,.94) 58%, rgba(0,0,0,.96) 100%);
        }
        @keyframes ark-gacha-effect-fade {
            0% { opacity: .72; }
            32% { opacity: 1; }
            100% { opacity: 0; }
        }
        .ark-gacha-footer {
            display: flex; align-items: flex-end; justify-content: space-between; flex-wrap: wrap;
            flex-shrink: 0; gap: 12px; margin-top: 24px;
        }
        .ark-gacha-info-area { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
        .ark-gacha-pool-box { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
        .ark-gacha-pool-info { color: #bbb; font-size: 11px; letter-spacing: .5px; }
        .ark-gacha-refresh-btn {
            width: auto; min-width: 0; height: auto; margin: 0; padding: 0; border: 0;
            appearance: none; background: transparent; box-shadow: none;
            color: inherit; cursor: pointer; font: inherit; font-size: 12px; line-height: 1;
            opacity: .5; transition: .2s;
        }
        .ark-gacha-refresh-btn:hover { color: #f09199; opacity: 1; transform: rotate(45deg); }
        .ark-gacha-progress { color: #f09199; font-size: 12px; font-weight: 700; }
        .ark-gacha-progress-wrap { display: flex; align-items: center; gap: 8px; }
        .ark-gacha-progress-wrap[hidden] { display: none; }
        .ark-gacha-mini-btn {
            padding: 4px 10px; border: 1px solid #eee; border-radius: 8px;
            background: #fff; color: #999; font-size: 11px; cursor: pointer; transition: .2s;
        }
        [data-theme='dark'] .ark-gacha-mini-btn, body[data-theme='dark'] .ark-gacha-mini-btn { background: #3a3a3a; border-color: #555; color: #ccc; }
        .ark-gacha-mini-btn:hover { border-color: #f09199; color: #f09199; }
        .ark-gacha-logs { display: flex; flex-direction: column; max-width: 430px; max-height: 44px; overflow: hidden; color: #aaa; font-size: 10px; line-height: 1.4; }
        .ark-gacha-log-error { color: #e57373; }
        .ark-gacha-confirm {
            display: flex; align-items: center; justify-content: space-between; gap: 10px;
            margin-top: 12px; padding: 10px 12px; border: 1px solid #f6d4d7; border-radius: 10px;
            background: #fff8f8; color: #a85c63; font-size: 12px;
        }
        .ark-gacha-confirm[hidden] { display: none; }
        [data-theme='dark'] .ark-gacha-confirm, body[data-theme='dark'] .ark-gacha-confirm { background: #422f31; border-color: #654447; color: #f0aeb4; }
        .ark-gacha-confirm-actions { display: flex; flex: 0 0 auto; gap: 6px; }
        .ark-gacha-confirm button { padding: 5px 8px; border: 1px solid #f0b9be; border-radius: 7px; background: transparent; color: inherit; cursor: pointer; font-size: 11px; }
        .ark-gacha-confirm button.primary { background: #f09199; color: #fff; border-color: #f09199; }
        .ark-gacha-btn-group { display: flex; gap: 8px; width: 100%; max-width: 320px; }
        .ark-gacha-main-btn {
            flex: 1; padding: 10px 0; border: 0; border-radius: 50px; color: #fff;
            background: linear-gradient(135deg, #f09199, #f2a2a9); box-shadow: 0 5px 16px rgba(240,145,153,.28);
            cursor: pointer; font-size: 15px; font-weight: 700; transition: .2s;
        }
        .ark-gacha-main-btn:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 8px 22px rgba(240,145,153,.44); }
        .ark-gacha-main-btn:active:not(:disabled) { transform: scale(.96); }
        .ark-gacha-main-btn:disabled { background: #ddd; color: #aaa; box-shadow: none; cursor: wait; }
        @media (max-width: 600px) {
            .ark-gacha-launcher { right: 18px; bottom: 72px; width: 52px; height: 52px; }
            .ark-gacha-modal { width: 96%; max-height: 90vh; padding: 16px; }
            .ark-gacha-result-grid { gap: 8px; }
            .ark-gacha-result-grid.ten-gacha { gap: 6px; }
            .ark-gacha-message { min-height: 230px; padding: 20px 0; }
            .ark-gacha-title { min-height: calc(2.4em + 8px); padding: 4px 2px; font-size: 10px; }
            .ark-gacha-score { padding: 2px; font-size: 9px; }
            .ark-gacha-footer { flex-direction: column; align-items: stretch; margin-top: 16px; }
            .ark-gacha-info-area { align-items: center; text-align: center; }
            .ark-gacha-pool-box { justify-content: center; }
            .ark-gacha-btn-group { width: 100%; max-width: 100%; }
            .ark-gacha-main-btn { flex: 1; padding: 12px 0; }
            .ark-gacha-confirm { align-items: stretch; flex-direction: column; }
            .ark-gacha-confirm-actions button { flex: 1; }
        }
    `;

  class GachaView {
    constructor(session) {
      this.session = session;
      this.logs = [];
      this.notifications = [];
      this.progressMessage = "";
      this.progressVisible = false;
      this.titleHeightFrame = null;
      this.renderStyles();
      this.renderLauncher();
      this.renderModal();
      window.addEventListener("resize", () => this.scheduleTitleHeightSync());
    }
    renderStyles() {
      if (document.querySelector("style[data-bangumi-ark-gacha-style]")) return;
      const style = document.createElement("style");
      style.dataset.bangumiArkGachaStyle = "true";
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    renderLauncher() {
      const launcher = document.createElement("button");
      launcher.type = "button";
      launcher.className = "ark-gacha-launcher";
      launcher.dataset.bangumiArkGacha = "launcher";
      launcher.textContent = "🎲";
      launcher.title = "打开收藏扭蛋机";
      launcher.addEventListener("click", () => {
        this.toggleModal(true);
        this.session.open();
      });
      document.body.appendChild(launcher);
      this.launcher = launcher;
    }

    renderModal() {
      const mask = document.createElement("div");
      mask.className = "ark-gacha-mask";
      mask.dataset.bangumiArkGacha = "modal";
      mask.innerHTML = `
                <div class="ark-gacha-modal" role="dialog" aria-label="收藏扭蛋机">
                    <div class="ark-gacha-tabs">
                        ${["all", ...STATUS_IDS]
                          .map(
                            (status) => `
                            <button type="button" class="ark-gacha-tab ${status === this.session.currentStatus ? "active" : ""}" data-status="${status}">${this.session.statusLabels[status]}</button>
                        `,
                          )
                          .join("")}
                    </div>
                    <div class="ark-gacha-result-grid" id="ark-gacha-result">
                        <div class="ark-gacha-message">打开扭蛋机开始读取收藏</div>
                    </div>
                    <div class="ark-gacha-confirm" id="ark-gacha-confirm" hidden></div>
                    <div class="ark-gacha-footer">
                        <div class="ark-gacha-info-area">
                            <div class="ark-gacha-pool-box">
                                <span class="ark-gacha-pool-info" id="ark-gacha-info">POOL: 0</span>
                                <button type="button" class="ark-gacha-refresh-btn" id="ark-gacha-refresh" title="全量更新当前收藏范围">🔄</button>
                            </div>
                            <div class="ark-gacha-progress-wrap" id="ark-gacha-progress-wrap" hidden>
                                <span class="ark-gacha-progress" id="ark-gacha-progress">准备同步...</span>
                            </div>
                            <div class="ark-gacha-logs" id="ark-gacha-logs"></div>
                        </div>
                        <div class="ark-gacha-btn-group">
                            <button type="button" class="ark-gacha-main-btn" id="ark-gacha-run-3" disabled>🎲 一键三连</button>
                            <button type="button" class="ark-gacha-main-btn" id="ark-gacha-run-10" disabled>✨ 一发十连</button>
                        </div>
                    </div>
                </div>
            `;
      document.body.appendChild(mask);

      this.ui = {
        mask,
        result: mask.querySelector("#ark-gacha-result"),
        info: mask.querySelector("#ark-gacha-info"),
        refresh: mask.querySelector("#ark-gacha-refresh"),
        progressWrap: mask.querySelector("#ark-gacha-progress-wrap"),
        progress: mask.querySelector("#ark-gacha-progress"),
        logs: mask.querySelector("#ark-gacha-logs"),
        confirm: mask.querySelector("#ark-gacha-confirm"),
        run3: mask.querySelector("#ark-gacha-run-3"),
        run10: mask.querySelector("#ark-gacha-run-10"),
      };

      mask.querySelectorAll(".ark-gacha-tab").forEach((tab) => {
        tab.addEventListener("click", () =>
          this.session.selectStatus(tab.dataset.status),
        );
      });
      mask.addEventListener("click", (event) => {
        if (event.target === mask) this.toggleModal(false);
      });
      this.ui.refresh.addEventListener("click", () =>
        this.session.forceRefresh(),
      );
      this.ui.run3.addEventListener("click", () => this.session.draw(3));
      this.ui.run10.addEventListener("click", () => this.session.draw(10));
    }

    toggleModal(open) {
      this.ui.mask.style.display = open ? "flex" : "none";
      if (open) this.scheduleTitleHeightSync();
    }

    setStatus(message) {
      this.progressMessage = message;
      this.renderStatus();
    }

    notify(message) {
      this.notifications.push(message);
      if (this.notifications.length === 1) this.showNextNotification();
    }

    showNextNotification() {
      this.renderStatus();
      this.renderStatusVisibility();
      if (!this.notifications.length) return;
      this.session.browser.setTimeout(() => {
        this.notifications.shift();
        this.showNextNotification();
      }, 5000);
    }

    renderStatus() {
      this.ui.progress.textContent =
        this.loginMessage || this.notifications[0] || this.progressMessage;
    }

    setLoginNotice(message) {
      this.loginMessage = message;
      this.renderStatus();
      this.renderStatusVisibility();
    }

    addLog(message, error = false) {
      this.logs.push({ message: String(message), error });
      if (this.logs.length > 4) this.logs.shift();
      this.ui.logs.replaceChildren(
        ...this.logs.map((entry) => {
          const line = document.createElement("span");
          line.textContent = entry.message;
          if (entry.error) line.className = "ark-gacha-log-error";
          return line;
        }),
      );
    }

    clearLogs() {
      this.logs = [];
      this.ui.logs.replaceChildren();
    }

    hasResultMessage() {
      return (
        Boolean(this.ui.result.querySelector(".ark-gacha-message")) &&
        !this.session.busy
      );
    }

    setResultMessage(message) {
      this.ui.result.style.removeProperty("--ark-gacha-title-height");
      this.ui.result.className = "ark-gacha-result-grid";
      this.ui.result.innerHTML = `<div class="ark-gacha-message">${escapeHtml(message)}</div>`;
    }

    scheduleTitleHeightSync() {
      if (this.titleHeightFrame != null)
        window.cancelAnimationFrame(this.titleHeightFrame);
      this.titleHeightFrame = window.requestAnimationFrame(() => {
        this.titleHeightFrame = null;
        if (this.ui.mask.style.display !== "flex") return;
        const titles = Array.from(
          this.ui.result.querySelectorAll(".ark-gacha-title"),
        );
        if (!titles.length) {
          this.ui.result.style.removeProperty("--ark-gacha-title-height");
          return;
        }

        this.ui.result.style.removeProperty("--ark-gacha-title-height");
        const maxHeight = Math.max(
          ...titles.map((title) => Math.ceil(title.scrollHeight)),
        );
        this.ui.result.style.setProperty(
          "--ark-gacha-title-height",
          `${maxHeight}px`,
        );
      });
    }

    updateInfo(suffix = "") {
      this.ui.info.textContent = `POOL: ${this.session.pool.length}${suffix ? ` ${suffix}` : ""}`;
    }

    updateButtons() {
      const disabled = this.session.busy || !this.session.complete;
      this.ui.run3.disabled = disabled || this.session.pool.length < 3;
      this.ui.run10.disabled = disabled || this.session.pool.length < 10;
      this.ui.refresh.disabled = false;
    }

    setProgressVisible(visible) {
      this.progressVisible = visible;
      this.renderStatusVisibility();
    }

    renderStatusVisibility() {
      this.ui.progressWrap.hidden =
        !this.progressVisible &&
        !this.notifications.length &&
        !this.loginMessage;
    }

    selectStatus(status) {
      this.ui.mask.querySelectorAll(".ark-gacha-tab").forEach((tab) => {
        tab.classList.toggle("active", tab.dataset.status === status);
      });
    }

    setShuffling(shuffling) {
      this.ui.result.classList.toggle("ark-gacha-shuffling", shuffling);
    }

    showPreparingCards(count) {
      this.ui.result.className = `ark-gacha-result-grid${count === 10 ? " ten-gacha" : ""}`;
      this.ui.result.innerHTML =
        '<div class="ark-gacha-message">正在获取选中条目的评分...</div>';
    }

    showCards(cardData, count) {
      this.ui.result.replaceChildren();
      cardData.forEach((data, index) => {
        const card = this.createCard(data);
        this.ui.result.appendChild(card);
        window.setTimeout(
          () => card.classList.add("card-enter"),
          index * (count === 10 ? 120 : 260),
        );
      });
      this.scheduleTitleHeightSync();
      if (document.fonts?.ready)
        document.fonts.ready.then(() => this.scheduleTitleHeightSync());
    }

    hideConfirm() {
      this.ui.confirm.hidden = true;
      this.ui.confirm.replaceChildren();
    }

    showFailure(canUseCache) {
      this.ui.confirm.hidden = false;
      this.ui.confirm.innerHTML = `
                <span>当前范围获取失败，请选择后续操作</span>
                <span class="ark-gacha-confirm-actions">
                    ${canUseCache ? '<button type="button" data-action="keep">继续使用缓存</button>' : ""}
                    <button type="button" class="primary" data-action="refresh">全量更新</button>
                </span>
            `;
      this.ui.confirm
        .querySelector('[data-action="keep"]')
        ?.addEventListener("click", () => this.hideConfirm());
      this.ui.confirm
        .querySelector('[data-action="refresh"]')
        .addEventListener("click", () => {
          this.hideConfirm();
          this.session.forceRefresh();
        });
    }

    createCard(data) {
      const card = document.createElement("div");
      card.className = "ark-gacha-card";
      card.tabIndex = 0;
      card.setAttribute("role", "link");

      const effect = document.createElement("div");
      effect.className = `ark-gacha-effect effect-${data.star}star`;
      const coverBox = document.createElement("div");
      coverBox.className = "ark-gacha-cover-box";
      if (data.cover) {
        const image = document.createElement("img");
        image.className = "ark-gacha-cover-img";
        image.src = data.cover;
        image.alt = data.title;
        image.addEventListener(
          "error",
          () => {
            image.remove();
            const placeholder = document.createElement("span");
            placeholder.className = "ark-gacha-cover-placeholder";
            placeholder.textContent = "✦";
            coverBox.appendChild(placeholder);
          },
          { once: true },
        );
        coverBox.appendChild(image);
      } else {
        const placeholder = document.createElement("span");
        placeholder.className = "ark-gacha-cover-placeholder";
        placeholder.textContent = "✦";
        coverBox.appendChild(placeholder);
      }

      const title = document.createElement("div");
      title.className = `ark-gacha-title title-bg-${data.star}star`;
      title.textContent = data.title || "无标题条目";
      const score = document.createElement("div");
      score.className = `ark-gacha-score score-bg-${data.star}star`;
      score.textContent = `评分：${data.info.hasScore ? data.info.score : "无"}`;

      card.append(effect, coverBox, title, score);
      const openSubject = () => {
        const opened = window.open(data.link, "_blank", "noopener");
        if (opened) opened.opener = null;
      };
      card.addEventListener("click", openSubject);
      card.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openSubject();
        }
      });
      return card;
    }
  }

  const MAX_FALLBACK_PAGES = 10000;
  function sleep(ms, browser) {
    return new Promise((resolve) => browser.setTimeout(resolve, ms));
  }

  class GachaSession {
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
        ? uniqueItems(
            statuses.flatMap((status) => this.storage.getItems(status)),
          )
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
        intents: new Set(
          intent ? [...previousIntents, intent] : previousIntents,
        ),
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
          if (this.targetStatuses().includes(status))
            this.updateResultMessage();
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
        const remaining = Array.from(
          { length: totalPages - 1 },
          (_, i) => i + 2,
        );
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
      const browser = createBrowserAdapter();
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
})();
