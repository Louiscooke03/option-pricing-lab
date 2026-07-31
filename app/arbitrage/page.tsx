"use client";

import { useMemo, useState } from "react";
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
} from "@/lib/arbitrage";
import { sampleChain } from "@/lib/sample/sampleChain";
import { VolPoint } from "@/lib/types";

const GRID_POINTS = 160;

function buildGrid(kMin: number, kMax: number, pad: number, n: number): number[] {
  const lo = kMin - pad;
  const hi = kMax + pad;
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

export default function ArbitragePage() {
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
    });

    slices.sort((a, b) => a.tau - b.tau);

    const kLo = Math.max(...slices.map((s) => s.kMin));
    const kHi = Math.min(...slices.map((s) => s.kMax));
    const calendarGrid =
      kHi > kLo ? buildGrid(kLo, kHi, 0, GRID_POINTS) : [];
    const calendar = checkCalendar(
      slices.map((s) => ({ tau: s.tau, params: s.params })),
      calendarGrid,
    );

    return { cleaned, forwardResult, slices, calendar };
  }, []);

  const { slices } = pipeline;
  const [selectedExpiry, setSelectedExpiry] = useState(slices[0]?.expiry);
  const slice = slices.find((s) => s.expiry === selectedExpiry) ?? slices[0];

  const tauMin = Math.min(...slices.map((s) => s.tau));
  const tauMax = Math.max(...slices.map((s) => s.tau));
  const tauSpan = Math.max(tauMax - tauMin, 1e-9);

  let gGrid: number[] = [];
  let gValues: number[] = [];
  let densityValues: number[] = [];
  if (slice) {
    const pad = (slice.kMax - slice.kMin) * 0.15 || 0.05;
    gGrid = buildGrid(slice.kMin, slice.kMax, pad, GRID_POINTS);
    gValues = gGrid.map((k) => butterflyG(k, slice.params));
    densityValues = gGrid.map((k) => riskNeutralDensity(k, slice.params));
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-16 px-6 py-24 sm:px-8">
      <header className="flex flex-col gap-4">
        <SectionNumber current={6} total={7} />
        <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          Static arbitrage guardrails
        </h1>
        <p className="max-w-xl text-base leading-7 text-muted">
          Analytic first/second derivatives of the fitted SVI slices feed Gatheral&apos;s
          butterfly indicator g(k) and the implied risk-neutral density, plus a
          calendar check that total variance is non-decreasing in tau at fixed k.
        </p>
        <div className="flex flex-wrap gap-2 pt-2">
          <Chip>{slices.length} fitted expiries</Chip>
          <Chip>{pipeline.calendar.ok ? "calendar ok" : "calendar crossings"}</Chip>
        </div>
      </header>

      <section className="flex flex-col gap-6">
        <SectionNumber current={6} total={7} />
        <h2 className="text-lg font-medium text-foreground">Butterfly arbitrage &amp; density</h2>

        <div className="flex flex-wrap gap-2">
          {slices.map((s) => {
            const isSelected = s.expiry === selectedExpiry;
            return (
              <button
                key={s.expiry}
                type="button"
                onClick={() => setSelectedExpiry(s.expiry)}
                className={`inline-flex items-center rounded-full border px-2.5 py-1 font-mono text-xs transition-colors ${
                  isSelected
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-border text-muted hover:text-foreground"
                }`}
              >
                {s.expiry}
              </button>
            );
          })}
        </div>

        {slice && (
          <>
            <Plot
              className="h-72 w-full"
              data={[
                {
                  x: gGrid,
                  y: gValues,
                  type: "scatter",
                  mode: "lines",
                  name: "g(k)",
                  line: { color: "#d97757", width: 2 },
                },
                {
                  x: [gGrid[0], gGrid[gGrid.length - 1]],
                  y: [0, 0],
                  type: "scatter",
                  mode: "lines",
                  name: "zero",
                  line: { color: "#525252", width: 1, dash: "dash" },
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
              data={[
                {
                  x: gGrid,
                  y: densityValues,
                  type: "scatter",
                  mode: "lines",
                  name: "p(k)",
                  fill: "tozeroy",
                  line: { color: "#7dd3fc", width: 2 },
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

            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              <EquationBlock
                className="flex-1"
                caption="g(k) = (1 − k·w′/(2w))² − (w′²/4)·(1/w + 1/4) + w″/2"
              >
                min g(k) = {slice.butterfly.minG.toExponential(3)}
              </EquationBlock>
              <div className="flex flex-row gap-2 sm:flex-col">
                <Chip>{slice.butterfly.ok ? "butterfly ok" : `${slice.butterfly.violations.length} violations`}</Chip>
                <Chip>rmse {slice.rmse.toExponential(3)}</Chip>
                <Chip>{slice.points.length} points</Chip>
              </div>
            </div>
          </>
        )}
      </section>

      <section className="flex flex-col gap-6">
        <SectionNumber current={7} total={7} />
        <h2 className="text-lg font-medium text-foreground">Calendar arbitrage</h2>
        <p className="max-w-xl text-base leading-7 text-muted">
          Every fitted total-variance slice w(k), overlaid and coloured by tau. A
          calendar-arbitrage-free surface never lets a longer-dated slice dip below a
          shorter-dated one at the same log-moneyness.
        </p>

        <Plot
          className="h-96 w-full"
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
              line: { color: lerpColor("#7dd3fc", "#d97757", t), width: 2 },
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
      </section>
    </div>
  );
}
