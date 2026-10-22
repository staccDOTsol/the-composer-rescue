#!/usr/bin/env python3
"""Rank current custody candidates after removing active exact-controller targets."""

import argparse
import json
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--crossref", type=Path, required=True)
    parser.add_argument("--exclusions", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--limit", type=int, default=3)
    args = parser.parse_args()
    crossref = json.loads(args.crossref.read_text())
    exclusions = json.loads(args.exclusions.read_text())
    active = {row["program_id"]: row["active_target"] for row in exclusions}
    eligible = [
        row
        for row in crossref["programs"]
        if row["present_in_executable_universe"]
        and row["priced_gross_usd_lower_bound"] is not None
        and row["program_id"] not in active
        and "incomplete" not in row["custody_coverage"].lower()
        and "does not rank" not in row["custody_coverage"].lower()
    ]
    eligible.sort(key=lambda row: -row["priced_gross_usd_lower_bound"])
    output = {
        "exclusion_semantics": "Exact custody-controller program IDs already covered by active Daybreak/local targets; shared dependencies are also excluded. Distinct programs in the same organization remain separately eligible.",
        "active_exclusion_count": len(active),
        "eligible_count": len(eligible),
        "top_unassigned": eligible[: args.limit],
    }
    args.output.write_text(json.dumps(output, indent=2) + "\n")
    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
