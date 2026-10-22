#!/usr/bin/env node
// Read-only current-mainnet xORCA identity, custody, history, and share-math census.
// This script uses only get* RPC methods. It never signs or submits a transaction.

const fs = require('fs');
const crypto = require('crypto');
const modules = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/';
const {
  Connection,
  PublicKey,
} = require(modules + '@solana/web3.js');
const {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} = require(modules + '@solana/spl-token');
const bs58Module = require(modules + 'bs58');
const bs58 = bs58Module.default || bs58Module;
const anchor = require(modules + '@coral-xyz/anchor');

const baseDir = __dirname;
const outputPath = `${baseDir}/orca-xorca-live-revalidation.json`;
const envPath = '/tmp/composer-helius-rpc.env';
const env = Object.fromEntries(fs.readFileSync(envPath, 'utf8')
  .split('\n').filter(Boolean).map((line) => line.split(/=(.*)/s).slice(0, 2)));
// Prefer the archival/general endpoint for address history and transaction
// batches; fall back to the heavy endpoint for methods it supports.
const rpcUrl = env.RPC_URL || env.HEAVY_RPC_URL;
if (!rpcUrl) throw new Error('Read-only RPC configuration is unavailable');
const rpcUrls = [...new Set([env.RPC_URL, env.HEAVY_RPC_URL].filter(Boolean))];

const P = (value) => new PublicKey(value);
const PROGRAM = P('StaKE6XNKVVhG8Qu9hDJBqCW3eRe7MDGLz17nJZetLT');
const ORCA_MINT = P('orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE');
const XORCA_MINT = P('xorcaYqbXUNz3474ubUMJAdu2xgPsew3rUCe5ughT3N');
const PROJECT0 = P('MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA');
const PROJECT0_ORCA_BANK = P('3Hd1VzDCd8xEzcqj6CHqqjeKdzKQPMczGnkSbpaubf3W');
const PROJECT0_ORCA_VAULT = P('9NMVNPzqSa46MvqXofFtLtbGdCx7r81Ve3JGEDahahrr');
const UPGRADEABLE_LOADER = P('BPFLoaderUpgradeab1e11111111111111111111111');
const SOURCE_COMMIT = '05fe66b67c95271cb07aa42c83b9fdfd8a39b936';
const EVIDENCE_SIGNATURE = '36Nr3rPc6i8WefZZbHXAXhNx2M3vxRxi5yUenU2xFgEhct4GhxF6yj1nUyoJ9n4boNfYq6QLK9SNKAuZsns8yDp5';
const INSTRUCTION_NAMES = ['Stake', 'Unstake', 'Withdraw', 'Initialize', 'Set'];
const connection = new Connection(rpcUrl, 'confirmed');
let rpcId = 0;

async function rpc(method, params) {
  let lastError = null;
  for (const endpoint of rpcUrls) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params}),
    });
    const body = await response.json();
    if (!body.error) return body.result;
    lastError = body.error;
  }
  throw new Error(`${method}: ${JSON.stringify(lastError)}`);
}

async function rpcBatch(calls) {
  const request = calls.map(({method, params}) => ({
    jsonrpc: '2.0', id: ++rpcId, method, params,
  }));
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify(request),
  });
  const body = await response.json();
  if (!Array.isArray(body)) throw new Error(`batch RPC returned ${JSON.stringify(body)}`);
  const byId = new Map(body.map((entry) => [entry.id, entry]));
  return request.map((entry) => {
    const reply = byId.get(entry.id);
    if (!reply) throw new Error(`batch RPC response missing id ${entry.id}`);
    if (reply.error) throw new Error(`${entry.method}: ${JSON.stringify(reply.error)}`);
    return reply.result;
  });
}

