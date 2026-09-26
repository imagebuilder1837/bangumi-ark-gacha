import { uniqueItems, normalizeItem, subjectIdFromLink } from "./shared.mjs";
const PAGE_TIMEOUT_MS = 10000;
const SCORE_TIMEOUT_MS = 5000;
function pageNumberFromHref(href) {
  try {
    const url = new URL(href, window.location.origin);
    const page = Number(url.searchParams.get("page"));
    return Number.isFinite(page) && page > 0 ? page : null;
  } catch (error) {
    return null;
  }
}

export function pageInfo(doc) {
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
        pageNumberFromHref(node.getAttribute("href") || "") ||
        Number(node.textContent),
    )
    .filter((page) => Number.isFinite(page) && page > 0);

  return {
    totalPages: pageNumbers.length ? Math.max(...pageNumbers) : 1,
    reliable: false,
  };
}

export function parseListPage(doc) {
  return Array.from(doc.querySelectorAll("#browserItemList li.item"))
    .map((li) => {
      const linkElement = li.querySelector("h3 a");
      if (!linkElement) return null;
      const link = linkElement.href || linkElement.getAttribute("href") || "";
      const id = subjectIdFromLink(link);
      if (!id) return null;
      return normalizeItem({
        id,
        title: linkElement.textContent || linkElement.innerText || "",
        link,
        cover: li.querySelector("img.cover")?.getAttribute("src") || "",
      });
    })
    .filter(Boolean);
}

async function fetchText(url, options = {}, transport = fetch) {
  const { signal, timeoutMs = PAGE_TIMEOUT_MS, cache = "default" } = options;
  const controller = new AbortController();
  let timedOut = false;
  let abortListener = null;
  const timer = window.setTimeout(() => {
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
    window.clearTimeout(timer);
    if (signal && abortListener)
      signal.removeEventListener("abort", abortListener);
  }
}

export function createBangumiClient({
  subjectType,
  userId,
  transport = fetch,
  parse = (html) => new DOMParser().parseFromString(html, "text/html"),
}) {
  return {
    async fetchListPage(status, page, signal, noStore = false) {
      const path = `/${subjectType}/list/${encodeURIComponent(userId)}/${status}`;
      const url = page === 1 ? path : `${path}?page=${page}`;
      const html = await fetchText(
        url,
        { signal, cache: noStore ? "no-store" : "default" },
        transport,
      );
      const doc = parse(html);
      return {
        items: uniqueItems(parseListPage(doc)),
        pageInfo: pageInfo(doc),
      };
    },
    async fetchSubject(subjectId, signal) {
      return parse(
        await fetchText(
          `/subject/${subjectId}`,
          { signal, timeoutMs: SCORE_TIMEOUT_MS },
          transport,
        ),
      );
    },
  };
}
