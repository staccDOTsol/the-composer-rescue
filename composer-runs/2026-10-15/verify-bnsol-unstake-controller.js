#!/usr/bin/env node
// Read-only proof and custody snapshot for the BNSOL unstake controller.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PublicKey } = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');

const RPC_URL = process.env.RPC_URL;
if (!RPC_URL) throw new Error('set RPC_URL');
const DIR = __dirname;
const OUT = process.argv[2] || path.join(DIR, 'bnsol-unstake-custody.json');
const PROGRAM = 'bn1dUNRecofQLxcGp895mGmKEVtFLMjdvjxBjFqhFU7';
const CONFIG = 'CTmYR2C2x94E27Ja3Hzpx68csqQqcqr3BYhX2GoYgi34';
const SOL_WALLET = '59oXzz6wUujTAN3LK5qqmzE9pby6nNHLAujeg9NKuYt8';
const BNSOL_POOL = 'Hr9pzexrBge3vgmBNRR8u42CNQgBXdHm4UkUN2DH4a7r';
const BNSOL_MINT = 'BNso1VUJnh4zcfpZa6986Ea66P6TCp59hvtNJ8b1X85';
const POOL_WITHDRAW = '75NPzpxoh8sXGuSENFMREidq6FMzEx4g2AfcBEB6qjCV';
const PROOFS = [
  'eVcguCtJXSB7FU1WFDFfvmwJn58ppUcVTbmf9bvQzxYGF3vdNcFMv7ML2TSKLZ58iEjLLAPGqWN1JPVsuUgukxW',
  '46ChwDMVxYjUyqZEdEdTiVBeTK3MXkdvBqmaH1yBccwuje4wK4gHPy94rbnxFP5GXBXSPHKrbKoSmfQAnskupKPC',
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
const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

(async () => {
  const census = JSON.parse(fs.readFileSync(path.join(DIR, 'native-stake-authority-census.json'), 'utf8'));
  const stakeGroup = census.retainedWithdrawerGroups.find((row) => row.authority === SOL_WALLET);
  if (!stakeGroup) throw new Error('authority missing from retained census');

  const pid = new PublicKey(PROGRAM);
  const [derivedConfig, configBump] = PublicKey.findProgramAddressSync([Buffer.from('config')], pid);
  const [derivedWallet, walletBump] = PublicKey.findProgramAddressSync([Buffer.from('sol_wallet')], pid);

  const [programAccounts, walletInfo] = await Promise.all([
    rpc('getProgramAccounts', [PROGRAM, { encoding: 'base64', commitment: 'confirmed', withContext: true }]),
    rpc('getAccountInfo', [SOL_WALLET, { encoding: 'base64', commitment: 'confirmed' }]),
  ]);
  const txs = [];
  for (const signature of PROOFS) {
    const tx = await rpc('getTransaction', [signature, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 1 }]);
    const programIx = tx.transaction.message.instructions.find((ix) => ix.programId === PROGRAM);
    const innerStake = (tx.meta.innerInstructions || []).flatMap((group) => group.instructions)
      .filter((ix) => ix.programId === 'Stake11111111111111111111111111111111111111')
      .map((ix) => ({ type: ix.parsed?.type || null, info: ix.parsed?.info || null }));
    txs.push({
      signature,
      slot: tx.slot,
      blockTime: tx.blockTime,
      err: tx.meta.err,
      instructionLog: tx.meta.logMessages.find((line) => line.startsWith('Program log: Instruction:')) || null,
      programAccounts: programIx.accounts,
      innerStake,
    });
  }

  const ownedAccounts = programAccounts.value.map((row) => {
    const data = Buffer.from(row.account.data[0], 'base64');
    return { address: row.pubkey, dataBytes: data.length, dataSha256: sha256(data), lamports: String(row.account.lamports) };
  });
  const output = {
    generatedAt: new Date().toISOString(),
    transport: 'read-only getProgramAccounts/getAccountInfo/getTransaction; no transaction submitted',
    programId: PROGRAM,
    programState: {
      observationSlot: programAccounts.context.slot,
      programOwnedAccountCount: ownedAccounts.length,
      accounts: ownedAccounts,
      config: { expected: CONFIG, derived: derivedConfig.toBase58(), bump: configBump, verified: derivedConfig.toBase58() === CONFIG, seedFormula: '["config"]' },
      solWallet: { expected: SOL_WALLET, derived: derivedWallet.toBase58(), bump: walletBump, verified: derivedWallet.toBase58() === SOL_WALLET, seedFormula: '["sol_wallet"]' },
    },
    linkedStandardStakePool: {
      stakePool: BNSOL_POOL,
      poolMint: BNSOL_MINT,
      withdrawAuthority: POOL_WITHDRAW,
      relationship: 'The controller withdraws stake from this standard SPL Stake Pool, burns/transfers BNSOL, reauthorizes the split stake to solWallet, deactivates it, then withdraws SOL to solWallet.',
    },
    custody: {
      censusContextSlotMin: census.contextSlotMin,
      censusContextSlotMax: census.contextSlotMax,
      stakeAccounts: stakeGroup,
      systemSolObservationSlot: walletInfo.context.slot,
      systemSolLamports: String(walletInfo.value.lamports),
      systemSol: walletInfo.value.lamports / 1e9,
      grossSol: stakeGroup.sol + (walletInfo.value.lamports / 1e9),
    },
    signerProvenance: txs,
  };
  fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify(output, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
