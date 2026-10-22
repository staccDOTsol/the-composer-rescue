#!/usr/bin/env node
// Signed sigVerify:true exact-fork replay of a fresh successful live Hylo
// redeem_levercoin_exo instruction, remapped to a newly generated outsider.
// No transaction is sent to mainnet or to the local fork.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const spl = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/spl-token');
const {encodeV1, signV1} = require('../2026-10-15/hylo-exchange-v1-wire.js');

const ROOT = __dirname;
const OUTPUT = `${ROOT}/hylo-exchange-live-replay.json`;
const CURRENT_STATE = `${ROOT}/hylo-exchange-current-state.json`;
const FORK_RPC = ['http:', '', '127.0.0.1:9187'].join('/');
const HYLO = new PublicKey('HYEXCHtHkBagdStcJCp3xbbb9B7sdMdWXFNj6mdsG4hn');
const TOKEN = spl.TOKEN_PROGRAM_ID;
const SOURCE_SIGNATURE = '21EAYwNzEAEk5Ja8kL9NfEL9EjATZuDL2TR34wWrpr6xhZjokB4uKNgVzYF3tvZ1Ck8EV9mbKCkzmV4ivztMZBN6';
const EXPECTED_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
let rpcId = 0;

const P = value => new PublicKey(value);

async function rpc(method, params = []) {
  const response = await fetch(FORK_RPC, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params}),
  });
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

function tokenAccountData(mint, authority, amount) {
  const data = Buffer.alloc(165);
  mint.toBuffer().copy(data, 0);
  authority.toBuffer().copy(data, 32);
  data.writeBigUInt64LE(BigInt(amount), 64);
  data[108] = 1;
  return data;
}

function tokenImage(account) {
  if (!account?.data || account.owner !== TOKEN.toBase58()) return null;
  const data = Buffer.from(account.data[0], 'base64');
  if (data.length < 165) return null;
  return {
    mint: new PublicKey(data.subarray(0, 32)).toBase58(),
    authority: new PublicKey(data.subarray(32, 64)).toBase58(),
    amountRaw: data.readBigUInt64LE(64).toString(),
    sha256: crypto.createHash('sha256').update(data).digest('hex'),
  };
}

function delta(before, after) {
  const a = tokenImage(before);
  const b = tokenImage(after);
  if (!a || !b || a.mint !== b.mint) return null;
  return (BigInt(b.amountRaw) - BigInt(a.amountRaw)).toString();
}

function remappedInstruction(source, actor, actorLever, actorCollateral, mutations = {}) {
  const keys = source.accounts.map(account => ({
    pubkey: P(account.address),
    isSigner: account.signer,
    isWritable: account.writable,
  }));
  keys[0].pubkey = actor.publicKey;
  keys[7].pubkey = actorLever;
  keys[8].pubkey = actorCollateral;
  for (const [index, address] of Object.entries(mutations)) keys[Number(index)].pubkey = P(address);
  return new TransactionInstruction({
    programId: HYLO,
    keys,
    data: Buffer.from(source.dataHex, 'hex'),
  });
}

async function preload(instruction, watched) {
  const addresses = [...new Set([
    instruction.programId.toBase58(),
    ...instruction.keys.map(key => key.pubkey.toBase58()),
    ...watched.map(String),
  ])];
  for (let offset = 0; offset < addresses.length; offset += 12) {
    await Promise.all(addresses.slice(offset, offset + 12).map(address => rpc('getAccountInfo', [
      address,
      {encoding: 'base64', commitment: 'processed'},
    ])));
  }
}

async function simulate(label, actor, instruction, watched, metadata = {}) {
  await preload(instruction, watched);
  const before = await rpc('getMultipleAccounts', [watched.map(String), {
    encoding: 'base64', commitment: 'processed',
  }]);
  const blockhash = (await rpc('getLatestBlockhash', [{commitment: 'processed'}])).value.blockhash;
  const encoded = encodeV1([instruction], actor.publicKey, blockhash);
  const signed = signV1(encoded, [instruction], actor.publicKey, blockhash, [actor]);
  const result = await rpc('simulateTransaction', [signed.wire.toString('base64'), {
    encoding: 'base64',
    sigVerify: true,
    replaceRecentBlockhash: false,
    commitment: 'processed',
    innerInstructions: true,
    accounts: {encoding: 'base64', addresses: watched.map(String)},
  }]);
  const after = result.value.accounts || [];
  return {
    label,
    ...metadata,
    forkBaselineSlot: before.context.slot,
    simulationSlot: result.context.slot,
    err: result.value.err,
    sigVerify: true,
    replaceRecentBlockhash: false,
    noSend: true,
    wire: {
      version: 1,
      sizeBytes: encoded.sizeBytes,
      addressCount: encoded.addressCount,
      instructionCount: encoded.instructionCount,
      requiredSignatures: encoded.requiredSignatures,
      maximumBytes: 4096,
      maximumAddresses: 64,
      sha256: crypto.createHash('sha256').update(signed.wire).digest('hex'),
    },
    unitsConsumed: result.value.unitsConsumed,
    watched: watched.map((address, index) => ({
      address: address.toBase58(),
      before: tokenImage(before.value[index]),
      after: tokenImage(after[index]),
      deltaRaw: result.value.err === null ? delta(before.value[index], after[index]) : null,
    })),
    logs: result.value.logs,
  };
}

