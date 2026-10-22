# Two actor-owned $800 Whirlpool LPs: committed local-fork control

This is an **executed local-fork account-mechanics control**, not a Jupiter Router result. No transaction was sent to mainnet. The second swap called the second Whirlpool directly: Jupiter's public build service cannot see LP positions deposited only on this fork. The signed v1 was accepted by Surfpool at 1,807 bytes; mainnet packet acceptance was not tested.

## Setup and atomic flow

- Pools: `3PRT79bw3hoMd9S4uC8mPTKvJVgqGa2NuS7ZLX92RFNn` first, `BSddxwYW73as8852ZTHRH13pbZEmZ96NBjayc5mSVtkZ` second, both WSOL/USDC full-range SplashPools. BSdd's originally nonzero fee and protocol rates were set to zero **only on the isolated fork** using signed authority instructions; see [fee authority receipt](dual-owned-fee-zero.json).
- Actor opened genuine NFT positions, each with liquidity `1,240,000,000`, ticks `[-427648, 427648]`. Signed setup receipts: `2PuLSGUjm5Ryv21QToC1pVCQCHvnC1D3KKX2AjdkwHxUYUiEWcHNTdrspLiSCJYudJqz4VSzfroPmJE7DCX21G2i` for pool 1 and `2CVeW4XMj2LuBFV1u3SqnxPzjGEnmeGVrNSQ8Rk2qfjxgKYxKaZkAiT6iGmSyvvC8aikvnhAwtLCMQtbMsaJqM3E` for pool 2, both at fork slot `458882923`. Inner SPL transfers prove deposits:

  | Owned position | WSOL deposit | USDC deposit | Value at illustrative $104.50/SOL |
  |---|---:|---:|---:|
  | 3PRT | 3.817631995 | 402.762760 | $801.705303 |
  | BSdd | 3.825038662 | 401.982865 | $801.699405 |
  | **Total** | **7.642670657** | **804.745625** | **$1,603.404709** |

- Any liquid WSOL and USDC left over from fork-only setup were reset to zero in the actor ATAs before the flash transaction. The deposited LPs remained intact. Native SOL for rent and signing was separate. Thus the transaction started with `0` WSOL and `0` USDC in the actor token accounts.
- Signed atomic v1 receipt: `5mbDwW9zyJoEqnzgPjppJt4HAzs4X1C4N4gVNsM5Rd88NtoTfBpd15J2gGhxatQ5s9VcRihMaCHTKTogscAgfVQU`, fork slot `458883047`, `err=null`, `262,991` CU, `10,000` lamport signature fee. The flow borrowed `5,742.317260340` WSOL from KLend and `529.030000000` WSOL from Project 0, swapped all `6,271.347260340` WSOL on actor-owned pool 1 for `402.615653` USDC, swapped all those USDC on actor-owned pool 2 for `2.474862161` WSOL, withdrew both LP positions, collected fees, and repaid both loans in the same signed transaction. Committed pre/post SPL token balances show **zero net change** in both lenders' WSOL supply vaults. Both actor positions finished at liquidity zero.

## Consolidated outcome

The actor wallet ended with **7.237245518 WSOL + 622.510223 USDC** and no LP principal or owed fees in either owned position. Against the two signed LP deposits, the consolidated asset change was **−0.405425139 WSOL −182.235402 USDC**, or **−$224.602329** at the illustrative $104.50/SOL mark, before rent and transaction costs. The signed receipt therefore demonstrates repayment and large spot changes, but **no harvest** for the actor in this configuration.

After withdrawal, pool 1 retained its pre-existing liquidity `301,845` and its displayed tick moved to `−170589`; pool 2 retained third-party liquidity `1,026,380,348` and its displayed tick moved to `−13791`. The actor no longer owns LP shares in either pool, so subsequent corrective trades cannot pay fees to those withdrawn positions. Their remaining vault balances belong to the pool's continuing obligations and other LPs; they are not an actor claim.

The [machine-readable ledger audit](dual-owned-flash-ledger.json) includes all three signed transaction IDs, inner SPL transfers, committed actor and lender token balances, and consolidated arithmetic. The [control receipt](dual-owned-flash-control.json) includes the instruction manifest, simulation and committed pool state. Both can be reproduced with [audit script](dual-owned-flash-audit.js) against the still-running local fork.

## Who captures the correction?

I used the **same actor**, after both owned LPs were withdrawn, to trade against the remaining outsider LPs and return each pool's `sqrt_price` to its exact pre-flash value. This was a separate signed local-fork v1 transaction, `45y6RgLVqZrtHH2cb3T5gcy81mCZQq1mC3VEUNx9RpaKP1wYZeAF14WtWNqPcmi8md9LtPbaxa1ANSTfbgETRDvS` at slot `458883441`, `err=null`, `46,334` CU. The swaps used those original sqrt values as hard price limits:

| Corrective swap | Actor pays | Actor receives |
|---|---:|---:|
| 3PRT, USDC→WSOL | 0.097983 USDC | 1.526221073 WSOL |
| BSdd, WSOL→USDC | 1.120795938 WSOL | 182.333382 USDC |

Both pool ticks and sqrt prices ended **exactly** at their pre-flash values. The actor wallet then held `7.642670653` WSOL + `804.745622` USDC. Compared with the initial signed LP deposits (`7.642670657` WSOL + `804.745625` USDC), the complete round trip lost **4 lamports and 3 micro-USDC** (about `$0.000003418` at `$104.50/SOL`), plus the signed transaction fees and LP rent. The [self-arb receipt](dual-owned-self-arb.json) records the exact transfers and pool states.

The residual inventory reconciles exactly against the pool vaults before the actor added liquidity: 3PRT ended **+2 lamports and +2 raw USDC**; BSdd ended **+2 lamports and +1 raw USDC**. Those four lamports and three micro-USDC equal the actor's unrecovered tokens. The self-arb can be rerun from [its source](dual-owned-self-arb.js) on the matching post-flash fork state; the initial owned setup and flash composition are in [the control source](dual-owned-flash-control.js).

Thus the ~$224.60 deficit after the flash was a recoverable arbitrage opportunity on the remaining third-party LPs. **Whoever executes the correction captures it**. If an independent arbitrageur trades first, the actor does not recover it; the actor's withdrawn LP positions receive none of those later trades. The near-zero final asset difference in this controlled self-arb is also evidence against a free-profit harvest in this configuration.
