#!/usr/bin/env node
// Offline derivation and transaction-corpus analysis for the current MOVEUSD
// controller. Inputs were captured read-only by moveusd-snapshot.js.

'use strict';

const fs = require('fs');
const path = require('path');
const MOD = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules';
const { PublicKey } = require(path.join(MOD, '@solana/web3.js'));
const { getAssociatedTokenAddressSync } = require(path.join(MOD, '@solana/spl-token'));

const DIR = __dirname;
const STATE_PATH = path.join(DIR, 'moveusd-current-state.json');
const TX_PATH = path.join(DIR, 'moveusd-recent-transactions.json');
const OUT_PATH = path.join(DIR, 'moveusd-transaction-analysis.json');
const PROGRAM = new PublicKey('EmiytJ3zWX9koH3emPsWDEs9RqNm6NNFp4CkMLoiA1KC');
const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const MINT = new PublicKey('3AdhVEX6k85yNivHVXDEiY3WyP2WgFQTUZCahGaeC2qm');
const WITNESS_SIGNATURE = '4LzzHMY8eCKiVCxb2258q9VbVa9XmsWpC3RZRaXzTUYkLNaxsPZjFjHX8gu2MnTrrrVdS5dZW5w2auQRf9Y5Drxq';
const CUSTODY = '9LbzSsqxTyaa9dA9nVv7oBaZy85qJuAonX7wCuEaXoXX';

function pda(seeds) {
  const [address, bump] = PublicKey.findProgramAddressSync(seeds, PROGRAM);
  return { address: address.toBase58(), bump };
}

const state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
const corpus = JSON.parse(fs.readFileSync(TX_PATH, 'utf8')).transactions;
const witness = corpus.find((tx) => tx.signature === WITNESS_SIGNATURE);
if (!witness) throw new Error('witness transaction not present in captured corpus');
const transfer = witness.controllerInstructions.find((ix) => ix.level === 'outer');
if (!transfer) throw new Error('witness controller instruction unavailable');
const data = Buffer.from(transfer.data.hex, 'hex');
const tokenIdLength = data.readUInt32LE(8);
const tokenId = data.subarray(12, 12 + tokenIdLength).toString('utf8');
const offset = 12 + tokenIdLength;
const ik = data.subarray(offset, offset + 16);
const sourceWalletId = data.subarray(offset + 16, offset + 32);
const sourceKind = data.readUInt32LE(offset + 32);
const amountRaw = data.readBigUInt64LE(offset + 36);
const targetCount = data.readUInt32LE(offset + 44);
const targetWalletId = data.subarray(offset + 48, offset + 64);
const targetKind = data.readUInt32LE(offset + 64);

const accounts = transfer.accounts;
const mapped = {
  payer: accounts[0], mint: accounts[1], tokenInfo: accounts[2],
  sourceLedgerAuthority: accounts[3], sourceLedgerAccount: accounts[4],
  authorityPermissions: accounts[5], authority: accounts[6],
  idempotentAccount: accounts[7], tokenProgram: accounts[8], systemProgram: accounts[9],
  eventAuthority: accounts[10], program: accounts[11],
  targetLedgerAuthority: accounts[12], targetLedgerAccount: accounts[13],
};
const sourcePda = pda([sourceWalletId, Buffer.from('redemption_wallet')]);
const targetPda = pda([targetWalletId, Buffer.from('redemption_wallet')]);
const permissionPda = pda([
  Buffer.from(tokenId), new PublicKey(mapped.authority).toBuffer(), Buffer.from('access_control_v3'),
]);
const idempotentPda = pda([ik, Buffer.from('transfer')]);
const sourceAta = getAssociatedTokenAddressSync(MINT, new PublicKey(sourcePda.address), true,
  TOKEN_PROGRAM).toBase58();
const targetAta = getAssociatedTokenAddressSync(MINT, new PublicKey(targetPda.address), true,
  TOKEN_PROGRAM).toBase58();

