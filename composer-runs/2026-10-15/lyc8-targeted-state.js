#!/usr/bin/env node
'use strict';
// Targeted read-only state check for one selected USD* bank vault and four
// recent Token states. No signed transaction or submission.
const fs = require('fs');
const crypto = require('crypto');
const MOD = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules';
const { PublicKey } = require(`${MOD}/@solana/web3.js`);
const { BorshAccountsCoder } = require(`${MOD}/@coral-xyz/anchor`);
const bs58 = require(`${MOD}/bs58`);
const { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } = require(`${MOD}/@solana/spl-token`);
const P = s => new PublicKey(s), S = p => p.toBase58(), D = bn => bn.toString(10);
const PROGRAM = 'LYC8YiiSzQfPpxUW2tpxfuPKGZwywAJhXKUfDP2B66f';
const BANK = '9ZC4H7cb4hZREv1i97smRkgRppJd1PejmTMPgwmojxJe';
const USD_STAR_VAULT = 'C1Eht8rhJArzAVgQM6crTG6gCQ44yTfJZCVg1GWwWcG5';
const USD_STAR = 'star9agSpjiFe3M49B3RniVU4CMBBEK3Qnaqn3RGiFM';
const TOKENS = ['HdXY9DDV4MGt7ZwM1nnDNrUmWCcwbmLrAvS3z84BzMM8',
  '5MsScoUHUJuVpPeaS2EuMB2kRzD1BwJTfoe3nEAZ2fZY',
  '3BLb67a77XiFXn9XosRozpK4f1YD3w8dDZNb8yvxbvWc',
  'BDAETn8ebYLi2sdA1SHm9NBBnNr52PccGACoB87WkTzz'];
