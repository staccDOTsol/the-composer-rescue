#!/usr/bin/env node
// Read-only state-link and signer-provenance proof for the deployed
// `prestaking-solana` binary (name taken from current ELF strings).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PublicKey } = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');

const RPC_URL = process.env.RPC_URL;
if (!RPC_URL) throw new Error('set RPC_URL');
const DIR = __dirname;
const OUT = process.argv[2] || path.join(DIR, 'prestaking-solana-custody.json');
const PROGRAM = '5eSX5ApiNYaFSYWypf3MtBjVZD9axVHBAN4Pp4tLyNJk';
const AUTHORITY = '4qL62rxhqaYjXLzQNVJJ74iLhaXSZutQiQWSSiJjf19f';
const PROOFS = [
  '3p5V9BxhXcZpsUwvRP8N2QahbjnpRm4PWCPNJvbcVpSumGZY5eoiqpBP6JR5HpEHYx1rMqLHMsETuGHDEmCbRy9H',
  'VwU1VK2MzoWhZRKGnVXsAhU5kpEUXqhfjUgKSkhkyUuJ3Y9hKdDq8v6my9zz4yaYwB1JNvMHTrHzyvtqTW37MxK',
];

async function rpc(method, params) {
  const response = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const body = await response.json();
  if (body.error) throw new Error(JSON.stringify(body.error));
  return body.result;
}
const disc = (name) => crypto.createHash('sha256').update(`account:${name}`).digest().subarray(0, 8).toString('hex');

(async () => {
  const census = JSON.parse(fs.readFileSync(path.join(DIR, 'native-stake-authority-census.json'), 'utf8'));
  const stakeGroup = census.retainedWithdrawerGroups.find((row) => row.authority === AUTHORITY);
  if (!stakeGroup) throw new Error('authority missing from retained census');

  const programAccounts = await rpc('getProgramAccounts', [PROGRAM, {
    encoding: 'base64', commitment: 'confirmed', withContext: true, filters: [{ dataSize: 41 }],
  }]);
  const expectedDiscriminators = { ProgramState: disc('ProgramState'), StakeAuthority: disc('StakeAuthority') };
  const decodedState = programAccounts.value.map((row) => {
    const data = Buffer.from(row.account.data[0], 'base64');
    const discriminator = data.subarray(0, 8).toString('hex');
    const accountType = Object.entries(expectedDiscriminators).find(([, value]) => value === discriminator)?.[0] || null;
    return {
      address: row.pubkey,
      accountType,
      discriminator,
      linkedPubkey: new PublicKey(data.subarray(8, 40)).toBase58(),
      storedBump: data[40],
      lamports: String(row.account.lamports),
    };
  });

  const transactions = [];
  for (const signature of PROOFS) {
    const tx = await rpc('getTransaction', [signature, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 1 }]);
    const signerMap = new Map(tx.transaction.message.accountKeys.map((key) => [key.pubkey, key.signer]));
    const programIx = tx.transaction.message.instructions.find((ix) => ix.programId === PROGRAM);
    const innerStake = (tx.meta.innerInstructions || []).flatMap((group) => group.instructions)
      .filter((ix) => ix.programId === 'Stake11111111111111111111111111111111111111')
      .map((ix) => ({ type: ix.parsed?.type || null, info: ix.parsed?.info || null }));
    transactions.push({
      signature,
      slot: tx.slot,
      blockTime: tx.blockTime,
      err: tx.meta.err,
      instructionLog: tx.meta.logMessages.find((line) => line.startsWith('Program log: Instruction:')) || null,
      programAccounts: programIx.accounts.map((address) => ({ address, transactionSigner: Boolean(signerMap.get(address)) })),
      innerStake,
    });
  }
  const output = {
    generatedAt: new Date().toISOString(),
    transport: 'read-only getProgramAccounts/getTransaction; no transaction submitted',
    programId: PROGRAM,
    currentBinaryEvidence: {
      embeddedCratePath: 'programs/prestaking-solana',
      metadataFile: 'native-stake-program-metadata.json',
      sourceVerification: 'No exact public source-to-current-binary binding established.',
    },
    programState: {
      observationSlot: programAccounts.context.slot,
      expectedDiscriminators,
      accounts: decodedState,
      authorityStateLinked: decodedState.some((row) => row.address === AUTHORITY && row.accountType === 'StakeAuthority'),
      authorityPdaSeedStatus: 'Unestablished: the off-curve authority stores bump 255, but the seed preimage was not recovered from a verified source.',
    },
    custody: {
      censusContextSlotMin: census.contextSlotMin,
      censusContextSlotMax: census.contextSlotMax,
      stakeAccounts: stakeGroup,
    },
    signerProvenance: transactions,
    accessObservation: 'Both sampled successful top-level calls include aDmiNDx5cXFLEgXPZn8YbXckprWDHYE7F8GDV1SBs8G as a transaction signer; no permissionless custody exit was established.',
  };
  fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify(output, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
