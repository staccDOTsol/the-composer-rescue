#!/usr/bin/env node
'use strict';

// Read-only expansion census for bridge families with enumerable on-chain state.
// This script never constructs, signs, or submits a transaction.
const fs = require('fs');
const crypto = require('crypto');
const {
  PublicKey,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const bs58 = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');

const RPC = process.env.SOLANA_RPC;
if (!RPC) throw new Error('SOLANA_RPC is required');
const OUT = process.argv[2] || 'bridge-expansion-custody.json';
const UPGRADEABLE = 'BPFLoaderUpgradeab1e11111111111111111111111';

const PROGRAMS = {
  layerZeroEndpoint: '76y77prsiCMvXMjuoZ5VRrhG5qYBrUMYTE5WgHqgjEn6',
  layerZeroOft: 'HRPXLCqspQocTjfcX4rvAPaY9q6Gwb1rrD3xXWrfJWdW',
  nttJitoSampleManager: 'WZLm4bJU4BNVmzWEwEzGVMQ5XFUc4iBmMSLutFbr41f',
  debridgeGate: 'DEbrdGj3HsRsAzx6uH4MKyREKxVAfBydijLUF3ygsFfh',
  debridgeSettings: 'DeSetTwWhjZq6Pz9Kfdo1KoS5NqtsM6G8ERbX4SSCSft',
  dlnSource: 'src5qyZHqTqecJV4aY6Cb6zDZLMDzrDKKezs22MPHr4',
  dlnDestination: 'dst5MGcFPoBeREFAA5E3tU5ij8m5uVYwkzkSAbsLbNo',
  dlnExecutor: 'exe59FS5cojZkPJVDFDV8RnXCC7wd6yoBjsUtqH7Zai',
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let rpcId = 1;
async function rpc(method, params, retries = 8) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const response = await fetch(RPC, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({jsonrpc: '2.0', id: rpcId++, method, params}),
    });
    if ((response.status === 429 || response.status >= 500) && attempt < retries) {
      await sleep(750 * (attempt + 1));
      continue;
    }
    const json = await response.json();
    if (json.error) throw new Error(`${method}: ${JSON.stringify(json.error)}`);
    return json.result;
  }
}

function pubkey(data, offset) {
  return new PublicKey(data.subarray(offset, offset + 32)).toBase58();
}
function u64(data, offset) {
  return data.readBigUInt64LE(offset);
}
function discriminator(name) {
  return crypto.createHash('sha256').update(`account:${name}`).digest().subarray(0, 8);
}
function decodeMint(data) {
  if (data.length < 82) return null;
  return {
    mintAuthority: data.readUInt32LE(0) === 1 ? pubkey(data, 4) : null,
    supplyRaw: u64(data, 36).toString(),
    decimals: data[44],
    freezeAuthority: data.readUInt32LE(46) === 1 ? pubkey(data, 50) : null,
  };
}
function decodeTokenAccount(data) {
  if (data.length < 72) return null;
  return {mint: pubkey(data, 0), authority: pubkey(data, 32), amountRaw: u64(data, 64).toString()};
}
function uiAmount(raw, decimals) {
  return Number(raw) / (10 ** decimals);
}

async function accountInfo(address) {
  const result = await rpc('getAccountInfo', [address, {encoding: 'base64', commitment: 'confirmed'}]);
  if (!result.value) return null;
  return {...result.value, dataBuffer: Buffer.from(result.value.data[0], 'base64')};
}

async function programAccounts(program, filters = [], dataSlice) {
  const config = {encoding: 'base64', commitment: 'confirmed', filters};
  if (dataSlice) config.dataSlice = dataSlice;
  return rpc('getProgramAccounts', [program, config]);
}

async function programMetadata(program) {
  const account = await accountInfo(program);
  if (!account) return {exists: false};
  const base = {exists: true, executable: account.executable, owner: account.owner, lamports: account.lamports};
  const data = account.dataBuffer;
  if (account.owner !== UPGRADEABLE || data.length < 36 || data.readUInt32LE(0) !== 2) return base;
  const programData = pubkey(data, 4);
  const pda = await accountInfo(programData);
  if (!pda) return {...base, programData, programDataMissing: true};
  const pd = pda.dataBuffer;
  const hasAuthority = pd.readUInt32LE(12) === 1;
  const elfOffset = hasAuthority ? 48 : 16;
  return {
    ...base,
    programData,
    lastDeployedSlot: Number(pd.readBigUInt64LE(4)),
    upgradeAuthority: hasAuthority ? pubkey(pd, 16) : null,
    elfSha256: crypto.createHash('sha256').update(pd.subarray(elfOffset)).digest('hex'),
  };
}

