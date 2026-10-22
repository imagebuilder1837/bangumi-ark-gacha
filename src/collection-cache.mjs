import { uniqueItems, STATUS_IDS } from "./shared.mjs";
import {
  validCachedSubject,
  SCORE_TTL_MS,
  SUBJECT_CACHE_VERSION,
} from "./subject-cache-policy.mjs";
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
    meta.totalPages >= 1 &&
    (meta.version === undefined ||
      (Number.isInteger(meta.version) &&
        meta.version >= 1 &&
        meta.version <= 2))
  );
}
function parseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function environmentStorage(name) {
  try {
    return globalThis[name];
  } catch {
    return null;
  }
}
function validRecord(record) {
  return validItems(record?.items) && validMeta(record?.meta);
}

export class GachaStorage {
  constructor(
    userId,
    subjectType,
    {
      indexedDB = environmentStorage("indexedDB"),
      legacy = environmentStorage("localStorage"),
      now = Date.now,
    } = {},
  ) {
    this.indexedDB = indexedDB;
    this.legacy = legacy;
    this.now = now;
    this.subjects = new Map();
    this.userId = String(userId);
    this.subjectType = String(subjectType);
    this.records = new Map();
    this.loading = new Map();
    this.pending = new Map();
    this.error = null;
    this.listeners = new Set();
    this.writes = new Map();
    this.saving = 0;
  }
  recordKey(status) {
    return `${STORAGE_PREFIX}:record:${this.userId}:${this.subjectType}:${status}`;
  }
  openDatabase() {
    if (!this.connection)
      this.connection = new Promise((resolve, reject) => {
        let settled = false;
        const fail = (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(error);
        };
        const timer = setTimeout(
          () => fail(new Error("打开缓存超时，可重试保存")),
          3000,
        );
        let request;
        try {
          request = this.indexedDB.open(STORAGE_PREFIX, 1);
        } catch (error) {
          fail(error);
          return;
        }
        request.onupgradeneeded = () => {
          if (settled) {
            request.transaction.abort();
            return;
          }
          const db = request.result;
          db.createObjectStore("collections");
          db.createObjectStore("subjects");
        };
        request.onblocked = () =>
          fail(new Error("缓存升级被其他标签页阻塞，请关闭旧标签页后重试"));
        request.onerror = () => fail(request.error);
        request.onsuccess = () => {
          const db = request.result;
          if (settled) {
            db.close();
            return;
          }
          settled = true;
          clearTimeout(timer);
          const closed = (message) => {
            db.close();
            this.error = new Error(message);
            this.emit();
          };
          db.onversionchange = () =>
            closed("缓存已在其他标签页升级，请刷新页面");
          db.onclose = () => closed("缓存连接已关闭，可重试保存");
          resolve(db);
        };
      });
    return this.connection;
  }
  async transaction(storeName, mode, work) {
    const db = await this.openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      let result;
      const timer = setTimeout(() => {
        try {
          tx.abort();
        } catch {
          /* already finished */
        }
        reject(new Error("缓存读写超时，可重试保存"));
      }, 3000);
      // A successful request is not a committed transaction.
      tx.oncomplete = () => {
        clearTimeout(timer);
        resolve(result);
      };
      tx.onabort = () => {
        clearTimeout(timer);
        reject(tx.error || new Error("缓存事务已取消"));
      };
      try {
        work(tx.objectStore(storeName), (value) => {
          result = value;
        });
      } catch (error) {
        clearTimeout(timer);
        try {
          tx.abort();
        } catch {
          /* already finished */
        }
        reject(error);
      }
    });
  }
  loadStatuses(statuses) {
    return Promise.all(
      statuses.map((status) => {
        if (!this.loading.has(status))
          this.loading.set(status, this.loadStatus(status));
        return this.loading.get(status);
      }),
    );
  }
  async loadStatus(status) {
    if (this.records.has(status)) return;
    const key = this.recordKey(status);
    let record = null;
    try {
      record = await this.transaction(
        "collections",
        "readonly",
        (store, done) => {
          const request = store.get(key);
          request.onsuccess = () => done(request.result);
        },
      );
    } catch (error) {
      this.error = error;
      this.emit();
    }
    if (this.records.has(status)) return;
    if (!validRecord(record)) {
      const legacy = this.legacyCollection(key);
      record = legacy.value;
      if (record)
        void this.save("collections", key, record, {
          onlyMissing: true,
          sources: legacy.sources,
        });
    }
    if (!this.records.has(status))
      this.records.set(status, validRecord(record) ? record : null);
  }
  getStatus(status) {
    return this.records.get(status) || null;
  }
  getItems(status) {
    return this.getStatus(status)?.items || [];
  }
  getMeta(status) {
    return this.getStatus(status)?.meta || null;
  }
  async commitStatus(status, items, meta) {
    if (!STATUS_IDS.includes(status) || !validItems(items) || !validMeta(meta))
      throw new Error("收藏缓存数据无效");
    const record = { items: uniqueItems(items), meta };
    // Full network data is usable even when persistence is unavailable.
    this.records.set(status, record);
    return this.save("collections", this.recordKey(status), record);
  }
  getSubjectMeta(subjectId) {
    const value = this.subjects.get(String(subjectId));
    return validCachedSubject(value, subjectId, this.now()) ? value : null;
  }
  async loadSubject(subjectId) {
    subjectId = String(subjectId);
    if (this.subjects.has(subjectId)) return this.getSubjectMeta(subjectId);
    const key = `${STORAGE_PREFIX}:subject:${subjectId}`;
    let value;
    try {
      value = await this.transaction("subjects", "readonly", (store, done) => {
        const request = store.get(key);
        request.onsuccess = () => done(request.result);
      });
    } catch (error) {
      this.error = error;
      this.emit();
    }
    if (this.subjects.has(subjectId)) return this.getSubjectMeta(subjectId);
    if (!validCachedSubject(value, subjectId, this.now())) {
      const raw = this.readLegacy(key);
      value = parseJson(raw);
      if (validCachedSubject(value, subjectId, this.now()))
        void this.save("subjects", key, value, {
          onlyMissing: true,
          sources: [[key, raw]],
        });
    }
    if (!this.subjects.has(subjectId)) this.subjects.set(subjectId, value);
    return this.getSubjectMeta(subjectId);
  }
  saveSubjectMeta(subjectId, value) {
    this.subjects.set(String(subjectId), value);
    return this.save(
      "subjects",
      `${STORAGE_PREFIX}:subject:${subjectId}`,
      value,
    );
  }
  persistenceState() {
    return {
      pending: this.pending.size > 0,
      error: this.error,
      saving: this.saving > 0,
    };
  }
  legacyCollection(key) {
    const keys = [
      key,
      key.replace(":record:", ":list:"),
      key.replace(":record:", ":meta:"),
    ];
    let sources = keys.map((key) => [key, this.readLegacy(key)]);
    const record = parseJson(sources[0][1]);
    const pair = {
      items: parseJson(sources[1][1]),
      meta: parseJson(sources[2][1]),
    };
    // Preserve unknown representations without suppressing a usable companion.
    sources = sources.filter((_, index) =>
      index === 0 ? !(record?.meta?.version > 2) : !(pair.meta?.version > 2),
    );
    const value = validRecord(record)
      ? record
      : validRecord(pair)
        ? pair
        : null;
    return {
      value: value ? { ...value, items: uniqueItems(value.items) } : null,
      sources,
    };
  }
  readLegacy(key) {
    try {
      return this.legacy?.getItem(key) ?? null;
    } catch (error) {
      console.warn("[Bangumi Ark Gacha] 旧缓存读取失败", error);
      return null;
    }
  }
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  emit() {
    for (const listener of this.listeners) listener(this.persistenceState());
  }
  removeSources(sources) {
    for (const [key, raw] of sources) {
      try {
        if (raw !== null && this.legacy?.getItem(key) === raw)
          this.legacy.removeItem(key);
      } catch (error) {
        console.warn("[Bangumi Ark Gacha] 旧缓存清理失败", error);
      }
    }
  }
  async save(
    storeName,
    key,
    value,
    { onlyMissing = false, sources = [] } = {},
  ) {
    const previous = this.pending.get(key);
    // Migration must never displace a newer network result awaiting persistence.
    if (onlyMissing && previous) {
      previous.sources.push(...sources);
      return this.writes.get(key) || false;
    }
    sources = [...(previous?.sources || []), ...sources];
    const entry = { storeName, key, value, onlyMissing, sources };
    this.pending.set(key, entry);
    const previousWrite = this.writes.get(key);
    const write = this.persist(entry, previousWrite);
    this.writes.set(key, write);
    write.finally(() => {
      if (this.writes.get(key) === write) this.writes.delete(key);
    });
    return write;
  }
  async persist(entry, previousWrite) {
    const { storeName, key, value, onlyMissing, sources } = entry;
    this.saving++;
    this.emit();
    try {
      await previousWrite;
      if (this.pending.get(key) !== entry) return true;
      await this.transaction(storeName, "readwrite", (store) => {
        if (!onlyMissing) store.put(value, key);
        else {
          const request = store.get(key);
          request.onsuccess = () => {
            if (
              !(storeName === "collections"
                ? validRecord(request.result)
                : validCachedSubject(
                    request.result,
                    value.subjectId,
                    this.now(),
                  ))
            )
              store.put(value, key);
          };
        }
      });
      this.removeSources(sources);
      if (this.pending.get(key) === entry) this.pending.delete(key);
      if (!this.pending.size) this.error = null;
      return true;
    } catch (error) {
      this.error = error;
      return false;
    } finally {
      this.saving--;
      this.emit();
    }
  }
  maintain() {
    if (!this.maintenance) this.maintenance = this.runMaintenance();
    return this.maintenance;
  }
  async runMaintenance() {
    const yieldTask = () => new Promise((resolve) => setTimeout(resolve, 0));
    try {
      await yieldTask();
      const groups = new Set();
      for (let i = 0; i < (this.legacy?.length || 0); i++) {
        const key = this.legacy.key(i);
        const match = key?.match(
          /^bangumi-ark-gacha:(record|list|meta):([^:]+):(anime|book|game|real|music):(wish|do|on_hold|collect|dropped)$/,
        );
        if (match)
          groups.add(
            `${STORAGE_PREFIX}:record:${match[2]}:${match[3]}:${match[4]}`,
          );
        else if (/^bangumi-ark-gacha:subject:\d+$/.test(key)) groups.add(key);
      }
      let processed = 0;
      for (const key of groups) {
        if (key.startsWith(`${STORAGE_PREFIX}:subject:`)) {
          const raw = this.legacy.getItem(key);
          const value = parseJson(raw);
          if (validCachedSubject(value, key.split(":").at(-1), this.now()))
            await this.save("subjects", key, value, {
              onlyMissing: true,
              sources: [[key, raw]],
            });
          else if (!(value?.version > SUBJECT_CACHE_VERSION))
            this.removeSources([[key, raw]]);
        } else {
          const { value, sources } = this.legacyCollection(key);
          if (value)
            await this.save("collections", key, value, {
              onlyMissing: true,
              sources,
            });
          else this.removeSources(sources);
        }
        if (++processed % 25 === 0) await yieldTask();
      }
      // Short transactions re-read each record before deleting; refreshed scores survive.
      const cutoff = this.now() - SCORE_TTL_MS;
      let after = null;
      do {
        after = await this.transaction(
          "subjects",
          "readwrite",
          (store, done) => {
            let count = 0;
            const request = store.openCursor();
            request.onsuccess = () => {
              const cursor = request.result;
              if (!cursor) {
                done(null);
                return;
              }
              if (after !== null && cursor.key <= after) {
                if (cursor.key < after) cursor.continue(after);
                else cursor.continue();
                return;
              }
              const fetchedAt = cursor.value?.fetchedAt;
              if (
                !(cursor.value?.version > SUBJECT_CACHE_VERSION) &&
                Number.isFinite(fetchedAt) &&
                fetchedAt >= 0 &&
                fetchedAt <= cutoff
              )
                cursor.delete();
              if (++count === 50) done(cursor.key);
              else cursor.continue();
            };
          },
        );
        if (after !== null) await yieldTask();
      } while (after !== null);
      return true;
    } catch (error) {
      console.warn("[Bangumi Ark Gacha] 缓存维护失败", error);
      return false;
    }
  }
  async retryPersistence() {
    await Promise.all([...this.writes.values()]);
    if (this.error) {
      this.connection?.then(
        (db) => db.close(),
        () => {},
      );
      this.connection = null;
    }
    const entries = [...this.pending.values()];
    const results = await Promise.all(
      entries.map((entry) => {
        const { storeName, key, value, ...options } = entry;
        if (this.pending.get(key) !== entry) return true;
        this.pending.delete(key);
        return this.save(storeName, key, value, options);
      }),
    );
    try {
      await this.openDatabase();
      if (!this.pending.size) this.error = null;
    } catch (error) {
      this.error = error;
    }
    this.emit();
    return results.every(Boolean) && !this.error;
  }
}
