import { subjectIdFromLink } from "./shared.mjs";

const SCORE_TTL_MS = 72 * 60 * 60 * 1000;
const SUBJECT_CACHE_VERSION = 3;
export class DrawEngine {
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
