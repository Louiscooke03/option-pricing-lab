import { sviTotalVariance, SVIParams } from './svi';

export interface SVIDerivatives {
  /** Total variance w(k). */
  w: number;
  /** First derivative dw/dk. */
  wp: number;
  /** Second derivative d^2w/dk^2. */
  wpp: number;
}

export interface ButterflyViolation {
  k: number;
  g: number;
}

export interface ButterflyCheckResult {
  minG: number;
  violations: ButterflyViolation[];
  ok: boolean;
}

export interface CalendarSlice {
  tau: number;
  params: SVIParams;
}

export interface CalendarCrossing {
  k: number;
  tauShort: number;
  tauLong: number;
}

export interface CalendarCheckResult {
  crossings: CalendarCrossing[];
  ok: boolean;
}

const defaultKGrid = (lo = -1.5, hi = 1.5, step = 0.01): number[] => {
  const n = Math.round((hi - lo) / step) + 1;
  return Array.from({ length: n }, (_, i) => lo + i * step);
};

/**
 * Analytic first and second derivatives of the raw SVI total-variance function:
 * w(k) = a + b*(rho*dk + R), dk = k - m, R = sqrt(dk^2 + sigma^2).
 */
export const sviDerivatives = (k: number, p: SVIParams): SVIDerivatives => {
  const dk = k - p.m;
  const R = Math.sqrt(dk * dk + p.sigma * p.sigma);
  const w = p.a + p.b * (p.rho * dk + R);
  const wp = p.b * (p.rho + dk / R);
  const wpp = (p.b * p.sigma * p.sigma) / (R * R * R);
  return { w, wp, wpp };
};

/** Gatheral-Jacquier butterfly-arbitrage indicator g(k); g(k) < 0 signals a negative density. */
export const butterflyG = (k: number, p: SVIParams): number => {
  const { w, wp, wpp } = sviDerivatives(k, p);
  const term1 = (1 - (k * wp) / (2 * w)) ** 2;
  const term2 = ((wp * wp) / 4) * (1 / w + 0.25);
  const term3 = wpp / 2;
  return term1 - term2 + term3;
};

/** Implied risk-neutral density of log-moneyness k under the SVI slice. */
export const riskNeutralDensity = (k: number, p: SVIParams): number => {
  const { w } = sviDerivatives(k, p);
  if (w <= 0) return 0;
  const g = butterflyG(k, p);
  const dm = -k / Math.sqrt(w) - Math.sqrt(w) / 2;
  return (g / Math.sqrt(2 * Math.PI * w)) * Math.exp(-(dm * dm) / 2);
};

/** Scans g(k) over a k-grid and flags any k where g(k) < 0 (butterfly arbitrage). */
export const checkButterfly = (p: SVIParams, kGrid: number[] = defaultKGrid()): ButterflyCheckResult => {
  let minG = Infinity;
  const violations: ButterflyViolation[] = [];

  kGrid.forEach((k) => {
    const g = butterflyG(k, p);
    if (g < minG) minG = g;
    if (g < 0) violations.push({ k, g });
  });

  return { minG, violations, ok: violations.length === 0 };
};

/**
 * Verifies total variance is non-decreasing in tau at fixed k across a sorted-by-tau
 * set of SVI slices (calendar-arbitrage condition). Flags any k where a longer-dated
 * slice has strictly smaller total variance than the next shorter-dated one.
 */
export const checkCalendar = (
  slices: CalendarSlice[],
  kGrid: number[] = defaultKGrid(),
): CalendarCheckResult => {
  const sorted = [...slices].sort((a, b) => a.tau - b.tau);
  const crossings: CalendarCrossing[] = [];

  for (let i = 0; i < sorted.length - 1; i += 1) {
    const short = sorted[i];
    const long = sorted[i + 1];

    kGrid.forEach((k) => {
      const wShort = sviTotalVariance(k, short.params);
      const wLong = sviTotalVariance(k, long.params);
      if (wLong < wShort) {
        crossings.push({ k, tauShort: short.tau, tauLong: long.tau });
      }
    });
  }

  return { crossings, ok: crossings.length === 0 };
};