const permissionState = state.programOwnedAccounts.accounts.find(
  (account) => account.address === mapped.authorityPermissions,
);
if (!permissionState) throw new Error('permission state absent from program-account snapshot');
const permissionData = Buffer.from(permissionState.dataBase64, 'base64');
const embeddedAuthority = new PublicKey(permissionData.subarray(8, 40)).toBase58();
const permissionBits = permissionData.readBigUInt64LE(40).toString();

const outgoing = corpus.flatMap((tx) => (tx.tokenInstructions || [])
  .filter((ix) => ix.parsed?.type === 'transferChecked' && ix.parsed.info?.source === CUSTODY)
  .map((ix) => ({ signature: tx.signature, slot: tx.slot,
    amountRaw: ix.parsed.info.tokenAmount.amount, destination: ix.parsed.info.destination,
    authority: ix.parsed.info.authority })));
const programCounts = new Map();
for (const tx of corpus) {
  for (const ix of tx.allInstructions || []) {
    programCounts.set(ix.programId, (programCounts.get(ix.programId) || 0) + 1);
  }
}

const output = {
  generatedAt: new Date().toISOString(),
  offline: true,
  inputs: { state: path.basename(STATE_PATH), transactions: path.basename(TX_PATH) },
  witness: {
    signature: witness.signature, slot: witness.slot, success: witness.error === null,
    discriminator: data.subarray(0, 8).toString('hex'), dataLength: data.length,
    decoded: { tokenId, idempotencyKeyHex: ik.toString('hex'),
      sourceWalletIdHex: sourceWalletId.toString('hex'), sourceKind,
      amountRaw: amountRaw.toString(), targetCount,
      targetWalletIdHex: targetWalletId.toString('hex'), targetKind },
    accounts: mapped,
    derivations: {
      sourceAuthority: { ...sourcePda, matches: sourcePda.address === mapped.sourceLedgerAuthority },
      sourceAta: { address: sourceAta, matches: sourceAta === mapped.sourceLedgerAccount },
      targetAuthority: { ...targetPda, matches: targetPda.address === mapped.targetLedgerAuthority },
      targetAta: { address: targetAta, matches: targetAta === mapped.targetLedgerAccount },
      authorityPermissions: { ...permissionPda,
        matches: permissionPda.address === mapped.authorityPermissions,
        seedVersion: 'access_control_v3' },
      idempotentAccount: { ...idempotentPda,
        matches: idempotentPda.address === mapped.idempotentAccount },
    },
    permissionState: { address: permissionState.address, owner: permissionState.owner,
      dataLength: permissionState.dataLength, embeddedAuthority, permissionBits,
      embeddedAuthorityMatchesSigner: embeddedAuthority === mapped.authority },
  },
  recentCorpus: {
    transactionCount: corpus.length,
    failedTransactionCount: corpus.filter((tx) => tx.error !== null).length,
    custodyOutflowCount: outgoing.length,
    custodyOutflowTotalRaw: outgoing.reduce((sum, row) => sum + BigInt(row.amountRaw), 0n).toString(),
    custodyOutflowDestinations: [...new Set(outgoing.map((row) => row.destination))],
    custodyOutflowAuthorities: [...new Set(outgoing.map((row) => row.authority))],
    invokedPrograms: [...programCounts.entries()].map(([programId, instructionCount]) => ({
      programId, instructionCount,
    })).sort((a, b) => b.instructionCount - a.instructionCount),
    custodyOutflows: outgoing,
    interpretation: 'The bounded recent corpus contains controller, SPL Token, Associated Token, System, Memo, and Compute Budget instructions only; it contains no observed DEX, lender, oracle, or bridge CPI.',
  },
};

fs.writeFileSync(OUT_PATH, `${JSON.stringify(output, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({
  witness: output.witness.signature,
  derivations: output.witness.derivations,
  permissionState: output.witness.permissionState,
  recentCorpus: { transactionCount: output.recentCorpus.transactionCount,
    failedTransactionCount: output.recentCorpus.failedTransactionCount,
    custodyOutflowCount: output.recentCorpus.custodyOutflowCount,
    custodyOutflowTotalRaw: output.recentCorpus.custodyOutflowTotalRaw,
    invokedPrograms: output.recentCorpus.invokedPrograms },
}, null, 2)}\n`);
