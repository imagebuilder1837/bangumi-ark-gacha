export const STATUS_IDS = ["wish", "do", "on_hold", "collect", "dropped"];
const SUBJECT_ACTIONS = {
  anime: "看",
  real: "看",
  game: "玩",
  book: "读",
  music: "听",
};

export function statusLabelsFor(subjectType) {
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

export function subjectIdFromLink(link) {
  const match = String(link || "").match(/\/subject\/(\d+)/);
  return match ? match[1] : "";
}

export function normalizeItem(item, origin) {
  if (!item || !item.id) return null;
  return {
    id: String(item.id),
    title: String(item.title || "").trim(),
    link: String(item.link || ""),
    cover: normalizeCover(item.cover || "", origin),
  };
}

export function uniqueItems(items, origin) {
  const seen = new Set();
  return (Array.isArray(items) ? items : [])
    .map((item) => normalizeItem(item, origin))
    .filter((item) => {
      if (!item || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
}

export function firstPageFingerprint(items) {
  const core = uniqueItems(items).map((item) => ({
    id: item.id,
    title: item.title,
    link: item.link,
    cover: normalizeCover(item.cover),
  }));
  return JSON.stringify(core);
}

export function firstPageSnapshot(items, now = Date.now) {
  const normalized = uniqueItems(items);
  return {
    items: normalized,
    fingerprint: firstPageFingerprint(normalized),
    checkedAt: now(),
  };
}
