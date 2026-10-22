'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PublicKey } = require('./sdk-3.0.2/node_modules/@solana/web3.js');
const { StakePoolLayout } = require('./sdk-3.0.2/node_modules/@solana/spl-stake-pool');
const { restakingTypes: T } = require('./sdk-3.0.2');

const RPC = process.env.HEAVY_RPC_URL || process.env.RPC_URL;
if (!RPC) throw new Error('RPC_URL or HEAVY_RPC_URL is required');

const A = {
  program: 'fragnAis7Bp6FTsMoa6YcH8UffhEw43Ph79qAiK3iF3',
  fund: '3TK9fNePM4qdKC4dwvDe8Bamv14prDqdVfuANxPeiryb',
  fundReserve: '3H22A3T3CMyoGzAURZ4szV5Hmt64Dooo5g9Ns8h1kYy7',
  receiptMint: 'FRAGSEthVFL7fdqM8hxfxkfCZzUvmg21cqPJVvC1qdbo',
  wrappedMint: 'WFRGSWjaz8tbAxsJitmbfRuFV2mSNwy7BMWcCwaA28U',
  normalizedPool: 'AkbZvKxUAxMKz92FF7g5k2YLCJftg8SnYEPWdmZTt3mp',
  normalizedMint: 'nSoLnkrvh2aY792pgCNT6hzx84vYtkviRzxvhf3ws8e',
  jsolMint: '7Q2afV64in6N6SeZsAAB81TJzwDoD6zpqmHkzi9Dcavn',
  jsolReserve: '5HrP4MEggWDsENFTFX7QqW7U49RTei6Qqh7TVCczhgWa',
  jsolStakePool: 'CtMyWsrUtAwXWiGr9WjHT5fC3p3fgV8cyGpLTo2LJzG1',
};

async function rpc(method, params) {
  let last;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const response = await fetch(RPC, {
        method: 'POST', headers: {'content-type': 'application/json'},
        body: JSON.stringify({jsonrpc: '2.0', id: `${method}-${attempt}`, method, params}),
      });
      const json = await response.json();
      if (json.error) throw new Error(JSON.stringify(json.error));
      return json.result;
    } catch (error) {
      last = error;
      await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  throw last;
}

function clean(value) {
  return JSON.parse(JSON.stringify(value, (_key, item) => {
    if (typeof item === 'bigint') return item.toString();
    if (item && item.constructor && item.constructor.name === 'PublicKey') return item.toBase58();
    if (Buffer.isBuffer(item)) return item.toString('hex');
    return item;
  }));
}

function hash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function tokenAmount(data) {
  return data.readBigUInt64LE(64).toString();
}

function mintState(data) {
  return {supplyRaw: data.readBigUInt64LE(36).toString(), decimals: data[44]};
}

function compactFund(fund) {
  const supported = fund.supportedTokens.slice(0, Number(fund.numSupportedTokens));
  const jsol = supported.find(row => String(row.mint) === A.jsolMint);
  return clean({
    dataVersion: fund.dataVersion,
    reserveAccount: fund.reserveAccount,
    receiptTokenMint: fund.receiptTokenMint,
    receiptTokenProgram: fund.receiptTokenProgram,
    receiptTokenDecimals: fund.receiptTokenDecimals,
    receiptTokenSupplyAmount: fund.receiptTokenSupplyAmount,
    oneReceiptTokenAsSol: fund.oneReceiptTokenAsSol,
    receiptTokenValueUpdatedSlot: fund.receiptTokenValueUpdatedSlot,
    withdrawalBatchThresholdIntervalSeconds: fund.withdrawalBatchThresholdIntervalSeconds,
    withdrawalFeeRateBps: fund.withdrawalFeeRateBps,
    withdrawalEnabled: fund.withdrawalEnabled,
    depositEnabled: fund.depositEnabled,
    donationEnabled: fund.donationEnabled,
    operationEnabled: fund.operationEnabled,
    transferEnabled: fund.transferEnabled,
    normalizedToken: fund.normalizedToken,
    operation: fund.operation,
    wrapAccount: fund.wrapAccount,
    wrappedToken: fund.wrappedToken,
    numTokenSwapStrategies: fund.numTokenSwapStrategies,
    tokenSwapStrategies: fund.tokenSwapStrategies.slice(0, Number(fund.numTokenSwapStrategies)),
    depositResidualMicroReceiptTokenAmount: fund.depositResidualMicroReceiptTokenAmount,
    performanceFeeRateBps: fund.performanceFeeRateBps,
    jsolStrategy: jsol,
  });
}

async function getAccount(address) {
  const result = await rpc('getAccountInfo', [address, {encoding: 'base64', commitment: 'finalized'}]);
  if (!result.value) throw new Error(`missing account ${address}`);
  return {contextSlot: result.context.slot, ...result.value, dataBuffer: Buffer.from(result.value.data[0], 'base64')};
}

