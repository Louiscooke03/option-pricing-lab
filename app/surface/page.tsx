"use client";

import { useMemo, useState } from "react";
import SectionNumber from "@/components/SectionNumber";
import Chip from "@/components/Chip";
import EquationBlock from "@/components/EquationBlock";
import Plot from "@/components/Plot";
import { cleanChain } from "@/lib/clean";
import { recoverForward } from "@/lib/forward";
import { impliedVolPoints } from "@/lib/volSurface";
import { fitSVISlice, sviTotalVariance, SVIParams, SVIPoint, SVIFitResult } from "@/lib/svi";
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
import { checkButterfly, checkCalendar, ButterflyCheckResult } from "@/lib/arbitrage";
import { localVolSurface } from "@/lib/dupire";
import { sampleChain } from "@/lib/sample/sampleChain";
import { VolPoint } from "@/lib/types";

type SurfaceView = "iv" | "localvol";

const SLICE_GRID_POINTS = 120;
const SURFACE_K_POINTS = 61;
const SURFACE_TAU_POINTS = 40;

function buildGridFromPoints(points: { k: number }[], n: number): number[] {
  const ks = points.map((p) => p.k);
  const min = Math.min(...ks);
  const max = Math.max(...ks);
  const pad = (max - min) * 0.15 || 0.05;
  const lo = min - pad;
  const hi = max + pad;
  return Array.from({ length: n }, (_, i) => lo + (i / (n - 1)) * (hi - lo));
}

function linspace(lo: number, hi: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => lo + (i / (n - 1)) * (hi - lo));
}

