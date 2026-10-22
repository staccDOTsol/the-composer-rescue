#!/usr/bin/env node
// Read-only Hadron binary/state snapshot for the binary-state audit branch.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {Connection, PublicKey} = require('../2026-10-15/onre-harness/node_modules/@solana/web3.js');
const spl = require('../2026-10-15/onre-harness/node_modules/@solana/spl-token');
const sdk = require('./hadron-sdk/package/dist/index.js');

const PROGRAM = sdk.HADRON_PROGRAM_ID;
const DGLD_POOL = new PublicKey('rQsUkcKpia3v3VykWVNZWALuYehNZSTTjDa7qJ3oxWs');
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const envFile = '/Users/stacc/.config/stacc-ladder/rpc.env';
const row = fs.readFileSync(envFile, 'utf8').split(/\r?\n/).find(x => /^\s*(?:export\s+)?SOLANA_RPC=/.test(x));
if (!row) throw Error('SOLANA_RPC missing');
const rpcUrl = row.slice(row.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '');
const connection = new Connection(rpcUrl, 'confirmed');
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
const cast = value => JSON.parse(JSON.stringify(value, (_, v) => {
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof PublicKey) return v.toBase58();
  if (v instanceof Uint8Array) return [...v];
  return v;
}));

function rawToken(address, account, expectedMint, expectedAuthority, expectedTokenProgram) {
  if (!account) return {address, exists: false, raw: '0', valid: false};
  const mint = new PublicKey(account.data.subarray(0, 32)).toBase58();
  const authority = new PublicKey(account.data.subarray(32, 64)).toBase58();
  const raw = account.data.readBigUInt64LE(64).toString();
  const tokenProgram = account.owner.toBase58();
  return {address, exists: true, raw, mint, authority, tokenProgram,
    valid: mint === expectedMint && authority === expectedAuthority && tokenProgram === expectedTokenProgram,
    dataLength: account.data.length, dataSha256: sha256(account.data)};
}

function optionalKey(value) {
  if (!value) return null;
  if (value.toBase58) return value.toBase58();
  return cast(value);
}

function mintExtensions(address, account, epoch) {
  const pubkey = new PublicKey(address);
  const mint = spl.unpackMint(pubkey, account, account.owner);
  const types = spl.getExtensionTypes(mint.tlvData);
  const tf = spl.getTransferFeeConfig(mint);
  const hook = spl.getTransferHook(mint);
  const permanentDelegate = spl.getPermanentDelegate(mint);
  const pausable = spl.getPausableConfig(mint);
  const currentFee = tf ? spl.getEpochFee(tf, BigInt(epoch)) : null;
  return {
    address,
    dataLength: account.data.length,
    dataSha256: sha256(account.data),
    decimals: mint.decimals,
    supply: mint.supply.toString(),
    extensions: types.map(type => spl.ExtensionType[type] ?? `Unknown(${type})`),
    transferFee: tf ? {
      configAuthority: optionalKey(tf.transferFeeConfigAuthority),
      withdrawWithheldAuthority: optionalKey(tf.withdrawWithheldAuthority),
      withheldAmount: tf.withheldAmount.toString(),
      older: cast(tf.olderTransferFee), newer: cast(tf.newerTransferFee),
      current: cast(currentFee)
    } : null,
    transferHookProgram: hook ? optionalKey(hook.programId) : null,
    permanentDelegate: permanentDelegate ? optionalKey(permanentDelegate.delegate) : null,
    pausable: pausable ? cast(pausable) : null
  };
}

