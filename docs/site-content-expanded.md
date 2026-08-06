# Option Pricing Lab — Expanded Site Copy

Section-by-section replacement prose for the scroll-through. Each equation is followed by a
term-by-term "where" list, plus the deeper explanations requested. Voice matches the existing site:
precise, plain, honest about limitations.

---

## 01 / Forward & discount via put–call parity

**Equation:** `C − P = DF·(F − K)`

where:
- **C** — the market price (premium) of the call at strike K.
- **P** — the market price of the put at the same strike K.
- **DF** — the discount factor, `e^(−rτ)`: the value today of £1 paid at expiry.
- **F** — the forward price: the price agreed today for delivery of the underlying at expiry.
- **K** — the strike shared by the call/put pair.

Put–call parity is model-free — it holds by pure no-arbitrage, with no assumption about volatility.
A call minus a put replicates a discounted forward, so their price difference is fixed. Because the
right-hand side is linear in K, regressing observed `(C − P)` against strike across an expiry gives a
straight line whose slope is `−DF` and whose intercept is `DF·F` — recovering the forward and
discount directly from the chain. r and q only ever appear as the combination inside F, so dividends
are absorbed into the forward rather than modelled separately.

---

## 02 / Black-76 & implied vol (Newton)

**Equation:** `C = DF·[F·N(d₁) − K·N(d₂)]`, with `d₁ = [ln(F/K) + ½σ²τ] / (σ√τ)`, `d₂ = d₁ − σ√τ`

where:
- **C** — the model price of the call.
- **DF** — discount factor (from stage 01).
- **F** — forward price (from stage 01).
- **K** — strike.
- **N(·)** — the standard normal cumulative distribution function: the probability a standard normal
  random variable falls below its argument.
- **d₁, d₂** — standardised moneyness terms; d₂ is d₁ shifted down by one standard deviation `σ√τ`.
- **ln(F/K)** — log-moneyness: how far the strike sits from the forward.
- **σ** — the volatility. This is the single unknown we solve for.
- **τ** — time to expiry, in years.

