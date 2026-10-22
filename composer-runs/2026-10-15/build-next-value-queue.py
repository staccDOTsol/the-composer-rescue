#!/usr/bin/env python3
"""Join live custody, current-binary signer proofs, flash inventory, and assignments."""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def read(name):
    return json.loads((ROOT / name).read_text())


LIVE = read("next-value-queue-current-accounts.json")
RANK = {r["programId"]: r for r in read("mainnet-long-tail-custody-ranked.json")["ranking"]}
CALL = {
    r["programId"]: r for r in read("mainnet-token-authority-caller-programs.json")["programs"]
}
PROVENANCE = {
    r["authority"]: r
    for r in read("mainnet-token-authority-signer-provenance.json")["candidates"]
}
CROSSWALK = {
    r["programId"]: r for r in read("mainnet-token-authority-flash-crosswalk.json")["targets"]
}
ENVELOPES = {
    r["programId"]: r for r in read("mainnet-token-authority-atomic-envelopes.json")["rows"]
}
ZERO = read("klend-zero-fee-census.json")["activeZero"]
ASSIGN = read("daybreak-assignment-snapshot-current.json")

KNOWN_ASSIGNED = {
    "HYEXCHtHkBagdStcJCp3xbbb9B7sdMdWXFNj6mdsG4hn": "Hylo Exchange outsider audit",
    "onreuGhHHgVzMWSkj2oQDLDtvvGvoepBPkqyaubFcwe": "OnRe USDG outsider audit",
    "HysTabVUfmQBFcmzu1ctRd1Y1fxd66RBpboy1bmtDSQQ": "Hylo Stability Pool outsider",
    "eUSXyKoZ6aGejYVbnp3wtWQ1E8zuokLAJPecPxxtgG3": "Solstice YieldVault outsider",
    "StaKE6XNKVVhG8Qu9hDJBqCW3eRe7MDGLz17nJZetLT": "Orca xORCA staking outsider",
    "8eqh8wppT9c5rw4ERqNCffvU6cNFJWff9WmkcYtmGiqC": "PRIME controller flash audit",
    "4T5m5NtRVewiCVzP2mnfeUoMYRqncfkrS21X2dhVCNRT": "second PRIME controller audit",
    "ChnryP5RcZtMvP8vvVyPGUhwCg6uDJc53vCe3sxr11Sz": "Chnry USDG controller audit",
}

NOTES = {
    "LLoc8JX5dLAMVzbzTNKG6EFpkyJ9XCsVAGkqwQKUJoa": {
        "label": "unattributed LFNTY custody controller",
        "priority": 1,
        "reason": "Large post-deployment program-signed outflows; no same-mint zero-rate lending reserve or executable liquidation quote was located.",
    },
    "zbcKGdAmXfthXY3rEPBzexVByT2cqRqCZb9NwWdGQ2T": {
        "label": "unattributed ZBCN custody controller",
        "priority": 2,
        "reason": "Two current ZBCN vaults each have sampled program-signed outflows after the last observed deployment. No same-mint zero-rate lending reserve or executable liquidation quote was located.",
    },
    "FoXpJL1exLBJgHVvdSHNKyKu2xX2uatctH9qp6dLmfpP": {
        "label": "unattributed FOXY controller",
        "priority": 3,
        "reason": "Recent direct signer outflows from a $9.92m marked vault, but no same-mint zero-rate lending inventory or full-size liquidation quote.",
    },
    "VALT7AM76ZWfRhjVeYQRrLvNRLvqBzNs8dTsAcLW3jj": {
        "label": "unattributed USDu vault controller",
        "priority": 4,
        "reason": "The same authority owns two live USDu vaults; sampled post-deployment outflow is from the small vault only. Full-vault exit remains unproved.",
    },
    "BiSoNHVpsVZW2F7rx2eQ59yQwKxzU5NvBcmKshCSUypi": {
        "label": "Bison / World pay-in venue",
        "priority": 5,
        "reason": "Current public Jupiter-routed ETH exit is observed, but the USD1 vault lacks a sampled outflow. A conservative flash-plus-exit account union reaches exactly 64.",
    },
    "pytS9TjG1qyAZypk7n8rw8gfW9sUaqqYyMhJQ4E7JCQ": {
        "label": "unattributed PYTH distribution-shaped controller",
        "priority": 6,
        "reason": "High gross mark but every sampled signer outflow predates the current deployed binary; current outsider route and market depth are unproved.",
    },
    "GovER5Lthms3bLBqWub97yVrMmEogzX7xNjdXpPPCVZw": {
        "label": "unattributed PHY state controller",
        "priority": 7,
        "reason": "Program-owned authority states and live vaults; no sampled successful signer outflow, so direct spend control is not yet proved.",
    },
    "1oopBoJG58DgkUVKkEzKgyG9dvRmpgeEm1AVjoHkF78": {
        "label": "unattributed USD.infra/Bonk controller",
        "priority": 8,
        "reason": "Large USD.infra vault has no sampled outflow; the observed Bonk exit predates the current binary.",
    },
}


