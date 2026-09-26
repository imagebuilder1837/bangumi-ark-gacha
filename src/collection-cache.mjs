import { uniqueItems } from "./shared.mjs";
const STORAGE_PREFIX = "bangumi-ark-gacha";
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

  subjectKey(subjectId) {
    return `${STORAGE_PREFIX}:subject:${subjectId}`;
  }

  readJson(key, fallback) {
    try {
      const raw = this.storage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (error) {
      return fallback;
    }
  }

  writeJson(key, value) {
    this.storage.setItem(key, JSON.stringify(value));
  }

  getItems(status) {
    return uniqueItems(this.readJson(this.listKey(status), []));
  }

  getMeta(status) {
    const meta = this.readJson(this.metaKey(status), null);
    return meta && typeof meta === "object" ? meta : null;
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

  clearSubjectMeta(subjectIds) {
    const ids = new Set((subjectIds || []).map(String).filter(Boolean));
    ids.forEach((id) => this.storage.removeItem(this.subjectKey(id)));
  }

  commitStatus(status, items, meta) {
    const listKey = this.listKey(status);
    const metaKey = this.metaKey(status);
    const listTempKey = `${listKey}:tmp`;
    const metaTempKey = `${metaKey}:tmp`;
    const oldList = this.storage.getItem(listKey);
    const oldMeta = this.storage.getItem(metaKey);

    try {
      this.writeJson(listTempKey, uniqueItems(items));
      this.writeJson(metaTempKey, meta);
      this.storage.setItem(listKey, this.storage.getItem(listTempKey));
      this.storage.setItem(metaKey, this.storage.getItem(metaTempKey));
      this.storage.removeItem(listTempKey);
      this.storage.removeItem(metaTempKey);
    } catch (error) {
      if (oldList == null) this.storage.removeItem(listKey);
      else this.storage.setItem(listKey, oldList);
      if (oldMeta == null) this.storage.removeItem(metaKey);
      else this.storage.setItem(metaKey, oldMeta);
      this.storage.removeItem(listTempKey);
      this.storage.removeItem(metaTempKey);
      throw error;
    }
  }
}
