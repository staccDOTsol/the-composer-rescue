#!/usr/bin/env node
'use strict';

// Read-only, finalized snapshot of the deployed SPL Governance executable and
// the two selected PHY custody accounts. No transaction is constructed, signed,
// simulated, or submitted by this script.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HERE = __dirname;
const { PublicKey } = require(path.join(HERE, '../onre-harness/node_modules/@solana/web3.js'));
const RPC_ENV = '/tmp/composer-helius-rpc.env';
const PROGRAM = 'GovER5Lthms3bLBqWub97yVrMmEogzX7xNjdXpPPCVZw';
const EXPECTED_PROGRAMDATA = 'BZYjZ2ZbtAawP9WPt5yXszcoMWTvNFFX4AMbnDojtSGL';
const LOADER = 'BPFLoaderUpgradeab1e11111111111111111111111';
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const MINT = 'EswgBj2hZKdgovX2ihWSUDnuBg9VNbGmSGoH5yjNsPRa';
const TARGETS = [
  {
    authority: '6Va7K51FRbnPcYZTUwkoFfoYtnfh8qyJaZqT4W1GGxVi',
    vault: 'C2KKuAq4UaUFYtm3zcxZMSDUuSEfPSk4yLcq5XaBr4wM',
  },
  {
    authority: '2jfAMh48b37bBTKkoNwmvNZAqVQc1G7gh5vYv5FoWTUR',
    vault: '8vXYj8B567R8Di7BUvquiGC7usyPMtL756xx6KERfW9K',
  },
];

const env = Object.fromEntries(fs.readFileSync(RPC_ENV, 'utf8')
  .split(/\n/)
  .filter((line) => line.includes('='))
  .map((line) => line.split(/=(.*)/s).slice(0, 2)));
if (!env.RPC_URL) throw new Error('RPC_URL missing from private environment file');

let requestId = 0;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function rpc(method, params) {
  let lastError;
  for (let attempt = 0; attempt < 7; attempt += 1) {
    try {
      const response = await fetch(env.RPC_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method, params }),
      });
      const body = await response.json();
      if (response.status === 429 || response.status >= 500) throw new Error(`HTTP ${response.status}`);
      if (body.error) throw new Error(`${method}: ${body.error.code} ${body.error.message}`);
      return body.result;
    } catch (error) {
      lastError = error;
      if (attempt < 6) await sleep(400 * (2 ** attempt));
    }
  }
  throw lastError;
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function pubkey(bytes) {
  return new PublicKey(bytes).toBase58();
}

function parseCOptionPubkey(bytes, offset) {
  const option = bytes.readUInt32LE(offset);
  if (option === 0) return null;
  if (option !== 1) throw new Error(`invalid COption<Pubkey> tag ${option} at ${offset}`);
  return pubkey(bytes.subarray(offset + 4, offset + 36));
}

function parseProgram(address, account) {
  const bytes = Buffer.from(account.data[0], 'base64');
  if (account.owner !== LOADER || !account.executable || bytes.length !== 36 || bytes.readUInt32LE(0) !== 2) {
    throw new Error('unexpected upgradeable Program account shape');
  }
  return {
    address,
    owner: account.owner,
    executable: account.executable,
    lamports: account.lamports,
    dataLength: bytes.length,
    loaderState: 'Program',
    programdataAddress: pubkey(bytes.subarray(4, 36)),
    dataSha256: sha256(bytes),
  };
}

function parseProgramData(address, account) {
  const bytes = Buffer.from(account.data[0], 'base64');
  if (account.owner !== LOADER || account.executable || bytes.length < 45 || bytes.readUInt32LE(0) !== 3) {
    throw new Error('unexpected upgradeable ProgramData account shape');
  }
  const authorityOption = bytes[12];
  if (authorityOption !== 0 && authorityOption !== 1) throw new Error(`invalid upgrade authority tag ${authorityOption}`);
  const elfOffset = authorityOption === 1 ? 45 : 13;
  const elf = bytes.subarray(elfOffset);
  if (elf.subarray(0, 4).toString('hex') !== '7f454c46') throw new Error('ProgramData payload is not ELF');
  fs.writeFileSync(path.join(HERE, 'spl-governance-current.so'), elf);
  return {
    address,
    owner: account.owner,
    executable: account.executable,
    lamports: account.lamports,
    dataLength: bytes.length,
    loaderState: 'ProgramData',
    lastDeploymentSlot: Number(bytes.readBigUInt64LE(4)),
    upgradeAuthority: authorityOption === 1 ? pubkey(bytes.subarray(13, 45)) : null,
    elfOffset,
    elfLength: elf.length,
    elfSha256: sha256(elf),
    fullDataSha256: sha256(bytes),
  };
}

function parseMint(address, account) {
  const bytes = Buffer.from(account.data[0], 'base64');
  if (account.owner !== TOKEN_PROGRAM || bytes.length !== 82) throw new Error('unexpected SPL Mint account shape');
  return {
    address,
    owner: account.owner,
    lamports: account.lamports,
    dataLength: bytes.length,
    mintAuthority: parseCOptionPubkey(bytes, 0),
    supply: bytes.readBigUInt64LE(36).toString(),
    decimals: bytes[44],
    initialized: bytes[45] === 1,
    freezeAuthority: parseCOptionPubkey(bytes, 46),
    dataSha256: sha256(bytes),
  };
}