def proof(program_id, authority, vault, deploy_slot):
    rank = RANK.get(program_id)
    items = []
    if rank:
        for a in rank.get("sampledAuthorities", []):
            if a["authority"] == authority:
                items.extend(
                    p for p in a.get("exitScan", {}).get("outflows", []) if p["source"] == vault
                )
    candidate = PROVENANCE.get(authority)
    if candidate:
        items.extend(
            p
            for p in candidate.get("provenance", [])
            if p.get("sourceTokenAccount") == vault
            and p.get("callerProgram") == program_id
        )
    items.sort(key=lambda p: p["slot"], reverse=True)
    if not items:
        return None
    item = items[0]
    return {
        "signature": item["signature"],
        "slot": item["slot"],
        "afterCurrentDeployment": item["slot"] >= deploy_slot,
        "immediateSignerProgram": program_id,
        "tokenInstruction": item.get("type") or item.get("tokenInstruction"),
    }


def main():
    assignments = ASSIGN["assignments"]
    assigned_rows = []
    for program_id, phrase in KNOWN_ASSIGNED.items():
        hits = [a for a in assignments if phrase in a["title"]]
        if len(hits) != 1:
            raise RuntimeError(f"Assignment not unique for {program_id}: {len(hits)}")
        assigned_rows.append({"programId": program_id, **hits[0]})
    rows = []
    assigned = []
    for current in LIVE["results"]:
        program_id = current["programId"]
        rank = RANK.get(program_id)
        caller = CALL.get(program_id)
        program_data = rank.get("programData") if rank else caller.get("programData")
        deploy_slot = int(
            program_data.get("lastDeploySlot") or program_data.get("deploySlot") or 0
        )
        current_vaults = []
        for vault in current["vaults"]:
            if not vault["authorityAndMintMatch"]:
                raise RuntimeError(f"Live authority mismatch for {vault['vault']}")
            p = proof(program_id, vault["authority"], vault["vault"], deploy_slot)
            amount = float(vault["uiAmountString"] or 0)
            price = float(vault["usdPricePrior"] or 0)
            current_vaults.append(
                {
                    "authority": vault["authority"],
                    "vault": vault["vault"],
                    "mint": vault["mint"],
                    "symbol": vault["symbol"],
                    "currentUiAmount": vault["uiAmountString"],
                    "snapshotMarkUsd": round(amount * price, 2),
                    "authorityAndMintVerifiedAtSlot": LIVE["contextSlotMax"],
                    "authorityAccountOwner": vault["authorityAccountOwner"],
                    "signerOutflow": p,
                }
            )
        mints = {v["mint"] for v in current_vaults}
        flash = []
        for mint in mints:
            reserves = [r for r in ZERO if r["mint"] == mint]
            if reserves:
                decimals = reserves[0]["decimals"]
                flash.append(
                    {
                        "mint": mint,
                        "source": "Kamino Lend",
                        "activeZeroRateReserveCount": len(reserves),
                        "availableUiSnapshot": sum(
                            int(r["availableRaw"]) / (10 ** decimals) for r in reserves
                        ),
                        "reserveIds": [r["reserve"] for r in reserves],
                        "availabilityIsNotSimulatedBorrowLimit": True,
                    }
                )
        cross = CROSSWALK.get(program_id, {})
        same = cross.get("prioritySameMintAssets", []) or []
        for asset in same:
            if asset["mint"] not in mints:
                continue
            for provider in {"Project 0 / marginfi v1"}:
                inventory = [
                    v for v in asset.get("liveInventory", []) if v["provider"] == provider
                ]
                if inventory:
                    flash.append(
                        {
                            "mint": asset["mint"],
                            "source": provider,
                            "sampledSameMintVaultInventoryUsd": round(
                                sum(v.get("observedUsdValue") or 0 for v in inventory), 2
                            ),
                            "vaultIds": [v["vault"] for v in inventory],
                            "availabilityIsNotSimulatedBorrowLimit": True,
                        }
                    )
        envelope = ENVELOPES.get(program_id)
        out = {
            "programId": program_id,
            "label": NOTES.get(program_id, {}).get("label")
            or (rank or {}).get("annotation", {}).get("label")
            or "assigned controller",
            "currentExecutable": current["executable"],
            "loaderOwner": current["loaderOwner"],
            "programData": program_data,
            "selectedVaults": current_vaults,
            "selectedVaultSnapshotMarkUsd": round(
                sum(v["snapshotMarkUsd"] for v in current_vaults), 2
            ),
            "currentBinarySignerVaultSnapshotMarkUsd": round(
                sum(
                    v["snapshotMarkUsd"]
                    for v in current_vaults
                    if v["signerOutflow"]
                    and v["signerOutflow"]["afterCurrentDeployment"]
                ),
                2,
            ),
            "credibleTagUsdFromPriorCensus": (
                round(rank["credibleUsd"], 2) if rank else None
            ),
            "fullBalanceExecutableLiquidationQuoteUsd": None,
            "flashSources": flash,
            "conservativeV1WholeHistoricalExitPlusProject0Control": (
                envelope.get("conservativeFullTransactionSum") if envelope else None
            ),
            "exactAtomicFlashExitRepaySimulated": False,
            "assignment": "assigned" if program_id in KNOWN_ASSIGNED else "unassigned",
        }
        if program_id in NOTES:
            out["priority"] = NOTES[program_id]["priority"]
            out["reason"] = NOTES[program_id]["reason"]
            rows.append(out)
        else:
            assigned.append(out)
    rows.sort(key=lambda r: r["priority"])
    output = {
        "generatedAt": LIVE["generatedAt"],
        "scope": {
            "exactMainnetExecutableUniverse": 77715,
            "boundedTokenCensusMintCount": 3987,
            "boundedTokenCensusTopAccounts": 69054,
            "unassignedQueueIsNotAllMainnetPrograms": True,
            "assignmentSnapshotCount": ASSIGN["count"],
            "liveRefreshSlot": LIVE["contextSlotMax"],
            "readOnly": True,
        },
        "valueRule": "USD mark is price-times-current-vault-balance using the earlier census price; it is not realized value or an outsider drain. LST, receipt, and other overlapping claims are not summed across programs.",
        "assignmentExclusions": assigned_rows,
        "queue": rows,
        "newlyAssignedOverlay": assigned,
    }
    (ROOT / "next-value-first-unassigned-queue.json").write_text(
        json.dumps(output, indent=2) + "\n"
    )
    print(
        json.dumps(
            {
                "unassigned": len(rows),
                "newlyAssigned": len(assigned),
                "assignmentCount": ASSIGN["count"],
                "refreshSlot": LIVE["contextSlotMax"],
            }
        )
    )


if __name__ == "__main__":
    main()
