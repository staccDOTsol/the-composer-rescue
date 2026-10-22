#!/usr/bin/env node
'use strict';

// Read-only mainnet-beta receipt reconstruction for SPL Single Pool.
// This script lists and fetches confirmed/finalized transactions only. It does
// not construct, sign, simulate, or submit any transaction, and it never emits
// the configured RPC URL.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const bs58mod = require('/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/onre-harness/node_modules/bs58');
const {PublicKey} = require('/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/onre-harness/node_modules/@solana/web3.js');

const bs58 = bs58mod.default || bs58mod;
const PROGRAM = 'SVSPxpvHdN29nkVg9rPapPNDddN5DipNLRUFhyjFThE';
const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const DEPLOYED_SLOT = 408388782;
const OUT = process.argv[2] || path.join(__dirname, 'svsp-postdeploy-withdrawal-receipt.json');
const RPC_URL = process.env.SOLANA_RPC || process.env.RPC_URL || process.env.RPC;
if (!RPC_URL) throw new Error('SOLANA_RPC, RPC_URL, or RPC must be configured');

let id = 0;
const calls = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function rpc(method, params, retries = 6) {
  let last;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const response = await fetch(RPC_URL, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({jsonrpc: '2.0', id: ++id, method, params}),
        signal: AbortSignal.timeout(120_000),
      });
      const body = await response.json();
      if (!response.ok || body.error) {
        throw new Error(`${method}: HTTP ${response.status}: ${JSON.stringify(body.error || body).slice(0, 400)}`);
      }
      calls.push({method, ok: true});
      return body.result;
    } catch (error) {
      last = error;
      if (attempt + 1 < retries) await sleep(350 * (2 ** attempt));
    }
  }
  calls.push({method, ok: false, error: String(last?.message || last)});
  throw last;
}

function decodeWithdrawData(data58) {
  let data;
  try { data = Buffer.from(bs58.decode(data58)); } catch { return null; }
  // Borsh enum discriminant 3, then Pubkey and u64 token amount.
  if (data.length !== 41 || data[0] !== 3) return null;
  return {
    discriminant: data[0],
    dataLength: data.length,
    dataSha256: crypto.createHash('sha256').update(data).digest('hex'),
    userStakeAuthority: new PublicKey(data.subarray(1, 33)).toBase58(),
    tokenAmountRaw: data.readBigUInt64LE(33).toString(),
  };
}

function normalizeInstruction(ix) {
  return {
    program: ix.program || null,
    programId: ix.programId || null,
    accounts: ix.accounts || null,
    data: ix.data || null,
    parsed: ix.parsed || null,
    stackHeight: ix.stackHeight ?? null,
  };
}

function sumBy(values) {
  return values.reduce((acc, value) => acc + BigInt(value), 0n).toString();
}

