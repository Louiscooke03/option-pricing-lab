"use client";

import { useEffect, useRef } from "react";
import type { Data, Layout, Config, PlotlyHTMLElement } from "plotly.js-dist-min";

interface PlotProps {
  data: Data[];
  layout?: Partial<Layout>;
  config?: Partial<Config>;
  className?: string;
  /** Base filename (no extension) used by the modebar's "download as PNG" button. */
  exportName?: string;
}

const DARK_LAYOUT: Partial<Layout> = {
  paper_bgcolor: "rgba(0,0,0,0)",
  plot_bgcolor: "rgba(0,0,0,0)",
  font: {
    family:
      "var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace",
    color: "#eef1f8",
    size: 12,
  },
  margin: { l: 48, r: 24, t: 24, b: 40 },
  xaxis: {
    gridcolor: "#1e2438",
    zerolinecolor: "#1e2438",
    linecolor: "#1e2438",
  },
  yaxis: {
    gridcolor: "#1e2438",
    zerolinecolor: "#1e2438",
    linecolor: "#1e2438",
  },
  modebar: {
    bgcolor: "rgba(0,0,0,0)",
    color: "#7a8296",
    activecolor: "#5568f0",
  },
};

const DEFAULT_CONFIG: Partial<Config> = {
  displayModeBar: true,
  displaylogo: false,
  responsive: true,
};

export default function Plot({ data, layout, config, className = "", exportName = "plot" }: PlotProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<PlotlyHTMLElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;

    async function render() {
      const Plotly = (await import("plotly.js-dist-min")).default;
      if (cancelled || !container) return;

      const mergedLayout: Partial<Layout> = {
        ...DARK_LAYOUT,
        ...layout,
        font: { ...DARK_LAYOUT.font, ...layout?.font },
        xaxis: { ...DARK_LAYOUT.xaxis, ...layout?.xaxis },
        yaxis: { ...DARK_LAYOUT.yaxis, ...layout?.yaxis },
      };
      const mergedConfig: Partial<Config> = {
        ...DEFAULT_CONFIG,
        ...config,
        toImageButtonOptions: {
          format: "png",
          scale: 3,
          filename: exportName,
          ...config?.toImageButtonOptions,
        },
      };

      plotRef.current = await Plotly.newPlot(
        container,
        data,
        mergedLayout,
        mergedConfig,
      );
    }

    render();

    return () => {
      cancelled = true;
      if (container) {
        import("plotly.js-dist-min").then(({ default: Plotly }) => {
          Plotly.purge(container);
        });
      }
    };
  }, [data, layout, config, exportName]);

  return <div ref={containerRef} className={className} />;
}
