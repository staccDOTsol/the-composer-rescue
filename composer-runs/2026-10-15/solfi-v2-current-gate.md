# SolFi V2 USDC/USDT pool — current bounded gate

Read-only mainnet-beta checks on 2026-10-15. Genesis hash:
`5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d`. No transaction was
signed, simulated, or broadcast for this SolFi pass. The raw account,
transaction, and quote evidence is in [solfi-v2-current-gate.json](solfi-v2-current-gate.json);
the reproducible read-only script is [solfi-v2-current-gate.js](solfi-v2-current-gate.js).

## Custody and postdeploy transfer

Jupiter's selected USDC→USDT direct route points to pool
`FkEB6uvyzuoaGpgs4yRtFtxC4WJxhejNFbUkj5R6wR32`. RPC confirms that
account is owned by executable SolFi V2 program
`SV2EYYJyRz2YhfXwXnhNAevDEui5Q6yrfyo13WtupPF`. The upgradeable
program-data account `H6M3jMJCednoAr7BR9P6versKQmbo5kV3oi8R5JsWNKz`
reports last deployment at slot **406030591** (state tag 3, read at
457412729).

At confirmed slot **457412539**, SPL Token's `getTokenAccountsByOwner` for
the pool returned three accounts. Token-2022 returned one more account at
slot **457413064**. Each has token authority equal to the program-owned pool
account:

| Vault | Mint | Exact balance at stated slot |
|---|---|---:|
| `ARWaajRJyF6PKQryJ4HLzLBfTWM2qmVQUQVtBjk6PgPc` | USDC | 278,311.684364 |
| `5bHD9xdEzJdkVuhs54mGPC9BZgUshqgMg4tqmTwhWggc` | USDT | 472,162.607117 |
| `H7Yi3mSNZXXkRwzgd66TduKCKH7kSmhBYGiDgcvTvYG3` | `CKRZLHz2W5sJTnUmERNps8ZXgxy4TtrU3hLDWp9HFiMZ` | 0.002000000 |
| `Gzg7DMzsPRb1yBsjw3A2y2Liu8ng6Y9vAi2BZjW8f1iH` | `DEXSF1jH6hxhCuLu9sNgqHQ99e4935AEq2ndRSoktmXw` (Token-2022) | 0.900000000 |

Successful transaction
`2SnySB1yzNGy2bFtq2TnCRnZQuPGMESFtzWbMvBWuzT3j5YgYTp379yayn5qjMp9ucaXBivRpr8g6TNwEGzLgYa5`
at slot **457412535** contains a SolFi V2 inner call under a Propeller outer
instruction (inner index 20, stack height 2). Its nested SPL Token transfer
(inner index 22, stack height 3) spends **337.248675 USDT** from the
listed USDT vault, with authority **the pool account**, to
`4CqpDzLQZJemtge58uX9dwVi8nvKXHVynVubCsLtctur`. The slot is later
than the program's last deployment slot. This establishes actual
program-signed custody outflow for this pool, not an outsider drain.

## Independent exit and two-sided economics

Jupiter Lite ExactIn direct quotes required the SolFi leg to use the **exact
pool key** above. The independent leg excluded `SolFi V2` and was accepted
only when its returned key and label differed. The selected independent
USDT→USDC exit at the 100 USDC test used Deriverse pool
`H7o7KCr5n3whqcPsPkeCPWrzivKrarqzidD3kt8fijvB`:
**100.097327 USDT → 100.000132 USDC** at adjacent quote slots
457412542–543, following **100 USDC → 100.097327 USDT** on SolFi. That is
just **132 raw USDC ($0.000132) gross**.

| Starting USDC | SolFi first, gross USDC | SolFi second, gross USDC |
|---:|---:|---:|
| 100 | +0.000132 | −0.000465 |
| 1,000 | −0.529295 | −0.005302 |
| 10,000 | −5.408806 | −0.177079 |

The same quote source returned **105.727870 USDC per 1 SOL** at slot
457412550. A 5,000-lamport one-signature base fee alone therefore costs
about **0.000529 USDC**, already four times the only positive gross quote.
Lender, priority, swap, and slippage costs can only worsen this sampled
route. Price and route selection move quickly.

**Decision:** No concrete positive outsider route survived fees. Per the
economic stop gate, no `~/hooked.json` KLend flash/SolFi/exit/repay packet was
built or simulated. These observations cover this pool and the sampled
sizes/slots only; they are not a whole-program safety claim or a proof that
every possible exit is uneconomic.
