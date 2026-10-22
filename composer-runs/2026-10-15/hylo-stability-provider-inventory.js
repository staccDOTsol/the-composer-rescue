#!/usr/bin/env node
'use strict';

// Read-only exact-mint flash-provider inventory for Hylo's hyUSD stability pool.
// RPC methods are limited to get* calls. No transaction is built, signed, sent,
// or simulated by this inventory script.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bs58Module = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const bs58 = bs58Module.default || bs58Module;

const ROOT = __dirname;
const OUT = path.join(ROOT, 'hylo-stability-provider-inventory.json');
const TARGET = '5YMkXAYccHSGnHn9nob9xEvv6Pvka9DZWH7nTbotTu9E';
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const P0 = 'MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA';
const P0_BANK = '5syijTAMBBmdjwUgYYBvvv26zTS6YX1bYV9EdXkgYqLa';
const P0_VAULT = '6fN1Eqh7433vm4RLBC2Ybd9m3EHg3s6S2GP1JyjABMEU';
const KLEND = 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD';
const KLEND_RESERVE = 'BhD4buCKPSpXiws9CzuXoE4Hg4XDAxfNVPnHPSWV3PgG';
const KLEND_MARKET = '4XAxzYvQqUcxN1qdXV6Qsn1tfD19epbkg5Wkmo46L5Dq';
const KLEND_SUPPLY = '2he82FFDtK4awwVr1XbER9XRS3BDpZYfR3b5TNNN6dS9';
const KLEND_FEE = '4veAufs2oHh9ymfedNNZi84ycmk3sB8PRxBjtHB4JcG8';
const JUPITER_FLASH = 'jupKxkab7RTnQJ6wXStXg6WY4rcReV3maiUNwByciFF';
const MANGO = '4MangoMjqJ2firMokCjjGgoK8d4MXcrgL7XJaL3w6fVg';
const DRIFT = 'dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH';
const SAVE = 'So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo';
const PORT = 'Port7uDYB3wk6GJAw4KT1WpTeMtSu9bTcChBHkX2LfR';
const LARIX = '7Zb1bGi32pfsrBkzWdqd4dFhUXwp5Nybr1zuaEwN34hy';