function reconstruct(signatureRow, tx, outerIndex, decoded) {
  const keys = tx.transaction.message.accountKeys.map((row) => typeof row === 'string'
    ? {pubkey: row, signer: null, writable: null, source: null}
    : row);
  const outer = tx.transaction.message.instructions[outerIndex];
  const accounts = outer.accounts || [];
  const hasOnramp = accounts.length === 11;
  const labels = hasOnramp
    ? ['pool', 'poolStake', 'poolOnramp', 'poolMint', 'poolStakeAuthority', 'poolMintAuthority',
      'destinationStake', 'sourceTokenAccount', 'clockSysvar', 'tokenProgram', 'stakeProgram']
    : ['pool', 'poolStake', 'poolMint', 'poolStakeAuthority', 'poolMintAuthority',
      'destinationStake', 'sourceTokenAccount', 'clockSysvar', 'tokenProgram', 'stakeProgram'];
  const accountMap = Object.fromEntries(labels.map((label, i) => [label, accounts[i] || null]));
  const indexByKey = new Map(keys.map((row, i) => [row.pubkey, i]));
  const balanceRows = accounts.map((pubkey, instructionAccountIndex) => {
    const transactionAccountIndex = indexByKey.get(pubkey);
    const pre = transactionAccountIndex === undefined ? null : tx.meta.preBalances[transactionAccountIndex];
    const post = transactionAccountIndex === undefined ? null : tx.meta.postBalances[transactionAccountIndex];
    return {
      label: labels[instructionAccountIndex] || `remaining${instructionAccountIndex - labels.length}`,
      pubkey,
      transactionAccountIndex: transactionAccountIndex ?? null,
      signer: transactionAccountIndex === undefined ? null : keys[transactionAccountIndex].signer,
      writable: transactionAccountIndex === undefined ? null : keys[transactionAccountIndex].writable,
      source: transactionAccountIndex === undefined ? null : keys[transactionAccountIndex].source,
      preLamports: pre === null ? null : String(pre),
      postLamports: post === null ? null : String(post),
      deltaLamports: pre === null || post === null ? null : (BigInt(post) - BigInt(pre)).toString(),
    };
  });
  const innerGroup = (tx.meta.innerInstructions || []).find((row) => row.index === outerIndex) || null;
  const inner = innerGroup ? innerGroup.instructions.map(normalizeInstruction) : [];
  const stakeInner = inner.filter((ix) => ix.program === 'stake' || ix.programId === 'Stake11111111111111111111111111111111111111');
  const tokenInner = inner.filter((ix) => ix.program === 'spl-token' || ix.programId === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
  const signerKeys = keys.filter((row) => row.signer).map((row) => row.pubkey);
  const outerInstructions = tx.transaction.message.instructions.map(normalizeInstruction);
  const transactionBalanceDeltas = keys.map((row, transactionAccountIndex) => ({
    ...row,
    transactionAccountIndex,
    preLamports: String(tx.meta.preBalances[transactionAccountIndex]),
    postLamports: String(tx.meta.postBalances[transactionAccountIndex]),
    deltaLamports: (BigInt(tx.meta.postBalances[transactionAccountIndex])
      - BigInt(tx.meta.preBalances[transactionAccountIndex])).toString(),
  })).filter((row) => row.deltaLamports !== '0');
  const subsequentStakeInstructions = outerInstructions.slice(outerIndex + 1)
    .map((ix, relativeIndex) => ({...ix, outerInstructionIndex: outerIndex + 1 + relativeIndex}))
    .filter((ix) => ix.program === 'stake' || ix.programId === 'Stake11111111111111111111111111111111111111');
  const poolStakeBalance = balanceRows.find((row) => row.label === 'poolStake');
  const destinationStakeBalance = balanceRows.find((row) => row.label === 'destinationStake');
  const sourceTokenBalance = balanceRows.find((row) => row.label === 'sourceTokenAccount');
  const sourceTokenMeta = [...(tx.meta.preTokenBalances || []), ...(tx.meta.postTokenBalances || [])]
    .find((row) => row.accountIndex === sourceTokenBalance?.transactionAccountIndex) || null;
  const parsedSplit = stakeInner.find((ix) => ix.parsed?.type === 'split');
  const splitLamports = parsedSplit?.parsed?.info?.lamports === undefined
    ? null : String(parsedSplit.parsed.info.lamports);
  const destinationNetLamportDelta = destinationStakeBalance?.deltaLamports || null;
  const poolStakeReleasedLamports = poolStakeBalance?.deltaLamports === null || poolStakeBalance?.deltaLamports === undefined
    ? null : (-BigInt(poolStakeBalance.deltaLamports)).toString();

  return {
    signature: signatureRow.signature,
    slot: tx.slot,
    blockTime: tx.blockTime,
    confirmationStatusAtSelection: signatureRow.confirmationStatus,
    transactionVersion: tx.version,
    feeLamports: String(tx.meta.fee),
    computeUnitsConsumed: tx.meta.computeUnitsConsumed ?? null,
    err: tx.meta.err,
    signerKeys,
    outerInstructionIndex: outerIndex,
    outerInstruction: normalizeInstruction(outer),
    allOuterInstructions: outerInstructions,
    subsequentStakeInstructions,
    decoded,
    accountShape: {
      accountCount: accounts.length,
      includesOptionalOnramp: hasOnramp,
      labels,
      accounts: accountMap,
      accountDetails: balanceRows,
    },
    valueRelease: {
      tokenAmountBurnedRaw: decoded.tokenAmountRaw,
      parsedStakeSplitLamports: splitLamports,
      temporaryDestinationStakeNetLamportDelta: destinationNetLamportDelta,
      poolStakeLamportsReleased: poolStakeReleasedLamports,
      balancedProgramSplit: splitLamports !== null && poolStakeReleasedLamports !== null
        ? splitLamports === poolStakeReleasedLamports : null,
      temporaryDestinationConsumedLaterInTransaction: destinationNetLamportDelta === '0'
        && subsequentStakeInstructions.some((ix) => ix.parsed?.type === 'merge'
          && ix.parsed?.info?.source === accountMap.destinationStake),
    },
    authorizationClassification: {
      sourceTokenOwner: sourceTokenMeta?.owner || null,
      sourceTokenOwnerSignedTransaction: sourceTokenMeta?.owner
        ? signerKeys.includes(sourceTokenMeta.owner) : null,
      sourceTokenOwnerEqualsNewStakeAuthority: sourceTokenMeta?.owner
        ? sourceTokenMeta.owner === decoded.userStakeAuthority : null,
      burnAuthorityPda: accountMap.poolMintAuthority,
      classification: sourceTokenMeta?.owner && signerKeys.includes(sourceTokenMeta.owner)
        && sourceTokenMeta.owner === decoded.userStakeAuthority
        ? 'caller-owned receipt spend; not an outsider burn of third-party holdings'
        : 'ownership classification unresolved',
    },
    transactionBalanceDeltas,
    tokenBalanceRows: {
      pre: tx.meta.preTokenBalances || [],
      post: tx.meta.postTokenBalances || [],
    },
    innerInstructions: inner,
    stakeProgramInnerInstructions: stakeInner,
    tokenProgramInnerInstructions: tokenInner,
    logMessages: tx.meta.logMessages || [],
    returnData: tx.meta.returnData || null,
    fullAccountKeys: keys,
  };
}

async function main() {
  const [genesisHash, startSlot] = await Promise.all([
    rpc('getGenesisHash', []),
    rpc('getSlot', [{commitment: 'finalized'}]),
  ]);
  if (genesisHash !== MAINNET_GENESIS) throw new Error(`wrong genesis hash: ${genesisHash}`);

  const scan = {pages: 0, signaturesListed: 0, successfulTransactionsFetched: 0, nullTransactions: 0};
  let before;
  let selected;
  let oldestSlot = startSlot;
  const pageLimit = Number(process.env.SVSP_HISTORY_PAGES || 20);

  outer: for (let pageNo = 0; pageNo < pageLimit; pageNo += 1) {
    const config = {limit: 1000, commitment: 'finalized'};
    if (before) config.before = before;
    const rows = await rpc('getSignaturesForAddress', [PROGRAM, config]);
    scan.pages += 1;
    scan.signaturesListed += rows.length;
    if (!rows.length) break;
    oldestSlot = rows[rows.length - 1].slot;

    const successful = rows.filter((row) => row.err === null && row.slot > DEPLOYED_SLOT);
    for (let i = 0; i < successful.length; i += 12) {
      const batch = successful.slice(i, i + 12);
      const transactions = await Promise.all(batch.map(async (row) => {
        const tx = await rpc('getTransaction', [row.signature, {
          encoding: 'jsonParsed',
          commitment: 'finalized',
          maxSupportedTransactionVersion: 0,
        }]);
        scan.successfulTransactionsFetched += 1;
        if (!tx) scan.nullTransactions += 1;
        return {row, tx};
      }));
      for (const {row, tx} of transactions) {
        if (!tx?.transaction?.message?.instructions) continue;
        for (let outerIndex = 0; outerIndex < tx.transaction.message.instructions.length; outerIndex += 1) {
          const ix = tx.transaction.message.instructions[outerIndex];
          if (ix.programId !== PROGRAM || !ix.data) continue;
          const decoded = decodeWithdrawData(ix.data);
          if (!decoded) continue;
          const logs = tx.meta?.logMessages || [];
          if (!logs.some((line) => line === 'Program log: Instruction: WithdrawStake')) continue;
          selected = reconstruct(row, tx, outerIndex, decoded);
          break outer;
        }
      }
    }

    before = rows[rows.length - 1].signature;
    if (oldestSlot <= DEPLOYED_SLOT) break;
  }

  const endSlot = await rpc('getSlot', [{commitment: 'finalized'}]);
  const output = {
    schema: 'svsp-postdeploy-withdrawal-receipt/v1',
    generatedAt: new Date().toISOString(),
    network: 'mainnet-beta',
    genesisHash,
    commitment: 'finalized',
    broadcast: false,
    programId: PROGRAM,
    deployedSlot: DEPLOYED_SLOT,
    observation: {startSlot, endSlot},
    scan: {...scan, oldestSlotReached: oldestSlot, pageLimit},
    selected: selected || null,
    rpcCallSummary: {
      total: calls.length,
      byMethod: Object.fromEntries([...new Set(calls.map((row) => row.method))]
        .map((method) => [method, calls.filter((row) => row.method === method).length])),
      failures: calls.filter((row) => !row.ok),
    },
    limitation: selected ? null : 'No successful post-deploy WithdrawStake was found within the bounded history scan.',
  };
  fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({
    output: OUT,
    observation: output.observation,
    scan: output.scan,
    selected: selected ? {
      signature: selected.signature,
      slot: selected.slot,
      tokenAmountRaw: selected.decoded.tokenAmountRaw,
      stakeReleasedLamports: selected.valueRelease.poolStakeLamportsReleased,
      accountCount: selected.accountShape.accountCount,
      signerCount: selected.signerKeys.length,
      stakeInnerCount: selected.stakeProgramInnerInstructions.length,
      tokenInnerCount: selected.tokenProgramInnerInstructions.length,
    } : null,
  }));
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exitCode = 1;
});
