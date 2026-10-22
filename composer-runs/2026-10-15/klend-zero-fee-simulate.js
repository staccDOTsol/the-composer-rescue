// Read-only mainnet simulateTransaction controls for exact-zero-rate KLend reserves.
// Signature verification is disabled so existing account owners can serve as
// positive-control signers. This never creates, signs, or submits a transaction.
const fs = require('fs');
const crypto = require('crypto');
const {PublicKey, TransactionInstruction} = require(
  '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const bs58 = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const {encodeV1} = require('./klend-v1-composition.js');

const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split('\n').filter(Boolean).map(line => line.split(/=(.*)/s).slice(0, 2)));
const rpcUrl = env.HEAVY_RPC_URL || env.RPC_URL;
const census = JSON.parse(fs.readFileSync('composer-runs/2026-10-15/klend-zero-fee-census.json'));
const flashHistory = JSON.parse(fs.readFileSync('composer-runs/2026-10-15/kamino-flash-history.json'));
const programId = new PublicKey(census.programId);
const tokenkeg = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const token2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const systemProgram = '11111111111111111111111111111111';
const output = process.env.ZERO_FEE_TARGET ?
  `composer-runs/2026-10-15/klend-zero-fee-simulations-${process.env.ZERO_FEE_TARGET}.json` :
  'composer-runs/2026-10-15/klend-zero-fee-simulations.json';

async function rpc(method, params) {
  const response = await fetch(rpcUrl, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params})});
  const json = await response.json();
  if (json.error) throw new Error(`${method}: ${json.error.code} ${json.error.message}`);
  return json.result;
}

function historicalIx(index) {
  const tx = flashHistory.hits[0].transaction;
  const msg = tx.transaction.message;
  const staticKeys = msg.accountKeys;
  const loaded = tx.meta.loadedAddresses;
  const allKeys = [...staticKeys, ...loaded.writable, ...loaded.readonly];
  const h = msg.header;
  const writable = i => i < staticKeys.length ?
    (i < h.numRequiredSignatures ? i < h.numRequiredSignatures - h.numReadonlySignedAccounts :
      i < staticKeys.length - h.numReadonlyUnsignedAccounts) :
    i < staticKeys.length + loaded.writable.length;
  const source = msg.instructions[index];
  return new TransactionInstruction({programId: new PublicKey(allKeys[source.programIdIndex]),
    keys: source.accounts.map(i => ({pubkey: new PublicKey(allKeys[i]),
      isSigner: i < h.numRequiredSignatures, isWritable: writable(i)})),
    data: Buffer.from(bs58.decode(source.data))});
}
const borrowTemplate = historicalIx(3);
const repayTemplate = historicalIx(13);

function flashIx(template, reserve, mintOwner, user, userToken, amount, repayIndex) {
  const keys = template.keys.map(x => ({...x}));
  const market = new PublicKey(reserve.market);
  const authority = PublicKey.findProgramAddressSync([Buffer.from('lma'), market.toBuffer()],
    programId)[0];
  for (const [index, value] of Object.entries({0: user, 1: authority, 2: market,
    3: reserve.reserve, 4: reserve.mint, 5: reserve.supplyVault,
    6: userToken, 7: reserve.feeVault, 11: mintOwner}))
    keys[Number(index)].pubkey = new PublicKey(value);
  const data = Buffer.from(template.data);
  data.writeBigUInt64LE(amount, 8);
  if (repayIndex !== undefined) data[16] = repayIndex;
  return new TransactionInstruction({programId, keys, data});
}

