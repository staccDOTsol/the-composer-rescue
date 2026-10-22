#!/usr/bin/env node
// Current-mainnet census of Jupiter Vaults oracle paths that terminate in a
// Jupiter DEX smart-collateral or smart-debt peg source. Read-only RPC only.

const fs = require('fs');
const {
  Connection, PublicKey,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const {BorshAccountsCoder} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@coral-xyz/anchor');
const bsModule = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const bs58 = bsModule.default || bsModule;

const root = '/Users/stacc/the-composer-rescue/composer-runs/2026-10-15';
const idlRoot = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/jupiter-lend-current/public/idl';
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split('\n').filter(Boolean).map(line => line.split(/=(.*)/s).slice(0, 2)));
const rpcUrl = env.HEAVY_RPC_URL || env.RPC_URL;
if (!rpcUrl) throw new Error('No read-only RPC configured');
const conn = new Connection(rpcUrl, 'confirmed');
const vaultProgram = new PublicKey('jupr81YtYssSyPt8jbnGuiWon5f6x9TcDEFxYe3Bdzi');
const oracleProgram = new PublicKey('jupnw4B6Eqs7ft6rxpzYLJZYSnrpRgPcr589n5Kv4oc');
const vaultIdl = JSON.parse(fs.readFileSync(`${idlRoot}/vaults.json`, 'utf8'));
const oracleIdl = JSON.parse(fs.readFileSync(`${idlRoot}/oracle.json`, 'utf8'));
const vaultCoder = new BorshAccountsCoder(vaultIdl);
const oracleCoder = new BorshAccountsCoder(oracleIdl);
const disc = (idl, name) => Buffer.from(idl.accounts.find(x => x.name === name).discriminator);
const typeName = value => value && typeof value === 'object' ? Object.keys(value)[0] : null;
const bn = value => BigInt(value.toString());

async function programAccounts(program, size, discriminator) {
  return conn.getProgramAccounts(program, {commitment: 'confirmed', filters: [
    {dataSize: size}, {memcmp: {offset: 0, bytes: bs58.encode(discriminator)}},
  ]});
}

async function positionsForVault(vaultId) {
  const id = Buffer.alloc(2);
  id.writeUInt16LE(vaultId);
  const accounts = await conn.getProgramAccounts(vaultProgram, {commitment: 'confirmed', filters: [
    {dataSize: 71}, {memcmp: {offset: 0, bytes: bs58.encode(disc(vaultIdl, 'Position'))}},
    {memcmp: {offset: 8, bytes: bs58.encode(id)}},
  ]});
  let totalSupply = 0n;
  let totalDustDebt = 0n;
  let borrowingPositions = 0;
  for (const item of accounts) {
    const position = vaultCoder.decode('Position', item.account.data);
    totalSupply += bn(position.supply_amount);
    totalDustDebt += bn(position.dust_debt_amount);
    if (!position.is_supply_only_position) borrowingPositions++;
  }
  return {positionCount: accounts.length, borrowingPositions,
    totalPositionSupplyRaw: totalSupply.toString(),
    totalPositionDustDebtRaw: totalDustDebt.toString()};
}

