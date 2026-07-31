"""
Fetch a live option chain from Deribit's public API and save it as a snapshot.

Usage:
    python fetch_data.py [CURRENCY]

CURRENCY defaults to BTC. No API key is required (public endpoint).

Output:
    research/data/<currency>_<snapshot-date>.json  -- parsed chain + metadata
    research/data/<currency>_<snapshot-date>.csv   -- flat table for vol_smile.py
"""

import csv
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import requests

DERIBIT_URL = "https://www.deribit.com/api/v2/public/get_book_summary_by_currency"

DATA_DIR = Path(__file__).parent / "data"

CSV_COLUMNS = [
    "expiry",
    "strike",
    "type",
    "bid_usd",
    "ask_usd",
    "mid_usd",
    "underlying",
    "mark_iv",
    "valuation",
]


def parse_instrument_name(name):
    """Parse 'BTC-31JUL26-92000-C' -> (expiry_datetime_utc, strike, option_type)."""
    _, expiry_str, strike_str, cp = name.split("-")
    expiry_date = datetime.strptime(expiry_str, "%d%b%y").replace(tzinfo=timezone.utc)
    # Deribit options settle at 08:00 UTC on the expiry date.
    expiry = expiry_date.replace(hour=8, minute=0, second=0, microsecond=0)
    strike = float(strike_str)
    option_type = "C" if cp == "C" else "P"
    return expiry, strike, option_type


def fetch_chain(currency):
    resp = requests.get(
        DERIBIT_URL,
        params={"currency": currency, "kind": "option"},
        timeout=30,
    )
    resp.raise_for_status()
    payload = resp.json()
    return payload["result"]


def parse_rows(raw_instruments):
    rows = []
    max_ts = 0
    for inst in raw_instruments:
        bid = inst.get("bid_price")
        ask = inst.get("ask_price")
        mid = inst.get("mid_price")
        if bid is None or ask is None or mid is None:
            continue

        underlying = inst.get("underlying_price")
        if underlying is None:
            continue

        creation_ts = inst.get("creation_timestamp", 0)
        max_ts = max(max_ts, creation_ts)

        expiry, strike, option_type = parse_instrument_name(inst["instrument_name"])

        rows.append(
            {
                "expiry": expiry,
                "strike": strike,
                "type": option_type,
                "bid_usd": bid * underlying,
                "ask_usd": ask * underlying,
                "mid_usd": mid * underlying,
                "underlying": underlying,
                "mark_iv": inst.get("mark_iv"),
            }
        )

    valuation = datetime.fromtimestamp(max_ts / 1000, tz=timezone.utc) if max_ts else None
    return rows, valuation


def save_snapshot(currency, rows, valuation):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    snapshot_date = valuation.date().isoformat()
    json_path = DATA_DIR / f"{currency}_{snapshot_date}.json"
    csv_path = DATA_DIR / f"{currency}_{snapshot_date}.csv"

    valuation_iso = valuation.isoformat()

    json_records = []
    for row in rows:
        json_records.append(
            {
                "expiry": row["expiry"].isoformat(),
                "strike": row["strike"],
                "type": row["type"],
                "bid_usd": row["bid_usd"],
                "ask_usd": row["ask_usd"],
                "mid_usd": row["mid_usd"],
                "underlying": row["underlying"],
                "mark_iv": row["mark_iv"],
                "valuation": valuation_iso,
            }
        )

    with open(json_path, "w") as f:
        json.dump(
            {
                "currency": currency,
                "valuation": valuation_iso,
                "records": json_records,
            },
            f,
            indent=2,
        )

    with open(csv_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_COLUMNS)
        writer.writeheader()
        for record in json_records:
            writer.writerow({col: record[col] for col in CSV_COLUMNS})

    return json_path, csv_path


def main():
    currency = sys.argv[1].upper() if len(sys.argv) > 1 else "BTC"

    print(f"Fetching {currency} option chain from Deribit...")
    raw_instruments = fetch_chain(currency)
    print(f"Received {len(raw_instruments)} instruments.")

    rows, valuation = parse_rows(raw_instruments)
    if not rows or valuation is None:
        raise SystemExit("No usable quotes (all bid/ask/mid/underlying were null).")

    print(f"Parsed {len(rows)} quotes with usable bid/ask/mid. Valuation time: {valuation.isoformat()}")

    json_path, csv_path = save_snapshot(currency, rows, valuation)
    print(f"Saved snapshot:\n  {json_path}\n  {csv_path}")


if __name__ == "__main__":
    main()
