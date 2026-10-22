#!/usr/bin/env node
// Read-only account, price, route, and transaction recheck for the GRASS controller.
const fs = require('fs');
const path = require('path');
const { PublicKey } = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');

const dir = __dirname;
const programId = 'EyxPPowqBRTpZpiDb2ixUR6XUU1VJwTCNgJdK8eyc6kc';
const grassMint = 'Grass7B4RdKfBCjTKgSqnXkqjwiGvQyFbuSCUJr3XXjs';
const usdcMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const signature = 'vYM2KYraryaF9navrBZdHFnnoyU8axeuQFnm4YVMLwkGL4qTeyLVHUmuxQmcam3NcXtrt2inJpdu1gq19n4HT7v';
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env', 'utf8')
  .split(/\n/).filter((line) => line.includes('='))
  .map((line) => line.split(/=(.*)/s).slice(0, 2)));
const endpoint = env.RPC_URL;
if (!endpoint) throw new Error('RPC_URL unavailable');
const source = JSON.parse(fs.readFileSync(path.join(dir, 'mainnet-token-authority-census.raw.json')));
const groups = source.authorities.filter((row) => row.directExecutableOwner === programId);
if (groups.length !== 9 || groups.some((row) => row.tokenAccounts.length !== 1)) {
  throw new Error(`expected nine singleton vault groups, found ${groups.length}`);
}
const programDataAddress = 'HZyc3e9xuPRPXyVXti863VYUeMFKYgXRC4L3aMgx71vY';

async function rpc(method, params) {
  const response = await fetch(endpoint, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!response.ok) throw new Error(`${method} HTTP ${response.status}`);
  const data = await response.json();
  if (data.error) throw new Error(`${method}: ${JSON.stringify(data.error)}`);
  return data.result;
}

function pubkey(bytes) { return new PublicKey(bytes).toBase58(); }
function bigintAmount(raw, decimals) {
  const d = 10n ** BigInt(decimals);
  return `${BigInt(raw) / d}.${(BigInt(raw) % d).toString().padStart(decimals, '0')}`;
}

