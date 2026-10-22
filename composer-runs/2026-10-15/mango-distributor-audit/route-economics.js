#!/usr/bin/env node
'use strict';

// Read-only executable quote check. No transaction construction or submission.

const fs = require('fs');
const path = require('path');
const { PublicKey } = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');

const DIR = __dirname;
const state = JSON.parse(fs.readFileSync(path.join(DIR, 'current-state.json'), 'utf8'));
const flash = JSON.parse(fs.readFileSync(path.join(DIR, '..', 'current-flash-provider-stack-signed-v1.json'), 'utf8'));
const COLLECTION = '3JaWRPs677Q22oLz3xT1rPD7yhCEL3Njp9raruM81VCS';
const MNGO = 'MangoCzJ36AjZyKwVj3VnYU4GTonjfVEnJmvvWaxLac';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const REPLACEMENT = '8cE4psxE5z8eVrMWdQPtcSpPewv36PJeu15J5KnmdBLk';
const SAMPLE_INPUT = 770_181_206n;

const account = (address) => state.programAccounts.find((entry) => entry.address === address);
const key = (bytes, offset) => new PublicKey(bytes.subarray(offset, offset + 32)).toBase58();

async function quote(inputMint, outputMint, amount, swapMode = 'ExactIn') {
  if (inputMint === outputMint) return { inputMint, outputMint, inAmount: amount.toString(), outAmount: amount.toString(), swapMode, directIdentity: true };
  const params = new URLSearchParams({ inputMint, outputMint, amount: amount.toString(), swapMode, slippageBps: '50' });
  const url = `https://lite-api.jup.ag/swap/v1/quote?${params}`;
  const response = await fetch(url);
  const text = await response.text();
  if (!response.ok) return { inputMint, outputMint, amount: amount.toString(), swapMode, httpStatus: response.status, error: text.slice(0, 1000) };
  const body = JSON.parse(text);
  return {
    inputMint: body.inputMint, outputMint: body.outputMint,
    inAmount: body.inAmount, outAmount: body.outAmount,
    swapMode: body.swapMode, priceImpactPct: body.priceImpactPct,
    routePlan: (body.routePlan || []).map((leg) => ({
      label: leg.swapInfo.label, inAmount: leg.swapInfo.inAmount, outAmount: leg.swapInfo.outAmount,
      inputMint: leg.swapInfo.inputMint, outputMint: leg.swapInfo.outputMint,
    })),
  };
}

async function main() {
  const collectionBytes = Buffer.from(account(COLLECTION).dataBase64, 'base64');
  const collectedRaw = collectionBytes.readBigUInt64LE(40);
  const maximumCollectableRaw = collectionBytes.readBigUInt64LE(48);
  const distributionCount = collectionBytes[195];
  const distributions = [];
  for (let index = 0; index < distributionCount; index += 1) {
    const address = key(collectionBytes, 196 + index * 32);
    const bytes = Buffer.from(account(address).dataBase64, 'base64');
    const totalRaw = bytes.readBigUInt64LE(40);
    const mint = key(bytes, 48);
    const vault = key(bytes, 80);
    const claimedRaw = bytes.readBigUInt64LE(112);
    const sampleOutputRaw = SAMPLE_INPUT * totalRaw / maximumCollectableRaw;
    distributions.push({ address, mint, vault, totalRaw: totalRaw.toString(), claimedRaw: claimedRaw.toString(),
      remainingRaw: (totalRaw - claimedRaw).toString(), sampleOutputRaw: sampleOutputRaw.toString() });
  }

  const acquisition = await quote(USDC, MNGO, SAMPLE_INPUT, 'ExactOut');
  const directMngoExit = await quote(MNGO, USDC, SAMPLE_INPUT);
  const exits = [];
  for (const distribution of distributions) exits.push({
    distribution: distribution.address,
    ...await quote(distribution.mint, USDC, BigInt(distribution.sampleOutputRaw)),
  });
  const replacementExit = await quote(REPLACEMENT, USDC, SAMPLE_INPUT);
  const routableExitRaw = exits.reduce((sum, entry) => sum + BigInt(entry.outAmount || 0), 0n)
    + BigInt(replacementExit.outAmount || 0);
  const acquisitionRaw = BigInt(acquisition.inAmount || 0);

  const result = {
    generatedAt: new Date().toISOString(),
    noLiveSubmission: true,
    stateSlots: { knownAccounts: state.knownAccountsSlot, programAccounts: state.programAccountsSlot },
    collection: {
      address: COLLECTION,
      collectedMint: MNGO,
      collectedRaw: collectedRaw.toString(),
      maximumCollectableRaw: maximumCollectableRaw.toString(),
      remainingCollectableRaw: (maximumCollectableRaw - collectedRaw).toString(),
      replacementMint: REPLACEMENT,
      distributionCount,
    },
    distributions,
    sample: {
      inputMngoRaw: SAMPLE_INPUT.toString(), acquisition, directMngoExit,
      exits, replacementExit, routableExitUsdcRaw: routableExitRaw.toString(),
      acquisitionUsdcRaw: acquisitionRaw.toString(),
      routableShortfallUsdcRaw: (acquisitionRaw - routableExitRaw).toString(),
      profitableBeforeFees: routableExitRaw > acquisitionRaw,
      caveat: 'Quotes are executable-route discovery evidence, not a signed atomic transaction. Unroutable outputs contribute zero to atomic repayment.',
    },
    crossMintFundingEvidence: {
      source: '../current-flash-provider-stack-signed-v1.json',
      generatedAt: flash.generatedAt,
      forkBaselineSlot: flash.forkBaselineSlot,
      capacities: flash.capacities,
      successfulSignedV1Controls: flash.cases.filter((entry) => entry.err === null).map((entry) => ({
        label: entry.label, kind: entry.kind, amounts: entry.amounts, wire: entry.wire && {
          version: entry.wire.version, bytes: entry.wire.bytes, addresses: entry.wire.addresses,
          instructions: entry.wire.instructions, requiredSignatures: entry.wire.requiredSignatures,
          signerOrder: entry.wire.signerOrder, sigVerify: entry.wire.sigVerify,
          replaceRecentBlockhash: entry.wire.replaceRecentBlockhash, sha256: entry.wire.sha256,
        },
        lenderDeltas: entry.tokenDeltas,
      })),
      conclusion: 'Cross-mint atomic funding exists for WSOL and USDC, but the sampled MNGO acquisition plus claim plus independently routable exits is negative before flash fees and transaction costs.',
    },
  };
  fs.writeFileSync(path.join(DIR, 'route-economics.json'), `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ collection: result.collection, sample: result.sample,
    successfulFundingControls: result.crossMintFundingEvidence.successfulSignedV1Controls.map((entry) => ({ label: entry.label, wire: entry.wire })) }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
