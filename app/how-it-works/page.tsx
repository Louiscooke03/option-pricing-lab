import SectionNumber from "@/components/SectionNumber";
import EquationBlock from "@/components/EquationBlock";

interface PipelineStep {
  title: string;
  equation: string;
  caption: string;
  explanation: string;
  assumptions: string;
}

const STEPS: PipelineStep[] = [
  {
    title: "Forward & discount via put–call parity",
    equation: "C − P = DF·(F − K)",
    caption: "lib/forward.ts → recoverForward()",
    explanation:
      "Pairs each expiry's call and put quotes at matching strikes and regresses (C − P) against strike; the slope recovers the discount factor DF and the intercept recovers the forward F, in one weighted least-squares pass. The forward isn't assumed from spot and a rate — it's observed directly from market prices via put–call parity.",
    assumptions:
      "European-style, cash-settled options with matched call/put strikes; dividends and financing costs are absorbed into the implied (F, DF) pair rather than modelled separately.",
  },
  {
    title: "Black-76 & implied vol (Newton)",
    equation: "C = DF·[F·N(d₁) − K·N(d₂)]",
    caption: "lib/bs.ts → black76Call(); lib/impliedVol.ts → impliedVol()",
    explanation:
      "Every OTM quote is priced under Black-76 (lognormal forward, so no separate drift assumption is needed once F and DF are known), then inverted for the implied volatility that reproduces its market mid, using Newton's method seeded from a Brenner–Subrahmanyam ATM estimate, falling back to bisection if Newton stalls or vega is too small.",
    assumptions:
      "Black-76 is used purely as an inversion device, not a claim of constant vol; prices outside the model's no-arbitrage bounds are rejected rather than forced to a volatility.",
  },
  {
    title: "Coordinates",
    equation: "k = ln(K/F),   w = σ²τ",
    caption: "lib/volSurface.ts → impliedVolPoints()",
    explanation:
      "Converts each expiry's (strike, implied vol) pairs into the coordinates the rest of the pipeline fits in: log-moneyness k, which normalises strikes across expiries and spot levels, and total variance w = σ²τ, the additive quantity across time that SVI and SSVI are parameterised in.",
    assumptions:
      "Only the OTM leg (calls above the forward, puts below) is used per strike, since OTM quotes carry the least discretisation/pinning noise; wide or crossed quotes were already dropped upstream during cleaning.",
  },
  {
    title: "SVI slice",
    equation: "w(k) = a + b[ρ(k−m) + √((k−m)² + σ²)]",
    caption: "lib/svi.ts → fitSVISlice()",
    explanation:
      "Fits the five-parameter raw SVI curve to one expiry's (k, w) points at a time by weighted least squares (Nelder–Mead over an unconstrained reparameterisation, with random restarts), giving a smooth, closed-form smile with analytic derivatives that the arbitrage checks and Dupire formula later depend on.",
    assumptions:
      "A per-expiry fit only constrains that one slice — nothing stops adjacent expiries from crossing in time until the calendar check (or the global SSVI fit) is applied.",
  },
  {
    title: "Butterfly & density",
    equation: "g(k) = (1 − kw′/2w)² − (w′²/4)(1/w + 1/4) + w″/2,   p(k) = g/√(2πw)·e^(−d₋²/2)",
    caption: "lib/arbitrage.ts → butterflyG(), riskNeutralDensity()",
    explanation:
      "g(k) is the Gatheral–Jacquier butterfly-arbitrage indicator, built from the SVI slice's analytic first and second derivatives; g(k) < 0 anywhere implies a negative implied density there — a butterfly-spread arbitrage. p(k) is that implied risk-neutral density itself.",
    assumptions:
      "Evaluated on the strikes actually spanned by the fit — extrapolating g(k) or p(k) far outside the calibrated k-range isn't a claim the fit is making.",
  },
  {
    title: "Calendar",
    equation: "∂w/∂τ ≥ 0",
    caption: "lib/arbitrage.ts → checkCalendar()",
    explanation:
      "Total variance must be non-decreasing in time at fixed log-moneyness, or a shorter-dated option would be arbitrageable against a longer-dated one at the same strike. checkCalendar scans every pair of adjacent-tau slices across a shared k-grid and flags any point where a longer expiry's w dips below a shorter one's.",
    assumptions:
      "Checked over each pair's shared, data-supported k-range for independent per-expiry slices, since raw extrapolation there isn't trustworthy; the global SSVI surface instead satisfies this by construction via its penalised fit.",
  },
  {
    title: "SSVI surface",
    equation: "w(k,θ) = (θ/2){1 + ρφk + √((φk+ρ)² + (1−ρ²))},   φ(θ) = ηθ^(−γ)",
    caption: "lib/ssvi.ts → fitSSVI()",
    explanation:
      "Instead of one SVI curve per expiry, SSVI fits a single global (ρ, η, γ) across every expiry's points at once, driven by the ATM total-variance term structure θ(τ) built from the per-slice fits. The no-butterfly-arbitrage bound θ·φ(θ)·(1+|ρ|) < 4 is penalised directly inside the fit, so the surface is arbitrage-free by construction rather than by checking after the fact.",
    assumptions:
      "One skew/curvature shape is shared across the whole surface; if the true smile shape changes materially by tenor, a single (ρ, η, γ) fits some expiries less tightly than an independent per-slice SVI would.",
  },
  {
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

export default function HowItWorksPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-16 px-6 py-24 sm:px-8">
      <header className="flex flex-col gap-4">
        <SectionNumber current={1} total={STEPS.length} />
        <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          How it works
        </h1>
        <p className="max-w-xl text-base leading-7 text-muted">
          A walkthrough of the pipeline implemented in <code>lib/</code>, from raw
          quotes to a Dupire local-vol surface. No new maths here — this page is a
          reference to what the other pages already compute.
        </p>
      </header>

      {STEPS.map((step, i) => (
        <section key={step.title} className="flex flex-col gap-4">
          <SectionNumber current={i + 1} total={STEPS.length} />
          <h2 className="text-lg font-medium text-foreground">
            {i + 1}. {step.title}
          </h2>
          <EquationBlock caption={step.caption}>{step.equation}</EquationBlock>
          <p className="max-w-xl text-base leading-7 text-muted">{step.explanation}</p>
          <p className="max-w-xl text-sm leading-6 text-muted">
            <span className="font-mono text-xs uppercase tracking-wide text-foreground">
              Assumptions / limitations —{" "}
            </span>
            {step.assumptions}
          </p>
        </section>
      ))}

      <section className="flex flex-col gap-6 border-t border-border pt-12">
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
    </div>
  );
}