function hash(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function parseTokenAccount(data) {
  if (!data || data.length < 165) return null;
  return {
    mint: new PublicKey(data.subarray(0, 32)).toString(),
    authority: new PublicKey(data.subarray(32, 64)).toString(),
    amountRaw: data.readBigUInt64LE(64).toString(),
    state: data[108],
  };
}

function parseMint(data) {
  if (!data || data.length < 82) return null;
  const mintAuthorityFlag = data.readUInt32LE(0);
  const freezeAuthorityFlag = data.readUInt32LE(46);
  return {
    mintAuthorityFlag,
    mintAuthority: mintAuthorityFlag ? new PublicKey(data.subarray(4, 36)).toString() : null,
    supplyRaw: data.readBigUInt64LE(36).toString(),
    decimals: data[44],
    initialized: data[45] !== 0,
    freezeAuthorityFlag,
    freezeAuthority: freezeAuthorityFlag ? new PublicKey(data.subarray(50, 82)).toString() : null,
  };
}

function parseState(data) {
  if (!data || data.length < 56) return null;
  return {
    discriminator: data[0],
    bump: data[6],
    vaultBump: data[7],
    escrowedOrcaRaw: data.readBigUInt64LE(8).toString(),
    coolDownPeriodSeconds: data.readBigInt64LE(16).toString(),
    updateAuthority: new PublicKey(data.subarray(24, 56)).toString(),
    dataLength: data.length,
    dataSha256: hash(data),
  };
}

function parsePending(address, data) {
  if (!data || data.length < 56) return null;
  return {
    address,
    discriminator: data[0],
    bump: data[6],
    withdrawIndex: data[7],
    unstaker: new PublicKey(data.subarray(8, 40)).toString(),
    withdrawableOrcaRaw: data.readBigUInt64LE(40).toString(),
    withdrawableTimestamp: data.readBigInt64LE(48).toString(),
  };
}

function parseUpgradeableProgram(programData, programDataAccountData) {
  const programDiscriminant = programData.readUInt32LE(0);
  const programDataAddress = new PublicKey(programData.subarray(4, 36));
  const dataDiscriminant = programDataAccountData.readUInt32LE(0);
  const deploymentSlot = programDataAccountData.readBigUInt64LE(4);
  const hasUpgradeAuthority = programDataAccountData[12] !== 0;
  const upgradeAuthority = hasUpgradeAuthority
    ? new PublicKey(programDataAccountData.subarray(13, 45)).toString() : null;
  const elfOffset = hasUpgradeAuthority ? 45 : 13;
  const elf = programDataAccountData.subarray(elfOffset);
  return {
    programDiscriminant,
    programDataAddress: programDataAddress.toString(),
    programDataDiscriminant: dataDiscriminant,
    deploymentSlot: deploymentSlot.toString(),
    upgradeAuthority,
    programDataLength: programDataAccountData.length,
    programDataSha256: hash(programDataAccountData),
    elfOffset,
    elfLength: elf.length,
    elfSha256: hash(elf),
  };
}

function i80Raw(wrapped) {
  const bytes = Buffer.from(wrapped.value);
  let value = BigInt(`0x${Buffer.from(bytes).reverse().toString('hex')}`);
  if ((bytes[15] & 0x80) !== 0) value -= 1n << 128n;
  return value.toString();
}

function enumName(value) {
  if (!value || typeof value !== 'object') return String(value);
  return Object.keys(value)[0] || 'unknown';
}

function keysForTransaction(tx) {
  return [
    ...tx.transaction.message.accountKeys,
    ...(tx.meta?.loadedAddresses?.writable || []),
    ...(tx.meta?.loadedAddresses?.readonly || []),
  ].map(String);
}

function xorcaInstructions(tx) {
  const keys = keysForTransaction(tx);
  const rows = [];
  const inspect = (ix, parentIndex, innerIndex) => {
    if (keys[ix.programIdIndex] !== PROGRAM.toString()) return;
    const data = Buffer.from(bs58.decode(ix.data));
    rows.push({
      parentIndex,
      innerIndex,
      discriminator: data.length ? data[0] : null,
      name: data.length ? (INSTRUCTION_NAMES[data[0]] || 'Unknown') : 'Empty',
      dataHex: data.toString('hex'),
      accounts: (ix.accounts || []).map((index) => keys[index]),
    });
  };
  tx.transaction.message.instructions.forEach((ix, index) => inspect(ix, index, null));
  for (const inner of tx.meta?.innerInstructions || []) {
    inner.instructions.forEach((ix, innerIndex) => inspect(ix, inner.index, innerIndex));
  }
  return rows;
}

function vaultDelta(tx, vault) {
  const keys = keysForTransaction(tx);
  const index = keys.indexOf(vault.toString());
  if (index < 0) return null;
  const pre = (tx.meta?.preTokenBalances || []).find((row) => row.accountIndex === index);
  const post = (tx.meta?.postTokenBalances || []).find((row) => row.accountIndex === index);
  if (!pre && !post) return null;
  const preRaw = BigInt(pre?.uiTokenAmount?.amount || 0);
  const postRaw = BigInt(post?.uiTokenAmount?.amount || 0);
  return {preRaw: preRaw.toString(), postRaw: postRaw.toString(), deltaRaw: (postRaw - preRaw).toString()};
}

function summarizeTransaction(signatureRow, tx, vault) {
  if (!tx) return {signature: signatureRow.signature, unavailable: true};
  const instructions = xorcaInstructions(tx);
  return {
    signature: signatureRow.signature,
    slot: tx.slot,
    blockTime: tx.blockTime,
    err: tx.meta?.err || null,
    feeLamports: tx.meta?.fee ?? null,
    xorcaInstructions: instructions,
    vaultDelta: vaultDelta(tx, vault),
    relevantLogs: (tx.meta?.logMessages || []).filter((line) =>
      line.includes(PROGRAM.toString()) || line.includes('Instruction:')),
  };
}

async function fetchTransactions(signatureRows) {
  const output = [];
  for (let offset = 0; offset < signatureRows.length; offset += 20) {
    const batch = signatureRows.slice(offset, offset + 20);
    const results = await rpcBatch(batch.map((row) => ({
      method: 'getTransaction',
      params: [row.signature, {encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 1}],
    })));
    for (let index = 0; index < batch.length; index += 1) {
      output.push([batch[index], results[index]]);
    }
  }
  return output;
}

function shareMathRows(assetsRaw, supplyRaw, candidateAmounts) {
  const A = BigInt(assetsRaw);
  const S = BigInt(supplyRaw);
  const V = 100n;
  return candidateAmounts.map((amount) => {
    const d = BigInt(amount);
    const minted = d * (S + V) / (A + V);
    const postAssets = A + d;
    const postSupply = S + minted;
    const claim = minted * (postAssets + V) / (postSupply + V);
    return {
      stakeRaw: d.toString(),
      xorcaMintedRaw: minted.toString(),
      immediateUnstakeClaimRaw: claim.toString(),
      claimMinusStakeRaw: (claim - d).toString(),
    };
  });
}

function donationOrdering(assetsRaw, supplyRaw, stakeRaw, donationRaw) {
  const A = BigInt(assetsRaw);
  const S = BigInt(supplyRaw);
  const d = BigInt(stakeRaw);
  const y = BigInt(donationRaw);
  const V = 100n;

  const beforeMint = d * (S + V) / (A + V);
  const beforeClaim = beforeMint * (A + d + y + V) / (S + beforeMint + V);

  const afterMint = d * (S + V) / (A + y + V);
  const afterClaim = afterMint * (A + y + d + V) / (S + afterMint + V);

  return {
    stakeRaw: d.toString(),
    donationRaw: y.toString(),
    stakeBeforeDonation: {
      xorcaMintedRaw: beforeMint.toString(),
      unstakeClaimRaw: beforeClaim.toString(),
      claimMinusStakeRaw: (beforeClaim - d).toString(),
      netIfAttackerAlsoFundsDonationRaw: (beforeClaim - d - y).toString(),
    },
    donationBeforeStake: {
      xorcaMintedRaw: afterMint.toString(),
      unstakeClaimRaw: afterClaim.toString(),
      claimMinusStakeRaw: (afterClaim - d).toString(),
      netIfAttackerFundsDonationRaw: (afterClaim - d - y).toString(),
    },
  };
}

async function main() {
  const [state] = PublicKey.findProgramAddressSync([Buffer.from('state')], PROGRAM);
  const [stateDerived, stateBump] = PublicKey.findProgramAddressSync([Buffer.from('state')], PROGRAM);
  const vault = getAssociatedTokenAddressSync(ORCA_MINT, state, true, TOKEN_PROGRAM_ID);
  const [, vaultBump] = PublicKey.findProgramAddressSync(
    [state.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), ORCA_MINT.toBuffer()],
    P('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'));

  const accountKeys = [PROGRAM, state, vault, ORCA_MINT, XORCA_MINT,
    PROJECT0_ORCA_BANK, PROJECT0_ORCA_VAULT];
  const accounts = await connection.getMultipleAccountsInfoAndContext(accountKeys, 'confirmed');
  const [programInfo, stateInfo, vaultInfo, orcaMintInfo, xorcaMintInfo,
    project0BankInfo, project0VaultInfo] = accounts.value;
  if (!programInfo || !stateInfo || !vaultInfo || !orcaMintInfo || !xorcaMintInfo ||
      !project0BankInfo || !project0VaultInfo) throw new Error('one or more required accounts are missing');

  if (!programInfo.owner.equals(UPGRADEABLE_LOADER) || programInfo.data.length < 36) {
    throw new Error('program is not owned by the upgradeable loader');
  }
  const programDataAddress = new PublicKey(programInfo.data.subarray(4, 36));
  const programDataInfo = await connection.getAccountInfo(programDataAddress, 'confirmed');
  if (!programDataInfo) throw new Error('ProgramData account is unavailable');
  const deployment = parseUpgradeableProgram(programInfo.data, programDataInfo.data);

  const stateData = parseState(stateInfo.data);
  const vaultData = parseTokenAccount(vaultInfo.data);
  const orcaMintData = parseMint(orcaMintInfo.data);
  const xorcaMintData = parseMint(xorcaMintInfo.data);
  const project0VaultData = parseTokenAccount(project0VaultInfo.data);

  const idl = JSON.parse(fs.readFileSync(
    `${baseDir}/marginfi-source/fuzz/crucible/idls/marginfi_program.json`, 'utf8'));
  const bankCoder = new anchor.BorshAccountsCoder(idl);
  const project0Bank = bankCoder.decode('Bank', project0BankInfo.data);
  const project0 = {
    program: PROJECT0.toString(),
    bank: PROJECT0_ORCA_BANK.toString(),
    bankOwner: project0BankInfo.owner.toString(),
    group: project0Bank.group.toString(),
    mint: project0Bank.mint.toString(),
    liquidityVault: project0Bank.liquidity_vault.toString(),
    derivedLiquidityVaultAuthority: PublicKey.findProgramAddressSync(
      [Buffer.from('liquidity_vault_auth'), PROJECT0_ORCA_BANK.toBuffer()], PROJECT0)[0].toString(),
    operationalState: enumName(project0Bank.config.operational_state),
    oracleSetup: enumName(project0Bank.config.oracle_setup),
    oracleKeys: project0Bank.config.oracle_keys.map(String),
    originationFeeI80F48Raw: i80Raw(project0Bank.config.interest_rate_config.protocol_origination_fee),
    fixedPriceI80F48Raw: i80Raw(project0Bank.config.fixed_price),
    liquidityVaultAccount: project0VaultData,
    bankDataSha256: hash(project0BankInfo.data),
  };

  const pendingRpc = await rpc('getProgramAccounts', [PROGRAM.toString(), {
    encoding: 'base64',
    commitment: 'confirmed',
    withContext: true,
    filters: [{dataSize: 1024}],
  }]);
  const pendingRowsRaw = pendingRpc.value || pendingRpc;
  const pendingRows = pendingRowsRaw.map((row) => parsePending(
    row.pubkey, Buffer.from(row.account.data[0], 'base64'))).filter(Boolean);
  const pendingTotal = pendingRows.reduce((sum, row) => sum + BigInt(row.withdrawableOrcaRaw), 0n);
  const now = BigInt(Math.floor(Date.now() / 1000));

  const programSignatures = await rpc('getSignaturesForAddress', [PROGRAM.toString(), {
    commitment: 'confirmed', limit: 100,
  }]);
  const programTransactions = await fetchTransactions(programSignatures.filter((row) => !row.err));
  const programHistory = programTransactions.map(([row, tx]) => summarizeTransaction(row, tx, vault));
  const samplesByInstruction = {};
  for (const row of programHistory) {
    for (const instruction of row.xorcaInstructions || []) {
      if (!samplesByInstruction[instruction.name]) samplesByInstruction[instruction.name] = row;
    }
  }

  const vaultSignatures = await rpc('getSignaturesForAddress', [vault.toString(), {
    commitment: 'confirmed', limit: 100,
  }]);
  const vaultTransactions = await fetchTransactions(vaultSignatures.filter((row) => !row.err));
  const vaultHistory = vaultTransactions.map(([row, tx]) => summarizeTransaction(row, tx, vault));
  const directPositiveVaultChanges = vaultHistory.filter((row) => {
    const delta = BigInt(row.vaultDelta?.deltaRaw || 0);
    const hasStake = (row.xorcaInstructions || []).some((ix) => ix.name === 'Stake');
    return delta > 0n && !hasStake;
  });

  const evidenceTx = await rpc('getTransaction', [EVIDENCE_SIGNATURE, {
    encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 1,
  }]);
  const evidence = summarizeTransaction({signature: EVIDENCE_SIGNATURE}, evidenceTx, vault);

  const vaultAmount = BigInt(vaultData.amountRaw);
  const escrowed = BigInt(stateData.escrowedOrcaRaw);
  const nonEscrowed = vaultAmount - escrowed;
  const supply = BigInt(xorcaMintData.supplyRaw);
  const project0Available = BigInt(project0VaultData.amountRaw);
  const amountCandidates = [...new Set([
    1n, 2n, 10n, 100n, 1_000_000n,
    project0Available > 1n ? project0Available - 1n : 1n,
    project0Available,
  ].map(String))].map(BigInt);
  const donationCandidate = directPositiveVaultChanges.length
    ? BigInt(directPositiveVaultChanges[0].vaultDelta.deltaRaw) : project0Available;

  const output = {
    generatedAt: new Date().toISOString(),
    safety: 'Read-only get* RPC methods only; no transaction was signed or submitted.',
    contextSlot: accounts.context.slot,
    identities: {
      program: PROGRAM.toString(),
      programExecutable: programInfo.executable,
      programOwner: programInfo.owner.toString(),
      state: state.toString(),
      stateExpected: 'CSqKhyW1cpdyjheAx5HXx4ibcnYrzpL5JywEMAkZixBK',
      stateMatchesExpected: state.toString() === 'CSqKhyW1cpdyjheAx5HXx4ibcnYrzpL5JywEMAkZixBK',
      stateBump,
      stateDerivedTwiceMatches: state.equals(stateDerived),
      vault: vault.toString(),
      vaultExpected: 'Ce5j11WAsSzM3nkzrw4Kw6v6ic3nbyqpv5eywjYKeKc5',
      vaultMatchesExpected: vault.toString() === 'Ce5j11WAsSzM3nkzrw4Kw6v6ic3nbyqpv5eywjYKeKc5',
      vaultBump,
      orcaMint: ORCA_MINT.toString(),
      xorcaMint: XORCA_MINT.toString(),
    },
    deployment,
    source: {
      officialRepositoryCommit: SOURCE_COMMIT,
      declaredProgramIdMatches: true,
      instructionDiscriminators: Object.fromEntries(INSTRUCTION_NAMES.map((name, index) => [name, index])),
      stateLayoutBytes: 2048,
      pendingWithdrawLayoutBytes: 1024,
      virtualOrcaRaw: '100',
      virtualXorcaRaw: '100',
    },
    currentAccounts: {
      state: stateData,
      vault: {...vaultData, dataSha256: hash(vaultInfo.data)},
      orcaMint: {...orcaMintData, dataSha256: hash(orcaMintInfo.data)},
      xorcaMint: {...xorcaMintData, dataSha256: hash(xorcaMintInfo.data)},
      nonEscrowedOrcaRaw: nonEscrowed.toString(),
      pendingWithdrawCount: pendingRows.length,
      pendingWithdrawTotalRaw: pendingTotal.toString(),
      escrowEqualsPendingTotal: pendingTotal === escrowed,
      maturedPendingCount: pendingRows.filter((row) => BigInt(row.withdrawableTimestamp) <= now).length,
      pendingWithdraws: pendingRows,
    },
    project0,
    shareMath: {
      formula: 'floor(amount * (supply + 100) / (nonEscrowedVault + 100)) in both directions',
      rows: shareMathRows(nonEscrowed, supply, amountCandidates),
      donationOrdering: donationOrdering(nonEscrowed, supply,
        project0Available > 0n ? project0Available : 1n, donationCandidate),
    },
    history: {
      programSignaturesChecked: programSignatures.length,
      vaultSignaturesChecked: vaultSignatures.length,
      samplesByInstruction,
      directPositiveVaultChanges,
      evidenceOutflow: evidence,
    },
  };

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify({
    outputPath,
    contextSlot: output.contextSlot,
    identities: output.identities,
    deployment: output.deployment,
    state: output.currentAccounts.state,
    vault: output.currentAccounts.vault,
    xorcaMint: output.currentAccounts.xorcaMint,
    pendingWithdrawCount: output.currentAccounts.pendingWithdrawCount,
    pendingWithdrawTotalRaw: output.currentAccounts.pendingWithdrawTotalRaw,
    project0: output.project0,
    shareMathRows: output.shareMath.rows,
    directPositiveVaultChanges: output.history.directPositiveVaultChanges.map((row) => ({
      signature: row.signature, slot: row.slot, blockTime: row.blockTime, vaultDelta: row.vaultDelta,
    })),
    evidenceOutflow: output.history.evidenceOutflow,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
