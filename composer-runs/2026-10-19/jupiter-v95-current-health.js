#!/usr/bin/env node
'use strict';

// Current-state, signed read-only health snapshot for Jupiter Vault 95.
// Uses a local Surfpool mainnet fork and simulateTransaction only. Never sends.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const MODULES = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules';
const {PublicKey, Keypair, TransactionInstruction, TransactionMessage,
  VersionedTransaction, SystemProgram} = require(path.join(MODULES, '@solana', 'web3.js'));
const {getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID} =
  require(path.join(MODULES, '@solana', 'spl-token'));
const {BorshAccountsCoder} = require(path.join(MODULES, '@coral-xyz', 'anchor'));
const bs58Module = require(path.join(MODULES, 'bs58'));
const bs58 = bs58Module.default || bs58Module;

const ROOT = '/Users/stacc/the-composer-rescue/composer-runs/2026-10-19';
const PRIOR = '/Users/stacc/the-composer-rescue/composer-runs/2026-10-15';
const IDL_ROOT = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/jupiter-lend-current/public/idl';
const RPC = process.env.V95_FORK_RPC || 'http://127.0.0.1:9033';
const VAULT_ID = 95;
const PROGRAM = {
  vaults: new PublicKey('jupr81YtYssSyPt8jbnGuiWon5f6x9TcDEFxYe3Bdzi'),
  oracle: new PublicKey('jupnw4B6Eqs7ft6rxpzYLJZYSnrpRgPcr589n5Kv4oc'),
};
const GET_BOTH = Buffer.from([92, 88, 161, 46, 230, 193, 46, 237]);
const vaultIdl = JSON.parse(fs.readFileSync(path.join(IDL_ROOT, 'vaults.json')));
const oracleIdl = JSON.parse(fs.readFileSync(path.join(IDL_ROOT, 'oracle.json')));
const dexIdl = JSON.parse(fs.readFileSync(path.join(IDL_ROOT, 'dex.json')));
const liquidityIdl = JSON.parse(fs.readFileSync(path.join(IDL_ROOT, 'liquidity.json')));
const vaultCoder = new BorshAccountsCoder(vaultIdl);
const oracleCoder = new BorshAccountsCoder(oracleIdl);
const dexCoder = new BorshAccountsCoder(dexIdl);
const liquidityCoder = new BorshAccountsCoder(liquidityIdl);
const priorPath = JSON.parse(fs.readFileSync(path.join(PRIOR, 'jupiter-dex-peg-path-census.json')))
  .paths.find((row) => row.vaultId === VAULT_ID);
if (!priorPath) throw new Error('Prior Vault 95 topology missing');
// The deployed oracle config contains one DexSmartColPegOracle source.  That
// source expands to its config, DEX, two supply positions, and two reserves.
// Vault 95 quotes directly in USDC, so its default conversion source is not
// passed (unlike smart-peg vaults with a non-default Pyth conversion source).
const ORACLE_REMAINING = [
  priorPath.oracleSource,
  priorPath.dex,
  priorPath.dexPositionToken0,
  priorPath.dexPositionToken1,
  priorPath.tokenReserve0,
  priorPath.tokenReserve1,
];

