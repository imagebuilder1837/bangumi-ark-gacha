import { validCalendarDate } from "./shared.mjs";

export const SCORE_TTL_MS = 72 * 60 * 60 * 1000;
export const SUBJECT_CACHE_VERSION = 3;

export function validCachedSubject(info, subjectId, now) {
  return (
    !!info &&
    info.version === SUBJECT_CACHE_VERSION &&
    info.resolved === true &&
    info.subjectId === String(subjectId) &&
    typeof info.hasScore === "boolean" &&
    (info.hasScore
      ? typeof info.score === "number" &&
        Number.isFinite(info.score) &&
        info.score > 0 &&
        info.score <= 10
      : info.score === null) &&
    typeof info.isPartial === "boolean" &&
    (info.totalEpisodes === null ||
      (Number.isSafeInteger(info.totalEpisodes) && info.totalEpisodes >= 0)) &&
    (info.date === null || validCalendarDate(info.date)) &&
    Number.isFinite(info.fetchedAt) &&
    info.fetchedAt >= 0 &&
    now >= info.fetchedAt &&
    now - info.fetchedAt < SCORE_TTL_MS
  );
}
