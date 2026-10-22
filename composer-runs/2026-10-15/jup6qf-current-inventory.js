#!/usr/bin/env node
'use strict';

// Read-only inventory and successful value-flow tracing for the isolated
// Jupiter Lend Ethena liquidity deployment. This script has no send RPC path.
const fs = require('fs');
const crypto = require('crypto');
const {
  Connection,
  PublicKey,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const anchor = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@coral-xyz/anchor');
const bs58Module = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const bs58 = bs58Module.default || bs58Module;

const DIR = __dirname;
const OUT = `${DIR}/jup6qf-current-inventory.json`;
const IDL_PATH = `${DIR}/jup6qf-onchain-idl.json`;
const BINARY_PATH = `${DIR}/jup6qf-current.so`;
const PROGRAM = new PublicKey('jup6QF1sNDGpkkcu6F4qaFHcRBmnSS1VgyB4uFbBvNS');
const PROGRAM_DATA = new PublicKey('3pCmHYrm5vyitCA1xQmgCm86V7ZgKNX17XXgcCohbvTo');
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const MINTS = {
  USDG: '2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH',
  PYUSD: '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo',
  USDe: 'DEkqHyPN7GMRJ5cArtQFAWefqbZb33Hyf6s5iCwjEonT',
  JupUSD: 'JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD',
  WSOL: 'So11111111111111111111111111111111111111112',
};
const KNOWN_ETHENA_PROGRAMS = {
  vaults: 'jupo974WCqAUMD3RtpayTap1me7StQCWtEkBbDb6Ba3',
  liquidity: PROGRAM.toBase58(),
  lending: 'jup97Zx1NixM8UJMQFw8TtKzqTiRT3ETAJR7cVx3PfQ',
  flashloan: 'jupKxkab7RTnQJ6wXStXg6WY4rcReV3maiUNwByciFF',
  lendingRewardRateModel: 'jupGBUJYXuzz2hVSoqjrxoEwJUB6uuHJsQqkzmYyQ7n',
  dex: 'jupZ4m2GqUCJ5iueMfzQf8khFfH31d4XAQt3RzCT9Vd',
};

const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env', 'utf8')
  .split(/\r?\n/).filter((line) => line.includes('='))
  .map((line) => line.split(/=(.*)/s).slice(0, 2)));
const RPC_URL = env.RPC_URL;
if (!RPC_URL) throw new Error('RPC_URL unavailable');
const connection = new Connection(RPC_URL, 'confirmed');
let rpcId = 0;

async function rpc(method, params) {
  let last;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const response = await fetch(RPC_URL, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params}),
      });
      if (response.status === 429 || response.status >= 500) throw new Error(`HTTP ${response.status}`);
      const body = await response.json();
      if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
      return body.result;
    } catch (error) {
      last = error;
      if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    }
  }
  throw last;
}

function json(value) {
  if (typeof value === 'bigint') return value.toString();
  if (value && typeof value.toBase58 === 'function') return value.toBase58();
  if (value && value.constructor?.name === 'BN') return value.toString(10);
  if (Buffer.isBuffer(value)) return value.toString('base64');
  if (Array.isArray(value)) return value.map(json);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, json(item)]));
  }
  return value;
}

function pk(bytes, offset) {
  return new PublicKey(bytes.subarray(offset, offset + 32)).toBase58();
}

function programMetadata(programDataBytes) {
  if (programDataBytes.readUInt32LE(0) !== 3) throw new Error('unexpected ProgramData tag');
  const hasAuthority = programDataBytes[12] === 1;
  const elfOffset = hasAuthority ? 45 : 13;
  return {
    programId: PROGRAM.toBase58(),
    programData: PROGRAM_DATA.toBase58(),
    upgradeSlot: Number(programDataBytes.readBigUInt64LE(4)),
    upgradeAuthority: hasAuthority ? pk(programDataBytes, 13) : null,
    programDataLength: programDataBytes.length,
    elfLength: programDataBytes.length - elfOffset,
    elfSha256: crypto.createHash('sha256').update(programDataBytes.subarray(elfOffset)).digest('hex'),
    dumpedBinarySha256: crypto.createHash('sha256').update(fs.readFileSync(BINARY_PATH)).digest('hex'),
  };
}

