"use client";

import { useMemo, useState } from "react";
import SectionNumber from "@/components/SectionNumber";
import Chip from "@/components/Chip";
import EquationBlock from "@/components/EquationBlock";
import Plot from "@/components/Plot";
import { cleanChain } from "@/lib/clean";
import { recoverForward } from "@/lib/forward";
import { impliedVolPoints } from "@/lib/volSurface";
import { fitSVISlice, sviTotalVariance, SVIPoint, SVIFitResult } from "@/lib/svi";
import { sampleChain } from "@/lib/sample/sampleChain";
import { VolPoint } from "@/lib/types";

const GRID_POINTS = 120;

function buildKGrid(points: SVIPoint[]): number[] {
  const ks = points.map((p) => p.k);
  const min = Math.min(...ks);
  const max = Math.max(...ks);
  const pad = (max - min) * 0.15 || 0.05;
  const lo = min - pad;
  const hi = max + pad;
  return Array.from({ length: GRID_POINTS }, (_, i) => lo + (i / (GRID_POINTS - 1)) * (hi - lo));
}

export default function SVIPage() {
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

    const fits = new Map<string, SVIFitResult>();
    pointsByExpiry.forEach((slicePoints, expiry) => {
      const sviPoints: SVIPoint[] = slicePoints.map((p) => ({ k: p.k, w: p.totalVar, weight: p.weight }));
      if (sviPoints.length >= 5) {
        fits.set(expiry, fitSVISlice(sviPoints));
      }
    });

    return { cleaned, forwardResult, pointsByExpiry, fits };
  }, []);

  const expiries = pipeline.forwardResult.expiries.map((e) => e.expiry);
  const [selectedExpiry, setSelectedExpiry] = useState(expiries[0]);

  const slicePoints = pipeline.pointsByExpiry.get(selectedExpiry) ?? [];
  const fit = pipeline.fits.get(selectedExpiry);
  const sviPoints: SVIPoint[] = slicePoints.map((p) => ({ k: p.k, w: p.totalVar, weight: p.weight }));

  const grid = fit ? buildKGrid(sviPoints) : [];
  const curveW = fit ? grid.map((k) => sviTotalVariance(k, fit.params)) : [];

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-16 px-6 py-24 sm:px-8">
      <header className="flex flex-col gap-4">
        <SectionNumber current={4} total={9} />
        <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          SVI slice fit
        </h1>
        <p className="max-w-xl text-base leading-7 text-muted">
          The bundled sample chain runs through clean → forward recovery → implied-vol
          inversion, then a raw five-parameter SVI smile is fit to each expiry&apos;s
          (log-moneyness, total variance) points by weighted least squares.
        </p>
        <div className="flex flex-wrap gap-2 pt-2">
          <Chip>{pipeline.cleaned.quotes.length} clean quotes</Chip>
          <Chip>{pipeline.forwardResult.expiries.length} expiries</Chip>
          <Chip>Nelder–Mead</Chip>
        </div>
      </header>

      <section className="flex flex-col gap-6">
        <SectionNumber current={5} total={9} />

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
              y: curveW,
              type: "scatter",
              mode: "lines",
              name: "SVI fit",
              line: { color: "#d97757", width: 2 },
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

        {fit && (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <EquationBlock
              className="flex-1"
              caption="w(k) = a + b·(ρ(k−m) + √((k−m)² + σ²))"
            >
              a = {fit.params.a.toFixed(5)}, b = {fit.params.b.toFixed(5)}, ρ ={" "}
              {fit.params.rho.toFixed(5)}, m = {fit.params.m.toFixed(5)}, σ ={" "}
              {fit.params.sigma.toFixed(5)}
            </EquationBlock>
            <div className="flex flex-row gap-2 sm:flex-col">
              <Chip>rmse {fit.rmse.toExponential(3)}</Chip>
              <Chip>{fit.converged ? "converged" : "not converged"}</Chip>
              <Chip>{sviPoints.length} points</Chip>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
