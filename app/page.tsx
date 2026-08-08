"use client";

import { ReactNode, useMemo, useState } from "react";
import SectionNumber from "@/components/SectionNumber";
import Chip from "@/components/Chip";
import EquationBlock from "@/components/EquationBlock";
import Plot from "@/components/Plot";
import { cleanChain } from "@/lib/clean";
import { recoverForward } from "@/lib/forward";
import { impliedVolPoints } from "@/lib/volSurface";
import { fitSVISlice, sviTotalVariance, SVIParams, SVIPoint } from "@/lib/svi";
import {
  butterflyG,
  riskNeutralDensity,
  checkButterfly,
  checkCalendar,
  ButterflyCheckResult,
  CalendarCheckResult,
} from "@/lib/arbitrage";
import {
  buildThetaTermStructure,
  fitSSVI,
  ssviTotalVariance,
  ssviSliceToSVIParams,
  thetaOf,
  ThetaKnot,
  SSVIPointsGroup,
  SSVIFitResult,
} from "@/lib/ssvi";
import { localVolSurface } from "@/lib/dupire";
import { sampleChain } from "@/lib/sample/sampleChain";
import { VolPoint } from "@/lib/types";

const TOTAL_STAGES = 8;
const GRID_POINTS = 160;
const SURFACE_K_POINTS = 61;
const SURFACE_TAU_POINTS = 40;
const LOCAL_VOL_TAU_POINTS = 24;

function buildGrid(kMin: number, kMax: number, pad: number, n: number): number[] {
  const lo = kMin - pad;
  const hi = kMax + pad;
  return Array.from({ length: n }, (_, i) => lo + (i / (n - 1)) * (hi - lo));
}

function buildGridFromPoints(points: { k: number }[], n: number): number[] {
  const ks = points.map((p) => p.k);
  return buildGrid(Math.min(...ks), Math.max(...ks), (Math.max(...ks) - Math.min(...ks)) * 0.15 || 0.05, n);
}

function linspace(lo: number, hi: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => lo + (i / (n - 1)) * (hi - lo));
}

/** Replaces any non-finite cell (NaN/Infinity) with 0 so a single bad cell can't blank a Plotly surface. */
function sanitizeSurface(matrix: number[][]): number[][] {
  return matrix.map((row) => row.map((v) => (Number.isFinite(v) ? v : 0)));
}

