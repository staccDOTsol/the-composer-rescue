#!/usr/bin/env node
'use strict';

// Read-only extraction of the deployed program-owned compressed Anchor IDL.
const fs = require('fs');
const zlib = require('zlib');
const crypto = require('crypto');
const {PublicKey} = require(
  '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');

const DIR = __dirname;
const IDL_ACCOUNT = 'CUHz8jRKdeDq56hCdFHTHEzwwez5gP5z1gkUnLobLreX';
const PROGRAM = 'jup6QF1sNDGpkkcu6F4qaFHcRBmnSS1VgyB4uFbBvNS';
const FLASH_IDL_ACCOUNT = '6aogr6JVXyuxeHSEuArwHqRkaxyPRYuZTT1fu6HWY3KV';
const FLASH_PROGRAM = 'jupKxkab7RTnQJ6wXStXg6WY4rcReV3maiUNwByciFF';
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env', 'utf8')
  .split(/\r?\n/).filter((line) => line.includes('='))
  .map((line) => line.split(/=(.*)/s).slice(0, 2)));
if (!env.RPC_URL) throw new Error('RPC_URL unavailable');

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

async function extract(accountAddress, program, referencePath, outputStem, testedNames) {
  const response = await fetch(env.RPC_URL, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: accountAddress, method: 'getAccountInfo', params: [accountAddress,
      {encoding: 'base64', commitment: 'confirmed'}]})});
  const body = await response.json();
  if (body.error || !body.result?.value) throw new Error(JSON.stringify(body.error || 'missing IDL'));
  const account = body.result.value;
  if (account.owner !== program) throw new Error(`unexpected IDL owner ${account.owner}`);
  const data = Buffer.from(account.data[0], 'base64');
  const authority = new PublicKey(data.subarray(8, 40)).toBase58();
  const compressedLength = data.readUInt32LE(40);
  const compressed = data.subarray(44, 44 + compressedLength);
  const plain = zlib.inflateSync(compressed);
  const idl = JSON.parse(plain.toString('utf8'));
  if (idl.address !== program) throw new Error(`unexpected IDL target ${idl.address}`);
  const newer = JSON.parse(fs.readFileSync(referencePath));
  const deployedNames = idl.instructions.map((item) => item.name);
  const newerNames = newer.instructions.map((item) => item.name);
  const evidence = {generatedAt: new Date().toISOString(), readOnly: true,
    submittedTransactions: 0, account: accountAddress, owner: account.owner, authority,
    accountDataLength: data.length, discriminatorHex: data.subarray(0, 8).toString('hex'),
    compressedLength, compressedSha256: sha256(compressed), decompressedLength: plain.length,
    decompressedSha256: sha256(plain), deployedMetadata: idl.metadata,
    deployedAddress: idl.address, deployedCounts: {instructions: idl.instructions.length,
      accounts: idl.accounts.length, types: idl.types.length, errors: idl.errors.length},
    newerReferenceMetadata: newer.metadata, newerReferenceAddress: newer.address,
    newerReferenceCounts: {instructions: newer.instructions.length,
      accounts: newer.accounts.length, types: newer.types.length, errors: newer.errors.length},
    instructionsOnlyInDeployed: deployedNames.filter((name) => !newerNames.includes(name)),
    instructionsOnlyInNewerReference: newerNames.filter((name) => !deployedNames.includes(name)),
    testedInstructionDiscriminators: Object.fromEntries(
      testedNames
        .map((name) => [name, Buffer.from(idl.instructions.find((item) => item.name === name)
          .discriminator).toString('hex')])),
  };
  fs.writeFileSync(`${DIR}/${outputStem}.json`, JSON.stringify(idl, null, 2));
  fs.writeFileSync(`${DIR}/${outputStem}-evidence.json`, JSON.stringify(evidence, null, 2));
  return evidence;
}

async function main() {
  const liquidityEvidence = await extract(IDL_ACCOUNT, PROGRAM,
    `${DIR}/jup6qf-source/target/idl/liquidity.json`, 'jup6qf-onchain-idl',
    ['operate', 'pre_operate', 'claim', 'collect_revenue', 'update_exchange_price']);
  const flashEvidence = await extract(FLASH_IDL_ACCOUNT, FLASH_PROGRAM,
    `${DIR}/jup6qf-source/target/idl/flashloan.json`, 'jup6qf-onchain-flash-idl',
    ['flashloan_borrow', 'flashloan_payback']);
  console.log(JSON.stringify({liquidity: liquidityEvidence, flashloan: flashEvidence}));
}

main().catch((error) => {console.error(error.stack || error.message); process.exitCode = 1;});
