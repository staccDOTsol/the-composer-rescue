#!/usr/bin/env node
// Read-only mainnet revalidation for Chancery USDG and exact-zero-fee KLend USDG reserves.
// Loads credentials only from /tmp/composer-helius-rpc.env, never prints an endpoint,
// and never signs or submits a transaction.

const fs = require('fs');
const crypto = require('crypto');
const {
  PublicKey,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const bs58Module = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const bs58 = bs58Module.default || bs58Module;

const root = 'composer-runs/2026-10-15';
const envPath = '/tmp/composer-helius-rpc.env';
const env = Object.fromEntries(fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
  .filter(line => line && !line.startsWith('#') && line.includes('='))
  .map(line => line.split(/=(.*)/s).slice(0, 2)));
const currentRpcUrl = env.HEAVY_RPC_URL || env.RPC_URL;
const archiveRpcUrl = env.RPC_URL || env.HEAVY_RPC_URL;
if (!currentRpcUrl || !archiveRpcUrl) throw new Error(`No RPC configured in ${envPath}`);

const programId = 'ChnryP5RcZtMvP8vvVyPGUhwCg6uDJc53vCe3sxr11Sz';
const loaderId = 'BPFLoaderUpgradeab1e11111111111111111111111';
const klendId = 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD';
const token2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const usdgMint = '2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH';
const vaultAddress = '6gXnsjMkrgC7zKsniUFPasEnPRVSecH3AwoKWjUTdXHg';
const reserveAuthority = '8anxfyoftY9hPwxdvReet2beFS2HXjcXraPEamo4nGyB';
const historicalSignature = '32sBxLB3zYh4efsMnBPnsCNdEenL2zfnjk48q8YVxAV9cXDZT44AFHiyHnvbypwq724uy94Jg9k2qRjKpiwqovXX';
const expected = {
  programDataAddress: 'BWgWFgZxxF2ndC9PgKS5Fa8c2Nv3PUS34mGbvuBw95Ln',
  deploymentSlot: '444033132',
  upgradeAuthority: '934modVoNj5TUV69Ub3YXJAvGxWvpqRiHAydTadJxA2L',
  fullProgramDataSha256: 'fda96ab287bbd8b17f795f49e24693a0354bde874a9cf5f66a2ac4b6022c9f71',
  releaseArtifactBytes: 1036752,
  releaseArtifactSha256: '1460e69a8e0330a67d73556e6c7690a1b449d54e7e1c3f3f6ab638768c714830',
  sourceRevision: '0dafa95d1aded954de098208f0f515d436aa496c',
  sourceRelease: 'chancery-v1.0.1',
};

async function rpc(url, method, params) {
  const response = await fetch(url, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params})});
  const json = await response.json();
  if (json.error) throw new Error(`${method}: ${json.error.code} ${json.error.message}`);
  return json.result;
}

const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
const pk = bytes => new PublicKey(bytes).toBase58();
const hex = bytes => Buffer.from(bytes).toString('hex');
const u128 = words => (BigInt(words[0]) | (BigInt(words[1]) << 64n)).toString();
const i128 = words => {
  const unsigned = BigInt(words[0]) | (BigInt(words[1]) << 64n);
  return (unsigned >= (1n << 127n) ? unsigned - (1n << 128n) : unsigned).toString();
};

function tokenAccount(data) {
  if (data.length < 165) return null;
  return {mint: pk(data.subarray(0, 32)), owner: pk(data.subarray(32, 64)),
    amountRaw: data.readBigUInt64LE(64).toString(), state: data[108], dataBytes: data.length};
}

function mintAccount(data) {
  if (data.length < 82) return null;
  return {supplyRaw: data.readBigUInt64LE(36).toString(), decimals: data[44],
    initialized: data[45] === 1, dataBytes: data.length};
}

const idl = JSON.parse(fs.readFileSync(`${root}/chnry-usdg-source/programs/chancery/idl/idl.json`));
const types = new Map(idl.types.map(type => [type.name, type.type]));
const accountTypes = new Map(idl.accounts.map(account => [hex(account.discriminator), account.name]));