function derive(seed, ...pubkeys) {
  const [address, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from(seed), ...pubkeys.map((value) => new PublicKey(value).toBuffer())],
    PROGRAM,
  );
  return {address: address.toBase58(), bump};
}

function tokenAccount(data, owner) {
  if (data.length < 72 || (owner !== TOKEN && owner !== TOKEN_2022)) return null;
  return {
    mint: pk(data, 0),
    authority: pk(data, 32),
    rawAmount: data.readBigUInt64LE(64).toString(),
    tokenProgram: owner,
  };
}

function instructionMap(idl) {
  return new Map(idl.instructions.map((ix) => [Buffer.from(ix.discriminator).toString('hex'), ix]));
}

function compactProgramInstruction(ix, idlInstructions) {
  if (ix.programId !== PROGRAM.toBase58() || !ix.data) return null;
  let data;
  try { data = Buffer.from(bs58.decode(ix.data)); } catch { return null; }
  const spec = idlInstructions.get(data.subarray(0, 8).toString('hex'));
  return {
    name: spec?.name || 'unknown',
    discriminator: data.subarray(0, 8).toString('hex'),
    dataBase58: ix.data,
    accounts: (ix.accounts || []).map((address, index) => ({
      index,
      name: spec?.accounts?.[index]?.name || `remaining_${index - (spec?.accounts?.length || 0)}`,
      address,
    })),
  };
}

function valueFlows(transaction, vaults) {
  const top = transaction.transaction?.message?.instructions || [];
  const inner = transaction.meta?.innerInstructions || [];
  const flows = [];
  for (const group of inner) {
    for (const ix of group.instructions || []) {
      const parsed = ix.parsed;
      if (!parsed || !['transfer', 'transferChecked'].includes(parsed.type)) continue;
      const info = parsed.info || {};
      if (!vaults.has(info.source) && !vaults.has(info.destination)) continue;
      flows.push({
        parentIndex: group.index,
        parentProgramId: top[group.index]?.programId || null,
        tokenProgramId: ix.programId,
        type: parsed.type,
        source: info.source,
        destination: info.destination,
        authority: info.authority || null,
        mint: info.mint || null,
        rawAmount: info.amount || info.tokenAmount?.amount || null,
        direction: vaults.has(info.source) ? 'out' : 'in',
      });
    }
  }
  return flows;
}