async function exactProgramCount(program) {
  const rows = await programAccounts(program, [], {offset: 0, length: 0});
  return rows.length;
}

async function priceMints(mints) {
  const unique = [...new Set(mints)];
  const prices = {};
  for (let offset = 0; offset < unique.length; offset += 100) {
    const ids = unique.slice(offset, offset + 100).map((mint) => `solana:${mint}`).join(',');
    const response = await fetch(`https://coins.llama.fi/prices/current/${ids}`);
    if (response.ok) Object.assign(prices, (await response.json()).coins || {});
  }
  return {prices, unique};
}

async function scanLayerZeroOft() {
  const program = PROGRAMS.layerZeroOft;
  const rows = await programAccounts(program, [{memcmp: {offset: 0, bytes: bs58.encode(discriminator('OftConfig'))}}]);
  const configs = [];
  const referenced = new Set();
  for (const row of rows) {
    const data = Buffer.from(row.account.data[0], 'base64');
    const extTag = data[145];
    const config = {
      state: row.pubkey,
      ld2sdRate: u64(data, 8).toString(),
      mint: pubkey(data, 16),
      tokenProgram: pubkey(data, 48),
      endpointProgram: pubkey(data, 80),
      bump: data[112],
      admin: pubkey(data, 113),
      kind: extTag === 0 ? 'native-burn-mint' : extTag === 1 ? 'adapter-lock-release' : `unknown-${extTag}`,
    };
    if (extTag === 0) {
      config.externalMintAuthorityOption = data[146];
      config.externalMintAuthority = data[146] === 1 ? pubkey(data, 147) : null;
    } else if (extTag === 1) {
      config.escrow = pubkey(data, 146);
      referenced.add(config.escrow);
    }
    referenced.add(config.mint);
    configs.push(config);
  }
  const accounts = new Map();
  const keys = [...referenced];
  for (let offset = 0; offset < keys.length; offset += 100) {
    const batch = keys.slice(offset, offset + 100);
    const result = await rpc('getMultipleAccounts', [batch, {encoding: 'base64', commitment: 'confirmed'}]);
    batch.forEach((key, index) => accounts.set(key, result.value[index]));
    await sleep(100);
  }
  for (const config of configs) {
    const mintAccount = accounts.get(config.mint);
    if (mintAccount) {
      config.mintInfo = decodeMint(Buffer.from(mintAccount.data[0], 'base64'));
      config.supplyUi = uiAmount(BigInt(config.mintInfo.supplyRaw), config.mintInfo.decimals);
      config.stateIsMintAuthority = config.mintInfo.mintAuthority === config.state;
    }
    if (config.escrow) {
      const escrowAccount = accounts.get(config.escrow);
      if (escrowAccount) {
        config.escrowInfo = decodeTokenAccount(Buffer.from(escrowAccount.data[0], 'base64'));
        config.escrowAuthorityMatches = config.escrowInfo?.authority === config.state;
        config.escrowAmountUi = config.mintInfo && config.escrowInfo ? uiAmount(BigInt(config.escrowInfo.amountRaw), config.mintInfo.decimals) : null;
      } else config.escrowMissing = true;
    }
  }
  const {prices, unique} = await priceMints(configs.map((row) => row.mint));
  for (const config of configs) {
    config.priceUsd = prices[`solana:${config.mint}`]?.price ?? null;
    if (config.priceUsd != null) {
      if (config.kind === 'adapter-lock-release' && config.escrowAmountUi != null) config.lockedValueUsd = config.escrowAmountUi * config.priceUsd;
      if (config.kind === 'native-burn-mint' && config.supplyUi != null) config.mintRiskSupplyValueUsd = config.supplyUi * config.priceUsd;
    }
  }
  return {
    program,
    exactOftConfigCount: configs.length,
    exactAdapterCount: configs.filter((row) => row.kind === 'adapter-lock-release').length,
    exactNativeCount: configs.filter((row) => row.kind === 'native-burn-mint').length,
    priceCoverage: {distinctMints: unique.length, pricedMints: unique.filter((mint) => prices[`solana:${mint}`]).length},
    configs,
  };
}