function primitiveSize(type) {
  if (type === 'u8') return 1;
  if (type === 'u16') return 2;
  if (type === 'u32') return 4;
  if (type === 'u64' || type === 'i64') return 8;
  if (type === 'u128' || type === 'i128') return 16;
  if (type === 'pubkey') return 32;
  if (typeof type === 'object' && type.array) return primitiveSize(type.array[0]) * type.array[1];
  throw new Error(`Unsupported IDL field type ${JSON.stringify(type)}`);
}

function decodePrimitive(type, data, offset) {
  if (type === 'u8') return data[offset];
  if (type === 'u16') return data.readUInt16LE(offset);
  if (type === 'u32') return data.readUInt32LE(offset);
  if (type === 'u64') return data.readBigUInt64LE(offset).toString();
  if (type === 'i64') return data.readBigInt64LE(offset).toString();
  if (type === 'u128' || type === 'i128') {
    const words = [data.readBigUInt64LE(offset), data.readBigUInt64LE(offset + 8)];
    return type === 'u128' ? u128(words) : i128(words);
  }
  if (type === 'pubkey') return pk(data.subarray(offset, offset + 32));
  if (typeof type === 'object' && type.array) {
    const [inner, count] = type.array;
    if (inner === 'u8') return hex(data.subarray(offset, offset + count));
    const size = primitiveSize(inner);
    return Array.from({length: count}, (_, i) => decodePrimitive(inner, data, offset + i * size));
  }
  throw new Error(`Unsupported IDL field type ${JSON.stringify(type)}`);
}

function decodeProgramState(data) {
  if (data.length < 8) return null;
  const name = accountTypes.get(hex(data.subarray(0, 8)));
  if (!name || !types.has(name)) return null;
  const out = {type: name};
  let offset = 0;
  for (const field of types.get(name).fields) {
    const size = primitiveSize(field.type);
    if (offset + size > data.length) throw new Error(`${name}.${field.name} exceeds account data`);
    if (!field.name.startsWith('_') && field.name !== 'discriminator')
      out[field.name] = decodePrimitive(field.type, data, offset);
    offset += size;
  }
  out.decodedBytes = offset;
  if (name === 'PermissionRecord') {
    out.roleBitsU128 = u128(out.role_bits);
    out.roles = {canMintDirect: (BigInt(out.roleBitsU128) & 1n) !== 0n,
      canRedeemDirect: (BigInt(out.roleBitsU128) & 2n) !== 0n};
  }
  if (name === 'ModuleActivationState') {
    const labels = {0: 'core', 1: 'events_cpi', 2: 'permissions', 3: 'pathway',
      4: 'settlement', 5: 'limits', 6: 'evidence', 7: 'fees', 8: 'reserve',
      9: 'control', 10: 'migration', 11: 'issued_token_control', 16: 'cross_chain'};
    const statuses = {0: 'disabled', 1: 'admin_only', 2: 'active',
      3: 'emergency_disabled', 4: 'deprecated'};
    const bytes = Buffer.from(out.module_statuses, 'hex');
    out.moduleStatusById = Object.fromEntries(Object.entries(labels).map(([id, label]) =>
      [label, {id: Number(id), value: bytes[Number(id)], status: statuses[bytes[Number(id)]] || 'unknown'}]));
  }
  if (name === 'UsageWindow') {
    out.grossInU128 = u128(out.gross_in);
    out.grossOutputU128 = u128(out.gross_output_amount);
    out.netFlowI128 = i128(out.net_flow);
  }
  return out;
}

function accountSummary(address, value) {
  if (!value) return {address, exists: false};
  const data = Buffer.from(value.data[0], 'base64');
  const decoded = value.owner === programId ? decodeProgramState(data) :
    (value.owner === token2022 ? tokenAccount(data) : null);
  return {address, exists: true, owner: value.owner, executable: value.executable,
    lamports: String(value.lamports), dataBytes: data.length, dataSha256: sha256(data), decoded};
}

function compiledKeys(tx) {
  const keys = tx.transaction.message.accountKeys.map(key => typeof key === 'string' ? key : key.pubkey);
  const loaded = tx.meta.loadedAddresses || {writable: [], readonly: []};
  return [...keys, ...loaded.writable, ...loaded.readonly];
}

