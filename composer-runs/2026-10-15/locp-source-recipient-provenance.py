#!/usr/bin/env python3
"""Read-only provenance for the largest claimable off-curve Locp recipients.

Uses confirmed mainnet RPC and the Squads V4 vault-check endpoint documented by
Squads. Does not sign or submit transactions.
"""

import json
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import requests
from solders.pubkey import Pubkey


RUN = Path(__file__).resolve().parent
RPC = "https://api.mainnet-beta.solana.com"
SQUADS_CHECK = "https://4fnetmviidiqkjzenwxe66vgoa0soerr.lambda-url.us-east-1.on.aws/isSquad/"
SQUADS_V4 = "SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf"
HISTORICAL_CLAIM = "Pp94BjG7zg9EGKKRRw2NGLJDQU2W8gEv6ac7RaVZnypcJLY98NDzrn2oSwibDWB5fCUhxXN5PvBLVKkfJVNc1Bz"
MIN_MARKED_CLAIMABLE_USD = 1_000_000
session = requests.Session()


def rpc(method, params):
    response = session.post(
        RPC, json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params}, timeout=45
    )
    response.raise_for_status()
    body = response.json()
    if "error" in body:
        raise RuntimeError(body["error"])
    return body["result"]


def squads_check(recipient):
    # The official endpoint is occasionally slow; a timeout is unknown, not a negative.
    for attempt in range(2):
        try:
            response = requests.get(SQUADS_CHECK + recipient, timeout=6)
            response.raise_for_status()
            return response.json()
        except requests.RequestException as exc:
            if attempt:
                return {"unavailable": str(exc)}
            time.sleep(0.25)


