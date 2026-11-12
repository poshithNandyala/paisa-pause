/**
 * Money is always an integer number of paise (1 rupee = 100 paise).
 * No floating-point rupees are ever used for accounting.
 */
export type Paise = number;
export type CurrencyCode = 'INR';

export const CURRENCY: CurrencyCode = 'INR';
/** ₹10 crore — a sanity ceiling for a single manual entry. */
export const MAX_ENTRY_PAISE: Paise = 10_000_000_000;

export function isValidPaise(value: unknown): value is Paise {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

export function assertPaise(value: number, label = 'amount'): Paise {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${label} must be a whole number of paise`);
  }
  return value;
}

export function sumPaise(values: readonly Paise[]): Paise {
  let total = 0;
  for (const v of values) total += assertPaise(v);
  return total;
}

/**
 * Parse what someone typed ("199", "199.5", "1,299.00", "₹ 45") into paise.
 * Returns null for anything that is not a clean amount with at most 2 decimals.
 * Never goes through floating point.
 */
export function parseRupeesToPaise(input: string): Paise | null {
  const cleaned = input.replace(/[₹,\s]/g, '');
  if (cleaned === '' || cleaned === '.') return null;
  const match = /^(\d{0,10})(?:\.(\d{0,2}))?$/.exec(cleaned);
  if (!match) return null;
  const whole = match[1] === '' ? 0 : Number.parseInt(match[1], 10);
  const fracDigits = (match[2] ?? '').padEnd(2, '0');
  const frac = Number.parseInt(fracDigits, 10);
  const paise = whole * 100 + frac;
  if (!Number.isSafeInteger(paise)) return null;
  return paise;
}

/** Group digits Indian style: 12,34,567 */
function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const last3 = digits.slice(-3);
  let rest = digits.slice(0, -3);
  const parts: string[] = [];
  while (rest.length > 2) {
    parts.unshift(rest.slice(-2));
    rest = rest.slice(0, -2);
  }
  if (rest.length > 0) parts.unshift(rest);
  return `${parts.join(',')},${last3}`;
}

export interface FormatOptions {
  /** Always show paise (₹900.00). Default: only when non-zero. */
  alwaysShowPaise?: boolean;
  /** Prefix "+" for positive values. */
  signed?: boolean;
  /** Leave out the ₹ sign. */
  noSymbol?: boolean;
}

export function formatPaise(paise: Paise, opts: FormatOptions = {}): string {
  assertPaise(paise);
  const negative = paise < 0;
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const rem = abs % 100;
  let text = groupIndian(String(rupees));
  if (rem !== 0 || opts.alwaysShowPaise) {
    text += `.${String(rem).padStart(2, '0')}`;
  }
  const symbol = opts.noSymbol ? '' : '₹';
  if (negative) return `-${symbol}${text}`;
  if (opts.signed && paise > 0) return `+${symbol}${text}`;
  return `${symbol}${text}`;
}

/** Words for screen readers: "701 rupees 25 paise". */
export function spokenPaise(paise: Paise): string {
  const negative = paise < 0;
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const rem = abs % 100;
  let text = `${rupees} rupee${rupees === 1 ? '' : 's'}`;
  if (rem) text += ` ${rem} paise`;
  return negative ? `minus ${text}` : text;
}

/** Integer division rounded half away from zero. */
export function divRound(numerator: number, denominator: number): number {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator === 0) {
    throw new Error('divRound needs integers and a non-zero denominator');
  }
  const sign = Math.sign(numerator) * Math.sign(denominator);
  const n = Math.abs(numerator);
  const d = Math.abs(denominator);
  return sign * Math.floor((2 * n + d) / (2 * d));
}

/**
 * Split `total` into integer parts proportional to `weights`
 * (largest-remainder method). Parts always sum to exactly `total`.
 * Ties go to the earlier index, so results are deterministic.
 */
export function apportion(total: Paise, weights: readonly number[]): Paise[] {
  assertPaise(total, 'total');
  if (weights.length === 0) {
    if (total !== 0) throw new Error('cannot apportion a non-zero total over nothing');
    return [];
  }
  const weightSum = weights.reduce((a, b) => a + b, 0);
  if (weights.some((w) => w < 0 || !Number.isSafeInteger(w))) {
    throw new Error('weights must be non-negative integers');
  }
  if (weightSum === 0) {
    // Nothing to be proportional to: put everything in the first bucket.
    return weights.map((_, i) => (i === 0 ? total : 0));
  }
  const sign = total < 0 ? -1 : 1;
  const absTotal = Math.abs(total);
  // Use BigInt for the products so huge values can't lose precision.
  const bigTotal = BigInt(absTotal);
  const bigSum = BigInt(weightSum);
  const floors: number[] = [];
  const remainders: { index: number; rem: bigint }[] = [];
  let allocated = 0;
  weights.forEach((w, index) => {
    const product = bigTotal * BigInt(w);
    const q = product / bigSum;
    const r = product % bigSum;
    floors.push(Number(q));
    allocated += Number(q);
    remainders.push({ index, rem: r });
  });
  let leftover = absTotal - allocated;
  remainders.sort((a, b) => (a.rem === b.rem ? a.index - b.index : a.rem > b.rem ? -1 : 1));
  for (let i = 0; leftover > 0; i++, leftover--) {
    floors[remainders[i % remainders.length].index] += 1;
  }
  return floors.map((v) => v * sign);
}
