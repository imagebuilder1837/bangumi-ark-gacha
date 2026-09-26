import { uniqueItems, normalizeItem, subjectIdFromLink } from "./shared.mjs";
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
    const nodes = Array.from(doc.querySelectorAll("#infobox li, .infobox li"));
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
    if (full) {
      const date = `${full[1]}-${full[2].padStart(2, "0")}-${full[3].padStart(2, "0")}`;
      const parsed = new Date(`${date}T00:00:00`);
      return Number.isNaN(parsed.getTime())
        ? { date: null, isPartial: false }
        : { date, isPartial: false };
    }

    const month = dateString.match(/^(\d{4})[-/]([01]?\d)$/);
    if (month)
      return {
        date: `${month[1]}-${month[2].padStart(2, "0")}-01`,
        isPartial: true,
      };
    const cnFull = dateString.match(/^(\d{4})年\s*([01]?\d)月\s*([0-3]?\d)日$/);
    if (cnFull) {
      const date = `${cnFull[1]}-${cnFull[2].padStart(2, "0")}-${cnFull[3].padStart(2, "0")}`;
      const parsed = new Date(`${date}T00:00:00`);
      return Number.isNaN(parsed.getTime())
        ? { date: null, isPartial: false }
        : { date, isPartial: false };
    }
    const cnMonth = dateString.match(/^(\d{4})年\s*([01]?\d)月$/);
    if (cnMonth)
      return {
        date: `${cnMonth[1]}-${cnMonth[2].padStart(2, "0")}-01`,
        isPartial: true,
      };
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

export function pageInfo(doc, origin) {
  const edge = doc.querySelector(".p_edge");
  const edgeText = edge ? edge.textContent || "" : "";
  const edgeMatch = edgeText.match(/(\d+)\s*\/\s*(\d+)/);
  if (edgeMatch) {
    return { totalPages: Math.max(1, Number(edgeMatch[2])), reliable: true };
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

export function parseListPage(doc, origin) {
  if (!doc.querySelector("#browserItemList"))
    throw new Error("收藏列表结构无效");
  const entries = Array.from(doc.querySelectorAll("#browserItemList li.item"));
  if (entries.some((li) => !li.querySelector("h3 a[href*='/subject/']")))
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
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
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

export function createBangumiClient({
  subjectType,
  userId,
  transport = fetch,
  browser = {
    origin: window.location.origin,
    parse: (html) => new DOMParser().parseFromString(html, "text/html"),
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    clearTimeout: (id) => window.clearTimeout(id),
  },
}) {
  return {
    async fetchListPage(status, page, signal, noStore = false) {
      const path = `/${subjectType}/list/${encodeURIComponent(userId)}/${status}`;
      const url = page === 1 ? path : `${path}?page=${page}`;
      const html = await fetchText(
        url,
        { signal, cache: noStore ? "no-store" : "default" },
        transport,
        browser,
      );
      const doc = browser.parse(html);
      return {
        items: uniqueItems(parseListPage(doc, browser.origin), browser.origin),
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