function readEnv(file) {
  return Object.fromEntries(fs.readFileSync(file, 'utf8').split(/\r?\n/)
    .filter(line => line && !line.startsWith('#') && line.includes('='))
    .map(line => line.split(/=(.*)/s).slice(0, 2)));
}
const env = readEnv('/tmp/composer-helius-rpc.env');
const endpoint = env.RPC_URL || env.HEAVY_RPC_URL;
if (!endpoint) throw new Error('Missing configured read-only RPC endpoint');
let rpcId = 0;
async function rpc(method, params) {
  const response = await fetch(endpoint, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params})});
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${body.error.code} ${body.error.message}`);
  return body.result;
}

const dataOf = account => Buffer.from(account.data[0], 'base64');
const pk = bytes => bs58.encode(Buffer.from(bytes));
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function tokenAccount(address, account) {
  if (!account) return {address, exists: false};
  const data = dataOf(account);
  return {
    address, exists: true, ownerProgram: account.owner, dataLength: data.length,
    mint: pk(data.subarray(0, 32)), authority: pk(data.subarray(32, 64)),
    amountRaw: data.readBigUInt64LE(64).toString(), state: data[108],
  };
}
function artifact(name) {
  const file = path.join(ROOT, name);
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file);
  return {name, sha256: sha256(raw), json: JSON.parse(raw)};
}
async function mintFilter(program, filters) {
  const result = await rpc('getProgramAccounts', [program, {encoding: 'base64',
    commitment: 'confirmed', withContext: true, dataSlice: {offset: 0, length: 0}, filters}]);
  return {slot: result.context.slot, count: result.value.length,
    accounts: result.value.map(row => ({address: row.pubkey, dataLength: row.account.space,
      owner: row.account.owner}))};
}

async function main() {
  const observationSlot = await rpc('getSlot', [{commitment: 'confirmed'}]);
  const observationBlockTime = await rpc('getBlockTime', [observationSlot]);
  const addresses = [P0, P0_BANK, P0_VAULT, KLEND, KLEND_RESERVE, KLEND_SUPPLY,
    KLEND_FEE, JUPITER_FLASH, MANGO, DRIFT, SAVE, PORT, LARIX];
  const fetched = await rpc('getMultipleAccounts', [addresses,
    {encoding: 'base64', commitment: 'confirmed'}]);
  const accounts = Object.fromEntries(addresses.map((address, index) =>
    [address, fetched.value[index]]));

  const klendReserveData = dataOf(accounts[KLEND_RESERVE]);
  const p0Vault = tokenAccount(P0_VAULT, accounts[P0_VAULT]);
  const klendSupply = tokenAccount(KLEND_SUPPLY, accounts[KLEND_SUPPLY]);
  const klendFee = tokenAccount(KLEND_FEE, accounts[KLEND_FEE]);

  const mangoDisc = bs58.encode(crypto.createHash('sha256').update('account:Bank')
    .digest().subarray(0, 8));
  const driftDisc = bs58.encode(crypto.createHash('sha256').update('account:SpotMarket')
    .digest().subarray(0, 8));
  const [mango, drift, save, port, larix] = await Promise.all([
    mintFilter(MANGO, [{memcmp: {offset: 0, bytes: mangoDisc}},
      {memcmp: {offset: 56, bytes: TARGET}}]),
    mintFilter(DRIFT, [{memcmp: {offset: 0, bytes: driftDisc}},
      {memcmp: {offset: 72, bytes: TARGET}}]),
    mintFilter(SAVE, [{dataSize: 619}, {memcmp: {offset: 42, bytes: TARGET}}]),
    mintFilter(PORT, [{memcmp: {offset: 42, bytes: TARGET}}]),
    mintFilter(LARIX, [{memcmp: {offset: 42, bytes: TARGET}}]),
  ]);

  const jupiter = artifact('jup6qf-current-inventory.json');
  const xp1brIdl = artifact('xp1br-generic-standard-idl.json');
  const xp1brInventory = artifact('xp1br-current-inventory.json');
  const crosswalk = artifact('mainnet-token-authority-flash-crosswalk.json');
  const longTail = artifact('mainnet-long-tail-flash-overlay.json');
  const signed = artifact('hylo-stability-signed-fork-sim.json') ||
    artifact('hylo-stability-v1-sim.json');
  const jupiterMints = jupiter?.json.reserves?.map(row => row.mint) || [];
  const xpInstructions = xp1brIdl?.json.instructions?.map(row => row.name) || [];
  const xpTargetVaults = [];
  function collectTargetObjects(value) {
    if (Array.isArray(value)) value.forEach(collectTargetObjects);
    else if (value && typeof value === 'object') {
      if (value.mint === TARGET && value.address && value.amountRaw) {
        xpTargetVaults.push({address: value.address, authority: value.authority || null,
          amountRaw: value.amountRaw});
      }
      Object.values(value).forEach(collectTargetObjects);
    }
  }
  if (xp1brInventory) collectTargetObjects(xp1brInventory.json);
  const uniqueXpVaults = [...new Map(xpTargetVaults.map(row => [row.address, row])).values()];

  const simLiquidity = signed?.json.currentLiquidity || {};
  const project0RiskMax = simLiquidity.project0?.lastSuccessfulRiskLimitedRaw || null;
  const project0RouteMax = simLiquidity.project0?.lastSuccessfulFullHyloRouteRaw || null;
  const klendAvailableRaw = klendReserveData.readBigUInt64LE(224).toString();
  const klendFlashFeeSf = klendReserveData.readBigUInt64LE(4904).toString();

  const output = {
    generatedAt: new Date().toISOString(), observationSlot, observationBlockTime,
    target: {symbol: 'hyUSD', mint: TARGET, decimals: 6},
    safety: {readOnly: true, rpcEndpointRedacted: true, transactionsBuilt: 0,
      transactionsSigned: 0, simulations: 0, submissions: 0},
    eligibleExactMintZeroFeeProviders: [
      {
        provider: 'Project0 / Marginfi', program: P0, bank: P0_BANK,
        vault: p0Vault, exactMint: p0Vault.mint === TARGET,
        programExecutable: accounts[P0]?.executable === true,
        zeroFeeEvidence: {
          field: 'protocol_origination_fee I80F48',
          raw: signed?.json.initial?.project0_bank?.bank?.originationFeeI80F48Raw || null,
          exactlyZero: signed?.json.assertions?.project0OriginationFeeExactlyZero === true,
        },
        displayedVaultRaw: p0Vault.amountRaw,
        observedRiskLimitedFlashMaximumRaw: project0RiskMax,
        observedFullHyloRouteMaximumRaw: project0RouteMax,
        capacitySemantics: 'Bank risk/borrow limits are authoritative; displayed vault tokens are not all flash-borrowable.',
      },
      {
        provider: 'Kamino Lend / KLend', program: KLEND, reserve: KLEND_RESERVE,
        market: KLEND_MARKET, supplyVault: klendSupply, feeVault: klendFee,
        exactMint: klendSupply.mint === TARGET,
        programExecutable: accounts[KLEND]?.executable === true,
        availableRaw: klendAvailableRaw,
        flashLoanFeeSf: klendFlashFeeSf,
        feeScale: '2^60', exactlyZeroFee: klendFlashFeeSf === '0',
        repeatBorrowConstraint: 'MultipleFlashBorrows is enforced per reserve per transaction; one borrow can fund repeated target calls.',
      },
    ],
    investigatedButNotCompatibleAsThirdExactMintProvider: [
      {
        provider: 'Jupiter Lend native flash-loan program', program: JUPITER_FLASH,
        programExecutable: accounts[JUPITER_FLASH]?.executable === true,
        currentReserveMints: jupiterMints, targetReservePresent: jupiterMints.includes(TARGET),
        blocker: 'Current native flash reserve set does not contain hyUSD.',
      },
      {provider: 'Mango v4', program: MANGO, bankMintOffset: 56, result: mango,
        blocker: mango.count ? null : 'No current Mango Bank account has the hyUSD mint.'},
      {provider: 'Drift spot', program: DRIFT, spotMarketMintOffset: 72, result: drift,
        blocker: drift.count ? null : 'No current Drift SpotMarket has the hyUSD mint.'},
      {provider: 'Save / Solend', program: SAVE, reserveMintOffset: 42, result: save,
        blocker: save.count ? null : 'No current 619-byte Save reserve has the hyUSD mint.'},
      {provider: 'Port Finance', program: PORT, reserveMintOffset: 42, result: port,
        blocker: port.count ? null : 'No current SPL-lending-layout account has the hyUSD mint.'},
      {provider: 'Larix', program: LARIX, reserveMintOffset: 42, result: larix,
        blocker: larix.count ? null : 'No current SPL-lending-layout account has the hyUSD mint.'},
      {
        provider: 'XP1BR principal-token program',
        currentHyusdCustody: uniqueXpVaults,
        instructionNames: xpInstructions,
        hasFlashOrBorrowInstruction: xpInstructions.some(name => /flash|borrow/i.test(name)),
        blocker: 'It has hyUSD custody but exposes deposit/mint/redeem/withdraw semantics, not an outsider flash-borrow facility.',
      },
      {
        provider: 'Manifest orderbook custody',
        blocker: 'Custody/orderbook settlement is not an independently callable exact-repayment flash-loan facility; no flash-borrow instruction was identified.',
      },
    ],
    maximumCompatibleSet: {
      independentProviderCount: 2,
      providers: ['Project0 / Marginfi', 'Kamino Lend / KLend'],
      triSourcePossible: false,
      blocker: 'Every investigated third protocol either lacks a current hyUSD market/reserve or lacks an outsider-callable flash-borrow ABI.',
      compositionEvidence: signed ? signed.name : null,
    },
    sourceArtifacts: [jupiter, xp1brIdl, xp1brInventory, crosswalk, longTail, signed]
      .filter(Boolean).map(row => ({name: row.name, sha256: row.sha256})),
    caveat: 'Exact-mint inventory covers the deployed native flash surfaces and current same-mint lending markets enumerated above. Cross-asset flash plus a DEX swap is a different route with swap price, account, and liquidity dependencies; it is not a third zero-fee hyUSD source.',
  };
  fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({output: path.basename(OUT), observationSlot,
    eligible: output.eligibleExactMintZeroFeeProviders.length,
    investigatedExcluded: output.investigatedButNotCompatibleAsThirdExactMintProvider.length,
    triSourcePossible: output.maximumCompatibleSet.triSourcePossible})}\n`);
}

main().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