async function findUserToken(reserve) {
  const mint = await rpc('getAccountInfo', [reserve.mint,
    {encoding: 'base64', commitment: 'confirmed'}]);
  if (!mint.value || ![tokenkeg, token2022].includes(mint.value.owner))
    throw new Error(`Unsupported mint program for ${reserve.name}`);
  const tokenProgram = mint.value.owner;
  let tokenAddresses;
  if (reserve.mint === 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v') {
    // Restored from the successful mainnet flash source transaction.
    tokenAddresses = ['C5D9cS5gAtuSipZJXacjgdpaBhed39GMeMr5CNom8zDw'];
  } else if (reserve.mint === 'So11111111111111111111111111111111111111112') {
    // Existing initialized WSOL account owned by an on-curve System account.
    tokenAddresses = ['ByQm7b58mxeASN8CXov6EiVJzAcmeLARp95oaSfPxJav'];
  } else {
    const largest = await rpc('getTokenLargestAccounts', [reserve.mint,
      {commitment: 'confirmed'}]);
    tokenAddresses = largest.value.map(x => x.address);
  }
  const tokenAccounts = await rpc('getMultipleAccounts', [tokenAddresses,
    {encoding: 'base64', commitment: 'confirmed'}]);
  const candidates = tokenAccounts.value.map((value, i) => {
    if (!value || value.owner !== tokenProgram) return null;
    const data = Buffer.from(value.data[0], 'base64');
    if (data.length < 165 || data[108] !== 1) return null;
    const owner = bs58.encode(data.subarray(32, 64));
    if (!PublicKey.isOnCurve(new PublicKey(owner).toBuffer())) return null;
    return {address: tokenAddresses[i], owner, balanceRaw: data.readBigUInt64LE(64).toString()};
  }).filter(Boolean);
  const owners = [...new Set(candidates.map(x => x.owner))];
  const ownerAccounts = await rpc('getMultipleAccounts', [owners,
    {encoding: 'base64', commitment: 'confirmed'}]);
  const byOwner = new Map(owners.map((key, i) => [key, ownerAccounts.value[i]]));
  const usable = candidates.find(x => byOwner.get(x.owner)?.owner === systemProgram &&
    byOwner.get(x.owner)?.lamports > 50000000);
  if (!usable) throw new Error(`No suitable on-curve System owner for ${reserve.name}`);
  return {...usable, tokenProgram, ownerCheckSlot: ownerAccounts.context.slot};
}

function amountFromSimAccount(account) {
  if (!account || ![tokenkeg, token2022].includes(account.owner)) return null;
  const data = Buffer.from(account.data[0], 'base64');
  return data.length >= 72 ? data.readBigUInt64LE(64).toString() : null;
}

async function runCase(reserve, user, name, amount, latestHash, pre) {
  const borrow = flashIx(borrowTemplate, reserve, user.tokenProgram, user.owner,
    user.address, amount);
  const repay = flashIx(repayTemplate, reserve, user.tokenProgram, user.owner,
    user.address, amount, 0);
  const encoded = encodeV1([borrow, repay], new PublicKey(user.owner), latestHash);
  const watched = [user.address, reserve.supplyVault, reserve.feeVault, reserve.reserve];
  const result = await rpc('simulateTransaction', [encoded.wire.toString('base64'),
    {encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true,
      commitment: 'confirmed', accounts: {encoding: 'base64', addresses: watched}}]);
  const post = result.value.accounts?.map((account, i) => i < 3 ?
    amountFromSimAccount(account) : account?.data ?
      crypto.createHash('sha256').update(Buffer.from(account.data[0], 'base64')).digest('hex') :
      null) || null;
  const reserveAfterData = result.value.accounts?.[3]?.data ?
    Buffer.from(result.value.accounts[3].data[0], 'base64') : null;
  return {name, amountRaw: amount.toString(), slot: result.context.slot,
    err: result.value.err, sizeBytes: encoded.sizeBytes, addressCount: encoded.addressCount,
    unitsConsumed: result.value.unitsConsumed, pre, post,
    reserveAvailableAfterRaw: reserveAfterData?.readBigUInt64LE(224).toString() || null,
    reserveRewardsBudgetAfterRaw: reserveAfterData?.readBigUInt64LE(440).toString() || null,
    balanceDeltasRaw: post && post.slice(0, 3).every(x => x !== null) ?
      post.slice(0, 3).map((x, i) => (BigInt(x) - BigInt(pre[i])).toString()) : null,
    logs: result.value.logs?.filter(x => x.includes('Reserve rewards distributed') ||
      x.includes('Instruction:') ||
      x.includes('failed') || x.includes('Error') || x.includes('success')).slice(-12)};
}