const idl = JSON.parse(fs.readFileSync(__dirname + '/lyc8-current.idl.json', 'utf8'));
const coder = new BorshAccountsCoder(idl);
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split(/\r?\n/).filter(Boolean).map(x => x.split(/=(.*)/s).slice(0, 2)));
const endpoint = env.HEAVY_RPC_URL || env.RPC_URL;
if (!endpoint) throw Error('RPC endpoint unavailable');
let id = 0;
async function rpc(method, params = []) {
  const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) });
  const result = await response.json();
  if (result.error) throw Error(method + ': ' + JSON.stringify(result.error));
  return result.result;
}
function decodeTokenAccount(account) {
  if (!account) return null;
  const data = Buffer.from(account.data[0], 'base64');
  if (account.owner !== S(TOKEN_PROGRAM_ID) && account.owner !== S(TOKEN_2022_PROGRAM_ID)) return null;
  return { tokenProgram: account.owner, mint: S(P(data.subarray(0, 32))),
    authority: S(P(data.subarray(32, 64))), raw: data.readBigUInt64LE(64).toString(),
    sha256: crypto.createHash('sha256').update(data).digest('hex') };
}
async function main() {
  const genesis = await rpc('getGenesisHash');
  if (genesis !== '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d') throw Error('not mainnet-beta');
  const addresses = [PROGRAM, BANK, USD_STAR_VAULT, USD_STAR, ...TOKENS];
  const snap = await rpc('getMultipleAccounts', [addresses, { encoding: 'base64', commitment: 'confirmed' }]);
  const accounts = snap.value;
  if (!accounts[0]?.executable || accounts[1]?.owner !== PROGRAM) throw Error('current program/bank invalid');
  const vault = decodeTokenAccount(accounts[2]);
  if (vault?.mint !== USD_STAR || vault.authority !== BANK) throw Error('selected USD* vault/bank mismatch');
  const expectedBankAta = S(getAssociatedTokenAddressSync(P(USD_STAR), P(BANK), true, TOKEN_PROGRAM_ID));
  if (expectedBankAta !== USD_STAR_VAULT || PublicKey.isOnCurve(P(BANK).toBytes()))
    throw Error('selected bank ATA/off-curve control mismatch');
  const bank = coder.decode('YieldingBank', Buffer.from(accounts[1].data[0], 'base64'));
  if (S(bank.config.default_redemption_mint) !== USD_STAR) throw Error('bank redemption mint mismatch');
  const tokenRows = TOKENS.map((address, i) => {
    const account = accounts[i + 4];
    if (account?.owner !== PROGRAM) throw Error('recent Token state not program-owned: ' + address);
    const t = coder.decode('Token', Buffer.from(account.data[0], 'base64'));
    const tokenProgram = Object.keys(t.config.token_program)[0] === 'Token2022' ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
    const collateralProgram = Object.keys(t.collateral.token_program)[0] === 'Token2022' ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
    const reserve = getAssociatedTokenAddressSync(t.collateral.mint, P(address), true, collateralProgram);
    return { address, mint: S(t.config.mint), collateralMint: S(t.collateral.mint),
      collateralReserve: S(reserve), collateralTokenProgram: S(collateralProgram), tokenProgram: S(tokenProgram),
      collateralPriceRaw: D(t.collateral.price), tokenPriceRaw: D(t.accounting.price),
      unlentCollateralRaw: D(t.collateral.unlent_amount), totalSupplyRaw: D(t.accounting.total_supply),
      pendingAsyncBurnRaw: D(t.accounting.pending_async_burn_amount),
      pendingAsyncRedemptionLiabilityRaw: D(t.accounting.pending_async_redemption_liability),
      reservedForRedemptionEpochsRaw: D(t.accounting.reserved_for_redemption_epochs),
      mintFeeBps: t.fees.minting_fee_bps, burnFeeBps: t.fees.burning_fee_bps,
      burnRateLimit: { maxAmountRaw: D(t.config.burn_rate_limit.max_amount),
        windowDurationSeconds: D(t.config.burn_rate_limit.window_duration_secs),
        amountUsedRaw: D(t.config.burn_rate_limit.amount_used) },
      carryInSelectedBank: t.debt_carry.some(c => S(c.yielding_base_mint) === S(bank.config.base_mint) &&
        c.yielding_bank_id === bank.config.id && D(c.shares) !== '0'),
      bankSharesRaw: t.debt_carry.filter(c => S(c.yielding_base_mint) === S(bank.config.base_mint) &&
        c.yielding_bank_id === bank.config.id).map(c => D(c.shares)) };
  });
  const reserves = await rpc('getMultipleAccounts', [tokenRows.map(t => t.collateralReserve),
    { encoding: 'base64', commitment: 'confirmed' }]);
  tokenRows.forEach((t, i) => { t.collateralReserveState = decodeTokenAccount(reserves.value[i]); });
  const tokenDiscriminator = bs58.encode(Buffer.from([131, 254, 39, 144, 4, 179, 134, 127]));
  async function filteredTokens(collateralMint) {
    const result = await rpc('getProgramAccounts', [PROGRAM, { encoding: 'base64', commitment: 'confirmed',
      withContext: true, dataSlice: { offset: 0, length: 0 },
      filters: [{ dataSize: 7176 }, { memcmp: { offset: 0, bytes: tokenDiscriminator } },
        { memcmp: { offset: 152, bytes: collateralMint } }] }]);
    return { slot: result.context.slot, addresses: result.value.map(x => x.pubkey) };
  }
  const controlCollateralFilter = await filteredTokens(tokenRows[1].collateralMint);
  if (!controlCollateralFilter.addresses.includes(tokenRows[1].address))
    throw Error('Token collateral-offset filter positive control failed');
  const usdStarCollateralFilter = await filteredTokens(USD_STAR);
  const out = { observedAtUtc: new Date().toISOString(), network: 'mainnet-beta', genesis,
    program: PROGRAM, slot: snap.context.slot, reserveSlot: reserves.context.slot,
    bank: BANK, bankAccountOwner: accounts[1].owner, bankOffCurve: true,
    bankUsdStarAtaDerived: expectedBankAta, bankBump: bank.config.bump,
    bankBaseMint: S(bank.config.base_mint), bankDefaultRedemptionMint: S(bank.config.default_redemption_mint),
    bankBaseAssetRaw: D(bank.base_asset.amount), bankSelectedUsdStarHoldingRaw: bank.assets
      .filter(a => S(a.mint) === USD_STAR).map(a => D(a.amount)),
    bankSharesRaw: D(bank.accounting.total_shares), bankRoles: Object.fromEntries(Object.entries(bank.roles)
      .map(([k, v]) => [k, S(v)])),
    usdStarVault: USD_STAR_VAULT, vault, tokenRows,
    tokenCollateralFilter: { accountSize: 7176, discriminatorOffset: 0, collateralMintOffset: 152,
      controlCollateralMint: tokenRows[1].collateralMint, control: controlCollateralFilter,
      usdStar: usdStarCollateralFilter },
    method: 'One selected bank/vault plus four Token states from saved recent handler index; IDL Borsh decoding and derived collateral ATAs.',
    noMainnetTransaction: true };
  fs.writeFileSync(__dirname + '/lyc8-targeted-state.json', JSON.stringify(out, null, 2) + '\n');
  console.log(JSON.stringify({ slot: out.slot, vaultRaw: vault.raw, bankBaseMint: out.bankBaseMint,
    bankDefaultRedemptionMint: out.bankDefaultRedemptionMint,
    usdStarCollateralTokenCount: usdStarCollateralFilter.addresses.length,
    tokenRows: tokenRows.map(t => ({ address: t.address, mint: t.mint, collateralMint: t.collateralMint,
      collateralReserveRaw: t.collateralReserveState?.raw, unlentCollateralRaw: t.unlentCollateralRaw,
      mintFeeBps: t.mintFeeBps, burnFeeBps: t.burnFeeBps, carryInSelectedBank: t.carryInSelectedBank })) }, null, 2));
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