async function scanNttSample() {
  const manager = PROGRAMS.nttJitoSampleManager;
  const [configAddress] = PublicKey.findProgramAddressSync([Buffer.from('config')], new PublicKey(manager));
  const account = await accountInfo(configAddress.toBase58());
  const result = {
    status: 'documented SDK sample only; no canonical NTT manager registry exists',
    manager,
    config: configAddress.toBase58(),
    exists: !!account,
  };
  if (!account) return result;
  const data = account.dataBuffer;
  let cursor = 8;
  result.bump = data[cursor++];
  result.owner = pubkey(data, cursor); cursor += 32;
  const pendingTag = data[cursor++];
  result.pendingOwner = pendingTag === 1 ? pubkey(data, cursor) : null;
  if (pendingTag === 1) cursor += 32;
  result.mint = pubkey(data, cursor); cursor += 32;
  result.tokenProgram = pubkey(data, cursor); cursor += 32;
  result.mode = data[cursor++] === 0 ? 'locking' : 'burning';
  result.chainId = data.readUInt16LE(cursor); cursor += 2;
  result.nextTransceiverId = data[cursor++];
  result.threshold = data[cursor++];
  result.enabledTransceiversHex = data.subarray(cursor, cursor + 16).toString('hex'); cursor += 16;
  result.paused = !!data[cursor++];
  result.custody = pubkey(data, cursor);

  const [mintAccount, custodyAccount] = await Promise.all([accountInfo(result.mint), accountInfo(result.custody)]);
  if (mintAccount) {
    result.mintInfo = decodeMint(mintAccount.dataBuffer);
    result.supplyUi = uiAmount(BigInt(result.mintInfo.supplyRaw), result.mintInfo.decimals);
  }
  if (custodyAccount) {
    result.custodyInfo = decodeTokenAccount(custodyAccount.dataBuffer);
    result.custodyAmountUi = result.mintInfo ? uiAmount(BigInt(result.custodyInfo.amountRaw), result.mintInfo.decimals) : null;
  }
  const {prices} = await priceMints([result.mint]);
  result.priceUsd = prices[`solana:${result.mint}`]?.price ?? null;
  if (result.priceUsd != null && result.custodyAmountUi != null) result.lockedValueUsd = result.custodyAmountUi * result.priceUsd;
  if (result.priceUsd != null && result.supplyUi != null) result.mintRiskSupplyValueUsd = result.supplyUi * result.priceUsd;
  return result;
}

async function scanPrograms() {
  const output = {};
  for (const [name, program] of Object.entries(PROGRAMS)) {
    try {
      output[name] = {program, exactProgramAccountCount: await exactProgramCount(program), metadata: await programMetadata(program)};
    } catch (error) {
      output[name] = {program, error: String(error)};
      try { output[name].metadata = await programMetadata(program); } catch (metaError) { output[name].metadataError = String(metaError); }
    }
    await sleep(150);
  }
  return output;
}

async function main() {
  const report = {
    generatedAt: new Date().toISOString(),
    slot: await rpc('getSlot', [{commitment: 'confirmed'}]),
    rpcReadsOnly: true,
    scopeNotes: {
      layerZero: 'Exact denominator for OftConfig accounts under the canonical Solana OFT program.',
      ntt: 'One manager explicitly published in the official SDK sample; not a global denominator because NTT has no canonical manager registry.',
      debridge: 'Exact program-owned account counts, not exact active order-wallet custody: GiveOrderState omits orderId, so its per-order wallet PDA cannot be inverted without a complete event/transaction index.',
    },
  };
  report.layerZeroOft = await scanLayerZeroOft();
  report.nttJitoSample = await scanNttSample();
  report.programs = await scanPrograms();
  fs.writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    out: OUT,
    slot: report.slot,
    layerZeroOft: {
      exact: report.layerZeroOft.exactOftConfigCount,
      adapter: report.layerZeroOft.exactAdapterCount,
      native: report.layerZeroOft.exactNativeCount,
    },
    nttSample: {exists: report.nttJitoSample.exists, mode: report.nttJitoSample.mode},
    programCounts: Object.fromEntries(Object.entries(report.programs).map(([name, row]) => [name, row.exactProgramAccountCount ?? row.error])),
  }, null, 2));
}

main().catch((error) => { console.error(error.stack || error); process.exit(1); });
