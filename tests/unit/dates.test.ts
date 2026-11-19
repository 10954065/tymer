import { describe, expect, it } from "vitest";
import {
  dayRange,
  formatDate,
  formatDateTime,
  monthRange,
  parseDisplayDate,
  rangeFromDates,
  weekRange,
  yearRange,
} from "@/lib/dates";

describe("business dates (Africa/Accra, DD/MM/YYYY)", () => {
  it("formats dates as DD/MM/YYYY", () => {
    expect(formatDate("2026-03-07")).toBe("07/03/2026");
    expect(formatDate(new Date("2026-12-31T23:30:00Z"))).toBe("31/12/2026");
    expect(formatDateTime(new Date("2026-01-02T08:05:00Z"))).toBe("02/01/2026 08:05");
  });

  it("parses user-typed DD/MM/YYYY", () => {
    expect(parseDisplayDate("05/11/2026")).toBe("2026-11-05");
    expect(parseDisplayDate("31/02/2026")).toBeNull();
  });

  it("builds half-open day ranges", () => {
    const range = dayRange("2026-11-19");
    expect(range.start.toISOString()).toBe("2026-11-19T00:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-11-20T00:00:00.000Z");
  });

  it("builds Monday-start weeks", () => {
    const range = weekRange("2026-11-19"); // Thursday
    expect(range.from).toBe("2026-11-16");
    expect(range.to).toBe("2026-11-22");
  });

  it("builds month and year ranges including leap years", () => {
    expect(monthRange("2028-02-10").to).toBe("2028-02-29");
    expect(yearRange("2026-06-01").end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("normalises reversed custom ranges", () => {
    const range = rangeFromDates("2026-05-10", "2026-05-01");
    expect(range.from).toBe("2026-05-01");
    expect(range.to).toBe("2026-05-10");
  });
});
