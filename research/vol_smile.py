"""
Load a saved Deribit option-chain snapshot, recover the forward/discount factor per
expiry via put-call parity, invert OTM mids to implied vol, fit an SVI slice, and
plot the smile before and after the fit.

Usage:
    python vol_smile.py [CURRENCY] [--expiry YYYY-MM-DD]

Loads the most recent research/data/<currency>_*.csv snapshot unless --expiry is
given to force a specific expiry (otherwise the expiry with the most usable OTM
strikes, with tau in [0.02, 0.5] years, is picked automatically).
"""

import argparse
import glob
import os
from datetime import datetime, timezone

import numpy as np
import pandas as pd
from scipy.optimize import brentq, least_squares
from scipy.stats import norm

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
FIG_DIR = os.path.join(os.path.dirname(__file__), "figures")

TAU_MIN, TAU_MAX = 0.02, 0.5
MIN_SLICE_POINTS = 6

# ---------------------------------------------------------------------------
# Dark plotting style, roughly matching the site's dark theme.
# ---------------------------------------------------------------------------
DARK_BG = "#0b0f14"
DARK_PANEL = "#11161d"
DARK_GRID = "#242c38"
DARK_TEXT = "#e6edf3"
ACCENT_RAW = "#7dd3fc"
ACCENT_FIT = "#fb923c"


def apply_dark_style(plt):
    plt.rcParams.update(
        {
            "figure.facecolor": DARK_BG,
            "axes.facecolor": DARK_PANEL,
            "axes.edgecolor": DARK_GRID,
            "axes.labelcolor": DARK_TEXT,
            "axes.titlecolor": DARK_TEXT,
            "xtick.color": DARK_TEXT,
            "ytick.color": DARK_TEXT,
            "text.color": DARK_TEXT,
            "grid.color": DARK_GRID,
            "legend.facecolor": DARK_PANEL,
            "legend.edgecolor": DARK_GRID,
            "font.size": 11,
        }
    )


# ---------------------------------------------------------------------------
# 1. Load
# ---------------------------------------------------------------------------
def load_chain(csv_path):
    """Load a snapshot CSV into a DataFrame with parsed datetimes."""
    df = pd.read_csv(csv_path, parse_dates=["expiry", "valuation"])
    return df


def latest_snapshot(currency):
    pattern = os.path.join(DATA_DIR, f"{currency}_*.csv")
    matches = sorted(glob.glob(pattern))
    if not matches:
        raise SystemExit(
            f"No snapshot found for {currency} in {DATA_DIR}. Run fetch_data.py first."
        )
    return matches[-1]


# ---------------------------------------------------------------------------
# 2. Year fraction
# ---------------------------------------------------------------------------
def year_fraction(valuation, expiry):
    """ACT/365 year fraction between two timezone-aware datetimes."""
    delta = expiry - valuation
    return delta.total_seconds() / (365.0 * 24 * 3600)


# ---------------------------------------------------------------------------
# 3. Forward / discount factor recovery via put-call parity
# ---------------------------------------------------------------------------
def recover_forward(df_expiry):
    """
    Pair calls & puts at matching strikes and regress (C - P) on strike:
        C - P = DF*F - DF*K
    so slope = -DF, intercept = DF*F.

    Returns (F, DF, tau, n_pairs).
    """
    calls = df_expiry[df_expiry["type"] == "C"].set_index("strike")
    puts = df_expiry[df_expiry["type"] == "P"].set_index("strike")
    common_strikes = calls.index.intersection(puts.index)
    if len(common_strikes) < 2:
        return None

    K = common_strikes.to_numpy(dtype=float)
    c_mid = calls.loc[common_strikes, "mid_usd"].to_numpy()
    p_mid = puts.loc[common_strikes, "mid_usd"].to_numpy()
    c_spread = (calls.loc[common_strikes, "ask_usd"] - calls.loc[common_strikes, "bid_usd"]).to_numpy()
    p_spread = (puts.loc[common_strikes, "ask_usd"] - puts.loc[common_strikes, "bid_usd"]).to_numpy()

    combined_spread = np.clip(c_spread + p_spread, 1e-6, None)
    weights = 1.0 / combined_spread

    y = c_mid - p_mid
    # Weighted least squares: y = intercept + slope * K
    W = np.diag(weights)
    X = np.column_stack([np.ones_like(K), K])
    XtW = X.T @ W
    beta = np.linalg.solve(XtW @ X, XtW @ y)
    intercept, slope = beta

    DF = -slope
    if DF <= 0:
        return None
    F = intercept / DF

    valuation = df_expiry["valuation"].iloc[0]
    expiry = df_expiry["expiry"].iloc[0]
    tau = year_fraction(valuation, expiry)

    return F, DF, tau, len(common_strikes)


