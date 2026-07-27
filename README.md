# Option Pricing Lab

An interactive companion to an MSc dissertation on option pricing. Client-side only — no backend, no API routes, no server-side numerics. Built for Vercel.

## Stack

- Next.js 15 (App Router), TypeScript (strict), Tailwind CSS v4
- `plotly.js-dist-min` via a client-only wrapper (`components/Plot.tsx`)

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

```bash
npm run build   # production build
npm run start   # serve the production build locally
npm run lint    # eslint
```

## Structure

```
app/          routes, layout, global styles
components/   design-system primitives (SectionNumber, Chip, EquationBlock, Slider) + Plot.tsx
lib/          pure, typed, unit-tested numerics only — no React, no DOM (see lib/README.md)
types/        ambient type declarations (e.g. plotly.js-dist-min -> plotly.js types)
```

## Design system

- Dark theme (near-black background, off-white text) with a single accent colour, configured as Tailwind theme tokens in `app/globals.css` (`background`, `surface`, `foreground`, `muted`, `border`, `accent`).
- Geist Mono (via `next/font`) is used for all numeric figures, chips, and equations.

## Plot.tsx

`components/Plot.tsx` dynamically imports `plotly.js-dist-min` inside a `useEffect`, so Plotly never touches `window` during SSR or static generation. It applies a dark layout (transparent backgrounds, light font, subtle gridlines) by default, which callers can override via the `layout` prop.

## Status

Scaffold only — no option-pricing maths yet. That lands next in `lib/`.
