/**
 * Money helpers. All amounts are integers in pesewas (1 GHS = 100 pesewas).
 * Floating-point arithmetic is never used for money.
 */

export const CURRENCY = "GHS";
export const CURRENCY_SYMBOL = "GH₵";

const MONEY_PATTERN = /^(-)?(\d{1,12})(?:\.(\d{1,2}))?$/;

export class MoneyParseError extends Error {
  constructor(input: string) {
    super(`"${input}" is not a valid amount (use up to 2 decimal places)`);
    this.name = "MoneyParseError";
  }
}

/** Parses "1,234.5" / "12" / "0.05" into pesewas. Throws MoneyParseError on invalid input. */
export function parseMoney(input: string | number): number {
  const raw = typeof input === "number" ? numberToMoneyString(input) : input;
  const cleaned = raw.replace(/[,\s]/g, "").replace(/^(GH₵|GHS)/i, "");
  const match = MONEY_PATTERN.exec(cleaned);
  if (!match) {
    throw new MoneyParseError(raw);
  }
  const [, sign, whole, fraction = ""] = match;
  const pesewas = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return sign && pesewas !== 0 ? -pesewas : pesewas;
}

/** Safe parse that returns null instead of throwing. */
export function tryParseMoney(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined || input === "") return null;
  try {
    return parseMoney(input);
  } catch {
    return null;
  }
}

function numberToMoneyString(value: number): string {
  if (!Number.isFinite(value)) throw new MoneyParseError(String(value));
  // Numbers only arrive from trusted UI widgets; round to 2dp via string formatting, not arithmetic.
  return value.toFixed(2);
}

function groupThousands(whole: string): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function assertInteger(value: number): void {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`Money values must be integer pesewas, received ${value}`);
  }
}

/** 123456 -> "1234.56" (for form inputs). */
export function toMoneyInput(pesewas: number): string {
  assertInteger(pesewas);
  const sign = pesewas < 0 ? "-" : "";
  const abs = Math.abs(pesewas);
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** 123456 -> "GH₵ 1,234.56" */
export function formatMoney(pesewas: number, options: { symbol?: boolean } = {}): string {
  assertInteger(pesewas);
  const sign = pesewas < 0 ? "-" : "";
  const abs = Math.abs(pesewas);
  const whole = groupThousands(String(Math.trunc(abs / 100)));
  const fraction = String(abs % 100).padStart(2, "0");
  const prefix = options.symbol === false ? "" : `${CURRENCY_SYMBOL} `;
  return `${sign}${prefix}${whole}.${fraction}`;
}

/** Compact display form for chart axes only (GH₵ 12.3k). Never used for stored values. */
export function formatMoneyCompact(pesewas: number): string {
  const cedis = pesewas / 100;
  const abs = Math.abs(cedis);
  if (abs >= 1_000_000) return `${CURRENCY_SYMBOL} ${(cedis / 1_000_000).toFixed(1)}m`;
  if (abs >= 1_000) return `${CURRENCY_SYMBOL} ${(cedis / 1_000).toFixed(1)}k`;
  return `${CURRENCY_SYMBOL} ${cedis.toFixed(0)}`;
}

/** Computes round(a * b / c) with half-up rounding (away from zero) using BigInt. */
export function mulDivRound(a: number, b: number, c: number): number {
  assertInteger(a);
  assertInteger(b);
  assertInteger(c);
  if (c === 0) throw new RangeError("Division by zero");
  const zero = BigInt(0);
  const numerator = BigInt(a) * BigInt(b);
  const divisor = BigInt(c);
  const negative = numerator < zero !== divisor < zero;
  const absNum = numerator < zero ? -numerator : numerator;
  const absDiv = divisor < zero ? -divisor : divisor;
  const rounded = Number((absNum * BigInt(2) + absDiv) / (absDiv * BigInt(2)));
  return negative && rounded !== 0 ? -rounded : rounded;
}

/** Basis points: 1000 bps = 10%. */
export function applyBps(amount: number, bps: number): number {
  return mulDivRound(amount, bps, 10_000);
}

/**
 * Splits `total` across `weights` proportionally so the parts always sum exactly to `total`
 * (largest-remainder method). Used to spread a cart-level discount over line items.
 */
export function allocateProRata(total: number, weights: readonly number[]): number[] {
  assertInteger(total);
  if (weights.length === 0) return [];
  const weightSum = weights.reduce((sum, w) => sum + w, 0);
  if (weightSum === 0) {
    return weights.map((_, index) => (index === 0 ? total : 0));
  }
  const exact = weights.map((w) => {
    const product = BigInt(total) * BigInt(w);
    return {
      floor: Number(product / BigInt(weightSum)),
      remainder: Number(product % BigInt(weightSum)),
    };
  });
  const allocated = exact.map((e) => e.floor);
  let leftover = total - allocated.reduce((sum, v) => sum + v, 0);
  const order = exact
    .map((e, index) => ({ index, remainder: e.remainder }))
    .sort((x, y) => y.remainder - x.remainder || x.index - y.index);
  for (let i = 0; leftover > 0 && i < order.length; i += 1, leftover -= 1) {
    allocated[order[i].index] += 1;
  }
  return allocated;
}

export function sumMoney(values: readonly number[]): number {
  return values.reduce((sum, value) => {
    assertInteger(value);
    return sum + value;
  }, 0);
}
