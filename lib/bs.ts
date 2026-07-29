const SQRT_2PI = Math.sqrt(2 * Math.PI);

export const normPdf = (x: number): number => Math.exp(-0.5 * x * x) / SQRT_2PI;

// Abramowitz & Stegun 7.1.26 rational approximation to erf, max absolute error ~1.5e-7.
const erf = (x: number): number => {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);

  const p = 0.3275911;
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;

  const t = 1 / (1 + p * ax);
  const poly = ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t;
  const y = 1 - poly * Math.exp(-ax * ax);

  return sign * y;
};

export const normCdf = (x: number): number => 0.5 * (1 + erf(x / Math.SQRT2));

interface D1D2 {
  d1: number;
  d2: number;
}

const d1d2 = (F: number, K: number, tau: number, sigma: number): D1D2 => {
  const sqrtTau = Math.sqrt(tau);
  const d1 = (Math.log(F / K) + 0.5 * sigma * sigma * tau) / (sigma * sqrtTau);
  const d2 = d1 - sigma * sqrtTau;
  return { d1, d2 };
};

export const black76Call = (F: number, K: number, tau: number, sigma: number, DF: number): number => {
  if (tau <= 0 || sigma <= 0) {
    return DF * Math.max(F - K, 0);
  }
  const { d1, d2 } = d1d2(F, K, tau, sigma);
  return DF * (F * normCdf(d1) - K * normCdf(d2));
};

export const black76Put = (F: number, K: number, tau: number, sigma: number, DF: number): number => {
  if (tau <= 0 || sigma <= 0) {
    return DF * Math.max(K - F, 0);
  }
  const { d1, d2 } = d1d2(F, K, tau, sigma);
  return DF * (K * normCdf(-d2) - F * normCdf(-d1));
};

export const black76Vega = (F: number, K: number, tau: number, sigma: number, DF: number): number => {
  if (tau <= 0 || sigma <= 0) {
    return 0;
  }
  const { d1 } = d1d2(F, K, tau, sigma);
  return DF * F * Math.sqrt(tau) * normPdf(d1);
};
