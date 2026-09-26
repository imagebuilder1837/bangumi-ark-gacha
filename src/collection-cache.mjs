import { uniqueItems, STATUS_IDS } from "./shared.mjs";
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

export class GachaStorage {
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
    if (!STATUS_IDS.includes(status) || !validItems(items) || !validMeta(meta))
      throw new Error("收藏缓存数据无效");
    // A single key is the publication point; an unsuccessful setItem leaves the old record intact.
    this.writeJson(this.recordKey(status), { items: uniqueItems(items), meta });
  }
}
