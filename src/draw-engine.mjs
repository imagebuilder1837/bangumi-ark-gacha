import { subjectIdFromLink } from "./shared.mjs";

const SCORE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
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
      !cached.fetchedAt
    )
      return null;
    return this.now() - cached.fetchedAt <= SCORE_TTL_MS ? cached : null;
  }

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

  async getSubjectInfo(subjectId, signal) {
    const cached = this.getCachedSubject(subjectId);
    if (cached) return cached;

    try {
      const html = await this.client.fetchSubject(subjectId, signal);
      const subjectResult = this.subjectInfoFromDocument(html);
      const stored = {
        version: SUBJECT_CACHE_VERSION,
        subjectId,
        fetchedAt: this.now(),
        ...subjectResult,
      };
      this.storage.saveSubjectMeta(subjectId, stored);
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