Given σ, this returns a price. *Implied volatility* is the reverse question: the σ that makes the
formula reproduce a quote's market mid. There's no closed form, so we solve numerically with Newton's
method — using vega (the price's sensitivity to σ) as the step — seeded from a Brenner–Subrahmanyam
ATM estimate, falling back to bisection if Newton stalls. Black-76 is used here purely as an
invertible quoting device, not as a claim that volatility is constant.

---

## 03 / Coordinates

**Equation:** `k = ln(K/F)`, `w = σ²·τ`

where:
- **k** — log-moneyness: the natural log of strike over forward. k = 0 at the forward, negative below
  it, positive above it. It normalises strikes across expiries and spot levels.
- **K** — strike; **F** — forward.
- **w** — total (implied) variance: the accumulated variance out to expiry. Unlike volatility, total
  variance is *additive across time*, which is what makes it the natural coordinate for the surface.
- **σ** — the implied volatility at that strike (from stage 02).
- **τ** — time to expiry, in years.

Every no-arbitrage and stability property is clean in (k, w) and messy in (K, σ), so the whole
surface is built in these coordinates.

---

## 04 / SVI slice fit

**Equation:** `w(k) = a + b·[ ρ(k − m) + √((k − m)² + σ²) ]`

where:
- **w(k)** — total variance as a function of log-moneyness (the smile for one expiry).
- **a** — the overall vertical *level* of the smile (roughly the minimum total variance).
- **b** — the *wing steepness*: how fast variance grows away from the money (b ≥ 0).
- **ρ** — the *skew/tilt*: leans the smile left or right (−1 < ρ < 1). Negative ρ lifts the
  low-strike wing — the classic downside-fear skew.
- **m** — the *horizontal shift*: the log-moneyness at which the smile bottoms out.
- **σ** — the *curvature of the belly*: how rounded versus sharp the bottom is (σ > 0). Despite the
  letter, this is **not** a volatility.
- **k** — log-moneyness.

**Why the fitted curves differ in shape.** All three expiries share this one functional form, yet
some look like smooth bowls and others like a sharp "V". The reason is the square-root term, which is
what rounds the bottom of the smile. Far from the money, for large `|k − m|`, the root behaves like
`|k − m|` — two straight *wings* with slopes `b(1 + ρ)` and `b(1 − ρ)` meeting at a corner. Close to
the money, the `σ²` inside the root smooths that corner into a rounded belly. The size of the fitted
**σ** controls how rounded: as σ → 0 the root collapses to `|k − m|`, giving a near-piecewise-linear
V; a larger σ widens and rounds the bottom into a bowl. So a short-dated slice whose fit pushes σ
toward zero looks angular, while slices with a larger fitted σ look smoothly curved — the difference
is the per-slice curvature parameter, not the model. (A very small σ is a valid but edge-case fit: it
concentrates all the curvature at a single point.)

---

## 05 / Butterfly arbitrage & the implied density

**Equation:** `g(k) = (1 − k·w′/2w)² − (w′²/4)(1/w + 1/4) + w″/2`,
`p(k) = g(k) / √(2π·w) · e^(−d₋²/2)`, with `d₋ = −k/√w − √w/2`

where:
- **g(k)** — the Gatheral–Jacquier butterfly indicator: the whole no-arbitrage content of the density
  distilled into one function of the smile. `g(k) ≥ 0` everywhere ⇔ no butterfly arbitrage.
- **w, w′, w″** — total variance and its first and second derivatives with respect to k.
- **p(k)** — the risk-neutral probability density of the log-return at expiry.
- **d₋** — a standardised-moneyness term.

**What a butterfly is (and why its price can't be negative).** A *butterfly spread* is an options
strategy: buy one call at a low strike, sell two calls at a middle strike, and buy one call at a high
strike (same expiry, equally spaced). Its payoff is a little tent — zero everywhere except a peak at
the middle strike, and never negative. Because it can only ever pay out (or break even), a butterfly
must cost a non-negative amount: if its price were negative you'd be *paid* to hold a position that
can only pay you more later — free money, an arbitrage. So every butterfly must have price ≥ 0.

**From butterflies to the density.** The price of an infinitesimally-tight butterfly at strike K is
proportional to the *curvature of call prices in strike*, `∂²C/∂K²`. And by the Breeden–Litzenberger
result, that curvature **is** the risk-neutral probability density of the underlying at K. So "every
butterfly costs ≥ 0" is exactly "the implied probability density is ≥ 0 everywhere." A negative
density is impossible (probabilities can't be negative) and corresponds precisely to a butterfly
you'd be paid to hold — an arbitrage.

**Why g(k) < 0 is the violation.** g(k) is that density condition rewritten purely in terms of the
fitted smile w(k) and its slope and curvature. So `g(k) < 0` at some k means the implied density is
negative there — a butterfly arbitrage, and an inadmissible smile.

**Why we also show p(k).** p(k) is the actual implied probability distribution of where the
underlying lands at expiry — what the option prices are "saying" about the future. Plotting it does
two things: it lets you *see* the market-implied distribution (which should be a sensible, unimodal
bell that integrates to 1), and it turns the abstract condition into a picture — if p(k) ever dips
below zero, that dip *is* the `g(k) < 0` butterfly violation made visible.

---

## 06 / Calendar arbitrage (no crossing)

**Equation:** `∂w/∂τ ≥ 0` (at fixed k)

where:
- **∂w/∂τ** — the rate of change of total variance with maturity, holding log-moneyness fixed.

**What a calendar spread is, and why crossings are arbitrage.** A *calendar spread* pairs two options
at the same strike but different expiries. Total variance `w = σ²τ` is the market's *accumulated
uncertainty* out to each expiry, and the key fact is that the longer-dated window physically contains
the shorter one — you pass through the near expiry on the way to the far one. Time can only add
uncertainty, never remove it, so at any fixed moneyness total variance must be non-decreasing in
maturity. On the plot, that means the total-variance slices must **not cross**.

If a longer-dated slice *does* dip below a shorter-dated one at some k (a crossover), it is claiming
that a longer option carries *less* accumulated variance than a shorter one at that strike. You could
then buy the "too cheap" longer-dated option and sell the "too expensive" shorter-dated one: the
shorter option expires first, and whatever it owes is always covered by the still-live longer option,
so you keep the premium difference risk-free. That is the calendar-spread arbitrage. No crossings
⇔ `∂w/∂τ ≥ 0` ⇔ no calendar arbitrage.

---

## 07 / SSVI global surface

**Equation:** `w(k, θ) = (θ/2)·{ 1 + ρ·φ(θ)·k + √[ (φ(θ)·k + ρ)² + (1 − ρ²) ] }`, `φ(θ) = η·θ^(−γ)`

where:
- **w(k, θ)** — total variance as a function of log-moneyness k and the ATM total variance θ.
- **θ = θ(τ)** — the *ATM total-variance term structure*: total variance at k = 0 for each maturity.
  It's the backbone level that sets where each slice sits.
- **ρ** — a *single, global* skew parameter shared by the whole surface (−1 < ρ < 1).
- **φ(θ)** — the *curvature function*: how sharply the smile bends at each maturity.
- **η** — the curvature scale (η > 0).
- **γ** — the curvature decay exponent (0 < γ ≤ ½): how curvature changes as maturity grows.
- **k** — log-moneyness.

**How the parameterised regularisation builds a differentiable surface.** The per-expiry SVI fits are
independent — 5 parameters × N expiries — and nothing forces them to agree, so they can cross in
maturity or disagree in skew. SSVI replaces all of them with a tiny, shared parameter set: the term
structure θ(τ) plus just three global numbers (ρ, η, γ). This is *regularisation by
parameterisation*: instead of fitting a flexible surface that chases every noisy quote, you restrict
the solution to a small, smooth, arbitrage-free family and fit that to all the points at once.

Two things fall out. First, because the family is low-dimensional and analytic, the fit cannot
overfit noise, and the resulting surface is **smooth and differentiable in k by construction** — its
derivatives are closed forms, not noisy numerical differences. Second, the no-arbitrage conditions
are built *into* the fit rather than checked afterward: the butterfly bound `θ·φ(θ)·(1 + |ρ|) < 4` is
penalised directly in the objective, and a monotone θ(τ) enforces the calendar condition. The result
is one globally consistent, differentiable surface `w(k, τ)` that is arbitrage-free everywhere. That
smoothness is exactly what the next stage needs: Dupire differentiates the surface, and differentiating
noisy quotes is unstable (ill-posed) — the regularisation is what turns it into a well-posed problem.

---

## 08 / Dupire local volatility

**Equation:** `σ_loc²(k, τ) = (∂w/∂τ) / g(k)`

where:
- **σ_loc²(k, τ)** — the *local variance*: the square of the instantaneous local volatility at
  log-moneyness k and maturity τ.
- **σ_loc** — the *local volatility*: the deterministic instantaneous volatility the underlying must
  have at each price level and time.
- **∂w/∂τ** — the maturity (calendar) derivative of total variance — the same quantity as the
  calendar condition; its non-negativity keeps the numerator ≥ 0.
- **g(k)** — the butterfly indicator from stage 05 — the strike-curvature term; its positivity keeps
  the denominator > 0.

**Why translating the surface into local vol matters.** Everything up to stage 07 is *descriptive* —
the implied-vol surface simply re-encodes today's option prices; it isn't a model of how the
underlying moves, and each option effectively carries its own volatility. Dupire's formula translates
that surface into a single, self-consistent **model**: `σ_loc(S, t)`, the instantaneous volatility as
a *deterministic function of spot S and time t*. Priced under its own diffusion, this one model
reproduces *every* vanilla option price simultaneously — it is the minimal model that matches the
entire smile.

This is powerful, and it's the point of the whole pipeline: it turns a static description of prices
into usable *dynamics*. With `σ_loc(S, t)` you can price exotics consistently with the vanilla market,
simulate price paths, and — in this project — feed it as the volatility field into a finite-difference
PDE engine. Without it you have a snapshot of prices; with it you have a model of the process that
generated them.

**Why the surface changes shape after Dupire.** Local vol is a *derivative* of the implied surface,
and differentiating exaggerates slopes: local vol responds to the *local steepness* of the smile and
moves roughly twice as fast across strikes as implied vol does. So the gentle skew of the implied
surface becomes a steeper, more pronounced feature in the local-vol surface. Think of implied vol as
the *average* volatility out to each expiry and local vol as the *instantaneous* volatility at each
point — converting one into the other re-expresses the shape rather than preserving it.

**The smooth term structure (why θ(τ) interpolation changed).** Dupire needs `∂w/∂τ`, a *maturity
derivative* — an object that only exists once the ATM level θ is a continuous function interpolated
between the observed expiries. Interpolating θ(τ) with straight lines makes its slope jump at each
observed maturity, so `∂w/∂τ` steps discontinuously and the local-vol surface shows a "wall" spanning
the strikes at that maturity. The fix is to interpolate θ(τ) with a **monotone cubic (PCHIP /
Fritsch–Carlson)** instead of straight lines: it keeps θ(τ) non-decreasing — so the calendar
no-arbitrage condition still holds — while making its first derivative *continuous*. With a smooth
θ(τ), `∂w/∂τ` is continuous and the wall flattens into a smooth surface. (Real term-structure models
use a smooth θ(τ) for exactly this reason.)

Assumptions / limitations — local vol reproduces every vanilla price the surface implies, but it
flattens the forward smile going forward in time, so it is not the same object as the market's future
implied-vol smile; and it is only reliable strictly inside the calibrated maturity range, since θ(τ)
is clamped flat outside it.