def main():
    source = json.loads((RUN / "locp-source-current-state.json").read_text())
    traces = json.loads((RUN / "locp-outbound-signer-traces.json").read_text())
    proof_by_escrow = {}
    for trace in traces["signerProofs"]:
        proof_by_escrow.setdefault(trace["authority"], []).append(trace)
    rows = []
    for row in source["rows"]:
        state, vault = row["state"], row["vault"]
        claimable_raw = min(vault["amount"], state["schedule"].get("scheduleClaimableAmount", 0))
        marked_claimable = claimable_raw * row["censusUsdPrice"] / 10 ** row["censusDecimals"]
        if marked_claimable >= MIN_MARKED_CLAIMABLE_USD:
            rows.append(
                {
                    "escrow": state["address"],
                    "symbol": row["censusSymbol"],
                    "recipient": state["recipient"],
                    "creator": state["creator"],
                    "recipientOnCurve": Pubkey.from_string(state["recipient"]).is_on_curve(),
                    "cancelMode": state["cancelMode"],
                    "updateRecipientMode": state["updateRecipientMode"],
                    "rawClaimable": str(claimable_raw),
                    "markedClaimableUsdAtCensusPrice": marked_claimable,
                    "sampledOutboundProofs": [
                        {
                            "signature": p["signature"],
                            "slot": p["slot"],
                            "topProgramIds": list(dict.fromkeys(t["topProgramId"] for t in p["transfers"])),
                            "immediateCallers": list(dict.fromkeys(t["immediateCaller"] for t in p["transfers"])),
                        }
                        for p in proof_by_escrow.get(state["address"], [])
                    ],
                }
            )
    rows.sort(key=lambda row: row["markedClaimableUsdAtCensusPrice"], reverse=True)
    offcurve = [row for row in rows if not row["recipientOnCurve"]]
    recipients = list(dict.fromkeys(row["recipient"] for row in offcurve))
    rpc_accounts = rpc("getMultipleAccounts", [recipients, {"encoding": "base64", "commitment": "confirmed", "dataSlice": {"offset": 0, "length": 0}}])
    recipient_info = {}
    with ThreadPoolExecutor(max_workers=5) as pool:
        checks = list(pool.map(squads_check, recipients))
    for recipient, account, check in zip(recipients, rpc_accounts["value"], checks):
        recipient_info[recipient] = {
            "exists": account is not None,
            "accountOwner": account["owner"] if account else None,
            "accountExecutable": account["executable"] if account else None,
            "lamports": account["lamports"] if account else None,
            "squadsVaultCheck": check,
        }
    for row in offcurve:
        row["recipientAccount"] = recipient_info[row["recipient"]]

    transaction = rpc(
        "getTransaction",
        [HISTORICAL_CLAIM, {"encoding": "jsonParsed", "maxSupportedTransactionVersion": 0, "commitment": "confirmed"}],
    )
    top = transaction["transaction"]["message"]["instructions"]
    inner = [ix for group in transaction["meta"]["innerInstructions"] for ix in group["instructions"]]
    locp_inner = [ix for ix in inner if ix.get("programId") == source["program"]]
    relevant_escrow = next(row for row in offcurve if row["escrow"] == "2V7DfGjzuF7QPPQvtReutcm6GEXC17jUbhZQg3fxJfYA")
    assert transaction["meta"]["err"] is None
    assert any(ix.get("programId") == SQUADS_V4 for ix in top)
    assert any(ix.get("accounts", [None] * 4)[3] == relevant_escrow["recipient"] for ix in locp_inner)
    output = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "selection": f"sampled Locp escrows with nominal claimable >= USD {MIN_MARKED_CLAIMABLE_USD} using earlier census prices",
        "rpcObservationSlot": rpc_accounts["context"]["slot"],
        "rowsOverThreshold": len(rows),
        "offCurveRows": len(offcurve),
        "offCurveRecipients": len(recipients),
        "offCurveMarkedClaimableUsd": sum(row["markedClaimableUsdAtCensusPrice"] for row in offcurve),
        "cumulativeTopThreeMarkedClaimableUsd": sum(row["markedClaimableUsdAtCensusPrice"] for row in rows[:3]),
        "topThreeAllOnCurve": all(row["recipientOnCurve"] for row in rows[:3]),
        "squadsVaultCheckEndpoint": SQUADS_CHECK,
        "squadsV4Program": SQUADS_V4,
        "thresholdRows": rows,
        "offCurveRowsDetail": offcurve,
        "historicalDirectCallerProof": {
            "signature": HISTORICAL_CLAIM,
            "slot": transaction["slot"],
            "error": transaction["meta"]["err"],
            "topProgramIds": [ix.get("programId") for ix in top],
            "innerLocpCalls": locp_inner,
            "relevantEscrow": relevant_escrow["escrow"],
            "recipient": relevant_escrow["recipient"],
            "recipientTransactionSignerFlag": next(key["signer"] for key in transaction["transaction"]["message"]["accountKeys"] if key["pubkey"] == relevant_escrow["recipient"]),
            "logs": [line for line in transaction["meta"]["logMessages"] if "VaultTransactionExecute" in line or "Instruction: ClaimV2" in line or "TransferChecked" in line or "SQDS4" in line],
        },
        "caveat": "A system-owned zero-data vault account cannot identify its PDA signer program by its account owner alone; Squads V4 endpoint and the successful nested ClaimV2 establish signer provenance for the observed DBR route. Other escrows have no outbound claim in the sampled trace set, which is not a comprehensive history proof.",
        "noTransactionsSubmitted": True,
    }
    path = RUN / "locp-source-recipient-provenance.json"
    path.write_text(json.dumps(output, indent=2) + "\n")
    print(json.dumps({"path": str(path), "slot": output["rpcObservationSlot"], "rowsOverThreshold":len(rows), "offCurveRows":len(offcurve), "offCurveMarkedClaimableUsd":output["offCurveMarkedClaimableUsd"], "topThreeClaimableUsd":output["cumulativeTopThreeMarkedClaimableUsd"], "recipientInfo":recipient_info}, indent=2))


if __name__ == "__main__":
    main()