async function main() {
  const addresses = [programId, programDataAddress, grassMint,
    ...groups.flatMap((row) => [row.authority, row.tokenAccounts[0].address])];
  const [accountResult, tx, tokenResponse] = await Promise.all([
    rpc('getMultipleAccounts', [addresses, { encoding: 'base64', commitment: 'confirmed',
      dataSlice: { offset: 0, length: 256 } }]),
    rpc('getTransaction', [signature, { encoding: 'jsonParsed', commitment: 'confirmed',
      maxSupportedTransactionVersion: 0 }]),
    fetch('https://lite-api.jup.ag/tokens/v2/search?query=' + grassMint).then(async (res) => {
      if (!res.ok) throw new Error(`Jupiter token search HTTP ${res.status}`);
      return res.json();
    }),
  ]);
  const accountMap = new Map(addresses.map((address, i) => [address, accountResult.value[i]]));
  const rawAccounts = Object.fromEntries(addresses.map((address) => [address, accountMap.get(address)]));
  const program = accountMap.get(programId);
  const programBytes = Buffer.from(program.data[0], 'base64');
  const programData = accountMap.get(programDataAddress);
  const pdBytes = Buffer.from(programData.data[0], 'base64');
  const token = tokenResponse.find((row) => row.id === grassMint) || null;
  const mint = accountMap.get(grassMint);
  const mintBytes = Buffer.from(mint.data[0], 'base64');
  const decimals = mintBytes[44];
  const vaults = groups.map((row) => {
    const vault = row.tokenAccounts[0];
    const authorityInfo = accountMap.get(row.authority);
    const vaultInfo = accountMap.get(vault.address);
    const b = Buffer.from(vaultInfo.data[0], 'base64');
    const rawAmount = b.readBigUInt64LE(64).toString();
    return {
      authority: row.authority,
      authorityOffCurve: !PublicKey.isOnCurve(new PublicKey(row.authority).toBytes()),
      authorityAccountOwner: authorityInfo.owner,
      authorityAccountDataLength: authorityInfo.space,
      vault: vault.address,
      vaultAccountOwner: vaultInfo.owner,
      tokenMint: pubkey(b.subarray(0, 32)),
      tokenAuthority: pubkey(b.subarray(32, 64)),
      rawAmount,
      uiAmountExact: bigintAmount(rawAmount, decimals),
      snapshotRawAmount: vault.rawAmount,
      priceUsd: token?.usdPrice ?? null,
      spotMarkUsd: token?.usdPrice == null ? null : Number(rawAmount) / 10 ** decimals * token.usdPrice,
    };
  });
  const totalRaw = vaults.reduce((sum, v) => sum + BigInt(v.rawAmount), 0n);
  const accountKeys = tx.transaction.message.accountKeys.map((row) =>
    typeof row === 'string' ? row : row.pubkey);
  const outer = tx.transaction.message.instructions.map((ix, index) => ({
    index, programId: ix.programId, parsed: ix.parsed ?? null,
  }));
  const inner = tx.meta.innerInstructions.map((group) => ({
    outerIndex: group.index,
    topLevelProgramId: outer[group.index]?.programId,
    instructions: group.instructions.map((ix) => ({
      programId: ix.programId, stackHeight: ix.stackHeight,
      parsed: ix.parsed ?? null,
    })),
  }));
  const vaultSet = new Set(vaults.map((v) => v.vault));
  const matchedTransfers = [];
  for (const group of inner) {
    const stack = [];
    stack[1] = group.topLevelProgramId;
    for (const ix of group.instructions) {
      const height = ix.stackHeight ?? 2;
      const immediateCaller = stack[height - 1] ?? null;
      stack[height] = ix.programId;
      stack.length = height + 1;
      const info = ix.parsed?.info || {};
      if (vaultSet.has(info.source) && ['transfer', 'transferChecked'].includes(ix.parsed?.type)) {
        matchedTransfers.push({ outerIndex: group.outerIndex,
          topLevelProgramId: group.topLevelProgramId,
          immediateCaller, ...ix });
      }
    }
  }
  const targetVault = vaults.find((v) => v.vault === '9cgnBLaq9uzH63UyPbpXT3H6TEBqjTj2CiK1xebSgCAL');
  const prePost = {
    pre: tx.meta.preTokenBalances.filter((row) => accountKeys[row.accountIndex] === targetVault.vault),
    post: tx.meta.postTokenBalances.filter((row) => accountKeys[row.accountIndex] === targetVault.vault),
  };
  const quoteSizes = [1000, 10000, 100000, 1000000, 10000000, 100000000, 200000000];
  const quotes = [];
  for (const units of quoteSizes) {
    const url = new URL('https://lite-api.jup.ag/swap/v1/quote');
    url.searchParams.set('inputMint', grassMint);
    url.searchParams.set('outputMint', usdcMint);
    url.searchParams.set('amount', (BigInt(units) * 10n ** BigInt(decimals)).toString());
    url.searchParams.set('slippageBps', '50');
    try {
      const res = await fetch(url);
      const body = await res.json();
      quotes.push({ units, quotedAt: new Date().toISOString(), status: res.status,
        inAmount: body.inAmount ?? null, outAmount: body.outAmount ?? null,
        outUsdc: body.outAmount ? Number(body.outAmount) / 1e6 : null,
        priceImpactPct: body.priceImpactPct ?? null,
        routePlan: body.routePlan?.map((step) => ({
          ammKey: step.swapInfo?.ammKey,
          label: step.swapInfo?.label,
          inAmount: step.swapInfo?.inAmount,
          outAmount: step.swapInfo?.outAmount,
        })) ?? null,
        error: body.error ?? null, errorCode: body.errorCode ?? null,
      });
    } catch (error) {
      quotes.push({ units, quotedAt: new Date().toISOString(), error: String(error) });
    }
  }
  const result = {
    generatedAt: new Date().toISOString(),
    dataSources: { accountAndTransaction: 'Helius Solana mainnet RPC, confirmed',
      tokenSearch: 'https://lite-api.jup.ag/tokens/v2/search?query=' + grassMint,
      quoteEndpoint: 'https://lite-api.jup.ag/swap/v1/quote',
      censusInput: 'mainnet-token-authority-census.raw.json (candidate addresses only)' },
    accountSlot: accountResult.context.slot,
    program: { programId, owner: program.owner, executable: program.executable,
      programTag: programBytes.readUInt32LE(0),
      programDataPointer: pubkey(programBytes.subarray(4, 36)),
      programDataAddress, programDataOwner: programData.owner,
      programDataTag: pdBytes.readUInt32LE(0),
      upgradeSlot: Number(pdBytes.readBigUInt64LE(4)),
      upgradeAuthorityOption: pdBytes.readUInt8(12),
      upgradeAuthority: pdBytes.readUInt8(12) === 1 ? pubkey(pdBytes.subarray(13, 45)) : null },
    mint: { address: grassMint, owner: mint.owner, decimals, supplyRaw: mintBytes.readBigUInt64LE(36).toString() },
    token,
    vaults,
    aggregate: { vaultCount: vaults.length,
      allAuthoritiesOffCurve: vaults.every((v) => v.authorityOffCurve),
      allAuthorityAccountsProgramOwned: vaults.every((v) => v.authorityAccountOwner === programId),
      allVaultTokenAuthoritiesMatch: vaults.every((v) => v.tokenAuthority === v.authority),
      allVaultMintsMatch: vaults.every((v) => v.tokenMint === grassMint),
      totalRaw: totalRaw.toString(), uiAmountExact: bigintAmount(totalRaw, decimals),
      spotMarkUsd: token?.usdPrice == null ? null : Number(totalRaw) / 10 ** decimals * token.usdPrice },
    citedTransfer: { signature, slot: tx.slot, blockTime: tx.blockTime,
      version: tx.version, err: tx.meta.err, feeLamports: tx.meta.fee,
      transactionSigners: tx.transaction.message.accountKeys
        .filter((row) => typeof row !== 'string' && row.signer).map((row) => row.pubkey),
      accountKeys, outer, inner, matchedTransfers, prePost },
    quotes,
    rawAccounts,
  };
  fs.writeFileSync(path.join(dir, 'grass-custody-recheck.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ slot: result.accountSlot, program: result.program,
    aggregate: result.aggregate, matchedTransfers: result.citedTransfer.matchedTransfers,
    prePost, quotes }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
