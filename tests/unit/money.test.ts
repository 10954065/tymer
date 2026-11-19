import { describe, expect, it } from "vitest";
import {
  allocateProRata,
  applyBps,
  formatMoney,
  mulDivRound,
  parseMoney,
  toMoneyInput,
  tryParseMoney,
} from "@/lib/money";

describe("parseMoney", () => {
  it.each([
    ["12", 1200],
    ["12.5", 1250],
    ["12.05", 1205],
    ["0.01", 1],
    ["1,234.56", 123456],
    ["GH₵ 10.00", 1000],
    ["-3.40", -340],
  ])("parses %s to %d pesewas", (input, expected) => {
    expect(parseMoney(input)).toBe(expected);
  });

  it("avoids floating point drift (0.1 + 0.2 style inputs)", () => {
    expect(parseMoney("0.10") + parseMoney("0.20")).toBe(30);
  });

  it.each(["12.345", "abc", "", "1.2.3", "--1"])("rejects invalid amount %s", (input) => {
    expect(() => parseMoney(input)).toThrow();
    expect(tryParseMoney(input)).toBeNull();
  });
});

describe("formatMoney", () => {
  it("formats with cedi symbol, grouping and 2 decimals", () => {
    expect(formatMoney(123456789)).toBe("GH₵ 1,234,567.89");
    expect(formatMoney(5)).toBe("GH₵ 0.05");
    expect(formatMoney(-1050)).toBe("-GH₵ 10.50");
    expect(formatMoney(1000, { symbol: false })).toBe("10.00");
  });

  it("rejects non-integer pesewas", () => {
    expect(() => formatMoney(10.5)).toThrow(TypeError);
  });

  it("round-trips through form input representation", () => {
    expect(parseMoney(toMoneyInput(98765))).toBe(98765);
  });
});

describe("mulDivRound / applyBps", () => {
  it("rounds half up", () => {
    expect(mulDivRound(5, 1, 2)).toBe(3);
    expect(mulDivRound(4, 1, 3)).toBe(1);
    expect(mulDivRound(-5, 1, 2)).toBe(-3);
  });

  it("computes 12.5% VAT of GH₵ 99.99 exactly", () => {
    expect(applyBps(9999, 1250)).toBe(1250);
  });
});

describe("allocateProRata", () => {
  it("always sums to the total", () => {
    const parts = allocateProRata(100, [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(100);
    expect(parts).toEqual([34, 33, 33]);
  });

  it("allocates proportionally to weights", () => {
    expect(allocateProRata(1000, [3000, 1000])).toEqual([750, 250]);
  });

  it("handles zero weights", () => {
    expect(allocateProRata(50, [0, 0])).toEqual([50, 0]);
    expect(allocateProRata(0, [10, 20])).toEqual([0, 0]);
  });
});