# ---------------------------------------------------------------------------
# 4. Black-76 pricing and implied-vol inversion
# ---------------------------------------------------------------------------
def black76_price(F, K, tau, sigma, DF, is_call):
    if tau <= 0 or sigma <= 0:
        intrinsic = max(F - K, 0.0) if is_call else max(K - F, 0.0)
        return DF * intrinsic

    vol_sqrt_t = sigma * np.sqrt(tau)
    d1 = (np.log(F / K) + 0.5 * sigma**2 * tau) / vol_sqrt_t
    d2 = d1 - vol_sqrt_t

    if is_call:
        return DF * (F * norm.cdf(d1) - K * norm.cdf(d2))
    return DF * (K * norm.cdf(-d2) - F * norm.cdf(-d1))


def implied_vol(price, F, K, tau, DF, is_call):
    """Invert Black-76 for sigma via brentq; NaN if price is outside no-arb bounds."""
    if is_call:
        lower = DF * max(F - K, 0.0)
        upper = DF * F
    else:
        lower = DF * max(K - F, 0.0)
        upper = DF * K

    if not (lower < price < upper):
        return np.nan

    def objective(sigma):
        return black76_price(F, K, tau, sigma, DF, is_call) - price

    try:
        return brentq(objective, 1e-4, 5.0)
    except ValueError:
        return np.nan


# ---------------------------------------------------------------------------
# 5. Build the (k, w, weight) slice using OTM legs
# ---------------------------------------------------------------------------
def build_slice(df_expiry, F, DF, tau):
    rows = []
    for _, row in df_expiry.iterrows():
        K = row["strike"]
        is_call = K > F  # OTM leg: calls above forward, puts below
        if is_call and row["type"] != "C":
            continue
        if not is_call and row["type"] != "P":
            continue

        mid = row["mid_usd"]
        bid = row["bid_usd"]
        ask = row["ask_usd"]
        if mid <= 0:
            continue

        iv = implied_vol(mid, F, K, tau, DF, is_call)
        if np.isnan(iv):
            continue

        spread = ask - bid
        rel_spread = spread / mid if mid > 0 else np.inf
        if rel_spread <= 0:
            continue

        k = np.log(K / F)
        w = iv**2 * tau
        weight = 1.0 / rel_spread
        rows.append((k, iv, w, weight))

    if len(rows) < MIN_SLICE_POINTS:
        return None

    arr = np.array(rows)
    k, iv, w, weight = arr[:, 0], arr[:, 1], arr[:, 2], arr[:, 3]
    order = np.argsort(k)
    return k[order], iv[order], w[order], weight[order]


# ---------------------------------------------------------------------------
# 6. SVI raw slice fit
# ---------------------------------------------------------------------------
def fit_svi(k, w, weight):
    """
    Fit w(k) = a + b*(rho*(k - m) + sqrt((k - m)^2 + sigma^2)) by weighted least
    squares. b >= 0, |rho| < 1, sigma > 0 are enforced via reparametrization.
    """
    a0 = float(np.min(w))
    b0 = 0.1
    rho0 = 0.0
    m0 = float(k[np.argmin(w)])
    sigma0 = 0.1

    x0 = np.array([a0, np.log(b0), np.arctanh(rho0), m0, np.log(sigma0)])
    sqrt_weight = np.sqrt(weight)

    def unpack(x):
        a, b_, rho_, m, sigma_ = x
        b = np.exp(b_)
        rho = np.tanh(rho_)
        sigma = np.exp(sigma_)
        return a, b, rho, m, sigma

    def model(k, a, b, rho, m, sigma):
        return a + b * (rho * (k - m) + np.sqrt((k - m) ** 2 + sigma**2))

    def residuals(x):
        a, b, rho, m, sigma = unpack(x)
        return sqrt_weight * (model(k, a, b, rho, m, sigma) - w)

    result = least_squares(residuals, x0, method="lm", max_nfev=5000)
    a, b, rho, m, sigma = unpack(result.x)

    fitted_w = model(k, a, b, rho, m, sigma)
    rmse = float(np.sqrt(np.mean((fitted_w - w) ** 2)))

    return {"a": a, "b": b, "rho": rho, "m": m, "sigma": sigma, "rmse": rmse}


def svi_w(k, params):
    a, b, rho, m, sigma = params["a"], params["b"], params["rho"], params["m"], params["sigma"]
    return a + b * (rho * (k - m) + np.sqrt((k - m) ** 2 + sigma**2))


# ---------------------------------------------------------------------------
# Expiry selection
# ---------------------------------------------------------------------------
def pick_expiry(df, forced_expiry=None):
    candidates = []
    for expiry, group in df.groupby("expiry"):
        forward_info = recover_forward(group)
        if forward_info is None:
            continue
        F, DF, tau, n_pairs = forward_info
        if forced_expiry is not None:
            if expiry.date().isoformat() != forced_expiry:
                continue
        elif not (TAU_MIN <= tau <= TAU_MAX):
            continue

        slice_data = build_slice(group, F, DF, tau)
        if slice_data is None:
            continue

        candidates.append((expiry, group, F, DF, tau, slice_data))

    if not candidates:
        raise SystemExit(
            "No expiry has enough usable OTM quotes "
            f"(need >= {MIN_SLICE_POINTS}) within tau in [{TAU_MIN}, {TAU_MAX}]."
        )

    if forced_expiry is not None:
        return candidates[0]

    candidates.sort(key=lambda c: len(c[5][0]), reverse=True)
    return candidates[0]


