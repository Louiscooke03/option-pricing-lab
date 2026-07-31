# research/ — Python reference layer

This folder is a standalone Python research environment. It is **not** part of the
Next.js app build and has no dependency on anything under `lib/`, `app/`, or
`components/`. It exists to prototype and sanity-check the option-pricing maths
against real market data before (re)implementing it in TypeScript.

## Setup

```bash
pip install -r requirements.txt
```

## Run

```bash
python fetch_data.py        # fetches a live BTC option chain from Deribit, saves data/
python vol_smile.py         # loads the latest snapshot, fits an SVI slice, saves figures/
```

Both scripts accept an optional currency argument, e.g. `python fetch_data.py ETH`
followed by `python vol_smile.py ETH`. `vol_smile.py` also accepts
`--expiry YYYY-MM-DD` to force a specific expiry instead of auto-picking the one
with the most usable strikes.

## What it does

- `fetch_data.py` pulls the full option book summary for a currency from Deribit's
  public REST API (no key needed), converts BTC/ETH-denominated premiums to USD,
  parses instrument names into (expiry, strike, type), drops quotes with missing
  bid/ask/mid, and writes a JSON + CSV snapshot under `data/`.
- `vol_smile.py` loads a snapshot, recovers the forward and discount factor per
  expiry from put-call parity (regressing `C - P` on strike), inverts OTM mids to
  Black-76 implied vols, builds a `(log-moneyness, total variance)` slice, and fits
  an SVI raw parametrization by weighted nonlinear least squares. It saves two
  plots per run to `figures/`: the raw smile before any fit, and the SVI-fitted
  slice (total variance and implied vol) with fitted parameters annotated.

## Why this is separate from `lib/`

This is throwaway-style research code: quick to iterate, fetches live data, and
isn't unit-tested or type-checked as part of CI. The same maths (forward recovery,
Black-76, implied-vol inversion, SVI fitting) is being reimplemented and unit-tested
properly in TypeScript under `lib/` for the actual app. Treat this folder as a
reference/validation tool, not production code.
