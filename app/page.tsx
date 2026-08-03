"use client";

import { useState } from "react";
import SectionNumber from "@/components/SectionNumber";
import Chip from "@/components/Chip";
import EquationBlock from "@/components/EquationBlock";
import Slider from "@/components/Slider";
import Plot from "@/components/Plot";

export default function Home() {
  const [frequency, setFrequency] = useState(2);

  const x = Array.from({ length: 200 }, (_, i) => (i / 199) * 4 * Math.PI);
  const y = x.map((v) => Math.sin(v * (frequency / 2)));

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-16 px-6 py-24 sm:px-8">
      <header className="flex flex-col gap-4">
        <SectionNumber current={1} total={9} />
        <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          Option Pricing Lab
        </h1>
        <p className="max-w-xl text-base leading-7 text-muted">
          An interactive companion to an MSc dissertation on option pricing.
          This scaffold proves out the design system and a client-only Plotly
          wrapper before any pricing models land.
        </p>
        <div className="flex flex-wrap gap-2 pt-2">
          <Chip>Next.js 15</Chip>
          <Chip>TypeScript</Chip>
          <Chip>Plotly</Chip>
          <Chip>SVI</Chip>
          <Chip>Newton</Chip>
        </div>
      </header>

      <section className="flex flex-col gap-4">
        <SectionNumber current={2} total={9} />
        <EquationBlock caption="lib/bs.ts → priceCall()">
          C = S₀N(d₁) − Ke^(−rT)N(d₂)
        </EquationBlock>
      </section>

      <section className="flex flex-col gap-6">
        <SectionNumber current={3} total={9} />
        <Slider
          label="Frequency"
          min={1}
          max={8}
          step={1}
          value={frequency}
          onChange={setFrequency}
        />
        <Plot
          className="h-80 w-full"
          exportName="demo-sine"
          data={[
            {
              x,
              y,
              type: "scatter",
              mode: "lines",
              line: { color: "#d97757", width: 2 },
            },
          ]}
          layout={{ title: { text: "Demo trace" } }}
        />
      </section>
    </div>
  );
}