function normalizeHistorical(tx) {
  const keys = compiledKeys(tx);
  const outer = tx.transaction.message.instructions.find(ix => keys[ix.programIdIndex] === programId);
  if (!outer) throw new Error('Historical transaction has no Chancery instruction');
  const data = Buffer.from(bs58.decode(outer.data));
  const idlIx = idl.instructions.find(ix => Buffer.from(ix.discriminator).equals(data.subarray(0, ix.discriminator.length)));
  if (!idlIx) throw new Error(`Unknown Chancery discriminator ${hex(data.subarray(0, 2))}`);
  const accountList = outer.accounts.map(index => keys[index]);
  const named = Object.fromEntries(idlIx.accounts.map((meta, index) => [meta.name, accountList[index]]));
  const pathwayId = data.subarray(2, 34);
  const firstAmount = data.readBigUInt64LE(34).toString();
  const minimumOutput = data.readBigUInt64LE(42).toString();
  const tokenDeltas = [];
  const preByIndex = new Map((tx.meta.preTokenBalances || []).map(x => [x.accountIndex, BigInt(x.uiTokenAmount.amount)]));
  for (const post of tx.meta.postTokenBalances || []) {
    const before = preByIndex.get(post.accountIndex) || 0n;
    const after = BigInt(post.uiTokenAmount.amount);
    if (before !== after) tokenDeltas.push({account: keys[post.accountIndex], mint: post.mint,
      owner: post.owner || null, preRaw: before.toString(), postRaw: after.toString(),
      deltaRaw: (after - before).toString()});
  }
  return {signature: historicalSignature, slot: tx.slot, blockTime: tx.blockTime,
    err: tx.meta.err, version: tx.version, instruction: idlIx.name,
    discriminatorHex: hex(data.subarray(0, 2)), pathwayIdHex: hex(pathwayId),
    inputAmountRaw: firstAmount, minimumOutputRaw: minimumOutput,
    namedAccounts: named, accountList, tokenDeltas,
    innerInstructionCount: (tx.meta.innerInstructions || []).reduce((n, group) => n + group.instructions.length, 0),
    logMessages: (tx.meta.logMessages || []).filter(line =>
      line.includes('Instruction:') || line.includes('success') || line.includes('failed'))};
}

function decodeReserve(address, value, censusRow) {
  if (!value) return {reserve: address, exists: false};
  const data = Buffer.from(value.data[0], 'base64');
  return {reserve: address, exists: true, owner: value.owner, dataBytes: data.length,
    market: pk(data.subarray(32, 64)), mint: pk(data.subarray(128, 160)),
    supplyVault: pk(data.subarray(160, 192)), feeVault: pk(data.subarray(192, 224)),
    availableRaw: data.readBigUInt64LE(224).toString(), decimals: Number(data.readBigUInt64LE(272)),
    status: data[4856], emergencyMode: data[4864], flashFeeSf: data.readBigUInt64LE(4904).toString(),
    name: data.subarray(5032, 5064).toString('utf8').replace(/\0.*$/, ''),
    censusRow};
}