async function main() {
  const desiredAll = [
    ['USDC', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'],
    ['USDe', 'DEkqHyPN7GMRJ5cArtQFAWefqbZb33Hyf6s5iCwjEonT'],
    ['PYUSD', '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo'],
    ['USDG', '2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH'],
    ['SOL', 'So11111111111111111111111111111111111111112'],
  ];
  const desired = process.env.ZERO_FEE_TARGET ? desiredAll.filter(x =>
    x[0] === process.env.ZERO_FEE_TARGET) : desiredAll;
  const latestHash = (await rpc('getLatestBlockhash', [{commitment: 'confirmed'}])).value.blockhash;
  const results = [];
  for (const [symbol, mint] of desired) {
    const reserve = census.activeZero.filter(x => x.mint === mint)
      .sort((a, b) => BigInt(a.availableRaw) > BigInt(b.availableRaw) ? -1 : 1)[0];
    if (!reserve) {results.push({symbol, skipped: 'no active, liquid zero-rate reserve'}); continue;}
    try {
      const user = await findUserToken(reserve);
      const watched = [user.address, reserve.supplyVault, reserve.feeVault, reserve.reserve];
      const prior = await rpc('getMultipleAccounts', [watched,
        {encoding: 'base64', commitment: 'confirmed'}]);
      const pre = prior.value.slice(0, 3).map(amountFromSimAccount);
      const reserveBefore = Buffer.from(prior.value[3].data[0], 'base64');
      const reserveAvailableBeforeRaw = reserveBefore.readBigUInt64LE(224).toString();
      const reserveRewardsBudgetBeforeRaw = reserveBefore.readBigUInt64LE(440).toString();
      const available = BigInt(reserve.availableRaw);
      const amounts = [['one_raw', 1n],
        ['one_unit', 10n ** BigInt(reserve.decimals)],
        ['million_units_or_available', [1000000n * 10n ** BigInt(reserve.decimals),
          available * 9n / 10n].reduce((a, b) => a < b ? a : b)],
        ['ninety_nine_percent_available', available * 99n / 100n],
        ['exact_available', available],
        ['available_plus_one', available + 1n]];
      const cases = [];
      for (const [name, amount] of amounts) {
        try { cases.push(await runCase(reserve, user, name, amount, latestHash, pre)); }
        catch (error) {cases.push({name, amountRaw: amount.toString(), transportError: error.message});}
      }
      results.push({symbol, reserve, userToken: user.address, userOwner: user.owner,
        signerVerification: false, userOwnerProgram: systemProgram,
        tokenProgram: user.tokenProgram, preSlot: prior.context.slot,
        reserveAvailableBeforeRaw, reserveRewardsBudgetBeforeRaw, watched, cases});
      console.log(JSON.stringify({symbol, reserve: reserve.reserve,
        availableRaw: reserve.availableRaw,
        status: cases.map(x => [x.name, x.err || x.transportError || null,
          x.balanceDeltasRaw])}));
    } catch (error) {
      results.push({symbol, reserve: reserve.reserve, setupError: error.message});
      console.log(JSON.stringify({symbol, reserve: reserve.reserve, setupError: error.message}));
    }
  }
  fs.writeFileSync(output, JSON.stringify({observedAt: new Date().toISOString(),
    readOnly: true, noSubmission: true, signerVerification: false,
    programId: programId.toBase58(), sourceFlashSignature: flashHistory.hits[0].signature,
    sourceFlashSlot: flashHistory.hits[0].slot, results}, null, 2));
}
main().catch(error => {console.error(error.message); process.exitCode = 1;});
