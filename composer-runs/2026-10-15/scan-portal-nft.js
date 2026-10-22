#!/usr/bin/env node
'use strict';

// Read-only Wormhole Portal variant census. Token Bridge custody is intentionally
// excluded here because it has a separate complete artifact in this run.
const fs = require('fs');
const {
  PublicKey,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const bs58 = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');

const RPC = process.env.SOLANA_RPC;
if (!RPC) throw new Error('SOLANA_RPC is required');
const OUT = process.argv[2] || 'portal-nft-custody.json';
const MINT_CHECKPOINT = `${OUT}.mint-checkpoint.json`;
const CORE = new PublicKey('worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth');
const NFT = new PublicKey('WnFt12ZrnzZrFZkt2xsNsaNWoQribnuQ5B5FrDbwDhD');
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
let id = 1;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function rpc(method, params, retries = 8) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const response = await fetch(RPC, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({jsonrpc: '2.0', id: id++, method, params}),
    });
    if ((response.status === 429 || response.status >= 500) && attempt < retries) {
      await sleep(750 * (attempt + 1));
      continue;
    }
    const text = await response.text();
    let json;
    try { json = JSON.parse(text); } catch (_) { throw new Error(`${method}: HTTP ${response.status}: ${text.slice(0, 200)}`); }
    if (json.error) throw new Error(`${method}: ${JSON.stringify(json.error)}`);
    return json.result;
  }
}

async function paginatedProgramAccounts(program, config) {
  let checkpoint = {page: 0, scannedPageCapacity: 0, paginationKey: null, accounts: [], complete: false};
  if (fs.existsSync(MINT_CHECKPOINT)) checkpoint = JSON.parse(fs.readFileSync(MINT_CHECKPOINT));
  if (checkpoint.complete) return checkpoint.accounts;
  const accounts = checkpoint.accounts;
  let paginationKey = checkpoint.paginationKey;
  let page = checkpoint.page;
  do {
    const result = await rpc('getProgramAccountsV2', [program, {
      ...config,
      limit: 10000,
      ...(paginationKey ? {paginationKey} : {}),
    }]);
    accounts.push(...result.accounts);
    paginationKey = result.paginationKey;
    page++;
    checkpoint = {page, scannedPageCapacity: page * 10000, paginationKey, accounts, complete: !paginationKey};
    if (page % 10 === 0 || !paginationKey) {
      fs.writeFileSync(MINT_CHECKPOINT, `${JSON.stringify(checkpoint)}\n`);
      console.error(`paginated ${page} pages / ${accounts.length} matching accounts / ${checkpoint.scannedPageCapacity} page capacity`);
    }
    await sleep(150);
  } while (paginationKey);
  return accounts;
}

async function main() {
  const [feeCollector] = PublicKey.findProgramAddressSync([Buffer.from('fee_collector')], CORE);
  const [custodySigner] = PublicKey.findProgramAddressSync([Buffer.from('custody_signer')], NFT);
  const [mintAuthority] = PublicKey.findProgramAddressSync([Buffer.from('mint_signer')], NFT);
  const slot = await rpc('getSlot', [{commitment: 'confirmed'}]);
  const checkpointOnly = process.env.PORTAL_MINT_CHECKPOINT_ONLY === '1';
  const existingCheckpoint = fs.existsSync(MINT_CHECKPOINT) ? JSON.parse(fs.readFileSync(MINT_CHECKPOINT)) : {page: 0, scannedPageCapacity: 0, paginationKey: null, accounts: [], complete: false};
  const [feeInfo, custody, wrappedMints, nftProgramAccounts] = await Promise.all([
    rpc('getAccountInfo', [feeCollector.toBase58(), {encoding: 'base64', commitment: 'confirmed'}]),
    rpc('getTokenAccountsByOwner', [custodySigner.toBase58(), {programId: TOKEN}, {encoding: 'jsonParsed', commitment: 'confirmed'}]),
    checkpointOnly ? Promise.resolve(existingCheckpoint.accounts) : paginatedProgramAccounts(TOKEN, {encoding: 'base64', commitment: 'confirmed', dataSlice: {offset: 0, length: 0}, filters: [{dataSize: 82}, {memcmp: {offset: 4, bytes: mintAuthority.toBase58()}}]}),
    rpc('getProgramAccounts', [NFT.toBase58(), {encoding: 'base64', commitment: 'confirmed', dataSlice: {offset: 0, length: 0}}]),
  ]);
  const custodyRows = custody.value.map((entry) => ({
    address: entry.pubkey,
    mint: entry.account.data.parsed.info.mint,
    owner: entry.account.data.parsed.info.owner,
    rawAmount: entry.account.data.parsed.info.tokenAmount.amount,
    decimals: entry.account.data.parsed.info.tokenAmount.decimals,
    uiAmountString: entry.account.data.parsed.info.tokenAmount.uiAmountString,
  }));
  const report = {
    generatedAt: new Date().toISOString(),
    slot,
    rpcReadsOnly: true,
    wormholeCore: {
      program: CORE.toBase58(),
      feeCollector: feeCollector.toBase58(),
      feeCollectorLamports: feeInfo.value?.lamports ?? null,
      custodyQualification: 'Message-layer fee collector only; not token bridge backing.',
    },
    portalNftBridge: {
      program: NFT.toBase58(),
      exactProgramAccountCount: nftProgramAccounts.length,
      custodySigner: custodySigner.toBase58(),
      exactCustodyTokenAccountCount: custodyRows.length,
      positiveCustodyTokenAccountCount: custodyRows.filter((row) => BigInt(row.rawAmount) > 0n).length,
      custodyRows,
      mintAuthority: mintAuthority.toBase58(),
      exactClassicSplMintsControlled: existingCheckpoint.complete ? wrappedMints.length : null,
      observedClassicSplMintsControlledLowerBound: wrappedMints.length,
      controlledClassicSplMints: wrappedMints.map((row) => row.pubkey),
      mintAuthorityEnumeration: existingCheckpoint.complete ? {
        complete: true,
        pages: existingCheckpoint.page,
      } : {
        complete: false,
        pagesCompleted: existingCheckpoint.page,
        scannedPageCapacity: existingCheckpoint.scannedPageCapacity,
        observedMatches: wrappedMints.length,
        paginationKeyPreserved: !!existingCheckpoint.paginationKey,
        blocker: 'The provider paginates the global Token Program keyspace before applying this sparse filter. The checkpoint preserves a resumable lower bound; it is not an exact mint-authority denominator.',
      },
      token2022MintEnumeration: 'not applicable to this legacy Portal NFT deployment unless separately evidenced; variable-length Token-2022 mints were not inferred',
    },
  };
  fs.writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    out: OUT,
    slot,
    coreFeeCollectorLamports: report.wormholeCore.feeCollectorLamports,
    nftProgramAccounts: report.portalNftBridge.exactProgramAccountCount,
    nftCustodyAccounts: report.portalNftBridge.exactCustodyTokenAccountCount,
    positiveNftCustodyAccounts: report.portalNftBridge.positiveCustodyTokenAccountCount,
    controlledClassicSplMintsExact: report.portalNftBridge.exactClassicSplMintsControlled,
    controlledClassicSplMintsObservedLowerBound: report.portalNftBridge.observedClassicSplMintsControlledLowerBound,
    mintAuthorityEnumeration: report.portalNftBridge.mintAuthorityEnumeration,
  }, null, 2));
}

main().catch((error) => { console.error(error.stack || error); process.exit(1); });