async function main() {
  const programResult = await rpc(currentRpcUrl, 'getAccountInfo', [programId,
    {encoding: 'base64', commitment: 'confirmed'}]);
  const programData = Buffer.from(programResult.value.data[0], 'base64');
  if (programData.readUInt32LE(0) !== 2) throw new Error('Program is not Upgradeable Loader Program state');
  const programDataAddress = pk(programData.subarray(4, 36));
  const programDataResult = await rpc(currentRpcUrl, 'getAccountInfo', [programDataAddress,
    {encoding: 'base64', commitment: 'confirmed'}]);
  const rawProgramData = Buffer.from(programDataResult.value.data[0], 'base64');
  if (rawProgramData.readUInt32LE(0) !== 3) throw new Error('ProgramData account has wrong loader state');
  const metadataBytes = rawProgramData[12] === 1 ? 45 : 13;
  const executablePayload = rawProgramData.subarray(metadataBytes);
  const upgradeAuthority = rawProgramData[12] === 1 ? pk(rawProgramData.subarray(13, 45)) : null;
  const localElf = fs.readFileSync(`${root}/chnry-usdg-current.so`);
  const releaseElf = fs.readFileSync(`${root}/chnry-usdg-integrity-records/builds/DEP-00002/payload/release/chancery.so`);

  const tx = await rpc(archiveRpcUrl, 'getTransaction', [historicalSignature,
    {encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 0}]);
  if (!tx) throw new Error('Historical control transaction unavailable');
  const historical = normalizeHistorical(tx);
  const uniqueHistoricalAccounts = [...new Set(historical.accountList)];
  const stateResult = await rpc(currentRpcUrl, 'getMultipleAccounts', [uniqueHistoricalAccounts,
    {encoding: 'base64', commitment: 'confirmed'}]);
  const stateByAddress = Object.fromEntries(uniqueHistoricalAccounts.map((address, index) =>
    [address, accountSummary(address, stateResult.value[index])]));

  const permissionDiscriminator = Buffer.from(idl.accounts.find(account =>
    account.name === 'PermissionRecord').discriminator);
  const permissionResultRaw = await rpc(currentRpcUrl, 'getProgramAccounts', [programId,
    {encoding: 'base64', commitment: 'confirmed', withContext: true, filters: [
      {dataSize: 192}, {memcmp: {offset: 0, bytes: bs58.encode(permissionDiscriminator)}},
    ]}]);
  const permissionRows = (permissionResultRaw.value || permissionResultRaw).map(row => ({
    address: row.pubkey, ...decodeProgramState(Buffer.from(row.account.data[0], 'base64')),
  }));
  const targetPathway = historical.namedAccounts.pathway_policy;
  const targetPathwayPermissions = permissionRows.filter(row =>
    row.scope_kind === 2 && row.scope_key === targetPathway);

  const vaultResult = await rpc(currentRpcUrl, 'getMultipleAccounts', [[vaultAddress, usdgMint],
    {encoding: 'base64', commitment: 'confirmed'}]);
  const vault = accountSummary(vaultAddress, vaultResult.value[0]);
  const mintRaw = Buffer.from(vaultResult.value[1].data[0], 'base64');
  const mint = {address: usdgMint, owner: vaultResult.value[1].owner, ...mintAccount(mintRaw),
    dataSha256: sha256(mintRaw)};

  const census = JSON.parse(fs.readFileSync(`${root}/klend-zero-fee-census.json`));
  const usdRows = census.activeZero.filter(row => row.mint === usdgMint);
  const addresses = [...new Set(usdRows.flatMap(row => [row.reserve, row.supplyVault, row.feeVault]))];
  const klendResult = await rpc(currentRpcUrl, 'getMultipleAccounts', [addresses,
    {encoding: 'base64', commitment: 'confirmed'}]);
  const current = new Map(addresses.map((address, index) => [address, klendResult.value[index]]));
  const reserves = usdRows.map(row => {
    const reserve = decodeReserve(row.reserve, current.get(row.reserve), row);
    const supply = accountSummary(row.supplyVault, current.get(row.supplyVault));
    const fee = accountSummary(row.feeVault, current.get(row.feeVault));
    const checks = {ownerIsKLend: reserve.owner === klendId, mintMatches: reserve.mint === usdgMint,
      statusActive: reserve.status === 0, emergencyOff: reserve.emergencyMode === 0,
      flashFeeExactlyZero: reserve.flashFeeSf === '0', supplyAddressMatches: reserve.supplyVault === row.supplyVault,
      feeAddressMatches: reserve.feeVault === row.feeVault,
      supplyBalanceMatchesAvailable: supply.decoded?.amountRaw === reserve.availableRaw,
      supplyMintMatches: supply.decoded?.mint === usdgMint, feeMintMatches: fee.decoded?.mint === usdgMint};
    const requiredChecks = ['ownerIsKLend', 'mintMatches', 'statusActive', 'emergencyOff',
      'flashFeeExactlyZero', 'supplyAddressMatches', 'feeAddressMatches',
      'supplyMintMatches', 'feeMintMatches'];
    const supplyBalance = supply.decoded?.amountRaw || null;
    return {...reserve, supplyVaultBalanceRaw: supplyBalance,
      feeVaultBalanceRaw: fee.decoded?.amountRaw || null,
      borrowableUpperBoundRaw: supplyBalance === null ? null :
        (BigInt(supplyBalance) < BigInt(reserve.availableRaw) ? supplyBalance : reserve.availableRaw),
      checks, eligibilityChecks: requiredChecks,
      eligibleExactZeroActive: requiredChecks.every(name => checks[name])};
  }).sort((a, b) => BigInt(a.availableRaw) > BigInt(b.availableRaw) ? -1 : 1);
  const eligible = reserves.filter(row => row.eligibleExactZeroActive);

  const pdaReserve = PublicKey.findProgramAddressSync([Buffer.from('reserve-authority')], new PublicKey(programId))[0].toBase58();
  const pdaMint = PublicKey.findProgramAddressSync([Buffer.from('mint-authority')], new PublicKey(programId))[0].toBase58();
  const output = {
    observedAt: new Date().toISOString(), readOnly: true, noSubmission: true,
    rpcCredentialsPrinted: false,
    program: {address: programId, owner: programResult.value.owner, executable: programResult.value.executable,
      programObservationSlot: programResult.context.slot, programDataAddress,
      programDataObservationSlot: programDataResult.context.slot,
      deploymentSlot: rawProgramData.readBigUInt64LE(4).toString(), upgradeAuthority,
      programDataAccountBytes: rawProgramData.length, metadataBytes,
      payloadBytes: executablePayload.length, payloadSha256: sha256(executablePayload),
      localElfBytes: localElf.length, localElfSha256: sha256(localElf),
      releaseElfBytes: releaseElf.length, releaseElfSha256: sha256(releaseElf),
      expected, checks: {upgradeableLoaderOwner: programResult.value.owner === loaderId,
        executable: programResult.value.executable === true,
        programDataAddress: programDataAddress === expected.programDataAddress,
        deploymentSlot: rawProgramData.readBigUInt64LE(4).toString() === expected.deploymentSlot,
        upgradeAuthority: upgradeAuthority === expected.upgradeAuthority,
        fullProgramDataSha256: sha256(executablePayload) === expected.fullProgramDataSha256,
        localDumpMatchesCurrentPayload: localElf.equals(executablePayload),
        releaseArtifactHash: sha256(releaseElf) === expected.releaseArtifactSha256,
        currentPayloadBeginsWithReleaseArtifact: executablePayload.subarray(0, releaseElf.length).equals(releaseElf),
        currentPayloadPaddingIsZero: executablePayload.subarray(releaseElf.length).every(byte => byte === 0)}},
    pdas: {reserveAuthorityDerived: pdaReserve, reserveAuthorityExpected: reserveAuthority,
      reserveAuthorityMatches: pdaReserve === reserveAuthority, mintAuthorityDerived: pdaMint},
    vault: {...vault, observationSlot: vaultResult.context.slot,
      checks: {mint: vault.decoded?.mint === usdgMint,
        ownerAuthority: vault.decoded?.owner === reserveAuthority,
        initialized: vault.decoded?.state === 1, tokenProgram: vault.owner === token2022}},
    mint: {...mint, observationSlot: vaultResult.context.slot},
    historicalControl: historical,
    currentHistoricalAccounts: {observationSlot: stateResult.context.slot, accounts: stateByAddress},
    permissionCensus: {observationSlot: permissionResultRaw.context?.slot || null,
      totalPermissionRecords: permissionRows.length, targetPathway,
      targetPathwayPermissions},
    klendUsdGCensus: {savedCensusObservedAt: census.observedAt, currentObservationSlot: klendResult.context.slot,
      savedRows: usdRows.length, currentlyEligibleRows: eligible.length,
      totalAvailableRaw: eligible.reduce((sum, row) => sum + BigInt(row.availableRaw), 0n).toString(),
      totalBorrowableUpperBoundRaw: eligible.reduce((sum, row) =>
        sum + BigInt(row.borrowableUpperBoundRaw || 0), 0n).toString(),
      selectedReserve: eligible[0] || null, reserves},
  };
  fs.writeFileSync(`${root}/chnry-usdg-current-state.json`, JSON.stringify(output, null, 2));
  console.log(JSON.stringify({observedAt: output.observedAt, programSlot: output.program.programDataObservationSlot,
    currentElfMatchesPublished: Object.values(output.program.checks).every(Boolean),
    vaultAmountRaw: output.vault.decoded?.amountRaw, historicalSlot: historical.slot,
    klendObservationSlot: klendResult.context.slot, klendEligible: eligible.length,
    klendTotalAvailableRaw: output.klendUsdGCensus.totalAvailableRaw,
    klendTotalBorrowableUpperBoundRaw: output.klendUsdGCensus.totalBorrowableUpperBoundRaw,
    selectedKlendReserve: eligible[0]?.reserve, selectedKlendAvailableRaw: eligible[0]?.availableRaw}, null, 2));
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