export default function SurfacePage() {
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

    const sliceFits = new Map<string, SVIFitResult>();
    const sliceFitList: { tau: number; params: SVIParams }[] = [];
    const groups: SSVIPointsGroup[] = [];

    pointsByExpiry.forEach((slicePoints, expiry) => {
      const sviPoints: SVIPoint[] = slicePoints.map((p) => ({ k: p.k, w: p.totalVar, weight: p.weight }));
      if (sviPoints.length < 5) return;

      const tau = forwardResult.expiries.find((e) => e.expiry === expiry)?.tau;
      if (tau === undefined) return;

      const fit = fitSVISlice(sviPoints);
      sliceFits.set(expiry, fit);
      sliceFitList.push({ tau, params: fit.params });
      groups.push({ tau, points: sviPoints });
    });

    const thetaKnots: ThetaKnot[] = buildThetaTermStructure(sliceFitList);
    const ssviFit: SSVIFitResult = fitSSVI(groups, thetaKnots);

    const arbitragePerExpiry = thetaKnots.map(({ tau, theta }) => ({
      tau,
      params: ssviSliceToSVIParams(theta, ssviFit.params),
    }));
    const butterflyResults: { tau: number; result: ButterflyCheckResult }[] = arbitragePerExpiry.map((s) => ({
      tau: s.tau,
      result: checkButterfly(s.params),
    }));
    const calendarResult = checkCalendar(arbitragePerExpiry);

    return { cleaned, forwardResult, pointsByExpiry, sliceFits, thetaKnots, ssviFit, butterflyResults, calendarResult };
  }, []);

  const { thetaKnots, ssviFit } = pipeline;
  const expiries = [...pipeline.pointsByExpiry.keys()].filter((e) => pipeline.sliceFits.has(e));
  const [selectedExpiry, setSelectedExpiry] = useState(expiries[0]);
  const [surfaceView, setSurfaceView] = useState<SurfaceView>("iv");

  const tauMin = thetaKnots[0]?.tau ?? 0;
  const tauMax = thetaKnots[thetaKnots.length - 1]?.tau ?? 1;
  // dw/dtau (and hence local variance) is taken via finite differences along the
  // theta(tau) term structure, which is clamped flat outside its knot range -- so we
  // stay strictly inside it here rather than claiming a value the fit isn't making.
  const tauPad = (tauMax - tauMin) * 0.05 || 0.01;
  const allPoints = expiries.flatMap((e) => pipeline.pointsByExpiry.get(e) ?? []);
  const kGrid = buildGridFromPoints(allPoints, SURFACE_K_POINTS);
  const tauGrid = linspace(tauMin + tauPad, tauMax - tauPad, SURFACE_TAU_POINTS);

  const ivSurface = tauGrid.map((tau) => {
    const theta = thetaOf(tau, thetaKnots);
    return kGrid.map((k) => {
      const w = Math.max(ssviTotalVariance(k, theta, ssviFit.params), 0);
      return Math.sqrt(w / tau);
    });
  });

  const localVol = localVolSurface(kGrid, tauGrid, ssviFit.params, thetaKnots);
  const localVolOk = localVol.negativeRegions.length === 0;

  const butterflyOk = pipeline.butterflyResults.every((r) => r.result.ok);
  const worstButterfly = pipeline.butterflyResults.reduce(
    (worst, r) => (r.result.minG < worst.result.minG ? r : worst),
    pipeline.butterflyResults[0],
  );

  const slicePoints: VolPoint[] = pipeline.pointsByExpiry.get(selectedExpiry) ?? [];
  const sliceFit = pipeline.sliceFits.get(selectedExpiry);
  const sviPoints: SVIPoint[] = slicePoints.map((p) => ({ k: p.k, w: p.totalVar, weight: p.weight }));
  const selectedTau = pipeline.forwardResult.expiries.find((e) => e.expiry === selectedExpiry)?.tau;

  const grid = sviPoints.length > 0 ? buildGridFromPoints(sviPoints, SLICE_GRID_POINTS) : [];
  const sviCurve = sliceFit ? grid.map((k) => sviTotalVariance(k, sliceFit.params)) : [];
  const ssviCurve =
    selectedTau !== undefined ? grid.map((k) => ssviTotalVariance(k, thetaOf(selectedTau, thetaKnots), ssviFit.params)) : [];

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-16 px-6 py-24 sm:px-8">
      <header className="flex flex-col gap-4">
        <SectionNumber current={8} total={9} />
        <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          SSVI global surface
        </h1>
        <p className="max-w-xl text-base leading-7 text-muted">
          One globally arbitrage-free surface (rho, eta, gamma) fit by weighted least
          squares over every expiry&apos;s points at once, using the ATM total-variance
          term structure theta(tau) as the backbone connecting the per-slice fits.
        </p>
        <div className="flex flex-wrap gap-2 pt-2">
          <Chip>rho = {ssviFit.params.rho.toFixed(4)}</Chip>
          <Chip>eta = {ssviFit.params.eta.toFixed(4)}</Chip>
          <Chip>gamma = {ssviFit.params.gamma.toFixed(4)}</Chip>
          <Chip>rmse {ssviFit.rmse.toExponential(3)}</Chip>
          <Chip>{ssviFit.converged ? "converged" : "not converged"}</Chip>
        </div>
      </header>

      <section className="flex flex-col gap-6">
        <SectionNumber current={8} total={9} />
        <h2 className="text-lg font-medium text-foreground">
          {surfaceView === "iv" ? "Implied-vol surface" : "Dupire local-vol surface"}
        </h2>

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
          className="h-[520px] w-full"
          exportName={surfaceView === "iv" ? "ssvi-implied-vol-surface" : "dupire-localvol-surface"}
          data={[
            {
              type: "surface",
              x: kGrid,
              y: tauGrid,
              z: surfaceView === "iv" ? ivSurface : localVol.sigma,
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
          <Chip>{butterflyOk ? "butterfly ok (all expiries)" : "butterfly violation detected"}</Chip>
          <Chip>worst min g(k) = {worstButterfly?.result.minG.toExponential(3)}</Chip>
          <Chip>{pipeline.calendarResult.ok ? "calendar ok" : "calendar crossings detected"}</Chip>
          <Chip>min local variance = {localVol.minLocalVar.toExponential(3)}</Chip>
          <Chip>{localVolOk ? "local vol >= 0 everywhere" : `${localVol.negativeRegions.length} negative region(s)`}</Chip>
        </div>

        <EquationBlock caption="sigma_loc^2(k,tau) = (dw/dtau) / g(k,tau), dw/dtau via finite differences along theta(tau)">
          Arbitrage-free by construction: checkButterfly and checkCalendar (lib/arbitrage.ts) are
          run against every fitted expiry&apos;s equivalent raw-SVI slice, converted analytically
          from (theta, rho, eta, gamma); the Dupire local-vol surface (lib/dupire.ts) reuses the
          same butterfly indicator g(k) as its denominator.
        </EquationBlock>
      </section>

      <section className="flex flex-col gap-6">
        <SectionNumber current={9} total={9} />
        <h2 className="text-lg font-medium text-foreground">Per-expiry: independent SVI vs. SSVI slice</h2>

        <div className="flex flex-wrap gap-2">
          {expiries.map((expiry) => {
            const isSelected = expiry === selectedExpiry;
            return (
              <button
                key={expiry}
                type="button"
                onClick={() => setSelectedExpiry(expiry)}
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

        <Plot
          className="h-96 w-full"
          exportName={`ssvi-vs-svi-${selectedExpiry}`}
          data={[
            {
              x: sviPoints.map((p) => p.k),
              y: sviPoints.map((p) => p.w),
              type: "scatter",
              mode: "markers",
              name: "quotes",
              marker: { color: "#ededed", size: 7 },
            },
            {
              x: grid,
              y: sviCurve,
              type: "scatter",
              mode: "lines",
              name: "independent SVI",
              line: { color: "#d97757", width: 2 },
            },
            {
              x: grid,
              y: ssviCurve,
              type: "scatter",
              mode: "lines",
              name: "SSVI slice",
              line: { color: "#7dd3fc", width: 2, dash: "dash" },
            },
          ]}
          layout={{
            title: { text: selectedExpiry },
            margin: { l: 64, r: 24, t: 40, b: 48 },
            xaxis: { title: { text: "log-moneyness k" } },
            yaxis: { title: { text: "total variance w" }, automargin: true },
            showlegend: true,
            legend: { orientation: "h" },
          }}
        />
      </section>
    </div>
  );
}