/** Linear interpolation between two hex colours, t in [0, 1]. */
function lerpColor(hexFrom: string, hexTo: string, t: number): string {
  const from = [1, 3, 5].map((i) => parseInt(hexFrom.slice(i, i + 2), 16));
  const to = [1, 3, 5].map((i) => parseInt(hexTo.slice(i, i + 2), 16));
  const mixed = from.map((c, i) => Math.round(c + (to[i] - c) * t));
  return `#${mixed.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

interface ExpirySlice {
  expiry: string;
  tau: number;
  points: SVIPoint[];
  params: SVIParams;
  rmse: number;
  kMin: number;
  kMax: number;
  butterfly: ButterflyCheckResult;
}

interface WhereTerm {
  symbol: string;
  definition: string;
}

interface ProseParagraph {
  /** Optional bold lead-in phrase marking a sub-point within the stage (rendered inline). */
  lead?: string;
  body: string;
}

interface PipelineStep {
  id: string;
  title: string;
  equation: string;
  caption: string;
  whereTerms: WhereTerm[];
  paragraphs: ProseParagraph[];
  assumptions: string;
}

const STEPS: PipelineStep[] = [
  {
    id: "forward",
    title: "Forward & discount via put–call parity",
    equation: "C − P = DF·(F − K)",
    caption: "lib/forward.ts → recoverForward()",
    whereTerms: [
      { symbol: "C", definition: "The market price (premium) of the call at strike K." },
      { symbol: "P", definition: "The market price of the put at the same strike K." },
      { symbol: "DF", definition: "The discount factor, e^(−rτ): the value today of £1 paid at expiry." },
      { symbol: "F", definition: "The forward price: the price agreed today for delivery of the underlying at expiry." },
      { symbol: "K", definition: "The strike shared by the call/put pair." },
    ],
    paragraphs: [
      {
        body: "Put–call parity is model-free — it holds by pure no-arbitrage, with no assumption about volatility. A call minus a put replicates a discounted forward, so their price difference is fixed. Because the right-hand side is linear in K, regressing observed (C − P) against strike across an expiry gives a straight line whose slope is −DF and whose intercept is DF·F — recovering the forward and discount directly from the chain. r and q only ever appear as the combination inside F, so dividends are absorbed into the forward rather than modelled separately.",
      },
    ],
    assumptions:
      "European-style, cash-settled options with matched call/put strikes; dividends and financing costs are absorbed into the implied (F, DF) pair rather than modelled separately.",
  },
  {
    id: "black76",
    title: "Black-76 & implied vol (Newton)",
    equation: "C = DF·[F·N(d₁) − K·N(d₂)]",
    caption: "lib/bs.ts → black76Call(); lib/impliedVol.ts → impliedVol()",
    whereTerms: [
      { symbol: "C", definition: "The model price of the call." },
      { symbol: "DF", definition: "Discount factor (from stage 01)." },
      { symbol: "F", definition: "Forward price (from stage 01)." },
      { symbol: "K", definition: "Strike." },
      {
        symbol: "N(·)",
        definition:
          "The standard normal cumulative distribution function: the probability a standard normal random variable falls below its argument.",
      },
      {
        symbol: "d₁, d₂",
        definition: "Standardised moneyness terms; d₂ is d₁ shifted down by one standard deviation σ√τ.",
      },
      { symbol: "ln(F/K)", definition: "Log-moneyness: how far the strike sits from the forward." },
      { symbol: "σ", definition: "The volatility. This is the single unknown we solve for." },
      { symbol: "τ", definition: "Time to expiry, in years." },
    ],
    paragraphs: [
      {
        body: "Given σ, this returns a price. Implied volatility is the reverse question: the σ that makes the formula reproduce a quote's market mid. There's no closed form, so we solve numerically with Newton's method — using vega (the price's sensitivity to σ) as the step — seeded from a Brenner–Subrahmanyam ATM estimate, falling back to bisection if Newton stalls. Black-76 is used here purely as an invertible quoting device, not as a claim that volatility is constant.",
      },
    ],
    assumptions:
      "Black-76 is used purely as an inversion device, not a claim of constant vol; prices outside the model's no-arbitrage bounds are rejected rather than forced to a volatility.",
  },
  {
    id: "coordinates",
    title: "Coordinates",
    equation: "k = ln(K/F),   w = σ²τ",
    caption: "lib/volSurface.ts → impliedVolPoints()",
    whereTerms: [
      {
        symbol: "k",
        definition:
          "Log-moneyness: the natural log of strike over forward. k = 0 at the forward, negative below it, positive above it. It normalises strikes across expiries and spot levels.",
      },
      { symbol: "K", definition: "Strike." },
      { symbol: "F", definition: "Forward." },
      {
        symbol: "w",
        definition:
          "Total (implied) variance: the accumulated variance out to expiry. Unlike volatility, total variance is additive across time, which is what makes it the natural coordinate for the surface.",
      },
      { symbol: "σ", definition: "The implied volatility at that strike (from stage 02)." },
      { symbol: "τ", definition: "Time to expiry, in years." },
    ],
    paragraphs: [
      {
        body: "Every no-arbitrage and stability property is clean in (k, w) and messy in (K, σ), so the whole surface is built in these coordinates.",
      },
    ],
    assumptions:
      "Only the OTM leg (calls above the forward, puts below) is used per strike, since OTM quotes carry the least discretisation/pinning noise; wide or crossed quotes were already dropped upstream during cleaning.",
  },
  {
    id: "svi",
    title: "SVI slice fit",
    equation: "w(k) = a + b[ρ(k−m) + √((k−m)² + σ²)]",
    caption: "lib/svi.ts → fitSVISlice()",
    whereTerms: [
      { symbol: "w(k)", definition: "Total variance as a function of log-moneyness (the smile for one expiry)." },
      { symbol: "a", definition: "The overall vertical level of the smile (roughly the minimum total variance)." },
      { symbol: "b", definition: "The wing steepness: how fast variance grows away from the money (b ≥ 0)." },
      {
        symbol: "ρ",
        definition:
          "The skew/tilt: leans the smile left or right (−1 < ρ < 1). Negative ρ lifts the low-strike wing — the classic downside-fear skew.",
      },
      { symbol: "m", definition: "The horizontal shift: the log-moneyness at which the smile bottoms out." },
      {
        symbol: "σ",
        definition:
          "The curvature of the belly: how rounded versus sharp the bottom is (σ > 0). Despite the letter, this is not a volatility.",
      },
      { symbol: "k", definition: "Log-moneyness." },
    ],
    paragraphs: [
      {
        body: "Fits the five-parameter raw SVI curve to one expiry's (k, w) points at a time by weighted least squares (Nelder–Mead over an unconstrained reparameterisation, with random restarts), giving a smooth, closed-form smile with analytic derivatives that the arbitrage checks and Dupire formula later depend on.",
      },
      {
        lead: "Why the fitted curves differ in shape",
        body: 'All three expiries share this one functional form, yet some look like smooth bowls and others like a sharp "V". The reason is the square-root term, which is what rounds the bottom of the smile. Far from the money, for large |k − m|, the root behaves like |k − m| — two straight wings with slopes b(1 + ρ) and b(1 − ρ) meeting at a corner. Close to the money, the σ² inside the root smooths that corner into a rounded belly. The size of the fitted σ controls how rounded: as σ → 0 the root collapses to |k − m|, giving a near-piecewise-linear V; a larger σ widens and rounds the bottom into a bowl. So a short-dated slice whose fit pushes σ toward zero looks angular, while slices with a larger fitted σ look smoothly curved — the difference is the per-slice curvature parameter, not the model. (A very small σ is a valid but edge-case fit: it concentrates all the curvature at a single point.)',
      },
    ],
    assumptions:
      "A per-expiry fit only constrains that one slice — nothing stops adjacent expiries from crossing in time until the calendar check (or the global SSVI fit) is applied.",
  },
  {
    id: "butterfly",
    title: "Butterfly & implied density",
    equation: "g(k) = (1 − kw′/2w)² − (w′²/4)(1/w + 1/4) + w″/2,   p(k) = g/√(2πw)·e^(−d₋²/2)",
    caption: "lib/arbitrage.ts → butterflyG(), riskNeutralDensity()",
    whereTerms: [
      {
        symbol: "g(k)",
        definition:
          "The Gatheral–Jacquier butterfly indicator: the whole no-arbitrage content of the density distilled into one function of the smile. g(k) ≥ 0 everywhere ⇔ no butterfly arbitrage.",
      },
      { symbol: "w, w′, w″", definition: "Total variance and its first and second derivatives with respect to k." },
      { symbol: "p(k)", definition: "The risk-neutral probability density of the log-return at expiry." },
      { symbol: "d₋", definition: "A standardised-moneyness term." },
    ],
    paragraphs: [
      {
        lead: "What a butterfly is (and why its price can't be negative)",
        body: "A butterfly spread is an options strategy: buy one call at a low strike, sell two calls at a middle strike, and buy one call at a high strike (same expiry, equally spaced). Its payoff is a little tent — zero everywhere except a peak at the middle strike, and never negative. Because it can only ever pay out (or break even), a butterfly must cost a non-negative amount: if its price were negative you'd be paid to hold a position that can only pay you more later — free money, an arbitrage. So every butterfly must have price ≥ 0.",
      },
      {
        lead: "From butterflies to the density",
        body: 'The price of an infinitesimally-tight butterfly at strike K is proportional to the curvature of call prices in strike, ∂²C/∂K². And by the Breeden–Litzenberger result, that curvature is the risk-neutral probability density of the underlying at K. So "every butterfly costs ≥ 0" is exactly "the implied probability density is ≥ 0 everywhere." A negative density is impossible (probabilities can\'t be negative) and corresponds precisely to a butterfly you\'d be paid to hold — an arbitrage.',
      },
      {
        lead: "Why g(k) < 0 is the violation",
        body: "g(k) is that density condition rewritten purely in terms of the fitted smile w(k) and its slope and curvature. So g(k) < 0 at some k means the implied density is negative there — a butterfly arbitrage, and an inadmissible smile.",
      },
      {
        lead: "Why we also show p(k)",
        body: 'p(k) is the actual implied probability distribution of where the underlying lands at expiry — what the option prices are "saying" about the future. Plotting it does two things: it lets you see the market-implied distribution (which should be a sensible, unimodal bell that integrates to 1), and it turns the abstract condition into a picture — if p(k) ever dips below zero, that dip is the g(k) < 0 butterfly violation made visible.',
      },
    ],
    assumptions:
      "Evaluated on the strikes actually spanned by the fit — extrapolating g(k) or p(k) far outside the calibrated k-range isn't a claim the fit is making.",
  },
  {
    id: "calendar",
    title: "Calendar / no-crossing",
    equation: "∂w/∂τ ≥ 0",
    caption: "lib/arbitrage.ts → checkCalendar()",
    whereTerms: [
      { symbol: "∂w/∂τ", definition: "The rate of change of total variance with maturity, holding log-moneyness fixed." },
    ],
    paragraphs: [
      {
        lead: "What a calendar spread is, and why crossings are arbitrage",
        body: "A calendar spread pairs two options at the same strike but different expiries. Total variance w = σ²τ is the market's accumulated uncertainty out to each expiry, and the key fact is that the longer-dated window physically contains the shorter one — you pass through the near expiry on the way to the far one. Time can only add uncertainty, never remove it, so at any fixed moneyness total variance must be non-decreasing in maturity. On the plot, that means the total-variance slices must not cross.",
      },
      {
        body: 'If a longer-dated slice does dip below a shorter-dated one at some k (a crossover), it is claiming that a longer option carries less accumulated variance than a shorter one at that strike. You could then buy the "too cheap" longer-dated option and sell the "too expensive" shorter-dated one: the shorter option expires first, and whatever it owes is always covered by the still-live longer option, so you keep the premium difference risk-free. That is the calendar-spread arbitrage. No crossings ⇔ ∂w/∂τ ≥ 0 ⇔ no calendar arbitrage.',
      },
    ],
    assumptions:
      "Checked over each pair's shared, data-supported k-range for independent per-expiry slices, since raw extrapolation there isn't trustworthy; the global SSVI surface instead satisfies this by construction via its penalised fit.",
  },
  {
    id: "ssvi",
    title: "SSVI global surface",
    equation: "w(k,θ) = (θ/2){1 + ρφk + √((φk+ρ)² + (1−ρ²))},   φ(θ) = ηθ^(−γ)",
    caption: "lib/ssvi.ts → fitSSVI()",
    whereTerms: [
      { symbol: "w(k, θ)", definition: "Total variance as a function of log-moneyness k and the ATM total variance θ." },
      {
        symbol: "θ = θ(τ)",
        definition:
          "The ATM total-variance term structure: total variance at k = 0 for each maturity. It's the backbone level that sets where each slice sits.",
      },
      { symbol: "ρ", definition: "A single, global skew parameter shared by the whole surface (−1 < ρ < 1)." },
      { symbol: "φ(θ)", definition: "The curvature function: how sharply the smile bends at each maturity." },
      { symbol: "η", definition: "The curvature scale (η > 0)." },
      { symbol: "γ", definition: "The curvature decay exponent (0 < γ ≤ ½): how curvature changes as maturity grows." },
      { symbol: "k", definition: "Log-moneyness." },
    ],
    paragraphs: [
      {
        lead: "How the parameterised regularisation builds a differentiable surface",
        body: "The per-expiry SVI fits are independent — 5 parameters × N expiries — and nothing forces them to agree, so they can cross in maturity or disagree in skew. SSVI replaces all of them with a tiny, shared parameter set: the term structure θ(τ) plus just three global numbers (ρ, η, γ). This is regularisation by parameterisation: instead of fitting a flexible surface that chases every noisy quote, you restrict the solution to a small, smooth, arbitrage-free family and fit that to all the points at once.",
      },
      {
        body: "Two things fall out. First, because the family is low-dimensional and analytic, the fit cannot overfit noise, and the resulting surface is smooth and differentiable in k by construction — its derivatives are closed forms, not noisy numerical differences. Second, the no-arbitrage conditions are built into the fit rather than checked afterward: the butterfly bound θ·φ(θ)·(1 + |ρ|) < 4 is penalised directly in the objective, and a monotone θ(τ) enforces the calendar condition. The result is one globally consistent, differentiable surface w(k, τ) that is arbitrage-free everywhere. That smoothness is exactly what the next stage needs: Dupire differentiates the surface, and differentiating noisy quotes is unstable (ill-posed) — the regularisation is what turns it into a well-posed problem.",
      },
    ],
    assumptions:
      "One skew/curvature shape is shared across the whole surface; if the true smile shape changes materially by tenor, a single (ρ, η, γ) fits some expiries less tightly than an independent per-slice SVI would.",
  },
  {
    id: "localvol",
    title: "Dupire local vol",
    equation: "σ_loc²(k,τ) = (∂w/∂τ) / g(k)",
    caption: "lib/dupire.ts → localVolSurface()",
    whereTerms: [
      {
        symbol: "σ_loc²(k, τ)",
        definition: "The local variance: the square of the instantaneous local volatility at log-moneyness k and maturity τ.",
      },
      {
        symbol: "σ_loc",
        definition: "The local volatility: the deterministic instantaneous volatility the underlying must have at each price level and time.",
      },
      {
        symbol: "∂w/∂τ",
        definition:
          "The maturity (calendar) derivative of total variance — the same quantity as the calendar condition; its non-negativity keeps the numerator ≥ 0.",
      },
      {
        symbol: "g(k)",
        definition: "The butterfly indicator from stage 05 — the strike-curvature term; its positivity keeps the denominator > 0.",
      },
    ],
    paragraphs: [
      {
        lead: "Why translating the surface into local vol matters",
        body: "Everything up to stage 07 is descriptive — the implied-vol surface simply re-encodes today's option prices; it isn't a model of how the underlying moves, and each option effectively carries its own volatility. Dupire's formula translates that surface into a single, self-consistent model: σ_loc(S, t), the instantaneous volatility as a deterministic function of spot S and time t. Priced under its own diffusion, this one model reproduces every vanilla option price simultaneously — it is the minimal model that matches the entire smile.",
      },
      {
        body: "This is powerful, and it's the point of the whole pipeline: it turns a static description of prices into usable dynamics. With σ_loc(S, t) you can price exotics consistently with the vanilla market, simulate price paths, and — in this project — feed it as the volatility field into a finite-difference PDE engine. Without it you have a snapshot of prices; with it you have a model of the process that generated them.",
      },
      {
        lead: "Why the surface changes shape after Dupire",
        body: "Local vol is a derivative of the implied surface, and differentiating exaggerates slopes: local vol responds to the local steepness of the smile and moves roughly twice as fast across strikes as implied vol does. So the gentle skew of the implied surface becomes a steeper, more pronounced feature in the local-vol surface. Think of implied vol as the average volatility out to each expiry and local vol as the instantaneous volatility at each point — converting one into the other re-expresses the shape rather than preserving it.",
      },
      {
        lead: "The smooth term structure (why θ(τ) interpolation changed)",
        body: 'Dupire needs ∂w/∂τ, a maturity derivative — an object that only exists once the ATM level θ is a continuous function interpolated between the observed expiries. Interpolating θ(τ) with straight lines makes its slope jump at each observed maturity, so ∂w/∂τ steps discontinuously and the local-vol surface shows a "wall" spanning the strikes at that maturity. The fix is to interpolate θ(τ) with a monotone cubic (PCHIP / Fritsch–Carlson) instead of straight lines: it keeps θ(τ) non-decreasing — so the calendar no-arbitrage condition still holds — while making its first derivative continuous. With a smooth θ(τ), ∂w/∂τ is continuous and the wall flattens into a smooth surface. (Real term-structure models use a smooth θ(τ) for exactly this reason.)',
      },
    ],
    assumptions:
      "Local vol reproduces every vanilla price the surface implies, but it flattens the forward smile going forward in time — it is not the same object as the market's future implied-vol smile — and is only reliable strictly inside the calibrated tau range, since θ(τ) is clamped flat outside it.",
  },
];

interface GlossaryEntry {
  term: string;
  definition: string;
}

const GLOSSARY: GlossaryEntry[] = [
  { term: "k", definition: "Log-moneyness: k = ln(K/F)." },
  { term: "w", definition: "Total variance: w = σ²τ; additive across time, the coordinate SVI/SSVI fit in." },
  { term: "θ(τ)", definition: "ATM total-variance term structure, θ(τ) = w(0, τ); the backbone SSVI's slices are anchored to." },
  { term: "φ(θ)", definition: "SSVI's power-law curvature, φ(θ) = ηθ^(−γ); controls how sharply the smile bends at each maturity." },
  { term: "g(k)", definition: "The Gatheral–Jacquier butterfly indicator; g(k) < 0 signals a negative (arbitrageable) implied density." },
  { term: "F", definition: "The forward price of the underlying for a given expiry, recovered from put–call parity." },
  { term: "DF", definition: "The discount factor to a given expiry, recovered alongside F from the same regression." },
  { term: "ρ", definition: "The correlation/skew parameter controlling the smile's tilt; |ρ| < 1." },
  { term: "SVI", definition: "The five-parameter (a, b, ρ, m, σ) raw parametrisation of one expiry's total-variance smile." },
  { term: "SSVI", definition: "\"Surface SVI\": one global (ρ, η, γ) plus a term structure θ(τ), giving one consistent surface across all expiries." },
  { term: "Local vol", definition: "The Dupire instantaneous volatility σ_loc(k, τ) consistent with the whole fitted implied-vol surface." },
];

function Stage({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section id={STEPS[n - 1].id} className="relative">
      <div className="sticky top-12 z-20 flex items-center gap-3 border-b border-border bg-surface px-6 py-3 sm:px-8">
        <SectionNumber current={n} total={TOTAL_STAGES} />
        <h2 className="font-mono text-sm text-foreground sm:text-base">{title}</h2>
      </div>
      <div className="flex flex-col gap-6 px-6 py-12 sm:px-8">{children}</div>
    </section>
  );
}

function StageProse({ step }: { step: PipelineStep }) {
  return (
    <>
      <EquationBlock caption={step.caption}>{step.equation}</EquationBlock>

      <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
        {step.whereTerms.map(({ symbol, definition }) => (
          <div key={symbol} className="flex flex-col gap-0.5">
            <dt className="font-mono text-sm text-accent">{symbol}</dt>
            <dd className="text-sm leading-6 text-muted">{definition}</dd>
          </div>
        ))}
      </dl>

      {step.paragraphs.map((paragraph, i) => (
        <p key={i} className="max-w-xl text-base leading-7 text-muted">
          {paragraph.lead && <strong className="font-medium text-foreground">{paragraph.lead}. </strong>}
          {paragraph.body}
        </p>
      ))}

      <p className="max-w-xl text-sm leading-6 text-muted">
        <span className="font-mono text-xs uppercase tracking-wide text-foreground">
          Assumptions / limitations —{" "}
        </span>
        {step.assumptions}
      </p>
    </>
  );
}

function ExpirySelector({
  expiries,
  selected,
  onSelect,
}: {
  expiries: string[];
  selected: string;
  onSelect: (expiry: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {expiries.map((expiry) => {
        const isSelected = expiry === selected;
        return (
          <button
            key={expiry}
            type="button"
            onClick={() => onSelect(expiry)}
            className={`inline-flex items-center rounded-full border px-2.5 py-1 font-mono text-xs transition-colors ${
              isSelected
                ? "border-accent bg-accent/10 text-accent"
                : "border-border text-muted hover:text-foreground"
            }`}
          >
            {expiry}
          </button>
        );
      })}
    </div>
  );
}

export default function HomePage() {
  const pipeline = useMemo(() => {
    const cleaned = cleanChain(sampleChain);
    const forwardResult = recoverForward(cleaned.quotes, sampleChain.valuationDate);
    const volResult = impliedVolPoints(cleaned.quotes, forwardResult.expiries);

    const pointsByExpiry = new Map<string, VolPoint[]>();
    volResult.points.forEach((p) => {
      const bucket = pointsByExpiry.get(p.expiry) ?? [];
      bucket.push(p);
      pointsByExpiry.set(p.expiry, bucket);
    });

    const slices: ExpirySlice[] = [];
    const sliceFitList: { tau: number; params: SVIParams }[] = [];
    const groups: SSVIPointsGroup[] = [];

    pointsByExpiry.forEach((slicePoints, expiry) => {
      const sviPoints: SVIPoint[] = slicePoints.map((p) => ({ k: p.k, w: p.totalVar, weight: p.weight }));
      if (sviPoints.length < 5) return;

      const tau = forwardResult.expiries.find((e) => e.expiry === expiry)?.tau;
      if (tau === undefined) return;

      const fit = fitSVISlice(sviPoints);
      const ks = sviPoints.map((p) => p.k);
      const kMin = Math.min(...ks);
      const kMax = Math.max(...ks);
      const pad = (kMax - kMin) * 0.15 || 0.05;
      const grid = buildGrid(kMin, kMax, pad, GRID_POINTS);
      const butterfly = checkButterfly(fit.params, grid);

      slices.push({ expiry, tau, points: sviPoints, params: fit.params, rmse: fit.rmse, kMin, kMax, butterfly });
      sliceFitList.push({ tau, params: fit.params });
      groups.push({ tau, points: sviPoints });
    });

    slices.sort((a, b) => a.tau - b.tau);

    const kLo = Math.max(...slices.map((s) => s.kMin));
    const kHi = Math.min(...slices.map((s) => s.kMax));
    const calendarGrid = kHi > kLo ? buildGrid(kLo, kHi, 0, GRID_POINTS) : [];
    const calendar: CalendarCheckResult = checkCalendar(
      slices.map((s) => ({ tau: s.tau, params: s.params })),
      calendarGrid,
    );

    const thetaKnots: ThetaKnot[] = buildThetaTermStructure(sliceFitList);
    const ssviFit: SSVIFitResult = fitSSVI(groups, thetaKnots);

    const ssviSlices = thetaKnots.map(({ tau, theta }) => ({
      tau,
      params: ssviSliceToSVIParams(theta, ssviFit.params),
    }));
    const ssviButterflyResults: { tau: number; result: ButterflyCheckResult }[] = ssviSlices.map((s) => ({
      tau: s.tau,
      result: checkButterfly(s.params),
    }));
    const ssviCalendar: CalendarCheckResult = checkCalendar(ssviSlices);

    return {
      cleaned,
      forwardResult,
      slices,
      calendar,
      thetaKnots,
      ssviFit,
      ssviButterflyResults,
      ssviCalendar,
    };
  }, []);

  const { slices, thetaKnots, ssviFit } = pipeline;
  const expiries = slices.map((s) => s.expiry);
  const [selectedExpiry, setSelectedExpiry] = useState(expiries[0]);
  const [surfaceView, setSurfaceView] = useState<"iv" | "localvol">("localvol");

  const slice = slices.find((s) => s.expiry === selectedExpiry) ?? slices[0];

  const sliceGrid = slice ? buildGrid(slice.kMin, slice.kMax, (slice.kMax - slice.kMin) * 0.15 || 0.05, GRID_POINTS) : [];
  const sviCurve = slice ? sliceGrid.map((k) => sviTotalVariance(k, slice.params)) : [];
  const gValues = slice ? sliceGrid.map((k) => butterflyG(k, slice.params)) : [];
  const densityValues = slice ? sliceGrid.map((k) => riskNeutralDensity(k, slice.params)) : [];
  const ssviSliceCurve =
    slice !== undefined ? sliceGrid.map((k) => ssviTotalVariance(k, thetaOf(slice.tau, thetaKnots), ssviFit.params)) : [];

  const tauMin = Math.min(...slices.map((s) => s.tau));
  const tauMax = Math.max(...slices.map((s) => s.tau));
  const tauSpan = Math.max(tauMax - tauMin, 1e-9);

  const surfaceGrids = useMemo(() => {
    const knotTauMin = thetaKnots[0]?.tau ?? 0;
    const knotTauMax = thetaKnots[thetaKnots.length - 1]?.tau ?? 1;
    const tauPad = (knotTauMax - knotTauMin) * 0.05 || 0.01;
    const allPoints = slices.flatMap((s) => s.points);
    const kGrid = buildGridFromPoints(allPoints, SURFACE_K_POINTS);
    const tauGrid = linspace(knotTauMin + tauPad, knotTauMax - tauPad, SURFACE_TAU_POINTS);

    const ivSurfaceRaw = tauGrid.map((tau) => {
      const theta = thetaOf(tau, thetaKnots);
      return kGrid.map((k) => Math.sqrt(Math.max(ssviTotalVariance(k, theta, ssviFit.params), 0) / tau));
    });
    const ivSurface = sanitizeSurface(ivSurfaceRaw);

    // The local-vol surface is far more sensitive at the domain boundary than the IV
    // surface: dw/dtau is a finite difference along theta(tau), which is clamped flat
    // outside the outermost fitted expiries, producing a cliff right at the edge of the
    // naive [knotTauMin, knotTauMax] domain. Apply a light additional interior trim (on
    // top of the existing tauPad) rather than dropping whole knots -- with only a
    // handful of fitted expiries, dropping knots can leave too narrow (or degenerate,
    // zero-width) a range, which collapses the surface entirely instead of just
    // smoothing its edge. Clip k to the range every kept expiry actually spans (no
    // extrapolation), and evaluate on a finer tau grid for a smoother surface.
    const localVolTauPad = (knotTauMax - knotTauMin) * 0.1 || 0.02;
    const localVolTauMin = knotTauMax - localVolTauPad > knotTauMin + localVolTauPad ? knotTauMin + localVolTauPad : knotTauMin;
    const localVolTauMax = knotTauMax - localVolTauPad > knotTauMin + localVolTauPad ? knotTauMax - localVolTauPad : knotTauMax;
    const localVolTauGrid = linspace(localVolTauMin, localVolTauMax, LOCAL_VOL_TAU_POINTS);

    // Light clip to the data-supported k-intersection (no extrapolation beyond what
    // every kept expiry actually spans). The near-vertical wall previously seen here
    // was not a k-edge effect -- it came from a slope kink in the piecewise-linear
    // theta(tau) interpolation, now fixed at the source in thetaOf (monotone cubic
    // Hermite / PCHIP, C1 across knots) -- so no additional k-domain trim is needed.
    const dataKLo = Math.max(...slices.map((s) => s.kMin));
    const dataKHi = Math.min(...slices.map((s) => s.kMax));
    const localVolKGrid =
      dataKHi > dataKLo ? linspace(dataKLo, dataKHi, SURFACE_K_POINTS) : kGrid;

    const localVolRaw = localVolSurface(localVolKGrid, localVolTauGrid, ssviFit.params, thetaKnots);
    const localVol = { ...localVolRaw, sigma: sanitizeSurface(localVolRaw.sigma) };

    return { kGrid, tauGrid, ivSurface, localVolKGrid, localVolTauGrid, localVol };
  }, [slices, thetaKnots, ssviFit]);

  const butterflyOk = pipeline.ssviButterflyResults.every((r) => r.result.ok);
  const worstButterfly = pipeline.ssviButterflyResults.reduce(
    (worst, r) => (r.result.minG < worst.result.minG ? r : worst),
    pipeline.ssviButterflyResults[0],
  );
  const localVolOk = surfaceGrids.localVol.negativeRegions.length === 0;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col">
      <div className="flex flex-col gap-4 px-6 py-16 sm:px-8">
        <p className="max-w-xl text-base leading-7 text-muted">
          A sequential walkthrough of an options-pricing pipeline: from a raw option
          chain to forward recovery, implied vol, an SVI smile per expiry, static
          arbitrage guardrails, a global SSVI surface, and a Dupire local-vol surface —
          each stage computed live in the browser from the same bundled sample chain.
        </p>
        <div className="flex flex-wrap gap-2">
          <Chip>{pipeline.cleaned.quotes.length} clean quotes</Chip>
          <Chip>{slices.length} expiries</Chip>
          <Chip>Nelder–Mead</Chip>
        </div>
      </div>

      <Stage n={1} title={STEPS[0].title}>
        <StageProse step={STEPS[0]} />
      </Stage>

      <Stage n={2} title={STEPS[1].title}>
        <StageProse step={STEPS[1]} />
      </Stage>

      <Stage n={3} title={STEPS[2].title}>
        <StageProse step={STEPS[2]} />
      </Stage>

      <Stage n={4} title={STEPS[3].title}>
        <StageProse step={STEPS[3]} />

        <ExpirySelector expiries={expiries} selected={selectedExpiry} onSelect={setSelectedExpiry} />

        {slice && (
          <>
            <Plot
              className="h-96 w-full"
              exportName={`svi-slice-${slice.expiry}`}
              data={[
                {
                  x: slice.points.map((p) => p.k),
                  y: slice.points.map((p) => p.w),
                  type: "scatter",
                  mode: "markers",
                  name: "quotes",
                  marker: { color: "#eef1f8", size: 7 },
                },
                {
                  x: sliceGrid,
                  y: sviCurve,
                  type: "scatter",
                  mode: "lines",
                  name: "SVI fit",
                  line: { color: "#5568f0", width: 2 },
                },
              ]}
              layout={{
                title: { text: slice.expiry },
                margin: { l: 64, r: 24, t: 40, b: 48 },
                xaxis: { title: { text: "log-moneyness k" } },
                yaxis: { title: { text: "total variance w" }, automargin: true },
                showlegend: true,
                legend: { orientation: "h" },
              }}
            />
            <div className="flex flex-wrap gap-2">
              <Chip>a = {slice.params.a.toFixed(5)}</Chip>
              <Chip>b = {slice.params.b.toFixed(5)}</Chip>
              <Chip>ρ = {slice.params.rho.toFixed(5)}</Chip>
              <Chip>m = {slice.params.m.toFixed(5)}</Chip>
              <Chip>σ = {slice.params.sigma.toFixed(5)}</Chip>
              <Chip>rmse {slice.rmse.toExponential(3)}</Chip>
              <Chip>{slice.points.length} points</Chip>
            </div>
          </>
        )}
      </Stage>

      <Stage n={5} title={STEPS[4].title}>
        <StageProse step={STEPS[4]} />

        {slice && (
          <>
            <Chip>showing {slice.expiry}</Chip>

            <Plot
              className="h-72 w-full"
              exportName={`butterfly-g-${slice.expiry}`}
              data={[
                {
                  x: sliceGrid,
                  y: gValues,
                  type: "scatter",
                  mode: "lines",
                  name: "g(k)",
                  line: { color: "#5568f0", width: 2 },
                },
                {
                  x: [sliceGrid[0], sliceGrid[sliceGrid.length - 1]],
                  y: [0, 0],
                  type: "scatter",
                  mode: "lines",
                  name: "zero",
                  line: { color: "#7a8296", width: 1, dash: "dash" },
                  hoverinfo: "skip",
                },
              ]}
              layout={{
                title: { text: `g(k) — ${slice.expiry}` },
                margin: { l: 56, r: 24, t: 40, b: 48 },
                xaxis: { title: { text: "log-moneyness k" } },
                yaxis: { title: { text: "g(k)" }, automargin: true },
                showlegend: true,
                legend: { orientation: "h" },
              }}
            />

            <Plot
              className="h-72 w-full"
              exportName={`density-${slice.expiry}`}
              data={[
                {
                  x: sliceGrid,
                  y: densityValues,
                  type: "scatter",
                  mode: "lines",
                  name: "p(k)",
                  fill: "tozeroy",
                  line: { color: "#7c8bff", width: 2 },
                },
              ]}
              layout={{
                title: { text: `risk-neutral density p(k) — ${slice.expiry}` },
                margin: { l: 56, r: 24, t: 40, b: 48 },
                xaxis: { title: { text: "log-moneyness k" } },
                yaxis: { title: { text: "p(k)" }, automargin: true },
                showlegend: false,
              }}
            />

            <div className="flex flex-wrap gap-2">
              <Chip>{slice.butterfly.ok ? "butterfly ok" : `${slice.butterfly.violations.length} violations`}</Chip>
              <Chip>min g(k) = {slice.butterfly.minG.toExponential(3)}</Chip>
            </div>
          </>
        )}
      </Stage>

      <Stage n={6} title={STEPS[5].title}>
        <StageProse step={STEPS[5]} />

        <Plot
          className="h-96 w-full"
          exportName="calendar-term-structure"
          data={slices.map((s) => {
            const pad = (s.kMax - s.kMin) * 0.15 || 0.05;
            const grid = buildGrid(s.kMin, s.kMax, pad, GRID_POINTS);
            const t = (s.tau - tauMin) / tauSpan;
            return {
              x: grid,
              y: grid.map((k) => sviTotalVariance(k, s.params)),
              type: "scatter",
              mode: "lines",
              name: `${s.expiry} (τ=${s.tau.toFixed(3)})`,
              line: { color: lerpColor("#7a8296", "#5568f0", t), width: 2 },
            };
          })}
          layout={{
            margin: { l: 56, r: 24, t: 24, b: 48 },
            xaxis: { title: { text: "log-moneyness k" } },
            yaxis: { title: { text: "total variance w" }, automargin: true },
            showlegend: true,
            legend: { orientation: "v", font: { size: 10 } },
          }}
        />

        <div className="flex flex-wrap gap-2">
          <Chip>
            {pipeline.calendar.ok
              ? "no crossings detected"
              : `${pipeline.calendar.crossings.length} crossing(s) detected`}
          </Chip>
          {!pipeline.calendar.ok && (
            <Chip>
              first at k={pipeline.calendar.crossings[0].k.toFixed(3)}, τ
              {pipeline.calendar.crossings[0].tauShort.toFixed(3)} → τ
              {pipeline.calendar.crossings[0].tauLong.toFixed(3)}
            </Chip>
          )}
        </div>
      </Stage>

      <Stage n={7} title={STEPS[6].title}>
        <StageProse step={STEPS[6]} />

        <div className="flex flex-wrap gap-2">
          <Chip>ρ = {ssviFit.params.rho.toFixed(4)}</Chip>
          <Chip>η = {ssviFit.params.eta.toFixed(4)}</Chip>
          <Chip>γ = {ssviFit.params.gamma.toFixed(4)}</Chip>
          <Chip>rmse {ssviFit.rmse.toExponential(3)}</Chip>
          <Chip>{ssviFit.converged ? "converged" : "not converged"}</Chip>
        </div>

        <Plot
          className="h-[620px] w-full"
          exportName="ssvi-implied-vol-surface"
          data={[
            {
              type: "surface",
              x: surfaceGrids.kGrid,
              y: surfaceGrids.tauGrid,
              z: surfaceGrids.ivSurface,
              colorscale: "Viridis",
              showscale: true,
              colorbar: { tickfont: { size: 13, color: "#eef1f8" }, len: 0.7, thickness: 14 },
            },
          ]}
          layout={{
            margin: { l: 0, r: 0, t: 24, b: 0 },
            font: { size: 14, color: "#eef1f8" },
            scene: {
              xaxis: {
                title: { text: "log-moneyness k", font: { size: 16, color: "#eef1f8" } },
                color: "#eef1f8",
                showticklabels: true,
                tickfont: { size: 14, color: "#eef1f8" },
                gridcolor: "#1e2438",
              },
              yaxis: {
                title: { text: "tau (years)", font: { size: 16, color: "#eef1f8" } },
                color: "#eef1f8",
                showticklabels: true,
                tickfont: { size: 14, color: "#eef1f8" },
                gridcolor: "#1e2438",
              },
              zaxis: {
                title: { text: "implied vol", font: { size: 16, color: "#eef1f8" } },
                color: "#eef1f8",
                showticklabels: true,
                tickfont: { size: 14, color: "#eef1f8" },
                gridcolor: "#1e2438",
              },
            },
          }}
        />

        <div className="flex flex-wrap gap-2">
          <Chip>{butterflyOk ? "butterfly ok (all expiries)" : "butterfly violation detected"}</Chip>
          <Chip>worst min g(k) = {worstButterfly?.result.minG.toExponential(3)}</Chip>
          <Chip>{pipeline.ssviCalendar.ok ? "calendar ok" : "calendar crossings detected"}</Chip>
        </div>

        <h3 className="pt-4 font-mono text-sm text-foreground">Per-expiry: independent SVI vs. SSVI slice</h3>
        <ExpirySelector expiries={expiries} selected={selectedExpiry} onSelect={setSelectedExpiry} />

        {slice && (
          <Plot
            className="h-96 w-full"
            exportName={`ssvi-vs-svi-${slice.expiry}`}
            data={[
              {
                x: slice.points.map((p) => p.k),
                y: slice.points.map((p) => p.w),
                type: "scatter",
                mode: "markers",
                name: "quotes",
                marker: { color: "#eef1f8", size: 7 },
              },
              {
                x: sliceGrid,
                y: sviCurve,
                type: "scatter",
                mode: "lines",
                name: "independent SVI",
                line: { color: "#5568f0", width: 2 },
              },
              {
                x: sliceGrid,
                y: ssviSliceCurve,
                type: "scatter",
                mode: "lines",
                name: "SSVI slice",
                line: { color: "#7c8bff", width: 2, dash: "dash" },
              },
            ]}
            layout={{
              title: { text: slice.expiry },
              margin: { l: 64, r: 24, t: 40, b: 48 },
              xaxis: { title: { text: "log-moneyness k" } },
              yaxis: { title: { text: "total variance w" }, automargin: true },
              showlegend: true,
              legend: { orientation: "h" },
            }}
          />
        )}
      </Stage>

      <Stage n={8} title={STEPS[7].title}>
        <StageProse step={STEPS[7]} />

        <div className="flex gap-2">
          {(["iv", "localvol"] as const).map((view) => (
            <button
              key={view}
              type="button"
              onClick={() => setSurfaceView(view)}
              className={`inline-flex items-center rounded-full border px-3 py-1 font-mono text-xs transition-colors ${
                surfaceView === view
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-border text-muted hover:text-foreground"
              }`}
            >
              {view === "iv" ? "Implied vol" : "Local vol"}
            </button>
          ))}
        </div>

        <Plot
          className="h-[620px] w-full"
          exportName={surfaceView === "iv" ? "ssvi-implied-vol-surface" : "dupire-localvol-surface"}
          data={[
            {
              type: "surface",
              x: surfaceView === "iv" ? surfaceGrids.kGrid : surfaceGrids.localVolKGrid,
              y: surfaceView === "iv" ? surfaceGrids.tauGrid : surfaceGrids.localVolTauGrid,
              z: surfaceView === "iv" ? surfaceGrids.ivSurface : surfaceGrids.localVol.sigma,
              colorscale: "Viridis",
              showscale: true,
              colorbar: { tickfont: { size: 13, color: "#eef1f8" }, len: 0.7, thickness: 14 },
            },
          ]}
          layout={{
            margin: { l: 0, r: 0, t: 24, b: 0 },
            font: { size: 14, color: "#eef1f8" },
            scene: {
              xaxis: {
                title: { text: "log-moneyness k", font: { size: 16, color: "#eef1f8" } },
                color: "#eef1f8",
                showticklabels: true,
                tickfont: { size: 14, color: "#eef1f8" },
                gridcolor: "#1e2438",
              },
              yaxis: {
                title: { text: "tau (years)", font: { size: 16, color: "#eef1f8" } },
                color: "#eef1f8",
                showticklabels: true,
                tickfont: { size: 14, color: "#eef1f8" },
                gridcolor: "#1e2438",
              },
              zaxis: {
                title: {
                  text: surfaceView === "iv" ? "implied vol" : "local vol",
                  font: { size: 16, color: "#eef1f8" },
                },
                color: "#eef1f8",
                showticklabels: true,
                tickfont: { size: 14, color: "#eef1f8" },
                gridcolor: "#1e2438",
              },
            },
          }}
        />

        <div className="flex flex-wrap gap-2">
          <Chip>min local variance = {surfaceGrids.localVol.minLocalVar.toExponential(3)}</Chip>
          <Chip>
            {localVolOk
              ? "local vol >= 0 everywhere"
              : `${surfaceGrids.localVol.negativeRegions.length} negative region(s)`}
          </Chip>
        </div>
      </Stage>

      <section className="flex flex-col gap-6 border-t border-border px-6 py-16 sm:px-8">
        <h2 className="text-lg font-medium text-foreground">Glossary</h2>
        <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
          {GLOSSARY.map(({ term, definition }) => (
            <div key={term} className="flex flex-col gap-1">
              <dt className="font-mono text-sm text-accent">{term}</dt>
              <dd className="text-sm leading-6 text-muted">{definition}</dd>
            </div>
          ))}
        </dl>
      </section>
    </main>
  );
}
