// Read-only mainnet simulations. Builds accepted Solana v1 wire transactions;
// it never submits a transaction and never signs with a live key.
const fs = require('fs');
const crypto = require('crypto');
const {
  Connection, PublicKey, TransactionInstruction,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const bs58 = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const {encodeV1} = require('../klend-v1-composition.js');

const envPath = fs.existsSync('/tmp/composer-helius-only.env')
  ? '/tmp/composer-helius-only.env' : '/tmp/composer-helius-rpc.env';
const env = Object.fromEntries(fs.readFileSync(envPath, 'utf8')
  .split('\n').filter(Boolean).map(line => line.split(/=(.*)/s).slice(0, 2)));
const rpcUrl = env.HEAVY_RPC_URL || env.RPC_URL || env.SOLANA_RPC_URL;
if (!rpcUrl) throw new Error('No read-only RPC configured');
const conn = new Connection(rpcUrl, 'confirmed');
const P = value => new PublicKey(value);

const PROGRAM = P('vesFcnNXtfS9JMtspbe9SkMJiRiSPwsywuWMjYwxQ2K');
const KLEND = P('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');
const TOKEN = P('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ATA = P('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const SYSTEM = P('11111111111111111111111111111111');
const BENEFICIARY = P('H771Wtz49Y9SE6Ghmn8JYYig4gqmceCcnSUHvzbm1EdM');
const BENEFICIARY_ATA = P('ACNRX3TfWSc4xB6xgeXt4KXkAXGZi1z1xwSYwEr2NDmb');
const OUTSIDER = P('ATzqChvNcqn92nM66HTSo33VBy9MmgPZCS57LwMAmzNL');
const OUTSIDER_ATA = P('AnQ7Rcc5Y2i7yZnwkrcRKXGMQF9X3T26CH4iXNxGXDnZ');
const VESTING = P('Ftk41smBgQ5tiFsDpBatfofHjYgpS4TcnzwDdw1CsaTC');
const VESTING_VAULT = P('C7J4nzXwVJpPRhSW43EUNomPci7tMjjzrGT93BYuMho');
const OTHER_VESTING = P('EL4CpiRgYZVmSs3SvAdJTAcnBogVUzrNDTyzWz2JNTk3');
const OTHER_VAULT = P('6hmV2nDeHQVxoa71C9HmvnYvg7zFck2s2YdGGSC3AYRM');
const CLAIM = P('JW9gztFCfsDunWDSPs6CLJQypMPkRZE957NfJ4Xouwy');
const MINT = P('2Wu1g2ft7qZHfTpfzP3wLdfPeV1is4EwQ3CXBfRYAciD');
const FLASH_OWNER = P('B36gY52xxE5jTm77CcPiemtpqEnif6Lcw3Qh2TcjdZY1');
const FLASH_DEST = P('3rYyUVvjsgXAVqTQc2QVudZZx4tCtz7eXyaQavQarCnf');
const CLAIM_DATA = Buffer.from('3ec6d6c1d59f6cd200', 'hex');
const NEAR_FLASH_AMOUNT = 7789632497552n; // previously funded successful control amount

const [outsiderClaim, outsiderClaimBump] = PublicKey.findProgramAddressSync(
  [Buffer.from('smithii_claim'), VESTING.toBuffer(), OUTSIDER.toBuffer()], PROGRAM);
const [beneficiaryOtherClaim, beneficiaryOtherClaimBump] = PublicKey.findProgramAddressSync(
  [Buffer.from('smithii_claim'), OTHER_VESTING.toBuffer(), BENEFICIARY.toBuffer()], PROGRAM);
const [derivedVesting, vestingBump] = PublicKey.findProgramAddressSync(
  [Buffer.from('smithii_vesting'), MINT.toBuffer(), BENEFICIARY.toBuffer()], PROGRAM);
const [derivedOtherVesting, otherVestingBump] = PublicKey.findProgramAddressSync(
  [Buffer.from('smithii_vesting'), MINT.toBuffer(), OUTSIDER.toBuffer()], PROGRAM);

function claimIx({signer = BENEFICIARY, destination = BENEFICIARY_ATA,
  vesting = VESTING, vault = VESTING_VAULT, claim = CLAIM,
  mint = MINT, data = CLAIM_DATA, aliases = {}} = {}) {
  const accounts = [signer, destination, vesting, vault, claim, mint, TOKEN, ATA, SYSTEM]
    .map((x, i) => aliases[i] || x);
  return new TransactionInstruction({programId: PROGRAM, keys: accounts.map((pubkey, i) => ({
    pubkey, isSigner: i === 0, isWritable: i < 5,
  })), data: Buffer.from(data)});
}

const source = JSON.parse(fs.readFileSync('composer-runs/2026-10-15/kamino-flash-history.json'));
const sample = source.hits[0].transaction;
const smsg = sample.transaction.message;
const staticKeys = smsg.accountKeys;
const allKeys = [...staticKeys, ...(sample.meta.loadedAddresses?.writable || []),
  ...(sample.meta.loadedAddresses?.readonly || [])];
const shead = smsg.header;
const writable = idx => idx < staticKeys.length
  ? (idx < shead.numRequiredSignatures
    ? idx < shead.numRequiredSignatures - shead.numReadonlySignedAccounts
    : idx < staticKeys.length - shead.numReadonlyUnsignedAccounts)
  : idx < staticKeys.length + (sample.meta.loadedAddresses?.writable?.length || 0);
function sourceIx(idx) {
  const src = smsg.instructions[idx];
  return new TransactionInstruction({programId: P(allKeys[src.programIdIndex]),
    keys: src.accounts.map(i => ({pubkey: P(allKeys[i]),
      isSigner: i < shead.numRequiredSignatures, isWritable: writable(i)})),
    data: Buffer.from(bs58.decode(src.data))});
}
const originalBorrow = sourceIx(3);
const originalRepay = sourceIx(13);
if (!originalBorrow.programId.equals(KLEND) || !originalRepay.programId.equals(KLEND))
  throw new Error('Historical KLend instruction indexes changed');
const flashSupply = originalBorrow.keys[5].pubkey;
const flashReserve = originalBorrow.keys[3].pubkey;
const flashFeeVault = originalRepay.keys[7].pubkey;
function setFlash(ix, amount, repayIndex) {
  const keys = ix.keys.map(x => ({...x}));
  keys[0].pubkey = FLASH_OWNER;
  keys[6].pubkey = FLASH_DEST;
  const data = Buffer.from(ix.data);
  data.writeBigUInt64LE(amount, 8);
  if (repayIndex !== undefined) data[16] = repayIndex;
  return new TransactionInstruction({programId: ix.programId, keys, data});
}

const traceAddresses = [...new Set([
  BENEFICIARY_ATA, VESTING_VAULT, VESTING, CLAIM, OUTSIDER_ATA,
  OTHER_VAULT, OTHER_VESTING, outsiderClaim, beneficiaryOtherClaim,
  FLASH_DEST, flashSupply, flashFeeVault, flashReserve,
].map(x => x.toBase58()))].map(P);

function sha256(data) { return crypto.createHash('sha256').update(data).digest('hex'); }
function decodeAccount(address, account) {
  if (!account) return null;
  const data = Buffer.from(Array.isArray(account.data) ? account.data[0] : account.data, 'base64');
  const out = {address, owner: account.owner, lamports: account.lamports,
    dataLength: data.length, dataSha256: sha256(data)};
  if (account.owner === TOKEN.toBase58() && data.length === 165) {
    out.kind = 'splToken';
    out.mint = new PublicKey(data.subarray(0, 32)).toBase58();
    out.authority = new PublicKey(data.subarray(32, 64)).toBase58();
    out.amountRaw = data.readBigUInt64LE(64).toString();
  } else if (account.owner === PROGRAM.toBase58() && data.length === 324) {
    out.kind = 'vesting';
    out.discriminatorHex = data.subarray(0, 8).toString('hex');
    out.beneficiary = new PublicKey(data.subarray(8, 40)).toBase58();
    out.mint = new PublicKey(data.subarray(40, 72)).toBase58();
    out.totalAmountRaw = data.readBigUInt64LE(72).toString();
    out.createdAt = data.readBigInt64LE(80).toString();
    out.finalUnlockAt = data.readBigInt64LE(88).toString();
    out.periods = Array.from({length: data.readUInt32LE(96)}, (_, i) => {
      const offset = 100 + i * 9;
      return {timestamp: data.readBigInt64LE(offset).toString(), percentage: data[offset + 8]};
    });
  } else if (account.owner === PROGRAM.toBase58() && data.length === 9) {
    out.kind = 'claim';
    out.discriminatorHex = data.subarray(0, 8).toString('hex');
    out.claimedPeriodCount = data[8];
  } else {
    out.kind = 'other';
  }
  return out;
}
async function rpc(id, method, params) {
  const response = await fetch(rpcUrl, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id, method, params})});
  return response.json();
}
function summarizeIx(ix) {
  return {programId: ix.programId.toBase58(),
    accounts: ix.keys.map(x => ({pubkey: x.pubkey.toBase58(), signer: x.isSigner,
      writable: x.isWritable})), dataHex: Buffer.from(ix.data).toString('hex')};
}
async function simulate(name, instructions, payer, blockhash, preByAddress) {
  const encoded = encodeV1(instructions, payer, blockhash);
  const referenced = new Set([payer.toBase58()]);
  for (const ix of instructions) {
    referenced.add(ix.programId.toBase58());
    for (const key of ix.keys) referenced.add(key.pubkey.toBase58());
  }
  const responseTrace = traceAddresses.filter(x => referenced.has(x.toBase58()));
  const response = await rpc(name, 'simulateTransaction', [encoded.wire.toString('base64'), {
    encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true,
    commitment: 'confirmed', accounts: {encoding: 'base64',
      addresses: responseTrace.map(x => x.toBase58())},
  }]);
  const value = response.result?.value;
  const post = Object.fromEntries(responseTrace.map((address, i) => [address.toBase58(),
    decodeAccount(address.toBase58(), value?.accounts?.[i])]));
  const tokenDeltas = {};
  for (const address of responseTrace.map(x => x.toBase58())) {
    const before = preByAddress[address];
    const after = post[address];
    if (before?.kind === 'splToken' && after?.kind === 'splToken')
      tokenDeltas[address] = (BigInt(after.amountRaw) - BigInt(before.amountRaw)).toString();
  }
  return {name, slot: response.result?.context?.slot, transportError: response.error || null,
    err: value?.err || null, wireFormat: 'Solana v1', wireBytes: encoded.sizeBytes,
    v0EquivalentBytes: encoded.v0Bytes, wireSha256: sha256(encoded.wire),
    wireBase64: encoded.wire.toString('base64'), addressCount: encoded.addressCount,
    writableCount: encoded.writableCount, instructionCount: encoded.instructionCount,
    requiredSignatures: encoded.requiredSignatures, config: encoded.config,
    payer: payer.toBase58(), instructions: instructions.map(summarizeIx),
    returnedAccountAddresses: responseTrace.map(x => x.toBase58()),
    unitsConsumed: value?.unitsConsumed ?? null,
    loadedAccountsDataSize: value?.loadedAccountsDataSize ?? null,
    post, tokenDeltas, logs: value?.logs || null};
}