async function main() {
  const genesis = await connection.getGenesisHash();
  if (genesis !== '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d') throw Error('wrong cluster');
  const startSlot = await connection.getSlot('confirmed');
  const epochInfo = await connection.getEpochInfo('confirmed');

  const programResult = await connection.getAccountInfoAndContext(PROGRAM, 'confirmed');
  if (!programResult.value || programResult.value.data.readUInt32LE(0) !== 2) throw Error('not an upgradeable program');
  const programdataAddress = new PublicKey(programResult.value.data.subarray(4, 36));
  const programdataResult = await connection.getAccountInfoAndContext(programdataAddress, 'confirmed');
  if (!programdataResult.value || programdataResult.value.data.readUInt32LE(0) !== 3) throw Error('bad ProgramData');
  const pd = programdataResult.value.data;
  const hasAuthority = pd.readUInt8(12) !== 0;
  const programBytesOffset = hasAuthority ? 45 : 13;
  const programBytes = pd.subarray(programBytesOffset);

  const configRows = await connection.getProgramAccounts(PROGRAM, {
    commitment: 'confirmed', filters: [{dataSize: sdk.CONFIG_SIZE}]
  });
  const configs = [];
  for (const row of configRows) {
    const data = sdk.decodeConfig(row.account.data);
    const id = row.pubkey.toBase58();
    const expected = sdk.getConfigAddress(data.seed, data.mintX, data.mintY)[0].toBase58();
    const vaultX = spl.getAssociatedTokenAddressSync(data.mintX, row.pubkey, true, data.tokenProgramX).toBase58();
    const vaultY = spl.getAssociatedTokenAddressSync(data.mintY, row.pubkey, true, data.tokenProgramY).toBase58();
    configs.push({id, state: data.state, seed: data.seed.toString(), mintX: data.mintX.toBase58(), mintY: data.mintY.toBase58(),
      tokenProgramX: data.tokenProgramX.toBase58(), tokenProgramY: data.tokenProgramY.toBase58(),
      authority: data.authority.toBase58(), configPdaMatches: id === expected, vaultX, vaultY});
  }
  const vaultAddresses = configs.flatMap(c => [c.vaultX, c.vaultY]);
  const vaultMap = new Map();
  for (let i = 0; i < vaultAddresses.length; i += 100) {
    const chunk = vaultAddresses.slice(i, i + 100);
    const rows = await connection.getMultipleAccountsInfo(chunk.map(x => new PublicKey(x)), 'confirmed');
    chunk.forEach((address, j) => vaultMap.set(address, rows[j]));
  }
  const pools = configs.map(c => {
    const x = rawToken(c.vaultX, vaultMap.get(c.vaultX), c.mintX, c.id, c.tokenProgramX);
    const y = rawToken(c.vaultY, vaultMap.get(c.vaultY), c.mintY, c.id, c.tokenProgramY);
    const usdcRaw = (c.mintX === USDC ? BigInt(x.raw) : 0n) + (c.mintY === USDC ? BigInt(y.raw) : 0n);
    return {...c, balances: {x, y}, usdcRaw: usdcRaw.toString()};
  });
  const initializedFunded = pools.filter(p => p.state === sdk.PoolState.Initialized &&
    (BigInt(p.balances.x.raw) > 0n || BigInt(p.balances.y.raw) > 0n));
  const liveToken2022Mints = [...new Set(initializedFunded.flatMap(p => [
    [p.mintX, p.tokenProgramX], [p.mintY, p.tokenProgramY]
  ]).filter(([, owner]) => owner === spl.TOKEN_2022_PROGRAM_ID.toBase58()).map(([mint]) => mint))];
  const mintMap = new Map();
  for (let i = 0; i < liveToken2022Mints.length; i += 100) {
    const chunk = liveToken2022Mints.slice(i, i + 100);
    const rows = await connection.getMultipleAccountsInfo(chunk.map(x => new PublicKey(x)), 'confirmed');
    chunk.forEach((address, j) => mintMap.set(address, rows[j]));
  }
  const token2022Mints = liveToken2022Mints.map(mint => mintExtensions(mint, mintMap.get(mint), epochInfo.epoch));

  const hadron = await sdk.Hadron.load(connection, DGLD_POOL);
  const criticalAddresses = [hadron.poolAddress, hadron.addresses.midpriceOracle, hadron.addresses.curveMeta,
    hadron.addresses.curvePrefabs, hadron.addresses.curveUpdates, hadron.addresses.vaultX, hadron.addresses.vaultY,
    hadron.feeConfigPda];
  const criticalRows = await connection.getMultipleAccountsInfo(criticalAddresses, 'confirmed');
  const critical = criticalAddresses.map((address, i) => ({address: address.toBase58(), owner: criticalRows[i].owner.toBase58(),
    dataLength: criticalRows[i].data.length, dataSha256: sha256(criticalRows[i].data), lamports: criticalRows[i].lamports}));
  const dgldMintInfo = mintMap.get(hadron.config.mintX.toBase58()) || await connection.getAccountInfo(hadron.config.mintX, 'confirmed');
  const dgldVault = spl.unpackAccount(hadron.addresses.vaultX, criticalRows[5], hadron.config.tokenProgramX);
  const curveUpdates = sdk.decodeCurveUpdates(criticalRows[4].data);
  const dgld = {
    pool: hadron.poolAddress.toBase58(),
    config: cast(hadron.config), oracle: cast(hadron.oracle), curveMeta: cast(hadron.curveMeta),
    feeConfigPda: hadron.feeConfigPda.toBase58(), feeConfig: cast(hadron.feeConfig), resolvedFee: cast(hadron.resolveFee()),
    activeCurves: cast(hadron.getActiveCurves()), curveUpdates: cast(curveUpdates),
    vaultX: rawToken(hadron.addresses.vaultX.toBase58(), criticalRows[5], hadron.config.mintX.toBase58(), hadron.poolAddress.toBase58(), hadron.config.tokenProgramX.toBase58()),
    vaultY: rawToken(hadron.addresses.vaultY.toBase58(), criticalRows[6], hadron.config.mintY.toBase58(), hadron.poolAddress.toBase58(), hadron.config.tokenProgramY.toBase58()),
    mintXExtensions: mintExtensions(hadron.config.mintX.toBase58(), dgldMintInfo, epochInfo.epoch),
    vaultXExtensions: {
      extensions: spl.getExtensionTypes(dgldVault.tlvData).map(type => spl.ExtensionType[type] ?? `Unknown(${type})`),
      transferFeeAmount: cast(spl.getTransferFeeAmount(dgldVault)),
      pausableAccount: cast(spl.getPausableAccount(dgldVault))
    },
    criticalAccounts: critical
  };

  const endSlot = await connection.getSlot('confirmed');
  const stateCounts = Object.fromEntries([...new Set(pools.map(p => p.state))].sort().map(state => [String(state), pools.filter(p => p.state === state).length]));
  const topUsdc = [...initializedFunded].sort((a, b) => BigInt(a.usdcRaw) === BigInt(b.usdcRaw) ? 0 : BigInt(a.usdcRaw) > BigInt(b.usdcRaw) ? -1 : 1).slice(0, 30);
  const output = {
    observedAtUtc: new Date().toISOString(), genesis, startSlot, endSlot, epoch: epochInfo.epoch, noTransactions: true,
    program: {
      address: PROGRAM.toBase58(), owner: programResult.value.owner.toBase58(), executable: programResult.value.executable,
      programdataAddress: programdataAddress.toBase58(), programdataSlot: programdataResult.context.slot,
      lastDeploySlot: pd.readBigUInt64LE(4).toString(), upgradeAuthority: hasAuthority ? new PublicKey(pd.subarray(13, 45)).toBase58() : null,
      programBytesLength: programBytes.length, programBytesSha256: sha256(programBytes)
    },
    census: {
      configs: pools.length, matchedConfigPdas: pools.filter(p => p.configPdaMatches).length,
      validVaults: pools.reduce((n, p) => n + Number(p.balances.x.valid) + Number(p.balances.y.valid), 0),
      stateCounts, initializedFunded: initializedFunded.length, initializedFundedToken2022Mints: token2022Mints.length,
      topUsdc
    },
    token2022Mints,
    dgld
  };
  const outPath = path.join(__dirname, 'hadron-binary-state-snapshot.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify({outPath, startSlot, endSlot, program: output.program,
    summary: output.census && {...output.census, topUsdc: output.census.topUsdc.slice(0, 5).map(p => ({id: p.id, usdcRaw: p.usdcRaw}))},
    dgld: {oracle: output.dgld.oracle, curveUpdates: output.dgld.curveUpdates,
      vaultX: output.dgld.vaultX.raw, vaultY: output.dgld.vaultY.raw, mintXExtensions: output.dgld.mintXExtensions}}));
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