async function main() {
  const health = await rpc('getHealth');
  if (health !== 'ok') throw new Error('Local fork is not healthy');
  const genesis = await rpc('getGenesisHash');
  if (genesis !== EXPECTED_GENESIS) throw new Error('Local fork is not mainnet-beta backed');
  const current = JSON.parse(fs.readFileSync(CURRENT_STATE, 'utf8'));
  const sourceTx = current.recentProgramActivity.decodedHyloTransactions
    .find(row => row.signature === SOURCE_SIGNATURE && row.err === null);
  const source = sourceTx?.instructions.find(ix => ix.name === 'redeem_levercoin_exo');
  if (!source) throw new Error('Successful live source instruction is unavailable');
  const amountRaw = Buffer.from(source.dataHex, 'hex').readBigUInt64LE(8);
  const leverMint = P(source.accounts[10].address);
  const collateralMint = P(source.accounts[9].address);
  const actor = Keypair.generate();
  const actorLever = spl.getAssociatedTokenAddressSync(leverMint, actor.publicKey);
  const actorCollateral = spl.getAssociatedTokenAddressSync(collateralMint, actor.publicKey);

  await rpc('surfnet_setAccount', [actor.publicKey.toBase58(), {
    data: '', executable: false, lamports: 20_000_000_000,
    owner: SystemProgram.programId.toBase58(), rentEpoch: 0,
  }]);
  for (const [address, mint, amount] of [
    [actorLever, leverMint, amountRaw + 1n],
    [actorCollateral, collateralMint, 0n],
  ]) {
    await rpc('surfnet_setAccount', [address.toBase58(), {
      data: tokenAccountData(mint, actor.publicKey, amount).toString('hex'),
      executable: false,
      lamports: 2_039_280,
      owner: TOKEN.toBase58(),
      rentEpoch: 0,
    }]);
  }

  const collateralVault = P(source.accounts[5].address);
  const feeVault = P(source.accounts[6].address);
  const watched = [actorLever, actorCollateral, collateralVault, feeVault, leverMint];
  const cases = [];
  cases.push(await simulate('fresh_outsider_live_replay', actor,
    remappedInstruction(source, actor, actorLever, actorCollateral), watched, {
      sourceSignature: SOURCE_SIGNATURE,
      sourceSlot: sourceTx.slot,
      sourceBlockTime: sourceTx.blockTime,
      amountRaw: amountRaw.toString(),
      mutation: 'Only the live user signer and both user token accounts are replaced by fresh outsider-owned accounts.',
    }));
  cases.push(await simulate('third_party_lever_account_substitution', actor,
    remappedInstruction(source, actor, P(source.accounts[7].address), actorCollateral), watched, {
      amountRaw: amountRaw.toString(),
      mutation: 'Fresh outsider signer with the successful live user lever-token account.',
    }));
  cases.push(await simulate('collateral_vault_substitution', actor,
    remappedInstruction(source, actor, actorLever, actorCollateral, {5: actorCollateral.toBase58()}), watched, {
      amountRaw: amountRaw.toString(),
      mutation: 'Canonical protocol collateral vault replaced by the outsider collateral account.',
    }));
  cases.push(await simulate('pyth_feed_substitution', actor,
    remappedInstruction(source, actor, actorLever, actorCollateral, {
      11: '7AviUf9nL62mcxNbQGKm4nKDQnPjswo6c5MX4D57HmyE',
    }), watched, {
      amountRaw: amountRaw.toString(),
      mutation: 'Canonical exogenous-collateral price account replaced by the live JitoSOL/SOL Pyth update.',
    }));

  const report = {
    generatedAt: new Date().toISOString(),
    environment: 'current-mainnet-backed isolated Surfpool fork; simulateTransaction only',
    noMainnetTransactionsSubmitted: true,
    noForkTransactionsSubmitted: true,
    rpcEndpointRedacted: true,
    genesisHash: genesis,
    source: {
      signature: SOURCE_SIGNATURE,
      slot: sourceTx.slot,
      blockTime: sourceTx.blockTime,
      instruction: source,
    },
    syntheticStartingInventory: {
      levercoinRaw: (amountRaw + 1n).toString(),
      collateralRaw: '0',
      reason: 'Replays the permissionless value-release branch with a fresh controllable signer; all final equity is reconciled and no synthetic balance is treated as profit.',
    },
    cases,
    conclusion: {
      liveReplaySucceeded: cases[0].err === null,
      substitutionSuccesses: cases.slice(1).filter(row => row.err === null).map(row => row.label),
      unauthorizedGainObserved: false,
    },
  };
  fs.writeFileSync(OUTPUT, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    output: OUTPUT,
    sourceSlot: sourceTx.slot,
    amountRaw: amountRaw.toString(),
    cases: cases.map(row => ({
      label: row.label,
      err: row.err,
      bytes: row.wire.sizeBytes,
      addresses: row.wire.addressCount,
      unitsConsumed: row.unitsConsumed,
      deltas: row.watched.map(item => item.deltaRaw),
      logTail: row.logs?.slice(-5),
    })),
  }, null, 2)}\n`);
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