(async () => {
  const blockhash = (await conn.getLatestBlockhash('confirmed')).blockhash;
  const beforeRaw = await conn.getMultipleAccountsInfoAndContext(traceAddresses, 'confirmed');
  const pre = Object.fromEntries(traceAddresses.map((address, i) => [address.toBase58(),
    beforeRaw.value[i] ? decodeAccount(address.toBase58(), {
      owner: beforeRaw.value[i].owner.toBase58(), lamports: beforeRaw.value[i].lamports,
      data: [beforeRaw.value[i].data.toString('base64'), 'base64'],
    }) : null]));
  const vestingPre = pre[VESTING.toBase58()];
  const claimPre = pre[CLAIM.toBase58()];
  const slotTime = await conn.getBlockTime(beforeRaw.context.slot);
  const unlockedPercentage = vestingPre.periods
    .filter(x => BigInt(x.timestamp) <= BigInt(slotTime)).reduce((sum, x) => sum + x.percentage, 0);
  const expectedVestedRaw = BigInt(vestingPre.totalAmountRaw) * BigInt(unlockedPercentage) / 100n;
  const expectedClaimableRaw = BigInt(vestingPre.totalAmountRaw) *
    BigInt(unlockedPercentage - claimPre.claimedPeriodCount) / 100n;

  const normal = claimIx();
  const targetSpecs = [
    ['positive_current_claim', [normal], BENEFICIARY],
    ['outsider_with_existing_claim_pda', [claimIx({signer: OUTSIDER,
      destination: OUTSIDER_ATA})], OUTSIDER],
    ['outsider_with_canonical_outsider_claim_pda', [claimIx({signer: OUTSIDER,
      destination: OUTSIDER_ATA, claim: outsiderClaim})], OUTSIDER],
    ['beneficiary_with_alternate_destination', [claimIx({destination: OUTSIDER_ATA})], BENEFICIARY],
    ['beneficiary_with_foreign_vault', [claimIx({vault: OTHER_VAULT})], BENEFICIARY],
    ['beneficiary_with_foreign_vesting_and_derived_claim', [claimIx({vesting: OTHER_VESTING,
      vault: OTHER_VAULT, claim: beneficiaryOtherClaim})], BENEFICIARY],
    ['claim_data_merkle_option_missing_payload', [claimIx({data: Buffer.from(
      '3ec6d6c1d59f6cd201', 'hex')})], BENEFICIARY],
    ['alias_claim_to_vesting', [claimIx({aliases: {4: VESTING}})], BENEFICIARY],
    ['reorder_destination_and_vesting', [claimIx({aliases: {1: VESTING, 2: BENEFICIARY_ATA}})],
      BENEFICIARY],
    ['duplicate_claim_atomic_rollback', [normal, normal], BENEFICIARY],
    ['triple_claim_atomic_rollback', [normal, normal, normal], BENEFICIARY],
  ];
  const results = [];
  for (const [name, ixs, payer] of targetSpecs) {
    const result = await simulate(name, ixs, payer, blockhash, pre);
    results.push(result);
    console.log(JSON.stringify({name, err: result.err, bytes: result.wireBytes,
      addresses: result.addressCount, units: result.unitsConsumed,
      beneficiaryDelta: result.tokenDeltas[BENEFICIARY_ATA.toBase58()] || null,
      vaultDelta: result.tokenDeltas[VESTING_VAULT.toBase58()] || null,
      lastLogs: result.logs?.slice(-5)}));
  }

  const flashSpecs = [];
  const addFlash = (name, amount, placement, wrongRepayIndex = false) => {
    let ixs;
    if (placement === 'between') ixs = [setFlash(originalBorrow, amount), normal,
      setFlash(originalRepay, amount, wrongRepayIndex ? 1 : 0)];
    if (placement === 'before') ixs = [normal, setFlash(originalBorrow, amount),
      setFlash(originalRepay, amount, wrongRepayIndex ? 0 : 1)];
    if (placement === 'after') ixs = [setFlash(originalBorrow, amount),
      setFlash(originalRepay, amount, wrongRepayIndex ? 1 : 0), normal];
    flashSpecs.push([name, ixs, FLASH_OWNER]);
  };
  addFlash('klend_dust_1_claim_between_repay', 1n, 'between');
  addFlash('klend_near_liquidity_claim_between_repay', NEAR_FLASH_AMOUNT, 'between');
  addFlash('claim_before_klend_dust_pair', 1n, 'before');
  addFlash('klend_dust_pair_before_claim', 1n, 'after');
  addFlash('klend_wrong_repay_index_with_claim', 1n, 'between', true);
  flashSpecs.push(['klend_two_dust_legs_one_claim', [
    setFlash(originalBorrow, 1n), normal, setFlash(originalRepay, 1n, 0),
    setFlash(originalBorrow, 2n), setFlash(originalRepay, 2n, 3),
  ], FLASH_OWNER]);
  flashSpecs.push(['klend_dust_with_duplicate_claim_atomic_rollback', [
    setFlash(originalBorrow, 1n), normal, normal, setFlash(originalRepay, 1n, 0),
  ], FLASH_OWNER]);
  const flashResults = [];
  for (const [name, ixs, payer] of flashSpecs) {
    const result = await simulate(name, ixs, payer, blockhash, pre);
    flashResults.push(result);
    console.log(JSON.stringify({name, err: result.err, bytes: result.wireBytes,
      addresses: result.addressCount, signatures: result.requiredSignatures,
      units: result.unitsConsumed,
      beneficiaryDelta: result.tokenDeltas[BENEFICIARY_ATA.toBase58()] || null,
      vaultDelta: result.tokenDeltas[VESTING_VAULT.toBase58()] || null,
      flashDestDelta: result.tokenDeltas[FLASH_DEST.toBase58()] || null,
      flashSupplyDelta: result.tokenDeltas[flashSupply.toBase58()] || null,
      feeVaultDelta: result.tokenDeltas[flashFeeVault.toBase58()] || null,
      lastLogs: result.logs?.slice(-7)}));
  }

  const output = {generatedAt: new Date().toISOString(), liveSubmission: false,
    simulationOnly: true, sigVerify: false, currentCommitment: 'confirmed',
    preSlot: beforeRaw.context.slot, preBlockTime: slotTime, pre,
    programs: {vesting: PROGRAM.toBase58(), klend: KLEND.toBase58()},
    derivations: {
      vesting: {address: derivedVesting.toBase58(), bump: vestingBump,
        seeds: ['smithii_vesting', MINT.toBase58(), BENEFICIARY.toBase58()]},
      otherVesting: {address: derivedOtherVesting.toBase58(), bump: otherVestingBump,
        seeds: ['smithii_vesting', MINT.toBase58(), OUTSIDER.toBase58()]},
      claim: {address: CLAIM.toBase58(), bump: PublicKey.findProgramAddressSync(
        [Buffer.from('smithii_claim'), VESTING.toBuffer(), BENEFICIARY.toBuffer()], PROGRAM)[1],
        seeds: ['smithii_claim', VESTING.toBase58(), BENEFICIARY.toBase58()]},
      outsiderClaim: {address: outsiderClaim.toBase58(), bump: outsiderClaimBump,
        seeds: ['smithii_claim', VESTING.toBase58(), OUTSIDER.toBase58()]},
      beneficiaryOtherClaim: {address: beneficiaryOtherClaim.toBase58(), bump: beneficiaryOtherClaimBump,
        seeds: ['smithii_claim', OTHER_VESTING.toBase58(), BENEFICIARY.toBase58()]},
    },
    math: {totalAmountRaw: vestingPre.totalAmountRaw, unlockedPercentage,
      alreadyClaimedPercentage: claimPre.claimedPeriodCount,
      expectedVestedRaw: expectedVestedRaw.toString(),
      expectedClaimableRaw: expectedClaimableRaw.toString(), periods: vestingPre.periods},
    klend: {sourceSignature: source.hits[0].signature, sourceSlot: source.hits[0].slot,
      reserve: flashReserve.toBase58(), liquiditySupply: flashSupply.toBase58(),
      feeVault: flashFeeVault.toBase58(), borrowerTokenAccount: FLASH_DEST.toBase58(),
      dustAmountRaw: '1', nearFlashAmountRaw: NEAR_FLASH_AMOUNT.toString(),
      assetRelationship: 'USDC flash asset is distinct from GOHOME vesting asset'},
    traceAddresses: traceAddresses.map(x => x.toBase58()), targetResults: results, flashResults,
  };
  const outPath = 'composer-runs/2026-10-15/vesfcn-current-audit-work/vesfcn-v1-simulations.json';
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify({outPath, targetResults: results.length,
    flashResults: flashResults.length, expectedClaimableRaw: expectedClaimableRaw.toString()}));
})().catch(error => {console.error(error.stack); process.exitCode = 1;});