let rpcId = 0;
async function rpc(method, params) {
  const response = await fetch(RPC, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params})});
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}
const P = (value) => value instanceof PublicKey ? value : new PublicKey(value);
const u16 = (value) => { const out = Buffer.alloc(2); out.writeUInt16LE(value); return out; };
const bn = (value) => BigInt(value.toString());
function readU128(data, offset) {
  let value = 0n;
  for (let index = 15; index >= 0; index--) value = (value << 8n) + BigInt(data[offset + index]);
  return value;
}
function getRatioAtTick(tick) {
  const factors = [
    0x10000000000000000n, 0xff9dd7de423466c2n, 0xff3bd55f4488ad27n,
    0xfe78410fd6498b74n, 0xfcf2d9987c9be179n, 0xf9ef02c4529258b0n,
    0xf402d288133a85a1n, 0xe895615b5beb6386n, 0xd34f17a00ffa00a8n,
    0xae6b7961714e2055n, 0x76d6461f27082d75n, 0x372a3bfe0745d8b7n,
    0xbe32cbee4897976n, 0x8d4f70c9ff4925n, 0x4e009ae55194n,
  ];
  const absolute = Math.abs(tick);
  let factor = absolute & 1 ? factors[1] : factors[0];
  for (let bit = 2, index = 2; index < factors.length; index++, bit <<= 1)
    if (absolute & bit) factor = factor * factors[index] >> 64n;
  let precision = 0n;
  if (tick >= 0) {
    factor = ((1n << 128n) - 1n) / factor;
    if (factor % 0x10000n) precision = 1n;
  }
  return (factor >> 16n) + precision;
}
function getTickAtRatio(target) {
  let low = -16383;
  let high = 16383;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (getRatioAtTick(middle) <= target) low = middle;
    else high = middle - 1;
  }
  return low;
}
function formatDecimal(raw, decimals = 6) {
  const negative = raw < 0n;
  if (negative) raw = -raw;
  const unit = 10n ** BigInt(decimals);
  return `${negative ? '-' : ''}${raw / unit}.${(raw % unit).toString().padStart(decimals, '0')}`;
}
function formatBps(value) {
  const negative = value < 0n;
  if (negative) value = -value;
  return `${negative ? '-' : ''}${value / 10000n}.${(value % 10000n).toString().padStart(4, '0')}`;
}
function accountData(row) { return Buffer.from(row.data[0], 'base64'); }