async function findValueControls(vaultRows, idlInstructions) {
  const vaults = new Set(vaultRows.map((row) => row.vault));
  const bySignature = new Map();
  for (const row of vaultRows) {
    let before;
    for (let page = 0; page < 3; page += 1) {
      const signatures = await rpc('getSignaturesForAddress', [row.vault, {
        limit: 100,
        commitment: 'confirmed',
        ...(before ? {before} : {}),
      }]);
      for (const item of signatures) if (!item.err) bySignature.set(item.signature, item);
      if (signatures.length < 100) break;
      before = signatures.at(-1).signature;
    }
  }
  const controls = [];
  const signatures = [...bySignature.keys()];
  for (let offset = 0; offset < signatures.length; offset += 12) {
    const batch = signatures.slice(offset, offset + 12);
    const txs = await Promise.all(batch.map((signature) => rpc('getTransaction', [signature, {
      encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 1,
    }])));
    for (let i = 0; i < txs.length; i += 1) {
      const tx = txs[i];
      if (!tx || tx.meta?.err) continue;
      const flows = valueFlows(tx, vaults);
      if (!flows.length) continue;
      const top = tx.transaction.message.instructions || [];
      const programInstructions = [];
      top.forEach((ix, index) => {
        const parsed = compactProgramInstruction(ix, idlInstructions);
        if (parsed) programInstructions.push({stack: 'top', parentIndex: index, ...parsed});
      });
      for (const group of tx.meta.innerInstructions || []) {
        for (const ix of group.instructions || []) {
          const parsed = compactProgramInstruction(ix, idlInstructions);
          if (parsed) programInstructions.push({stack: 'inner', parentIndex: group.index, ...parsed});
        }
      }
      if (!programInstructions.length) continue;
      controls.push({
        signature: batch[i],
        slot: tx.slot,
        blockTime: tx.blockTime,
        topLevelPrograms: top.map((ix) => ix.programId),
        programInstructions,
        flows,
        logEvidence: (tx.meta.logMessages || []).filter((line) =>
          line.includes('Instruction:') || line.includes(PROGRAM.toBase58()) || line.includes('failed')),
      });
    }
    const haveOutgoingMints = new Set(controls.flatMap((row) => row.flows)
      .filter((flow) => flow.direction === 'out').map((flow) => flow.mint));
    if (Object.values(MINTS).every((mint) => haveOutgoingMints.has(mint))) break;
  }
  controls.sort((a, b) => b.slot - a.slot);
  const selected = [];
  for (const mint of Object.values(MINTS)) {
    const incoming = controls.find((row) => row.flows.some((flow) => flow.mint === mint && flow.direction === 'in'));
    const outgoing = controls.find((row) => row.flows.some((flow) => flow.mint === mint && flow.direction === 'out'));
    for (const candidate of [incoming, outgoing]) {
      if (candidate && !selected.some((row) => row.signature === candidate.signature)) selected.push(candidate);
    }
  }
  return {successfulTransactionsInspected: controls.length, selected};
}

