/**
 * Local calendar dates are 'YYYY-MM-DD' strings in the configured time zone.
 * Precise moments are epoch milliseconds. Date arithmetic is done on day
 * numbers (days since 1970-01-01) so month ends and leap days are exact.
 */
export type LocalDate = string;

/**
 * 'Asia/Kolkata' is a fixed UTC+05:30 offset (India has no daylight saving).
 * 'device' follows the phone's own time zone, including any DST rules.
 */
export type TimeZoneSetting = 'Asia/Kolkata' | 'device';

const DAY_MS = 86_400_000;
const IST_OFFSET_MS = 330 * 60_000;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isLocalDate(value: unknown): value is LocalDate {
  if (typeof value !== 'string') return false;
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}

export function parts(date: LocalDate): { y: number; m: number; d: number } {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error(`Not a date: ${date}`);
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

export function makeDate(y: number, m: number, d: number): LocalDate {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y: number, m: number): number {
  return [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

export function dayNumber(date: LocalDate): number {
  const { y, m, d } = parts(date);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

export function fromDayNumber(n: number): LocalDate {
  const dt = new Date(n * DAY_MS);
  return makeDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function addDays(date: LocalDate, days: number): LocalDate {
  return fromDayNumber(dayNumber(date) + days);
}

/** Whole days from a to b (b - a). */
export function diffDays(a: LocalDate, b: LocalDate): number {
  return dayNumber(b) - dayNumber(a);
}

/** Inclusive count of calendar days in [start, end]; 0 if end < start. */
export function daysInclusive(start: LocalDate, end: LocalDate): number {
  return Math.max(0, diffDays(start, end) + 1);
}

/** 0 = Sunday … 6 = Saturday */
export function weekday(date: LocalDate): number {
  // 1970-01-01 was a Thursday (4).
  return (((dayNumber(date) + 4) % 7) + 7) % 7;
}

export function compareDates(a: LocalDate, b: LocalDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function minDate(a: LocalDate, b: LocalDate): LocalDate {
  return a <= b ? a : b;
}

export function maxDate(a: LocalDate, b: LocalDate): LocalDate {
  return a >= b ? a : b;
}

export function inRange(date: LocalDate, start: LocalDate, end: LocalDate): boolean {
  return date >= start && date <= end;
}

export function eachDate(start: LocalDate, end: LocalDate): LocalDate[] {
  const out: LocalDate[] = [];
  const s = dayNumber(start);
  const e = dayNumber(end);
  for (let n = s; n <= e; n++) out.push(fromDayNumber(n));
  return out;
}

export function startOfMonth(date: LocalDate): LocalDate {
  const { y, m } = parts(date);
  return makeDate(y, m, 1);
}

export function endOfMonth(date: LocalDate): LocalDate {
  const { y, m } = parts(date);
  return makeDate(y, m, daysInMonth(y, m));
}

/** Add months, clamping the day to the target month's length. */
export function addMonthsClamped(date: LocalDate, months: number, preferredDay?: number): LocalDate {
  const { y, m, d } = parts(date);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const day = Math.min(preferredDay ?? d, daysInMonth(ny, nm));
  return makeDate(ny, nm, day);
}

// ---------------------------------------------------------------------------
// Time zones

export function localDateOf(epochMs: number, tz: TimeZoneSetting): LocalDate {
  if (tz === 'Asia/Kolkata') {
    const dt = new Date(epochMs + IST_OFFSET_MS);
    return makeDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }
  const dt = new Date(epochMs);
  return makeDate(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
}

export function localTimeOf(epochMs: number, tz: TimeZoneSetting): { h: number; min: number } {
  if (tz === 'Asia/Kolkata') {
    const dt = new Date(epochMs + IST_OFFSET_MS);
    return { h: dt.getUTCHours(), min: dt.getUTCMinutes() };
  }
  const dt = new Date(epochMs);
  return { h: dt.getHours(), min: dt.getMinutes() };
}

export function epochFromLocal(date: LocalDate, hour: number, minute: number, tz: TimeZoneSetting): number {
  const { y, m, d } = parts(date);
  if (tz === 'Asia/Kolkata') {
    return Date.UTC(y, m - 1, d, hour, minute) - IST_OFFSET_MS;
  }
  return new Date(y, m - 1, d, hour, minute).getTime();
}

export function startOfLocalDay(date: LocalDate, tz: TimeZoneSetting): number {
  return epochFromLocal(date, 0, 0, tz);
}

// ---------------------------------------------------------------------------
// Display

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function monthName(m: number, long = false): string {
  return (long ? MONTHS_LONG : MONTHS)[m - 1];
}

export function weekdayName(date: LocalDate, long = false): string {
  return (long ? WEEKDAYS_LONG : WEEKDAYS)[weekday(date)];
}

/** "Thu 12 Nov" */
export function formatDateShort(date: LocalDate): string {
  const { m, d } = parts(date);
  return `${weekdayName(date)} ${d} ${monthName(m)}`;
}

/** "12 Nov 2026" */
export function formatDateMedium(date: LocalDate): string {
  const { y, m, d } = parts(date);
  return `${d} ${monthName(m)} ${y}`;
}

/** "8–12 Nov" or "28 Oct – 3 Nov" or with years when they differ. */
export function formatRange(start: LocalDate, end: LocalDate): string {
  const a = parts(start);
  const b = parts(end);
  if (start === end) return `${a.d} ${monthName(a.m)}`;
  if (a.y !== b.y) return `${a.d} ${monthName(a.m)} ${a.y} – ${b.d} ${monthName(b.m)} ${b.y}`;
  if (a.m === b.m) return `${a.d}–${b.d} ${monthName(a.m)}`;
  return `${a.d} ${monthName(a.m)} – ${b.d} ${monthName(b.m)}`;
}

export function formatTime(epochMs: number, tz: TimeZoneSetting): string {
  const { h, min } = localTimeOf(epochMs, tz);
  const suffix = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(min).padStart(2, '0')} ${suffix}`;
}

export function parseTimeHHMM(text: string): { h: number; min: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return { h, min };
}