async function main() {
  const secret = JSON.parse(fs.readFileSync(path.join(os.homedir(), 'hooked.json'), 'utf8'));
  const signer = Keypair.fromSecretKey(Uint8Array.from(secret));
  await rpc('surfnet_setAccount', [signer.publicKey.toBase58(), {data: '', executable: false,
    lamports: 20_000_000_000, owner: SystemProgram.programId.toBase58(), rentEpoch: 0}]);

  const vaultState = PublicKey.findProgramAddressSync([Buffer.from('vault_state'), u16(VAULT_ID)],
    PROGRAM.vaults)[0];
  const positionDisc = Buffer.from(vaultIdl.accounts.find((item) => item.name === 'Position').discriminator);
  const positionRows = await rpc('getProgramAccounts', [PROGRAM.vaults.toBase58(), {
    encoding: 'base64', commitment: 'processed', withContext: true, filters: [
      {dataSize: 71}, {memcmp: {offset: 0, bytes: bs58.encode(positionDisc)}},
      {memcmp: {offset: 8, bytes: bs58.encode(u16(VAULT_ID))}},
    ],
  }]);
  const addresses = [priorPath.vaultConfig, vaultState, priorPath.oracle, priorPath.oracleSource,
    priorPath.dex, priorPath.dexPositionToken0, priorPath.dexPositionToken1,
    priorPath.tokenReserve0, priorPath.tokenReserve1];
  const fetched = await rpc('getMultipleAccounts', [addresses.map(String),
    {encoding: 'base64', commitment: 'processed'}]);
  if (fetched.value.some((row) => !row)) throw new Error('Required current account missing');
  const config = vaultCoder.decode('VaultConfig', accountData(fetched.value[0]));
  const state = vaultCoder.decode('VaultState', accountData(fetched.value[1]));
  const oracle = oracleCoder.decode('Oracle', accountData(fetched.value[2]));
  const dexPegConfig = oracleCoder.decode('DexPegOracleConfig', accountData(fetched.value[3]));
  const dex = dexCoder.decode('Dex', accountData(fetched.value[4]));
  const dexSupply0 = liquidityCoder.decode('UserSupplyPosition', accountData(fetched.value[5]));
  const dexSupply1 = liquidityCoder.decode('UserSupplyPosition', accountData(fetched.value[6]));
  const reserve0 = liquidityCoder.decode('TokenReserve', accountData(fetched.value[7]));
  const reserve1 = liquidityCoder.decode('TokenReserve', accountData(fetched.value[8]));
  if (config.vault_id !== VAULT_ID || state.vault_id !== VAULT_ID)
    throw new Error('Vault id mismatch');
  if (config.oracle.toBase58() !== priorPath.oracle || oracle.nonce !== priorPath.oracleNonce)
    throw new Error('Vault 95 oracle topology changed; refresh topology before use');

  const oracleIx = new TransactionInstruction({programId: PROGRAM.oracle,
    keys: [priorPath.oracle, ...ORACLE_REMAINING]
      .map((value) => ({pubkey: P(value), isSigner: false, isWritable: false})),
    data: Buffer.concat([GET_BOTH, u16(oracle.nonce)])});
  const latest = await rpc('getLatestBlockhash', [{commitment: 'processed'}]);
  const message = new TransactionMessage({payerKey: signer.publicKey,
    recentBlockhash: latest.value.blockhash, instructions: [oracleIx]}).compileToV0Message();
  const transaction = new VersionedTransaction(message);
  transaction.sign([signer]);
  const wire = Buffer.from(transaction.serialize());
  const simulation = await rpc('simulateTransaction', [wire.toString('base64'), {
    encoding: 'base64', sigVerify: true, replaceRecentBlockhash: false,
    commitment: 'processed', innerInstructions: true,
  }]);
  if (simulation.value.err) throw new Error(`Signed oracle read failed: ${JSON.stringify(simulation.value.err)}\n${simulation.value.logs?.join('\n')}`);
  const prefix = `Program return: ${PROGRAM.oracle.toBase58()} `;
  const returnLine = simulation.value.logs.find((line) => line.startsWith(prefix));
  if (!returnLine) throw new Error('Oracle return data missing');
  const oracleReturn = Buffer.from(returnLine.slice(prefix.length), 'base64');
  const supplyRateX15 = readU128(oracleReturn, 0);
  const borrowRateX15 = readU128(oracleReturn, 16);
  const supplyEx = bn(state.vault_supply_exchange_price);
  const borrowEx = bn(state.vault_borrow_exchange_price);
  const effectiveSupplyPriceX15 = supplyRateX15 * supplyEx / borrowEx;
  const SHIFT = 1n << 48n;
  const cfRatio = effectiveSupplyPriceX15 * BigInt(config.collateral_factor) * SHIFT / 1000n / 1_000_000_000_000_000n;
  const ltRatio = effectiveSupplyPriceX15 * BigInt(config.liquidation_threshold) * SHIFT / 1000n / 1_000_000_000_000_000n;
  const cfBoundaryTick = getTickAtRatio(cfRatio);
  const ltBoundaryTick = getTickAtRatio(ltRatio);

  const borrowers = positionRows.value
    .map((row) => ({address: row.pubkey, decoded: vaultCoder.decode('Position', accountData(row.account))}))
    .filter((row) => !row.decoded.is_supply_only_position)
    .map(({address, decoded: position}) => {
      const supplyInternal = bn(position.supply_amount);
      const grossDebtInternal = (getRatioAtTick(position.tick) * (supplyInternal + 1n) >> 48n) + 1n;
      const dustDebtInternal = bn(position.dust_debt_amount);
      const netDebtInternal = grossDebtInternal > dustDebtInternal ? grossDebtInternal - dustDebtInternal : 0n;
      const debtUsdcRaw = netDebtInternal * borrowEx / 1_000_000_000_000n / 1000n;
      const collateralUsdcRaw = supplyInternal * supplyEx / 1_000_000_000_000n *
        supplyRateX15 / 1_000_000_000_000_000n / 1000n;
      const cfDebtLimitRaw = collateralUsdcRaw * BigInt(config.collateral_factor) / 1000n;
      const ltDebtLimitRaw = collateralUsdcRaw * BigInt(config.liquidation_threshold) / 1000n;
      const ratioAtPosition = getRatioAtTick(position.tick);
      const effectiveLiquidationPriceX15 = ratioAtPosition * 1_000_000_000_000_000n * 1000n /
        SHIFT / BigInt(config.liquidation_threshold);
      const oracleLiquidationPriceX15 = effectiveLiquidationPriceX15 * borrowEx / supplyEx;
      const priceDropBpsX4 = oracleLiquidationPriceX15 < supplyRateX15 ?
        (supplyRateX15 - oracleLiquidationPriceX15) * 100_000_000n / supplyRateX15 : 0n;
      return {
        address, nftId: position.nft_id, positionMint: position.position_mint.toBase58(),
        tick: position.tick, tickId: position.tick_id,
        supplyInternalRaw: supplyInternal.toString(), grossDebtInternalRaw: grossDebtInternal.toString(),
        dustDebtInternalRaw: dustDebtInternal.toString(), netDebtInternalRaw: netDebtInternal.toString(),
        collateralValueUsdcRaw: collateralUsdcRaw.toString(),
        collateralValueUsdc: formatDecimal(collateralUsdcRaw),
        debtUsdcRaw: debtUsdcRaw.toString(), debtUsdc: formatDecimal(debtUsdcRaw),
        ltvBps: collateralUsdcRaw ? Number(debtUsdcRaw * 10000n / collateralUsdcRaw) : null,
        cfCreditHeadroomUsdcRaw: (cfDebtLimitRaw - debtUsdcRaw).toString(),
        cfCreditHeadroomUsdc: formatDecimal(cfDebtLimitRaw - debtUsdcRaw),
        ltEquityHeadroomUsdcRaw: (ltDebtLimitRaw - debtUsdcRaw).toString(),
        ltEquityHeadroomUsdc: formatDecimal(ltDebtLimitRaw - debtUsdcRaw),
        cfBoundaryTick, ltBoundaryTick, ticksBelowCf: cfBoundaryTick - position.tick,
        ticksBelowLt: ltBoundaryTick - position.tick,
        oracleLiquidationPriceX15: oracleLiquidationPriceX15.toString(),
        oraclePriceDropToLiquidationBps: formatBps(priceDropBpsX4),
        currentlyLiquidatable: position.tick > ltBoundaryTick,
      };
    }).sort((a, b) => b.tick - a.tick);

  const topPositionMint = P(borrowers[0].positionMint);
  const topMintInfo = await rpc('getAccountInfo', [topPositionMint.toBase58(),
    {encoding: 'base64', commitment: 'processed'}]);
  const topMintProgram = P(topMintInfo.value.owner);
  if (!topMintProgram.equals(TOKEN_PROGRAM_ID) && !topMintProgram.equals(TOKEN_2022_PROGRAM_ID))
    throw new Error('Unexpected position NFT token program');
  const signerTopNftAta = getAssociatedTokenAddressSync(topPositionMint, signer.publicKey,
    false, topMintProgram);
  const signerTopNftInfo = await rpc('getAccountInfo', [signerTopNftAta.toBase58(),
    {encoding: 'base64', commitment: 'processed'}]);
  const signerTopNftAmount = signerTopNftInfo.value ?
    accountData(signerTopNftInfo.value).readBigUInt64LE(64) : 0n;

  const deployments = JSON.parse(fs.readFileSync(path.join(PRIOR, 'jupiter-current-deployments.json')));
  const binaryAttestation = Object.fromEntries(deployments.programs
    .filter((row) => ['vaults', 'oracle', 'dex', 'liquidity', 'flashloan'].includes(row.component))
    .map((row) => [row.component, {program: row.program, programdata: row.programdata,
      priorBinarySha256: row.binarySha256, priorDeploySlot: row.deploySlot}]));
  for (const row of Object.values(binaryAttestation)) {
    const info = await rpc('getAccountInfo', [row.programdata, {encoding: 'base64', commitment: 'processed'}]);
    const programdata = accountData(info.value);
    const executableOffset = programdata[12] === 1 ? 45 : 13;
    row.currentProgramdataSha256 = crypto.createHash('sha256').update(programdata).digest('hex');
    row.currentBinarySha256 = crypto.createHash('sha256').update(programdata.subarray(executableOffset)).digest('hex');
    row.executableOffset = executableOffset;
    row.currentMatchesPriorBinary = row.currentBinarySha256 === row.priorBinarySha256;
  }

  const output = {
    generatedAt: new Date().toISOString(), rpc: RPC,
    forkSlot: simulation.context.slot, mainnetSubmission: false,
    signerSource: '~/hooked.json (private bytes not retained)',
    signatureVerification: true,
    signedOracleControl: {err: simulation.value.err, wireBytes: wire.length,
      staticAccountKeys: message.staticAccountKeys.length, unitsConsumed: simulation.value.unitsConsumed,
      supplyRateX15: supplyRateX15.toString(), borrowRateX15: borrowRateX15.toString()},
    topology: {vaultId: VAULT_ID, vaultConfig: priorPath.vaultConfig, vaultState: vaultState.toBase58(),
      oracle: priorPath.oracle, oracleSource: priorPath.oracleSource, dexPoolA: priorPath.dex,
      usdgMint: '2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH',
      usdcMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'},
    dexPegOracleConfig: {dex: dexPegConfig.dex.toBase58(),
      positionToken0: dexPegConfig.position_token_0.toBase58(),
      positionToken1: dexPegConfig.position_token_1.toBase58(),
      tokenReserve0: dexPegConfig.token_reserve_0.toBase58(),
      tokenReserve1: dexPegConfig.token_reserve_1.toBase58(),
      quoteInToken0: dexPegConfig.quote_in_token0,
      conversionSource: dexPegConfig.conversion_source.source.toBase58(),
      pegBufferPercent: bn(dexPegConfig.peg_buffer_percent).toString()},
    dexState: {feeBps4: bn(dex.fee).toString(),
      centerPriceX15: bn(dex.center_price).toString(),
      totalSupplySharesRaw: bn(dex.total_supply_shares).toString(),
      token0SupplyPositionRaw: bn(dexSupply0.amount).toString(),
      token1SupplyPositionRaw: bn(dexSupply1.amount).toString(),
      token0ReserveSupplyPriceX12: bn(reserve0.supply_exchange_price).toString(),
      token1ReserveSupplyPriceX12: bn(reserve1.supply_exchange_price).toString()},
    config: {collateralFactorBps: config.collateral_factor,
      liquidationThresholdBps: config.liquidation_threshold,
      liquidationMaxLimitBps: config.liquidation_max_limit,
      liquidationPenaltyBps4: config.liquidation_penalty,
      borrowFeeBps4: config.borrow_fee},
    vaultState: {topmostTick: state.topmost_tick, totalSupplyRaw: bn(state.total_supply).toString(),
      totalBorrowRaw: bn(state.total_borrow).toString(), totalPositions: state.total_positions,
      vaultSupplyExchangePriceX12: supplyEx.toString(), vaultBorrowExchangePriceX12: borrowEx.toString(),
      lastUpdateTimestamp: bn(state.last_update_timestamp).toString()},
    healthBoundaries: {effectiveSupplyPriceX15: effectiveSupplyPriceX15.toString(),
      cfBoundaryTick, ltBoundaryTick},
    outsiderBorrowAuthorityGate: {position: borrowers[0].address,
      positionMint: borrowers[0].positionMint, requiresPositionNftAuthority: true,
      hookedSignerAssociatedPositionNftAccountExists: !!signerTopNftInfo.value,
      hookedSignerPositionNftAmountRaw: signerTopNftAmount.toString()},
    borrowerCount: borrowers.length, borrowers, binaryAttestation,
    limitations: [
      'Health values are derived from the current account snapshot and the signed current oracle return; they are not a liquidation execution.',
      'Programdata and extracted executable digests are retained separately; currentMatchesPriorBinary compares executable payloads only.',
    ],
  };
  fs.writeFileSync(path.join(ROOT, 'jupiter-v95-current-health.json'), `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({out: path.join(ROOT, 'jupiter-v95-current-health.json'),
    forkSlot: output.forkSlot, oracleRateX15: output.signedOracleControl.supplyRateX15,
    cfBoundaryTick, ltBoundaryTick, borrowerCount: borrowers.length,
    riskiest: borrowers.slice(0, 3).map((row) => ({address: row.address, tick: row.tick,
      debtUsdc: row.debtUsdc, collateralValueUsdc: row.collateralValueUsdc,
      cfHeadroomUsdc: row.cfCreditHeadroomUsdc,
      ltHeadroomUsdc: row.ltEquityHeadroomUsdc,
      priceDropBps: row.oraclePriceDropToLiquidationBps}))}));
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
