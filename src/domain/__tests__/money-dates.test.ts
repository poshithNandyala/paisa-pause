import { describe, expect, it } from 'vitest';
import { periodRangeFor } from '../budget';
import { addMonthsClamped, daysInclusive, epochFromLocal, formatRange, localDateOf, weekday } from '../dates';
import { apportion, divRound, formatPaise, parseRupeesToPaise, spokenPaise } from '../money';

describe('money in paise', () => {
  it('parses typed amounts without floating point', () => {
    expect(parseRupeesToPaise('199')).toBe(19900);
    expect(parseRupeesToPaise('199.5')).toBe(19950);
    expect(parseRupeesToPaise('0.10')).toBe(10);
    expect(parseRupeesToPaise('1,299.99')).toBe(129999);
    expect(parseRupeesToPaise('₹ 45')).toBe(4500);
    expect(parseRupeesToPaise('0.1') ).toBe(10);
    expect(parseRupeesToPaise('1.234')).toBeNull();
    expect(parseRupeesToPaise('abc')).toBeNull();
    expect(parseRupeesToPaise('')).toBeNull();
    expect(parseRupeesToPaise('-5')).toBeNull();
  });

  it('formats with Indian digit grouping and exact paise', () => {
    expect(formatPaise(90000)).toBe('₹900');
    expect(formatPaise(17525)).toBe('₹175.25');
    expect(formatPaise(123456789)).toBe('₹12,34,567.89');
    expect(formatPaise(100000000)).toBe('₹10,00,000');
    expect(formatPaise(-35000)).toBe('-₹350');
    expect(formatPaise(5)).toBe('₹0.05');
    expect(formatPaise(90000, { alwaysShowPaise: true })).toBe('₹900.00');
    expect(spokenPaise(70125)).toBe('701 rupees 25 paise');
  });

  it('rounds division half away from zero', () => {
    expect(divRound(70100, 4)).toBe(17525);
    expect(divRound(100000, 3)).toBe(33333);
    expect(divRound(5, 2)).toBe(3);
    expect(divRound(-5, 2)).toBe(-3);
  });

  it('apportions so parts always add up exactly', () => {
    const parts = apportion(1000, [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1000);
    expect(parts).toEqual([334, 333, 333]);
    expect(apportion(40000, [80000, 40000])).toEqual([26667, 13333]);
    expect(apportion(-1001, [1, 1])).toEqual([-501, -500]);
    expect(apportion(500, [0, 0])).toEqual([500, 0]);
    for (let total = 1; total < 500; total += 37) {
      const p = apportion(total, [7, 13, 29, 1]);
      expect(p.reduce((a, b) => a + b, 0)).toBe(total);
    }
  });
});

describe('dates and periods', () => {
  it('uses India time for local dates', () => {
    // 19:00 UTC on 11 Nov is 00:30 on 12 Nov in India.
    expect(localDateOf(Date.UTC(2026, 10, 11, 19, 0), 'Asia/Kolkata')).toBe('2026-11-12');
    expect(epochFromLocal('2026-11-12', 0, 30, 'Asia/Kolkata')).toBe(Date.UTC(2026, 10, 11, 19, 0));
  });

  it('handles leap days and month ends', () => {
    expect(daysInclusive('2028-02-28', '2028-03-01')).toBe(3);
    expect(daysInclusive('2026-02-28', '2026-03-01')).toBe(2);
    expect(addMonthsClamped('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsClamped('2028-01-31', 1)).toBe('2028-02-29');
    expect(weekday('2026-11-12')).toBe(4); // Thursday
    expect(formatRange('2026-11-08', '2026-11-12')).toBe('8–12 Nov');
  });

  it('builds weekly, monthly and payday periods', () => {
    expect(periodRangeFor('2026-11-12', 'weekly', 1, 1)).toEqual({ start: '2026-11-09', end: '2026-11-15' });
    expect(periodRangeFor('2026-11-12', 'monthly', 1, 1)).toEqual({ start: '2026-11-01', end: '2026-11-30' });
    // Payday on the 25th
    expect(periodRangeFor('2026-11-12', 'payday', 1, 25)).toEqual({ start: '2026-10-25', end: '2026-11-24' });
    expect(periodRangeFor('2026-11-25', 'payday', 1, 25)).toEqual({ start: '2026-11-25', end: '2026-12-24' });
    // Payday on the 31st clamps in short months
    expect(periodRangeFor('2027-02-28', 'payday', 1, 31)).toEqual({ start: '2027-02-28', end: '2027-03-30' });
    expect(periodRangeFor('2027-02-10', 'payday', 1, 31)).toEqual({ start: '2027-01-31', end: '2027-02-27' });
  });
});
