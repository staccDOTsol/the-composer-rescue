// Read-only Wormhole Token Bridge deployment/custody/redeem audit.
// This script performs only RPC reads and simulateTransaction calls; it never submits a transaction.
const crypto = require('crypto');
const fs = require('fs');
const {
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const bs58 = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');

const OUT = '/Users/stacc/the-composer-rescue/composer-runs/2026-10-15';
const PROGRAM = new PublicKey('wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb');
const CORE = new PublicKey('worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth');
const TOKEN = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const TOKEN_2022 = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const SYSTEM = new PublicKey('11111111111111111111111111111111');
const RENT = new PublicKey('SysvarRent111111111111111111111111111111111');
const LOADER = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const pk = (value) => value instanceof PublicKey ? value : new PublicKey(value);
const meta = (pubkey, isWritable = false, isSigner = false) => ({ pubkey: pk(pubkey), isWritable, isSigner });

function parseUpgradeable(info) {
  if (!info || !info.owner.equals(LOADER) || info.data.length < 4) return null;
  const tag = info.data.readUInt32LE(0);
  if (tag === 2 && info.data.length >= 36) {
    return { tag, type: 'program', programData: new PublicKey(info.data.subarray(4, 36)).toBase58() };
  }
  if (tag === 3 && info.data.length >= 13) {
    const authorityOption = info.data[12];
    const elfOffset = authorityOption === 1 ? 45 : 13;
    return {
      tag,
      type: 'programData',
      slot: info.data.readBigUInt64LE(4).toString(),
      upgradeAuthority: authorityOption === 1
        ? new PublicKey(info.data.subarray(13, 45)).toBase58()
        : null,
      elfOffset,
      elfLength: info.data.length - elfOffset,
      elfSha256: sha256(info.data.subarray(elfOffset)),
    };
  }
  return { tag, type: 'unknown' };
}

function parseTokenAccount(info) {
  if (!info || info.data.length < 72) return null;
  return {
    ownerProgram: info.owner.toBase58(),
    mint: new PublicKey(info.data.subarray(0, 32)).toBase58(),
    authority: new PublicKey(info.data.subarray(32, 64)).toBase58(),
    amount: info.data.readBigUInt64LE(64).toString(),
  };
}

function parsePostedTransfer(pubkey, data) {
  if (data.length !== 228 || data.subarray(0, 3).toString() !== 'vaa' || data[95] !== 1) return null;
  const emitterChain = data.readUInt16LE(57);
  const emitterAddressBytes = Buffer.from(data.subarray(59, 91));
  const sequence = data.readBigUInt64LE(49);
  const payload = data.subarray(95);
  const amount = BigInt(`0x${payload.subarray(1, 33).toString('hex')}`).toString();
  const mint = new PublicKey(payload.subarray(33, 65));
  const tokenChain = payload.readUInt16BE(65);
  const to = new PublicKey(payload.subarray(67, 99));
  const toChain = payload.readUInt16BE(99);
  const fee = BigInt(`0x${payload.subarray(101, 133).toString('hex')}`).toString();
  const chainBe = Buffer.from([emitterChain >> 8, emitterChain & 0xff]);
  const sequenceBe = Buffer.from(sequence.toString(16).padStart(16, '0'), 'hex');
  const [claim] = PublicKey.findProgramAddressSync(
    [emitterAddressBytes, chainBe, sequenceBe],
    PROGRAM,
  );
  const [endpoint] = PublicKey.findProgramAddressSync([chainBe, emitterAddressBytes], PROGRAM);
  const [custody] = PublicKey.findProgramAddressSync([mint.toBuffer()], PROGRAM);
  return {
    postedVaa: pubkey,
    emitterChain,
    emitterAddress: new PublicKey(emitterAddressBytes),
    sequence: sequence.toString(),
    amount,
    fee,
    mint,
    tokenChain,
    to,
    toChain,
    claim,
    endpoint,
    custody,
  };
}

function jsonCandidate(item) {
  return Object.fromEntries(Object.entries(item).map(([key, value]) => [
    key,
    value instanceof PublicKey ? value.toBase58() : value,
  ]));
}

function decodeSimulationAccount(account) {
  if (!account) return null;
  const data = Buffer.from(account.data[0], 'base64');
  return {
    exists: true,
    owner: account.owner,
    lamports: account.lamports,
    dataLength: data.length,
    tokenAmount: data.length >= 72 ? data.readBigUInt64LE(64).toString() : null,
    dataSha256: sha256(data),
  };
}

async function rpcSimulate(connection, instructions, payer, monitor) {
  const blockhash = (await connection.getLatestBlockhash('confirmed')).blockhash;
  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message();
  const transaction = new VersionedTransaction(message);
  const body = {
    jsonrpc: '2.0',
    id: 1,
    method: 'simulateTransaction',
    params: [
      Buffer.from(transaction.serialize()).toString('base64'),
      {
        encoding: 'base64',
        sigVerify: false,
        replaceRecentBlockhash: true,
        commitment: 'confirmed',
        accounts: {
          encoding: 'base64',
          addresses: monitor.map((x) => x.toBase58()),
        },
      },
    ],
  };
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await fetch(connection.rpcEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    if (response.status === 429 || text.startsWith('Too Many Requests')) {
      await new Promise((resolve) => setTimeout(resolve, 750 * (attempt + 1)));
      continue;
    }
    const json = JSON.parse(text);
    if (json.error) throw new Error(JSON.stringify(json.error));
    return json.result;
  }
  throw new Error('RPC rate limited simulateTransaction after six retries');
}

function completeNativeInstruction(candidate, payer, overrides = {}) {
  const [config] = PublicKey.findProgramAddressSync([Buffer.from('config')], PROGRAM);
  const [custodySigner] = PublicKey.findProgramAddressSync([Buffer.from('custody_signer')], PROGRAM);
  const keys = [
    meta(payer, true, true),
    meta(config),
    meta(candidate.postedVaa),
    meta(candidate.claim, true),
    meta(candidate.endpoint),
    meta(candidate.to, true),
    meta(candidate.to, true),
    meta(candidate.custody, true),
    meta(candidate.mint),
    meta(custodySigner),
    meta(RENT),
    meta(SYSTEM),
    meta(CORE),
    meta(candidate.tokenProgram || TOKEN),
  ];
  for (const [index, value] of Object.entries(overrides)) {
    keys[Number(index)].pubkey = pk(value);
  }
  return new TransactionInstruction({ programId: PROGRAM, keys, data: Buffer.from([2]) });
}

async function getDeployment(connection) {
  const [config] = PublicKey.findProgramAddressSync([Buffer.from('config')], PROGRAM);
  const [custodySigner, custodySignerBump] = PublicKey.findProgramAddressSync([Buffer.from('custody_signer')], PROGRAM);
  const [authoritySigner] = PublicKey.findProgramAddressSync([Buffer.from('authority_signer')], PROGRAM);
  const [mintSigner] = PublicKey.findProgramAddressSync([Buffer.from('mint_signer')], PROGRAM);
  const programInfo = await connection.getAccountInfo(PROGRAM, 'confirmed');
  const programAccount = parseUpgradeable(programInfo);
  const programDataKey = new PublicKey(programAccount.programData);
  const [programDataInfo, configInfo] = await connection.getMultipleAccountsInfo([programDataKey, config], 'confirmed');
  return {
    observedSlot: await connection.getSlot('confirmed'),
    program: PROGRAM.toBase58(),
    programOwner: programInfo.owner.toBase58(),
    executable: programInfo.executable,
    programAccount,
    programData: parseUpgradeable(programDataInfo),
    config: {
      address: config.toBase58(),
      owner: configInfo.owner.toBase58(),
      dataLength: configInfo.data.length,
      wormholeCoreBridge: new PublicKey(configInfo.data.subarray(0, 32)).toBase58(),
    },
    pdas: {
      custodySigner: custodySigner.toBase58(),
      custodySignerBump,
      authoritySigner: authoritySigner.toBase58(),
      mintSigner: mintSigner.toBase58(),
    },
  };
}

async function getCustody(connection, deployment) {
  const signer = new PublicKey(deployment.pdas.custodySigner);
  const rows = [];
  let firstObservationSlot = null;
  for (const tokenProgram of [TOKEN, TOKEN_2022]) {
    const result = await connection.getTokenAccountsByOwner(signer, { programId: tokenProgram }, 'confirmed');
    if (firstObservationSlot === null) firstObservationSlot = result.context.slot;
    for (const entry of result.value) {
      const parsed = parseTokenAccount(entry.account);
      const mint = new PublicKey(parsed.mint);
      const [expected] = PublicKey.findProgramAddressSync([mint.toBuffer()], PROGRAM);
      rows.push({
        address: entry.pubkey.toBase58(),
        mint: parsed.mint,
        authority: parsed.authority,
        tokenProgram: tokenProgram.toBase58(),
        rawAmount: parsed.amount,
        custodyPdaMatches: expected.equals(entry.pubkey),
        authorityMatches: parsed.authority === signer.toBase58(),
      });
    }
  }
  const verified = rows.filter((row) => row.custodyPdaMatches && row.authorityMatches && row.rawAmount !== '0');
  const mints = [...new Set(verified.map((row) => row.mint))];
  const prices = {};
  for (let index = 0; index < mints.length; index += 70) {
    const ids = mints.slice(index, index + 70).map((mint) => `solana:${mint}`).join(',');
    const response = await fetch(`https://coins.llama.fi/prices/current/${ids}`);
    if (response.ok) Object.assign(prices, (await response.json()).coins || {});
  }
  let pricedGrossUsdLowerBound = 0;
  let pricedCustodies = 0;
  for (const row of verified) {
    const price = prices[`solana:${row.mint}`];
    if (!price) continue;
    row.valuation = {
      symbol: price.symbol,
      amount: Number(row.rawAmount) / 10 ** price.decimals,
      usdPrice: price.price,
      usdValue: Number(row.rawAmount) / 10 ** price.decimals * price.price,
      priceTimestamp: price.timestamp,
    };
    pricedCustodies += 1;
    pricedGrossUsdLowerBound += row.valuation.usdValue;
  }
  return {
    timestamp: new Date().toISOString(),
    firstObservationSlot,
    lastObservationSlot: await connection.getSlot('confirmed'),
    program: PROGRAM.toBase58(),
    custodySigner: signer.toBase58(),
    custodySignerBump: deployment.pdas.custodySignerBump,
    tokenAccountCount: rows.length,
    verifiedNonzeroCustodies: verified.length,
    pricedCustodies,
    unpricedCustodies: verified.length - pricedCustodies,
    pricedGrossUsdLowerBound,
    rows,
  };
}

async function getUnclaimedCandidates(connection) {
  const accounts = await connection.getProgramAccounts(CORE, {
    commitment: 'confirmed',
    filters: [
      { dataSize: 228 },
      { memcmp: { offset: 0, bytes: bs58.encode(Buffer.from('vaa')) } },
      { memcmp: { offset: 95, bytes: bs58.encode(Buffer.from([1])) } },
      { memcmp: { offset: 194, bytes: bs58.encode(Buffer.from([0, 1])) } },
    ],
  });
  const parsed = accounts.map(({ pubkey, account }) => parsePostedTransfer(pubkey, account.data)).filter(Boolean);
  const unclaimed = [];
  for (let index = 0; index < parsed.length; index += 50) {
    const slice = parsed.slice(index, index + 50);
    const claims = await connection.getMultipleAccountsInfo(slice.map((item) => item.claim), 'confirmed');
    for (let offset = 0; offset < slice.length; offset += 1) {
      if (!claims[offset]) unclaimed.push(slice[offset]);
    }
  }
  const viable = [];
  for (let index = 0; index < unclaimed.length; index += 20) {
    const slice = unclaimed.slice(index, index + 20);
    const infos = await connection.getMultipleAccountsInfo(
      slice.flatMap((item) => [item.to, item.custody, item.mint, item.endpoint]),
      'confirmed',
    );
    for (let offset = 0; offset < slice.length; offset += 1) {
      const item = slice[offset];
      const toInfo = infos[offset * 4];
      const custodyInfo = infos[offset * 4 + 1];
      const mintInfo = infos[offset * 4 + 2];
      const endpointInfo = infos[offset * 4 + 3];
      const toAccount = parseTokenAccount(toInfo);
      const custodyAccount = parseTokenAccount(custodyInfo);
      if (
        item.tokenChain === 1
        && toAccount
        && custodyAccount
        && toAccount.mint === item.mint.toBase58()
        && custodyAccount.mint === item.mint.toBase58()
        && mintInfo
        && endpointInfo
        && BigInt(custodyAccount.amount) >= BigInt(item.amount)
      ) {
        viable.push({
          ...item,
          tokenProgram: mintInfo.owner,
          toAccount,
          custodyAccount,
          endpointOwner: endpointInfo.owner.toBase58(),
        });
      }
    }
  }
  return { observedSlot: await connection.getSlot('confirmed'), postedPayload1ToSolana: parsed.length, unclaimed: unclaimed.length, viable };
}

async function findFundedPayer(connection, candidates, excluded = null) {
  for (const candidate of candidates) {
    const authority = new PublicKey(candidate.toAccount.authority);
    if (excluded && authority.equals(excluded)) continue;
    const info = await connection.getAccountInfo(authority, 'confirmed');
    if (info && info.owner.equals(SYSTEM) && info.data.length === 0 && info.lamports > 3_000_000) return authority;
  }
  throw new Error('No funded system payer found among viable recipient authorities');
}

async function findAlternateTokenAccount(_connection, candidate, candidates) {
  for (const item of candidates) {
    if (item.mint.equals(candidate.mint) && !item.to.equals(candidate.to) && !item.to.equals(candidate.custody)) return item.to;
  }
  throw new Error('No alternate same-mint token account available');
}

async function runMutationMatrix(connection, search, deployment) {
  const legacy = search.viable.filter((item) => item.tokenProgram.equals(TOKEN));
  const authoritySigner = new PublicKey(deployment.pdas.authoritySigner);
  let chosen = null;
  let payer = null;
  let positive = null;
  for (const candidate of legacy) {
    try {
      const candidatePayer = await findFundedPayer(connection, [candidate]);
      const monitor = [candidate.custody, candidate.to, candidate.claim];
      const simulation = await rpcSimulate(
        connection,
        [completeNativeInstruction(candidate, candidatePayer)],
        candidatePayer,
        monitor,
      );
      if (!simulation.value.err) {
        chosen = candidate;
        payer = candidatePayer;
        positive = simulation;
        break;
      }
    } catch (_) {
      // Candidate may be redeemed between enumeration and simulation; try the next one.
    }
  }
  if (!chosen) throw new Error('No current-state positive CompleteNative simulation found');

  const alternatePayer = await findFundedPayer(connection, legacy, payer);
  const attackerDestination = await findAlternateTokenAccount(connection, chosen, legacy);
  const alternateVaa = legacy.find((item) => !item.mint.equals(chosen.mint) && !item.endpoint.equals(chosen.endpoint));
  if (!alternateVaa) throw new Error('No suitable alternate VAA found for mutation matrix');
  const alternateMint = alternateVaa.mint;
  const monitor = [chosen.custody, chosen.to, attackerDestination, chosen.claim, alternateVaa.claim];
  const beforeInfos = await connection.getMultipleAccountsInfo(monitor, 'confirmed');
  const before = Object.fromEntries(monitor.map((key, index) => [key.toBase58(), beforeInfos[index]
    ? {
      exists: true,
      owner: beforeInfos[index].owner.toBase58(),
      lamports: beforeInfos[index].lamports,
      dataLength: beforeInfos[index].data.length,
      tokenAmount: beforeInfos[index].data.length >= 72 ? beforeInfos[index].data.readBigUInt64LE(64).toString() : null,
      dataSha256: sha256(beforeInfos[index].data),
    }
    : null]));

  const baseline = () => completeNativeInstruction(chosen, payer);
  const cases = [
    { name: 'positive_baseline', payer, instructions: [baseline()] },
    { name: 'payer_substitution_permissionless', payer: alternatePayer, instructions: [completeNativeInstruction(chosen, alternatePayer)] },
    { name: 'destination_substitution', payer, instructions: [completeNativeInstruction(chosen, payer, { 5: attackerDestination })] },
    { name: 'fee_destination_substitution_zero_fee', payer, instructions: [completeNativeInstruction(chosen, payer, { 6: attackerDestination })] },
    { name: 'custody_substitution_same_mint', payer, instructions: [completeNativeInstruction(chosen, payer, { 7: attackerDestination })] },
    { name: 'mint_substitution', payer, instructions: [completeNativeInstruction(chosen, payer, { 8: alternateMint })] },
    { name: 'custody_signer_substitution', payer, instructions: [completeNativeInstruction(chosen, payer, { 9: authoritySigner })] },
    { name: 'posted_vaa_and_claim_substitution', payer, instructions: [completeNativeInstruction(chosen, payer, { 2: alternateVaa.postedVaa, 3: alternateVaa.claim, 4: alternateVaa.endpoint })] },
    { name: 'claim_substitution', payer, instructions: [completeNativeInstruction(chosen, payer, { 3: alternateVaa.claim })] },
    { name: 'endpoint_substitution', payer, instructions: [completeNativeInstruction(chosen, payer, { 4: alternateVaa.endpoint })] },
    { name: 'cpi_program_substitution', payer, instructions: [completeNativeInstruction(chosen, payer, { 13: TOKEN_2022 })] },
    { name: 'claim_aliases_destination', payer, instructions: [completeNativeInstruction(chosen, payer, { 3: chosen.to })] },
    { name: 'custody_aliases_destination', payer, instructions: [completeNativeInstruction(chosen, payer, { 7: chosen.to })] },
    { name: 'duplicate_valid_same_transaction', payer, instructions: [baseline(), baseline()] },
    { name: 'valid_then_bad_destination_atomicity', payer, instructions: [baseline(), completeNativeInstruction(chosen, payer, { 5: attackerDestination })] },
    { name: 'bad_destination_then_valid_order', payer, instructions: [completeNativeInstruction(chosen, payer, { 5: attackerDestination }), baseline()] },
  ];
  const outcomes = [];
  for (const test of cases) {
    let result;
    try {
      const simulation = test.name === 'positive_baseline' ? positive : await rpcSimulate(connection, test.instructions, test.payer, monitor);
      const post = Object.fromEntries(monitor.map((key, index) => [key.toBase58(), decodeSimulationAccount(simulation.value.accounts?.[index])]));
      const tokenDeltas = Object.fromEntries(monitor.slice(0, 3).map((key) => {
        const keyString = key.toBase58();
        const pre = before[keyString]?.tokenAmount;
        const after = post[keyString]?.tokenAmount;
        return [keyString, pre !== null && pre !== undefined && after !== null && after !== undefined
          ? (BigInt(after) - BigInt(pre)).toString()
          : null];
      }));
      result = {
        slot: simulation.context.slot,
        err: simulation.value.err,
        unitsConsumed: simulation.value.unitsConsumed,
        tokenDeltas,
        post,
        logs: simulation.value.logs,
      };
    } catch (error) {
      result = { transportError: error.message };
    }
    outcomes.push({
      name: test.name,
      payer: test.payer.toBase58(),
      instructionCount: test.instructions.length,
      result,
    });
    process.stdout.write(`${JSON.stringify({
      name: test.name,
      err: result.err || result.transportError || null,
      tokenDeltas: result.tokenDeltas || null,
      logTail: result.logs ? result.logs.slice(-6) : null,
    })}\n`);
  }
  const token2022Candidates = search.viable.filter((item) => item.tokenProgram.equals(TOKEN_2022));
  let token2022Positive = null;
  for (const candidate of token2022Candidates) {
    try {
      const token2022Payer = payer;
      const token2022Monitor = [candidate.custody, candidate.to, candidate.claim];
      const token2022BeforeInfos = await connection.getMultipleAccountsInfo(token2022Monitor, 'confirmed');
      const simulation = await rpcSimulate(
        connection,
        [completeNativeInstruction(candidate, token2022Payer)],
        token2022Payer,
        token2022Monitor,
      );
      if (simulation.value.err) continue;
      const post = token2022Monitor.map((_, index) => decodeSimulationAccount(simulation.value.accounts?.[index]));
      token2022Positive = {
        name: 'token2022_positive_baseline',
        payer: token2022Payer.toBase58(),
        candidate: jsonCandidate(candidate),
        result: {
          slot: simulation.context.slot,
          err: null,
          unitsConsumed: simulation.value.unitsConsumed,
          tokenDeltas: {
            [candidate.custody.toBase58()]: (BigInt(post[0].tokenAmount) - BigInt(parseTokenAccount(token2022BeforeInfos[0]).amount)).toString(),
            [candidate.to.toBase58()]: (BigInt(post[1].tokenAmount) - BigInt(parseTokenAccount(token2022BeforeInfos[1]).amount)).toString(),
          },
          post: Object.fromEntries(token2022Monitor.map((key, index) => [key.toBase58(), post[index]])),
          logs: simulation.value.logs,
        },
      };
      outcomes.push(token2022Positive);
      process.stdout.write(`${JSON.stringify({
        name: token2022Positive.name,
        err: null,
        tokenDeltas: token2022Positive.result.tokenDeltas,
        logTail: token2022Positive.result.logs.slice(-6),
      })}\n`);
      break;
    } catch (_) {
      // Try the next still-unclaimed Token-2022 VAA.
    }
  }
  return {
    timestamp: new Date().toISOString(),
    simulationOnly: true,
    txNeverSubmitted: true,
    sigVerify: false,
    positiveCandidate: jsonCandidate(chosen),
    alternateVaa: jsonCandidate(alternateVaa),
    payer: payer.toBase58(),
    alternatePayer: alternatePayer.toBase58(),
    attackerDestination: attackerDestination.toBase58(),
    monitor: monitor.map((key) => key.toBase58()),
    before,
    token2022PositiveFound: Boolean(token2022Positive),
    outcomes,
  };
}

async function main() {
  const endpoint = process.env.SOLANA_RPC || process.env.RPC_URL;
  if (!endpoint) throw new Error('SOLANA_RPC or RPC_URL is required');
  const connection = new Connection(endpoint, 'confirmed');
  if (process.env.TOKEN2022_DIAG === '1') {
    const saved = JSON.parse(fs.readFileSync(`${OUT}/wormhole-token-bridge-unclaimed.json`, 'utf8'));
    const previous = JSON.parse(fs.readFileSync(`${OUT}/wormhole-token-bridge-redeem-simulations.json`, 'utf8'));
    const keyFields = ['postedVaa', 'emitterAddress', 'mint', 'to', 'claim', 'endpoint', 'custody', 'tokenProgram'];
    const candidates = saved.viable.map((item) => {
      const copy = { ...item };
      for (const field of keyFields) copy[field] = new PublicKey(copy[field]);
      return copy;
    }).filter((item) => item.tokenProgram.equals(TOKEN_2022));
    const payer = new PublicKey(previous.payer);
    const outcomes = [];
    for (const candidate of candidates.slice(0, 3)) {
      const monitor = [candidate.custody, candidate.to, candidate.claim];
      const simulation = await rpcSimulate(
        connection,
        [completeNativeInstruction(candidate, payer)],
        payer,
        monitor,
      );
      const outcome = {
        candidate: jsonCandidate(candidate),
        slot: simulation.context.slot,
        err: simulation.value.err,
        unitsConsumed: simulation.value.unitsConsumed,
        logs: simulation.value.logs,
      };
      outcomes.push(outcome);
      process.stdout.write(`${JSON.stringify({ postedVaa: candidate.postedVaa.toBase58(), err: outcome.err, logTail: outcome.logs.slice(-8) })}\n`);
    }
    fs.writeFileSync(`${OUT}/wormhole-token-bridge-token2022-diagnostics.json`, `${JSON.stringify({
      timestamp: new Date().toISOString(),
      simulationOnly: true,
      txNeverSubmitted: true,
      payer: payer.toBase58(),
      outcomes,
    }, null, 2)}\n`);
    return;
  }
  if (process.env.ONLY_SIM === '1') {
    const deployment = JSON.parse(fs.readFileSync(`${OUT}/wormhole-token-bridge-deployment.json`, 'utf8'));
    const saved = JSON.parse(fs.readFileSync(`${OUT}/wormhole-token-bridge-unclaimed.json`, 'utf8'));
    const keyFields = ['postedVaa', 'emitterAddress', 'mint', 'to', 'claim', 'endpoint', 'custody', 'tokenProgram'];
    const viable = saved.viable.map((item) => {
      const copy = { ...item };
      for (const field of keyFields) copy[field] = new PublicKey(copy[field]);
      return copy;
    });
    const matrix = await runMutationMatrix(connection, { ...saved, viable }, deployment);
    fs.writeFileSync(`${OUT}/wormhole-token-bridge-redeem-simulations.json`, `${JSON.stringify(matrix, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ phase: 'complete', outcomes: matrix.outcomes.length })}\n`);
    return;
  }
  const deployment = await getDeployment(connection);
  fs.writeFileSync(`${OUT}/wormhole-token-bridge-deployment.json`, `${JSON.stringify(deployment, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ phase: 'deployment', ...deployment })}\n`);

  const custody = await getCustody(connection, deployment);
  fs.writeFileSync(`${OUT}/wormhole-token-bridge-custody.json`, `${JSON.stringify(custody, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    phase: 'custody',
    firstObservationSlot: custody.firstObservationSlot,
    lastObservationSlot: custody.lastObservationSlot,
    tokenAccountCount: custody.tokenAccountCount,
    verifiedNonzeroCustodies: custody.verifiedNonzeroCustodies,
    pricedCustodies: custody.pricedCustodies,
    unpricedCustodies: custody.unpricedCustodies,
    pricedGrossUsdLowerBound: custody.pricedGrossUsdLowerBound,
  })}\n`);

  const search = await getUnclaimedCandidates(connection);
  fs.writeFileSync(`${OUT}/wormhole-token-bridge-unclaimed.json`, `${JSON.stringify({
    observedSlot: search.observedSlot,
    postedPayload1ToSolana: search.postedPayload1ToSolana,
    unclaimed: search.unclaimed,
    viable: search.viable.map(jsonCandidate),
  }, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    phase: 'unclaimed',
    observedSlot: search.observedSlot,
    postedPayload1ToSolana: search.postedPayload1ToSolana,
    unclaimed: search.unclaimed,
    viable: search.viable.length,
  })}\n`);

  const matrix = await runMutationMatrix(connection, search, deployment);
  fs.writeFileSync(`${OUT}/wormhole-token-bridge-redeem-simulations.json`, `${JSON.stringify(matrix, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ phase: 'complete', outcomes: matrix.outcomes.length })}\n`);
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