async function main() {
  const observation = await rpc('getSlot', [{commitment: 'finalized'}]);
  const rows = {};
  for (const [name, address] of Object.entries(A)) {
    if (name === 'wrappedMint') continue;
    rows[name] = await getAccount(address);
  }

  const programBytes = rows.program.dataBuffer;
  if (programBytes.readUInt32LE(0) !== 2) throw new Error('program account is not upgradeable-loader Program state');
  const programDataAddress = new PublicKey(programBytes.subarray(4, 36)).toBase58();
  const programData = await getAccount(programDataAddress);
  if (programData.dataBuffer.readUInt32LE(0) !== 3) throw new Error('unexpected ProgramData state');
  const authorityTag = programData.dataBuffer[12];
  const upgradeAuthority = authorityTag === 1 ? new PublicKey(programData.dataBuffer.subarray(13, 45)).toBase58() : null;
  const elfOffset = authorityTag === 1 ? 45 : 13;
  const elf = programData.dataBuffer.subarray(elfOffset);
  fs.writeFileSync(path.join(__dirname, 'fragmetric-current.so'), elf);

  const fund = T.getFundAccountDecoder().decode(rows.fund.dataBuffer);
  const pool = T.getNormalizedTokenPoolAccountDecoder().decode(rows.normalizedPool.dataBuffer);
  const poolCompact = clean(pool);
  poolCompact.supportedTokens = poolCompact.supportedTokens.filter(row => row.mint === A.jsolMint);
  poolCompact.normalizedTokenValue.numerator = poolCompact.normalizedTokenValue.numerator.filter(row => JSON.stringify(row).includes(A.jsolMint));
  delete poolCompact.reserved;

  const stakePool = StakePoolLayout.decode(rows.jsolStakePool.dataBuffer);
  const totalLamports = BigInt(stakePool.totalLamports.toString());
  const poolTokenSupply = BigInt(stakePool.poolTokenSupply.toString());
  const exactOneJsolAsSolFloor = totalLamports * 1_000_000_000n / poolTokenSupply;
  const storedOneJsolAsSol = BigInt(poolCompact.supportedTokens[0].oneTokenAsSol);

  let pairs = null;
  try {
    const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${A.wrappedMint}`);
    pairs = (await response.json()).pairs;
  } catch (error) {
    pairs = [{captureError: String(error)}];
  }

  const klend = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'klend-zero-fee-census.json')));
  const marginfi = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'marginfi-vaults-current.json')));
  const lenders = {
    klend: klend.activeZero.filter(row => row.mint === A.jsolMint),
    project0: marginfi.rows.filter(row => row.kind === 'liquidity' && row.mint === A.jsolMint && BigInt(row.rawAmount) > 0n),
  };

  const accountEvidence = {};
  for (const [name, row] of Object.entries(rows)) {
    accountEvidence[name] = {
      address: A[name], contextSlot: row.contextSlot, owner: row.owner, executable: row.executable,
      lamports: row.lamports, dataLength: row.dataBuffer.length, dataSha256: hash(row.dataBuffer),
    };
  }
  accountEvidence.jsolReserve.tokenAmountRaw = tokenAmount(rows.jsolReserve.dataBuffer);
  accountEvidence.receiptMint.mint = mintState(rows.receiptMint.dataBuffer);
  accountEvidence.normalizedMint.mint = mintState(rows.normalizedMint.dataBuffer);

  const result = {
    observedAt: new Date().toISOString(), observationFinalizedSlot: observation,
    rpcDisclosure: 'RPC endpoint omitted; only finalized read methods were used.',
    addresses: A,
    deployedProgram: {
      programDataAddress,
      loaderOwner: rows.program.owner,
      deployedSlot: programData.dataBuffer.readBigUInt64LE(4).toString(),
      upgradeAuthority,
      programDataSha256: hash(programData.dataBuffer),
      elfOffset,
      elfLength: elf.length,
      elfSha256: hash(elf),
    },
    accountEvidence,
    fund: compactFund(fund),
    normalizedPool: poolCompact,
    jsolPricingSource: {
      address: A.jsolStakePool,
      owner: rows.jsolStakePool.owner,
      accountType: stakePool.accountType,
      totalLamports: totalLamports.toString(),
      poolTokenSupply: poolTokenSupply.toString(),
      lastUpdateEpoch: stakePool.lastUpdateEpoch.toString(),
      storedOneJsolAsSolRaw: storedOneJsolAsSol.toString(),
      exactOneJsolAsSolFloorRaw: exactOneJsolAsSolFloor.toString(),
      storedMinusExactRaw: (storedOneJsolAsSol - exactOneJsolAsSolFloor).toString(),
      manipulationClosure: 'The consumed account is SPL Stake Pool state. AMM swaps do not write it; changing it requires the SPL Stake Pool program accounting path.',
    },
    independentExitPairs: pairs,
    flashInventory: lenders,
    provenance: {
      sdkVersion: require('./sdk-3.0.2/package.json').version,
      sdkPackageIntegrity: 'See sdk-3.0.2.tgz and npm package-lock.json in this directory.',
      officialDocsCommit: fs.readFileSync(path.join(__dirname, 'official-docs-source', '.git', 'refs', 'heads', 'main'), 'utf8').trim(),
      jitoSourceCommit: fs.readFileSync(path.join(__dirname, 'jito-restaking-source', '.git', 'refs', 'heads', 'master'), 'utf8').trim(),
    },
  };
  fs.writeFileSync(path.join(__dirname, 'current-finalized-state.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({
    observationFinalizedSlot: result.observationFinalizedSlot,
    elfSha256: result.deployedProgram.elfSha256,
    upgradeAuthority: result.deployedProgram.upgradeAuthority,
    jsolReserveRaw: result.accountEvidence.jsolReserve.tokenAmountRaw,
    jsolPrice: result.jsolPricingSource,
    exitPairCount: Array.isArray(pairs) ? pairs.length : 0,
    lenders,
  }, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
