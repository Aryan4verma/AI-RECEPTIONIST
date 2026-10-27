import type { ExtractionResult } from "../../ai/schemas.js";

type TimeField = ExtractionResult["requested_time"];
const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Bounded English date/time forms. No identities, booking actions or guessed clock times. */
export function naturalTime(text: string, now: Date, timezone: string): TimeField | null {
  if (/\b(?:not|cancel|reschedule|utc|gmt|ist|pst|pdt|est|edt|cst|cdt|bst|cet|cest)\b|[+-]\d{2}:?\d{2}|\b[A-Za-z_]+\/[A-Za-z_]+\b/i.test(text)) return null;
  const dates = [...text.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)(?:\s*,?\s*(\d{4}))?\b/gi)];
  const relative = [...text.matchAll(/\b(today|tomorrow)\b/gi)];
  if (!dates.length && !relative.length) return null;
  const unknown = (reason: string): TimeField => ({ state: "unknown", reason });
  if (dates.length + relative.length !== 1 || /\b(?:or|either)\b/i.test(text)) return { state: "ambiguous", reason: "More than one option supplied; confirm one date and time", candidates: [...dates, ...relative].slice(0, 5).map(m => m[0]) };
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const part = (key: string) => Number(parts.find(p => p.type === key)?.value);
  let year = part("year"), month = part("month"), day = part("day");
  if (dates.length) {
    const date = dates[0]!;
    year = date[3] ? Number(date[3]) : year;
    month = months.indexOf(date[2]!.toLowerCase().slice(0, 3)) + 1;
    day = Number(date[1]);
  } else if (relative[0]![1]!.toLowerCase() === "tomorrow") {
    const tomorrow = new Date(Date.UTC(year, month - 1, day + 1));
    year = tomorrow.getUTCFullYear(); month = tomorrow.getUTCMonth() + 1; day = tomorrow.getUTCDate();
  }
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  if (calendarDate.getUTCFullYear() !== year || calendarDate.getUTCMonth() + 1 !== month || calendarDate.getUTCDate() !== day) return unknown("Invalid calendar date; confirm the date and time");
  const twelve = [...text.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?\b/gi)];
  const times = twelve.length ? twelve : [...text.matchAll(/\b(\d{1,2}):(\d{2})\b/g)];
  if (!times.length) return unknown("Date supplied without an exact time");
  if (times.length !== 1) return { state: "ambiguous", reason: "More than one time supplied; confirm one time", candidates: times.slice(0, 5).map(m => m[0]) };
  const time = times[0]!;
  let hour = Number(time[1]); const minute = Number(time[2] ?? 0);
  if (minute > 59 || (twelve.length ? hour < 1 || hour > 12 : hour > 23)) return unknown("Invalid clock time; confirm the time");
  if (twelve.length) hour = hour % 12 + (time[3]!.toLowerCase() === "p" ? 12 : 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  const value = `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00`;
  const localNow = `${part("year")}-${pad(part("month"))}-${pad(part("day"))}T${pad(part("hour"))}:${pad(part("minute"))}:${pad(part("second"))}`;
  if (value <= localNow) return unknown("That time is in the past; confirm a future date and year");
  return { state: "known", value };
}
