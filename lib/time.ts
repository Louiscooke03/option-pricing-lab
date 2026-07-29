const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * ACT/365 day count: calendar days between the two dates divided by 365.
 * This ignores leap years and actual coupon/holiday conventions — it's a
 * simple, common approximation used until a more precise day-count is needed.
 */
export const yearFraction = (valuationDate: string, expiry: string): number => {
  const start = Date.parse(valuationDate);
  const end = Date.parse(expiry);
  const days = (end - start) / MS_PER_DAY;
  return days / 365;
};
