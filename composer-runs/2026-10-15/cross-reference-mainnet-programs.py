#!/usr/bin/env python3
"""Join a custody/audit queue to the executable-program universe CSV."""

import argparse
import csv
import json
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--universe", type=Path, required=True)
    parser.add_argument("--queue", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    with args.universe.open(newline="") as handle:
        universe = {row["program_id"]: row for row in csv.DictReader(handle)}
    queue = json.loads(args.queue.read_text())
    joined = []
    for item in queue:
        row = dict(item)
        executable = universe.get(item["program_id"])
        row["present_in_executable_universe"] = executable is not None
        row["loader_class"] = executable["loader_class"] if executable else None
        row["owner"] = executable["owner"] if executable else None
        row["programdata_address"] = executable["programdata_address"] if executable else None
        joined.append(row)
    joined.sort(
        key=lambda row: (
            row["priced_gross_usd_lower_bound"] is None,
            -(row["priced_gross_usd_lower_bound"] or 0),
            row["name"],
        )
    )
    output = {
        "queue_count": len(joined),
        "present_count": sum(row["present_in_executable_universe"] for row in joined),
        "missing_count": sum(not row["present_in_executable_universe"] for row in joined),
        "programs": joined,
    }
    args.output.write_text(json.dumps(output, indent=2) + "\n")
    print(json.dumps({key: output[key] for key in ("queue_count", "present_count", "missing_count")}, indent=2))


if __name__ == "__main__":
    main()
