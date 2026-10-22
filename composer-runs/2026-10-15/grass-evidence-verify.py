#!/usr/bin/env python3
"""Cross-check independent read-only custody, claim, and v1 accounting artifacts."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
load = lambda name: json.loads((ROOT / name).read_text())
custody = load("grass-custody-recheck.json")
claim = load("eyx-claim-sim.json")
flash = load("flashloan-grass-v1.json")
fee = load("flashloan-grass-reserve.json")
program = load("eyx-programdata-final-check.json")

assert custody["aggregate"]["vaultCount"] == 9
assert sum(int(v["rawAmount"]) for v in custody["vaults"]) == int(custody["aggregate"]["totalRaw"])
assert custody["aggregate"]["totalRaw"] == "200440059771140603"
exit_tx = custody["citedTransfer"]
assert exit_tx["err"] is None and exit_tx["slot"] == 457215347
move = exit_tx["matchedTransfers"][0]
assert move["immediateCaller"] == custody["program"]["programId"]
amount = int(move["parsed"]["info"]["tokenAmount"]["amount"])
before = next(x for x in exit_tx["prePost"]["pre"] if x["accountIndex"] == 5)
after = next(x for x in exit_tx["prePost"]["post"] if x["accountIndex"] == 5)
assert int(before["uiTokenAmount"]["amount"]) - int(after["uiTokenAmount"]["amount"]) == amount

claims = {x["name"]: x for x in claim["outcomes"]}
reward_vault = "7FZRSVR4Wf8p26cuNX86zy3FJA86xni1pXokbueuww5J"
user = "771Wxey6HRVC6drKg4pHiH8EMQ8EjGvmB79ZBERaT8q1"
routers = ["cCLjaRdDtbVjx2rSzEbmjQ68mAboHq5ywRbmL3bnAi8",
           "BXTUMBDb3AzQUsUSqHzzKd1aDwT1vm4TqgwHEWYnXmJQ",
           "Bw2xKmtCxd93egiiyJqiYv2tE69r2Fnshdy8qbtKxzDf",
           "FiGu9sqJARDgYMxVjLCAq5RNfvQpcZRKCJhp21WkyTdV"]
for name in ("claim_one_current", "claim_four_pools_historical_order", "claim_four_pools_reverse_order"):
    row = claims[name]
    assert row["err"] is None
    delta = row["tokenDeltasVsPreRead"]
    assert -int(delta[reward_vault]) == int(delta[user]) + sum(int(delta.get(k) or 0) for k in routers)
assert claims["claim_four_pools_historical_order"]["tokenDeltasVsPreRead"] == \
       claims["claim_four_pools_reverse_order"]["tokenDeltasVsPreRead"]
assert claims["claim_same_pool_twice"]["err"]["InstructionError"][1]["Custom"] == 6025

assert fee["decoded"]["config"]["fees"]["flash_loan_fee_sf"] == "0"
available = int(fee["decoded"]["liquidity"]["total_available_amount"])
assert available == int(flash["initialAvailableRaw"]) == 1892492987128
cases = {x["label"]: x for x in flash["cases"]}
keys = flash["accounts"]
def state_map(images):
    return {row["key"]: row["state"] for row in images}
def amount_delta(row, key):
    pre = state_map(row["pre"]["accounts"])[key]["rawAmount"]
    post = state_map(row["post"])[key]["rawAmount"]
    return int(post) - int(pre)
def lender_restored(row):
    pre, post = state_map(row["pre"]["accounts"]), state_map(row["post"])
    for key in (keys["supply"], keys["feeVault"]):
        assert pre[key]["rawAmount"] == post[key]["rawAmount"]
    reserve = keys["reserve"]
    assert pre[reserve]["totalAvailableRaw"] == post[reserve]["totalAvailableRaw"]
    assert pre[reserve]["borrowedAmountSf"] == post[reserve]["borrowedAmountSf"]
    assert pre[reserve]["collateralMintTotalSupplyRaw"] == post[reserve]["collateralMintTotalSupplyRaw"]
    assert pre[reserve]["accumulatedProtocolFeesSf"] == post[reserve]["accumulatedProtocolFeesSf"]
    assert pre[reserve]["accumulatedReferrerFeesSf"] == post[reserve]["accumulatedReferrerFeesSf"]
    mint = keys["collateralMint"]
    assert pre[mint]["mintSupplyRaw"] == post[mint]["mintSupplyRaw"]

successful_flash = [r for r in flash["cases"] if r["label"].startswith("flash_") and r["err"] is None]
for row in successful_flash:
    lender_restored(row)
control = cases["withdraw_control"]
ceiling = cases["flash_1_memo_withdraw_repay_v1_4096_bytes"]
assert control["err"] is None and ceiling["err"] is None and ceiling["v1Bytes"] == 4096
assert amount_delta(control, keys["destination"]) == amount_delta(ceiling, keys["destination"]) == 33000006416685
assert amount_delta(control, keys["vault"]) == amount_delta(ceiling, keys["vault"]) == -33000006416685
assert program["accounts"][1]["lastUpgradeSlot"] == "295594988"

summary = {"checkedAt": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
           "custodyVaultCount": 9, "custodyRawGrass": custody["aggregate"]["totalRaw"],
           "citedTransferRawGrass": str(amount), "claimOrderInvariant": True,
           "kaminoFlashFeeRateExactlyZero": True, "kaminoAvailableRawGrass": str(available),
           "successfulFlashCasesWithRestoredLenderEconomics": len(successful_flash),
           "v1CeilingBytes": ceiling["v1Bytes"],
           "authorizedWithdrawalRawGrass": str(amount_delta(control, keys["destination"])),
           "programLastUpgradeSlotAfterSimulations": program["accounts"][1]["lastUpgradeSlot"]}
(ROOT / "grass-evidence-verify.json").write_text(json.dumps(summary, indent=2) + "\n")
print(json.dumps(summary, indent=2))
