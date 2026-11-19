import { addDays, addMonths, addYears, isValid, parse } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

export const BUSINESS_TZ = "Africa/Accra";

/** Business date string in ISO form (YYYY-MM-DD), always interpreted in Africa/Accra. */
export type BusinessDate = string;

export interface DateRange {
  /** Inclusive lower bound (UTC instant). */
  start: Date;
  /** Exclusive upper bound (UTC instant). */
  end: Date;
  /** Inclusive business dates for display. */
  from: BusinessDate;
  to: BusinessDate;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" && ISO_DATE.test(value) ? fromZonedTime(`${value}T00:00:00`, BUSINESS_TZ) : new Date(value);
  return formatInTimeZone(date, BUSINESS_TZ, "dd/MM/yyyy");
}

export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return "—";
  return formatInTimeZone(new Date(value), BUSINESS_TZ, "dd/MM/yyyy HH:mm");
}

export function formatTime(value: Date | string): string {
  return formatInTimeZone(new Date(value), BUSINESS_TZ, "HH:mm");
}

export function toBusinessDate(value: Date = new Date()): BusinessDate {
  return formatInTimeZone(value, BUSINESS_TZ, "yyyy-MM-dd");
}

export function todayBusinessDate(): BusinessDate {
  return toBusinessDate(new Date());
}

export function isBusinessDate(value: string): value is BusinessDate {
  if (!ISO_DATE.test(value)) return false;
  return isValid(parse(value, "yyyy-MM-dd", new Date()));
}

/** Parses a DD/MM/YYYY string typed by a user into a business date. */
export function parseDisplayDate(value: string): BusinessDate | null {
  const parsed = parse(value.trim(), "dd/MM/yyyy", new Date());
  return isValid(parsed) ? isoFromLocal(parsed) : null;
}

function isoFromLocal(date: Date): BusinessDate {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** UTC instant at which a business date starts in Africa/Accra. */
export function startOfBusinessDate(date: BusinessDate): Date {
  return fromZonedTime(`${date}T00:00:00`, BUSINESS_TZ);
}

function shiftDate(date: BusinessDate, days: number): BusinessDate {
  const base = parse(date, "yyyy-MM-dd", new Date());
  return isoFromLocal(addDays(base, days));
}

/** Inclusive business-date range -> half-open UTC instant range. */
export function rangeFromDates(from: BusinessDate, to: BusinessDate): DateRange {
  if (!isBusinessDate(from) || !isBusinessDate(to)) {
    throw new RangeError("Dates must be in YYYY-MM-DD format");
  }
  const [lo, hi] = from <= to ? [from, to] : [to, from];
  return { start: startOfBusinessDate(lo), end: startOfBusinessDate(shiftDate(hi, 1)), from: lo, to: hi };
}

export function dayRange(date: BusinessDate = todayBusinessDate()): DateRange {
  return rangeFromDates(date, date);
}

/** ISO week (Monday start) containing the date. */
export function weekRange(date: BusinessDate = todayBusinessDate()): DateRange {
  const base = parse(date, "yyyy-MM-dd", new Date());
  const dow = (base.getDay() + 6) % 7;
  const monday = isoFromLocal(addDays(base, -dow));
  return rangeFromDates(monday, shiftDate(monday, 6));
}

export function monthRange(date: BusinessDate = todayBusinessDate()): DateRange {
  const first = `${date.slice(0, 7)}-01`;
  const next = isoFromLocal(addMonths(parse(first, "yyyy-MM-dd", new Date()), 1));
  return rangeFromDates(first, shiftDate(next, -1));
}

export function yearRange(date: BusinessDate = todayBusinessDate()): DateRange {
  const first = `${date.slice(0, 4)}-01-01`;
  const next = isoFromLocal(addYears(parse(first, "yyyy-MM-dd", new Date()), 1));
  return rangeFromDates(first, shiftDate(next, -1));
}

export type PeriodKey = "today" | "week" | "month" | "year" | "custom";

export function resolvePeriod(period: PeriodKey, from?: string, to?: string): DateRange {
  switch (period) {
    case "today":
      return dayRange();
    case "week":
      return weekRange();
    case "year":
      return yearRange();
    case "custom":
      if (from && to && isBusinessDate(from) && isBusinessDate(to)) return rangeFromDates(from, to);
      return monthRange();
    case "month":
    default:
      return monthRange();
  }
}

export { shiftDate as addBusinessDays };