function parseTokenAccount(address, account) {
  const bytes = Buffer.from(account.data[0], 'base64');
  if (account.owner !== TOKEN_PROGRAM || bytes.length !== 165) throw new Error(`unexpected SPL Token account shape for ${address}`);
  return {
    address,
    ownerProgram: account.owner,
    lamports: account.lamports,
    dataLength: bytes.length,
    mint: pubkey(bytes.subarray(0, 32)),
    authority: pubkey(bytes.subarray(32, 64)),
    amount: bytes.readBigUInt64LE(64).toString(),
    delegate: parseCOptionPubkey(bytes, 72),
    state: bytes[108],
    isNativeReserve: bytes.readUInt32LE(109) === 1 ? bytes.readBigUInt64LE(113).toString() : null,
    delegatedAmount: bytes.readBigUInt64LE(121).toString(),
    closeAuthority: parseCOptionPubkey(bytes, 129),
    dataSha256: sha256(bytes),
  };
}

function parseGovernanceState(address, account) {
  const bytes = Buffer.from(account.data[0], 'base64');
  return {
    address,
    owner: account.owner,
    executable: account.executable,
    lamports: account.lamports,
    dataLength: bytes.length,
    accountTypeByte: bytes[0],
    leadingBytesHex: bytes.subarray(0, Math.min(64, bytes.length)).toString('hex'),
    dataBase64: bytes.toString('base64'),
    dataSha256: sha256(bytes),
  };
}

async function main() {
  const startedAt = new Date().toISOString();
  const addresses = [
    PROGRAM,
    EXPECTED_PROGRAMDATA,
    MINT,
    ...TARGETS.flatMap(({ authority, vault }) => [authority, vault]),
  ];
  const snapshot = await rpc('getMultipleAccounts', [addresses, {
    commitment: 'finalized',
    encoding: 'base64',
  }]);
  if (!snapshot?.context?.slot || snapshot.value.length !== addresses.length || snapshot.value.some((value) => !value)) {
    throw new Error('incomplete finalized getMultipleAccounts snapshot');
  }
  const accounts = Object.fromEntries(addresses.map((address, index) => [address, snapshot.value[index]]));
  const program = parseProgram(PROGRAM, accounts[PROGRAM]);
  if (program.programdataAddress !== EXPECTED_PROGRAMDATA) throw new Error('Program points to unexpected ProgramData account');
  const programdata = parseProgramData(EXPECTED_PROGRAMDATA, accounts[EXPECTED_PROGRAMDATA]);
  const mint = parseMint(MINT, accounts[MINT]);
  const targets = TARGETS.map(({ authority, vault }) => {
    const governanceState = parseGovernanceState(authority, accounts[authority]);
    const tokenAccount = parseTokenAccount(vault, accounts[vault]);
    if (governanceState.owner !== PROGRAM) throw new Error(`${authority} is no longer owned by target program`);
    if (tokenAccount.authority !== authority || tokenAccount.mint !== MINT) throw new Error(`${vault} authority or mint changed`);
    return { governanceState, tokenAccount };
  });
  const blockTime = await rpc('getBlockTime', [snapshot.context.slot]);
  const histories = [];
  for (const { authority, vault } of TARGETS) {
    const [authoritySignatures, vaultSignatures] = await Promise.all([
      rpc('getSignaturesForAddress', [authority, { commitment: 'finalized', limit: 1000 }]),
      rpc('getSignaturesForAddress', [vault, { commitment: 'finalized', limit: 1000 }]),
    ]);
    histories.push({
      authority,
      vault,
      authorityHistory: {
        requestedLimit: 1000,
        returned: authoritySignatures.length,
        newestSlot: authoritySignatures[0]?.slot ?? null,
        oldestSlot: authoritySignatures.at(-1)?.slot ?? null,
        successCount: authoritySignatures.filter((row) => row.err === null).length,
        failureCount: authoritySignatures.filter((row) => row.err !== null).length,
        signatures: authoritySignatures,
      },
      vaultHistory: {
        requestedLimit: 1000,
        returned: vaultSignatures.length,
        newestSlot: vaultSignatures[0]?.slot ?? null,
        oldestSlot: vaultSignatures.at(-1)?.slot ?? null,
        successCount: vaultSignatures.filter((row) => row.err === null).length,
        failureCount: vaultSignatures.filter((row) => row.err !== null).length,
        signatures: vaultSignatures,
      },
    });
  }
  const output = {
    generatedAt: new Date().toISOString(),
    startedAt,
    commitment: 'finalized',
    observedSlot: snapshot.context.slot,
    observedBlockTime: blockTime,
    noTransactionsSubmitted: true,
    noSimulationPerformed: true,
    program,
    programdata,
    mint,
    targets,
    histories,
  };
  fs.writeFileSync(path.join(HERE, 'current-snapshot.json'), `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({
    observedSlot: output.observedSlot,
    observedBlockTime: output.observedBlockTime,
    programdata: output.programdata,
    mint: output.mint,
    targets: output.targets.map(({ governanceState, tokenAccount }) => ({
      authority: governanceState.address,
      stateOwner: governanceState.owner,
      stateLength: governanceState.dataLength,
      accountTypeByte: governanceState.accountTypeByte,
      vault: tokenAccount.address,
      amount: tokenAccount.amount,
      tokenAuthority: tokenAccount.authority,
      delegate: tokenAccount.delegate,
      closeAuthority: tokenAccount.closeAuthority,
    })),
    histories: output.histories.map(({ authority, vault, authorityHistory, vaultHistory }) => ({
      authority,
      vault,
      authorityHistory: { ...authorityHistory, signatures: undefined },
      vaultHistory: { ...vaultHistory, signatures: undefined },
    })),
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
