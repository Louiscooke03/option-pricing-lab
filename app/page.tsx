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

interface PipelineStep {
  id: string;
  title: string;
  equation: string;
  caption: string;
  explanation: string;
  assumptions: string;
}

const STEPS: PipelineStep[] = [
  {
    id: "forward",
    title: "Forward & discount via put–call parity",
    equation: "C − P = DF·(F − K)",
    caption: "lib/forward.ts → recoverForward()",
    explanation:
      "Pairs each expiry's call and put quotes at matching strikes and regresses (C − P) against strike; the slope recovers the discount factor DF and the intercept recovers the forward F, in one weighted least-squares pass. The forward isn't assumed from spot and a rate — it's observed directly from market prices via put–call parity.",
    assumptions:
      "European-style, cash-settled options with matched call/put strikes; dividends and financing costs are absorbed into the implied (F, DF) pair rather than modelled separately.",
  },
  {
    id: "black76",
    title: "Black-76 & implied vol (Newton)",
    equation: "C = DF·[F·N(d₁) − K·N(d₂)]",
    caption: "lib/bs.ts → black76Call(); lib/impliedVol.ts → impliedVol()",
    explanation:
      "Every OTM quote is priced under Black-76 (lognormal forward, so no separate drift assumption is needed once F and DF are known), then inverted for the implied volatility that reproduces its market mid, using Newton's method seeded from a Brenner–Subrahmanyam ATM estimate, falling back to bisection if Newton stalls or vega is too small.",
    assumptions:
      "Black-76 is used purely as an inversion device, not a claim of constant vol; prices outside the model's no-arbitrage bounds are rejected rather than forced to a volatility.",
  },
  {
    id: "coordinates",
    title: "Coordinates",
    equation: "k = ln(K/F),   w = σ²τ",
    caption: "lib/volSurface.ts → impliedVolPoints()",
    explanation:
      "Converts each expiry's (strike, implied vol) pairs into the coordinates the rest of the pipeline fits in: log-moneyness k, which normalises strikes across expiries and spot levels, and total variance w = σ²τ, the additive quantity across time that SVI and SSVI are parameterised in.",
    assumptions:
      "Only the OTM leg (calls above the forward, puts below) is used per strike, since OTM quotes carry the least discretisation/pinning noise; wide or crossed quotes were already dropped upstream during cleaning.",
  },
  {
    id: "svi",
    title: "SVI slice fit",
    equation: "w(k) = a + b[ρ(k−m) + √((k−m)² + σ²)]",
    caption: "lib/svi.ts → fitSVISlice()",
    explanation:
      "Fits the five-parameter raw SVI curve to one expiry's (k, w) points at a time by weighted least squares (Nelder–Mead over an unconstrained reparameterisation, with random restarts), giving a smooth, closed-form smile with analytic derivatives that the arbitrage checks and Dupire formula later depend on.",
    assumptions:
      "A per-expiry fit only constrains that one slice — nothing stops adjacent expiries from crossing in time until the calendar check (or the global SSVI fit) is applied.",
  },
  {
    id: "butterfly",
    title: "Butterfly & implied density",
    equation: "g(k) = (1 − kw′/2w)² − (w′²/4)(1/w + 1/4) + w″/2,   p(k) = g/√(2πw)·e^(−d₋²/2)",
    caption: "lib/arbitrage.ts → butterflyG(), riskNeutralDensity()",
    explanation:
      "g(k) is the Gatheral–Jacquier butterfly-arbitrage indicator, built from the SVI slice's analytic first and second derivatives; g(k) < 0 anywhere implies a negative implied density there — a butterfly-spread arbitrage. p(k) is that implied risk-neutral density itself.",
    assumptions:
      "Evaluated on the strikes actually spanned by the fit — extrapolating g(k) or p(k) far outside the calibrated k-range isn't a claim the fit is making.",
  },
  {
    id: "calendar",
    title: "Calendar / no-crossing",
    equation: "∂w/∂τ ≥ 0",
    caption: "lib/arbitrage.ts → checkCalendar()",
    explanation:
      "Total variance must be non-decreasing in time at fixed log-moneyness, or a shorter-dated option would be arbitrageable against a longer-dated one at the same strike. checkCalendar scans every pair of adjacent-tau slices across a shared k-grid and flags any point where a longer expiry's w dips below a shorter one's.",
    assumptions:
      "Checked over each pair's shared, data-supported k-range for independent per-expiry slices, since raw extrapolation there isn't trustworthy; the global SSVI surface instead satisfies this by construction via its penalised fit.",
  },
  {
    id: "ssvi",
    title: "SSVI global surface",
    equation: "w(k,θ) = (θ/2){1 + ρφk + √((φk+ρ)² + (1−ρ²))},   φ(θ) = ηθ^(−γ)",
    caption: "lib/ssvi.ts → fitSSVI()",
    explanation:
      "Instead of one SVI curve per expiry, SSVI fits a single global (ρ, η, γ) across every expiry's points at once, driven by the ATM total-variance term structure θ(τ) built from the per-slice fits. The no-butterfly-arbitrage bound θ·φ(θ)·(1+|ρ|) < 4 is penalised directly inside the fit, so the surface is arbitrage-free by construction rather than by checking after the fact.",
    assumptions:
      "One skew/curvature shape is shared across the whole surface; if the true smile shape changes materially by tenor, a single (ρ, η, γ) fits some expiries less tightly than an independent per-slice SVI would.",
  },
  {
    id: "localvol",
    title: "Dupire local vol",
    equation: "σ_loc²(k,τ) = (∂w/∂τ) / g(k)",
    caption: "lib/dupire.ts → localVolSurface()",
    explanation:
      "Dupire's formula recovers the instantaneous local volatility consistent with the entire fitted implied-vol surface, expressed here in (k, τ) coordinates via the same pieces used above: ∂w/∂τ by finite differences along θ(τ), and g(k) analytically from the SSVI-equivalent slice at that τ.",
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
      <p className="max-w-xl text-base leading-7 text-muted">{step.explanation}</p>
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

    const ivSurface = tauGrid.map((tau) => {
      const theta = thetaOf(tau, thetaKnots);
      return kGrid.map((k) => Math.sqrt(Math.max(ssviTotalVariance(k, theta, ssviFit.params), 0) / tau));
    });

    const localVol = localVolSurface(kGrid, tauGrid, ssviFit.params, thetaKnots);

    return { kGrid, tauGrid, ivSurface, localVol };
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
          className="h-[480px] w-full"
          exportName="ssvi-implied-vol-surface"
          data={[
            {
              type: "surface",
              x: surfaceGrids.kGrid,
              y: surfaceGrids.tauGrid,
              z: surfaceGrids.ivSurface,
              colorscale: "Viridis",
              showscale: true,
            },
          ]}
          layout={{
            margin: { l: 0, r: 0, t: 24, b: 0 },
            scene: {
              xaxis: { title: { text: "log-moneyness k" } },
              yaxis: { title: { text: "tau (years)" } },
              zaxis: { title: { text: "implied vol" } },
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
          className="h-[480px] w-full"
          exportName={surfaceView === "iv" ? "ssvi-implied-vol-surface" : "dupire-localvol-surface"}
          data={[
            {
              type: "surface",
              x: surfaceGrids.kGrid,
              y: surfaceGrids.tauGrid,
              z: surfaceView === "iv" ? surfaceGrids.ivSurface : surfaceGrids.localVol.sigma,
              colorscale: "Viridis",
              showscale: true,
            },
          ]}
          layout={{
            margin: { l: 0, r: 0, t: 24, b: 0 },
            scene: {
              xaxis: { title: { text: "log-moneyness k" } },
              yaxis: { title: { text: "tau (years)" } },
              zaxis: { title: { text: surfaceView === "iv" ? "implied vol" : "local vol" } },
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