# ---------------------------------------------------------------------------
# Plots
# ---------------------------------------------------------------------------
def plot_raw_smile(plt, expiry, tau, F, k, iv):
    apply_dark_style(plt)
    fig, ax = plt.subplots(figsize=(8, 5.5))
    ax.scatter(k, iv * 100, color=ACCENT_RAW, edgecolor="white", linewidth=0.3, s=40, zorder=3)
    ax.grid(True, alpha=0.3)
    ax.set_xlabel("log-moneyness  k = ln(K/F)")
    ax.set_ylabel("implied vol (%)")
    ax.set_title(
        f"Raw smile (no fit) - expiry {expiry.date().isoformat()}\n"
        f"tau = {tau:.4f} yr, F = {F:,.0f}"
    )
    fig.tight_layout()

    os.makedirs(FIG_DIR, exist_ok=True)
    out_path = os.path.join(FIG_DIR, f"raw_smile_{expiry.date().isoformat()}.png")
    fig.savefig(out_path, dpi=150)
    plt.close(fig)
    return out_path


def plot_svi_fit(plt, expiry, tau, F, k, iv, w, params):
    apply_dark_style(plt)
    fig, (ax_w, ax_iv) = plt.subplots(1, 2, figsize=(13, 5.5))

    k_grid = np.linspace(k.min() - 0.05, k.max() + 0.05, 400)
    w_grid = svi_w(k_grid, params)
    iv_grid = np.sqrt(np.clip(w_grid, 0, None) / tau)

    ax_w.scatter(k, w, color=ACCENT_RAW, edgecolor="white", linewidth=0.3, s=35, zorder=3, label="observed")
    ax_w.plot(k_grid, w_grid, color=ACCENT_FIT, linewidth=2, zorder=2, label="SVI fit")
    ax_w.grid(True, alpha=0.3)
    ax_w.set_xlabel("k = ln(K/F)")
    ax_w.set_ylabel("total variance w = iv^2 * tau")
    ax_w.set_title("Total variance")
    ax_w.legend()

    ax_iv.scatter(k, iv * 100, color=ACCENT_RAW, edgecolor="white", linewidth=0.3, s=35, zorder=3, label="observed")
    ax_iv.plot(k_grid, iv_grid * 100, color=ACCENT_FIT, linewidth=2, zorder=2, label="SVI fit")
    ax_iv.grid(True, alpha=0.3)
    ax_iv.set_xlabel("k = ln(K/F)")
    ax_iv.set_ylabel("implied vol (%)")
    ax_iv.set_title("Implied vol")
    ax_iv.legend()

    annotation = (
        f"a={params['a']:.4f}  b={params['b']:.4f}  rho={params['rho']:.4f}\n"
        f"m={params['m']:.4f}  sigma={params['sigma']:.4f}  RMSE(w)={params['rmse']:.2e}"
    )
    fig.suptitle(
        f"SVI slice fit - expiry {expiry.date().isoformat()}  "
        f"(tau = {tau:.4f} yr, F = {F:,.0f})\n{annotation}",
        fontsize=11,
    )
    fig.tight_layout(rect=[0, 0, 1, 0.90])

    os.makedirs(FIG_DIR, exist_ok=True)
    out_path = os.path.join(FIG_DIR, f"svi_fit_{expiry.date().isoformat()}.png")
    fig.savefig(out_path, dpi=150)
    plt.close(fig)
    return out_path


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("currency", nargs="?", default="BTC")
    parser.add_argument("--expiry", default=None, help="Force expiry, e.g. 2026-07-31")
    args = parser.parse_args()

    currency = args.currency.upper()
    csv_path = latest_snapshot(currency)
    print(f"Loading snapshot: {csv_path}")
    df = load_chain(csv_path)
    df["valuation"] = df["valuation"].dt.tz_convert("UTC") if df["valuation"].dt.tz is not None else df["valuation"].dt.tz_localize("UTC")
    df["expiry"] = df["expiry"].dt.tz_convert("UTC") if df["expiry"].dt.tz is not None else df["expiry"].dt.tz_localize("UTC")

    expiry, group, F, DF, tau, (k, iv, w, weight) = pick_expiry(df, args.expiry)
    print(
        f"Selected expiry {expiry.date().isoformat()}  tau={tau:.4f} yr  "
        f"F={F:,.2f}  DF={DF:.6f}  n_points={len(k)}"
    )

    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    raw_path = plot_raw_smile(plt, expiry, tau, F, k, iv)
    print(f"Saved raw smile plot: {raw_path}")

    params = fit_svi(k, w, weight)
    print("Fitted SVI params:")
    for key in ("a", "b", "rho", "m", "sigma"):
        print(f"  {key} = {params[key]:.6f}")
    print(f"  RMSE (total variance) = {params['rmse']:.6e}")

    fit_path = plot_svi_fit(plt, expiry, tau, F, k, iv, w, params)
    print(f"Saved SVI fit plot: {fit_path}")


if __name__ == "__main__":
    main()