async function main() {
  const [slot, vaultAccounts, oracleAccounts, dexPegAccounts] = await Promise.all([
    conn.getSlot('confirmed'),
    programAccounts(vaultProgram, 219, disc(vaultIdl, 'VaultConfig')),
    programAccounts(oracleProgram, 279, disc(oracleIdl, 'Oracle')),
    programAccounts(oracleProgram, 287, disc(oracleIdl, 'DexPegOracleConfig')),
  ]);
  const oracles = new Map(oracleAccounts.map(item => [item.pubkey.toBase58(),
    oracleCoder.decode('Oracle', item.account.data)]));
  const dexPegs = new Map(dexPegAccounts.map(item => [item.pubkey.toBase58(), {
    address: item.pubkey.toBase58(), decoded: oracleCoder.decode('DexPegOracleConfig', item.account.data),
  }]));
  const paths = [];
  for (const item of vaultAccounts) {
    const config = vaultCoder.decode('VaultConfig', item.account.data);
    const oracleAddress = config.oracle.toBase58();
    const oracle = oracles.get(oracleAddress);
    if (!oracle) continue;
    for (const source of oracle.sources) {
      const sourceType = typeName(source.source_type);
      if (sourceType !== 'DexSmartColPegOracle' && sourceType !== 'DexSmartDebtPegOracle') continue;
      const sourceAddress = source.source.toBase58();
      const peg = dexPegs.get(sourceAddress);
      paths.push({
        vaultId: config.vault_id,
        vaultConfig: item.pubkey.toBase58(), vaultType: config.vault_type,
        supplyToken: config.supply_token.toBase58(), borrowToken: config.borrow_token.toBase58(),
        collateralFactorBps: config.collateral_factor,
        liquidationThresholdBps: config.liquidation_threshold,
        oracle: oracleAddress, oracleNonce: oracle.nonce,
        oracleSource: sourceAddress, sourceType,
        oracleSourceInvert: source.invert,
        oracleSourceMultiplier: bn(source.multiplier).toString(),
        oracleSourceDivisor: bn(source.divisor).toString(),
        dex: peg?.decoded.dex.toBase58(),
        dexPositionToken0: peg?.decoded.position_token_0.toBase58(),
        dexPositionToken1: peg?.decoded.position_token_1.toBase58(),
        tokenReserve0: peg?.decoded.token_reserve_0.toBase58(),
        tokenReserve1: peg?.decoded.token_reserve_1.toBase58(),
        quoteInToken0: peg?.decoded.quote_in_token0,
        conversionSource: peg?.decoded.conversion_source.source.toBase58(),
        conversionSourceType: typeName(peg?.decoded.conversion_source.source_type),
        conversionInvert: peg?.decoded.conversion_source.invert,
        pegBufferPercent: peg ? bn(peg.decoded.peg_buffer_percent).toString() : null,
        pegKind: typeName(peg?.decoded.kind),
      });
    }
  }
  paths.sort((a, b) => a.vaultId - b.vaultId);
  const activity = await Promise.all(paths.map(path => positionsForVault(path.vaultId)));
  for (let i = 0; i < paths.length; i++) paths[i].activity = activity[i];
  const uniqueDexes = new Set(paths.map(x => x.dex));
  const activePaths = paths.filter(x => x.activity.positionCount > 0);
  const summary = {
    vaultConfigAccounts: vaultAccounts.length,
    oracleAccounts: oracleAccounts.length,
    dexPegOracleConfigAccounts: dexPegAccounts.length,
    vaultToDexPegPaths: paths.length,
    activeVaultToDexPegPaths: activePaths.length,
    uniqueDexPoolsUsedByVaultPaths: uniqueDexes.size,
    smartCollateralPaths: paths.filter(x => x.sourceType === 'DexSmartColPegOracle').length,
    smartDebtPaths: paths.filter(x => x.sourceType === 'DexSmartDebtPegOracle').length,
    positionsAcrossPaths: paths.reduce((sum, x) => sum + x.activity.positionCount, 0),
    borrowingPositionsAcrossPaths: paths.reduce((sum, x) => sum + x.activity.borrowingPositions, 0),
  };
  const output = {timestamp: new Date().toISOString(), slot, liveSubmission: false,
    transport: 'current-mainnet getProgramAccounts/getSlot only',
    programs: {vaults: vaultProgram.toBase58(), oracle: oracleProgram.toBase58()},
    summary, paths};
  fs.writeFileSync(`${root}/jupiter-dex-peg-path-census.json`, JSON.stringify(output, null, 2));
  console.log(JSON.stringify(summary));
  for (const path of paths) console.log(JSON.stringify({vaultId: path.vaultId,
    sourceType: path.sourceType, dex: path.dex, pegBufferPercent: path.pegBufferPercent,
    positions: path.activity.positionCount, borrowingPositions: path.activity.borrowingPositions}));
}

main().catch(error => { console.error(error.stack); process.exitCode = 1; });