async function main() {
  const idl = JSON.parse(fs.readFileSync(IDL_PATH, 'utf8'));
  idl.address = PROGRAM.toBase58();
  const coder = new anchor.BorshAccountsCoder(idl);
  const accountSpecs = new Map(idl.accounts.map((account) => [Buffer.from(account.discriminator).toString('hex'), account.name]));
  const idlInstructions = instructionMap(idl);

  const [slot, blockTime, programDataInfo, programAccounts] = await Promise.all([
    connection.getSlot('confirmed'),
    connection.getSlot('confirmed').then((value) => connection.getBlockTime(value)),
    connection.getAccountInfo(PROGRAM_DATA, 'confirmed'),
    connection.getProgramAccounts(PROGRAM, {commitment: 'confirmed'}),
  ]);
  if (!programDataInfo) throw new Error('ProgramData unavailable');

  const decodedAccounts = [];
  for (const row of programAccounts) {
    const discriminator = row.account.data.subarray(0, 8).toString('hex');
    const accountName = accountSpecs.get(discriminator);
    let decoded = null;
    let decodeError = null;
    if (accountName) {
      try { decoded = json(coder.decode(accountName, row.account.data)); }
      catch (error) { decodeError = String(error.message || error); }
    }
    decodedAccounts.push({
      address: row.pubkey.toBase58(),
      lamports: row.account.lamports,
      dataLength: row.account.data.length,
      dataSha256: crypto.createHash('sha256').update(row.account.data).digest('hex'),
      discriminator,
      accountName: accountName || null,
      decoded,
      decodeError,
    });
  }

  const liquidityPda = derive('liquidity');
  const authListPda = derive('auth_list');
  const vaultRows = [];
  for (const [symbol, mint] of Object.entries(MINTS)) {
    const reserve = derive('reserve', mint);
    const rateModel = derive('rate_model', mint);
    const reserveAccount = decodedAccounts.find((row) => row.address === reserve.address);
    if (!reserveAccount?.decoded?.vault) throw new Error(`reserve missing for ${symbol}`);
    const vault = reserveAccount.decoded.vault;
    const vaultInfo = await connection.getAccountInfo(new PublicKey(vault), 'confirmed');
    if (!vaultInfo) throw new Error(`vault unavailable for ${symbol}`);
    const token = tokenAccount(vaultInfo.data, vaultInfo.owner.toBase58());
    vaultRows.push({
      symbol,
      mint,
      reserve: reserve.address,
      reserveBump: reserve.bump,
      rateModel: rateModel.address,
      rateModelBump: rateModel.bump,
      vault,
      vaultAccount: token,
      vaultMatchesReserve: vault === reserveAccount.decoded.vault,
      mintMatchesReserve: mint === reserveAccount.decoded.mint,
      authorityMatchesLiquidityPda: token?.authority === liquidityPda.address,
      reserveState: reserveAccount.decoded,
      rateModelState: decodedAccounts.find((row) => row.address === rateModel.address)?.decoded || null,
    });
  }

  const controls = await findValueControls(vaultRows, idlInstructions);
  const positionRows = decodedAccounts.filter((row) =>
    row.accountName === 'UserSupplyPosition' || row.accountName === 'UserBorrowPosition');
  const protocolAddresses = [...new Set(positionRows.map((row) => row.decoded?.protocol).filter(Boolean))];
  const protocolInfos = await connection.getMultipleAccountsInfo(
    protocolAddresses.map((address) => new PublicKey(address)), 'confirmed');
  const protocolBindings = protocolAddresses.map((address, index) => {
    const info = protocolInfos[index];
    return {
      protocol: address,
      exists: Boolean(info),
      ownerProgram: info?.owner?.toBase58() || null,
      executable: info?.executable || false,
      dataLength: info?.data?.length || 0,
      supplyPositions: positionRows.filter((row) =>
        row.accountName === 'UserSupplyPosition' && row.decoded?.protocol === address)
        .map((row) => ({address: row.address, mint: row.decoded.mint, state: row.decoded})),
      borrowPositions: positionRows.filter((row) =>
        row.accountName === 'UserBorrowPosition' && row.decoded?.protocol === address)
        .map((row) => ({address: row.address, mint: row.decoded.mint, state: row.decoded})),
    };
  });
  const output = {
    generatedAt: new Date().toISOString(),
    observation: {slot, blockTime},
    rpcReadsAndSimulationsOnly: true,
    submittedTransactions: 0,
    program: programMetadata(programDataInfo.data),
    marketIdentity: {
      label: 'Jupiter Lend isolated Ethena market',
      knownPrograms: KNOWN_ETHENA_PROGRAMS,
      officialSdkPackage: '@jup-ag/lend@0.4.0',
      officialSdkLiquidityBindingMatches: KNOWN_ETHENA_PROGRAMS.liquidity === PROGRAM.toBase58(),
    },
    derivations: {
      liquidity: {...liquidityPda, expected: '6GjquP3CKxb9G6RDsDsbMRjvomhzzeDq9twa9mS8AumL', matches: liquidityPda.address === '6GjquP3CKxb9G6RDsDsbMRjvomhzzeDq9twa9mS8AumL'},
      authorizationList: authListPda,
    },
    decodedProgramAccountCount: decodedAccounts.length,
    decodedProgramAccounts: decodedAccounts,
    protocolBindings,
    reserves: vaultRows,
    successfulValueControls: controls,
  };
  fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({
    output: OUT,
    observation: output.observation,
    program: output.program,
    derivations: output.derivations,
    accountTypeCounts: Object.fromEntries([...new Set(decodedAccounts.map((row) => row.accountName || 'unknown'))]
      .map((name) => [name, decodedAccounts.filter((row) => (row.accountName || 'unknown') === name).length])),
    reserves: vaultRows.map((row) => ({symbol: row.symbol, mint: row.mint, reserve: row.reserve, vault: row.vault, rawAmount: row.vaultAccount.rawAmount, state: row.reserveState})),
    controls: controls.selected.map((row) => ({signature: row.signature, slot: row.slot, topLevelPrograms: row.topLevelPrograms, instructions: row.programInstructions.map((ix) => ix.name), flows: row.flows})),
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
