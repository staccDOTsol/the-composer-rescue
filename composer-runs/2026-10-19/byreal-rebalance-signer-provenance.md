# Byreal autoswap `Rebalance` signer provenance — 2026-10-19

## Result

`BYrEa363GeActic949HkNmw7VGBf9k7awKEqCTZvPuT4` is an owner-authorized concentrated-liquidity position router, not a privileged protocol keeper and not a standalone oracle consumer. An arbitrary user can invoke the wrapper only for a position whose NFT they control. The observed transaction did not expose a way to rebalance another owner's position or extract protocol custody.

## Live transaction provenance

The successful source transaction is `5DnzTGPMdakorV388SHPtSw4Yx7pvzYgVnajnAfUGTUVW5idbK9EfKZcqeLeaaFD5zqZF3Yet827ZJfUvFJdfpML` at slot `457364372`.

- Transaction signers: position owner/payer `DvhdUT7...X9b` and newly-created replacement position mint `Ef9B3o...T7Qy`.
- The old position NFT account `2fkb7X...bgRP` held exactly one unit of mint `79Uo4h...Cg32`, with owner `DvhdUT7...X9b`.
- The instruction burned that NFT under `DvhdUT7...X9b`, closed the old token/mint state, created a new Byreal personal-position account and Token-2022 mint, minted one replacement NFT, and revoked mint authority.
- The same owner is the authority for temporary CRCLx/USDC accounts and all outbound transfers. This is user-position custody, not a program-wide keeper authority.
- The account list contains Byreal, Jupiter, and Raydium routing accounts, but no Pyth, Scope, Switchboard, or other standalone oracle account. Pool state plus encoded slippage bounds govern the route.

## Signed outsider checks

Fresh 2026-10-19 replay used the keypair in `~/hooked.json` as the substituted position owner and a new controlled mint signer. It was encoded as one Solana transaction-v1 instruction and simulated with `sigVerify:true` on a current mainnet-backed Surfpool fork; no transaction was broadcast.

- Wire: 1,523 bytes, 38 accounts, 2 required signatures, 18,196 compute units.
- Result: atomic failure `PriceSlippageExceeded` (autoswap error 12018). The four-day-old route parameters are rejected against current pool state before any position mutation.
- The earlier same-slot substitution test in `composer-runs/2026-10-15/byreal-signed-cross-pool-v1.json` reached the token binding and failed `InvalidTokenOwner` (12006): expected `Byfr7x...hipB`, supplied `HzTMkH...zHAf`. Those are respectively the canonical Token-2022 CRCLx ATAs for the substituted outsider and the real position owner.

Together, these checks show two independent guards: current-price/slippage validation and deterministic owner-token-account binding. The observed wrapper is therefore relevant as an owner-scoped liquidity/route surface, but it is not an outsider-callable consumer of a manipulated Byreal price for protocol-owned value.

Machine-readable evidence: `byreal-rebalance-signer-provenance.json`.
