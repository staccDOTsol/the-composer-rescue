// Read-only current-mainnet census of KLend Reserve flash-loan fee settings.
// Never signs, simulates, or submits a transaction. The RPC URL is not emitted.
const fs = require('fs');
const crypto = require('crypto');
const bs58 = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');

const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split('\n').filter(Boolean).map(line => line.split(/=(.*)/s).slice(0, 2)));
const rpcUrl = env.HEAVY_RPC_URL || env.RPC_URL;
if (!rpcUrl) throw new Error('No read-only RPC configured');

const programId = 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD';
const discriminator = crypto.createHash('sha256').update('account:Reserve').digest().subarray(0, 8);
const output = 'composer-runs/2026-10-15/klend-zero-fee-census.json';

async function rpc(method, params) {
  const response = await fetch(rpcUrl, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params})});
  const result = await response.json();
  if (result.error) throw new Error(`${method}: ${result.error.code} ${result.error.message}`);
  return result.result;
}

function pubkey(data, offset) { return bs58.encode(data.subarray(offset, offset + 32)); }

function decode(pubkeyString, account) {
  if (!account) return null;
  const data = Buffer.from(account.data[0], 'base64');
  if (account.owner !== programId || data.length !== 8624 ||
      !data.subarray(0, 8).equals(discriminator)) return null;
  const feeSf = data.readBigUInt64LE(4904);
  return {
    reserve: pubkeyString,
    market: pubkey(data, 32),
    mint: pubkey(data, 128),
    supplyVault: pubkey(data, 160),
    feeVault: pubkey(data, 192),
    availableRaw: data.readBigUInt64LE(224).toString(),
    decimals: Number(data.readBigUInt64LE(272)),
    status: data[4856],
    emergencyMode: data[4864],
    name: data.subarray(5032, 5064).toString('utf8').split('\0', 1)[0],
    flashFeeSf: feeSf.toString(),
    flashFeeClass: feeSf === 0n ? 'exact-zero-rate' :
      feeSf === 18446744073709551615n ? 'disabled' : 'positive-rate',
    flashFeeRateApprox: feeSf === 18446744073709551615n ? null :
      Number(feeSf) / 2 ** 60,
  };
}

async function main() {
  const listed = await rpc('getProgramAccounts', [programId,
    {encoding: 'base64', commitment: 'confirmed', withContext: true,
      filters: [{dataSize: 8624}, {memcmp: {offset: 0, bytes: bs58.encode(discriminator)}}],
      dataSlice: {offset: 0, length: 0}}]);
  const keys = listed.value.map(item => item.pubkey);
  const rows = [];
  const batchSlots = [];
  for (let i = 0; i < keys.length; i += 50) {
    const subset = keys.slice(i, i + 50);
    const page = await rpc('getMultipleAccounts', [subset,
      {encoding: 'base64', commitment: 'confirmed'}]);
    batchSlots.push(page.context.slot);
    for (let j = 0; j < subset.length; j++) {
      const row = decode(subset[j], page.value[j]);
      if (row) rows.push(row);
    }
  }
  const activeZero = rows.filter(x => x.flashFeeClass === 'exact-zero-rate' &&
    x.status === 0 && x.emergencyMode === 0 && BigInt(x.availableRaw) > 0n);
  const vaultKeys = [...new Set(activeZero.flatMap(x => [x.supplyVault, x.feeVault]))];
  const vaultBalances = new Map();
  for (let i = 0; i < vaultKeys.length; i += 100) {
    const subset = vaultKeys.slice(i, i + 100);
    const page = await rpc('getMultipleAccounts', [subset,
      {encoding: 'base64', commitment: 'confirmed'}]);
    batchSlots.push(page.context.slot);
    for (let j = 0; j < subset.length; j++) {
      const account = page.value[j];
      const data = account && Buffer.from(account.data[0], 'base64');
      vaultBalances.set(subset[j], data && data.length >= 72 ?
        data.readBigUInt64LE(64).toString() : null);
    }
  }
  for (const row of activeZero) {
    row.supplyVaultBalanceRaw = vaultBalances.get(row.supplyVault) ?? null;
    row.feeVaultBalanceRaw = vaultBalances.get(row.feeVault) ?? null;
  }
  activeZero.sort((a, b) => BigInt(a.availableRaw) > BigInt(b.availableRaw) ? -1 :
    BigInt(a.availableRaw) < BigInt(b.availableRaw) ? 1 : 0);
  const byClass = Object.fromEntries(['exact-zero-rate', 'positive-rate', 'disabled']
    .map(cls => [cls, rows.filter(x => x.flashFeeClass === cls).length]));
  const result = {observedAt: new Date().toISOString(), programId,
    readOnly: true, source: {method: 'getProgramAccounts + getMultipleAccounts',
      listedSlot: listed.context.slot, observedSlotMin: Math.min(...batchSlots),
      observedSlotMax: Math.max(...batchSlots), listed: keys.length, decoded: rows.length,
      reserveAccountLength: 8624, discriminatorHex: discriminator.toString('hex'),
      offsets: {availableRaw: 224, flashFeeSf: 4904, reserveConfigStatus: 4856,
        reserveConfigEmergencyMode: 4864}},
    feeScale: '2^60', byClass,
    activeZeroCount: activeZero.length,
    activeZero,
    otherRows: rows.filter(x => x.flashFeeClass !== 'exact-zero-rate' ||
      x.status !== 0 || x.emergencyMode !== 0 || BigInt(x.availableRaw) === 0n),
  };
  fs.writeFileSync(output, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({listed: keys.length, decoded: rows.length,
    byClass, activeZeroCount: activeZero.length,
    top: activeZero.slice(0, 20).map(x => ({name: x.name, reserve: x.reserve,
      mint: x.mint, decimals: x.decimals, availableRaw: x.availableRaw,
      supplyVaultBalanceRaw: x.supplyVaultBalanceRaw})),
    output}));
}

main().catch(error => {console.error(error.message); process.exitCode = 1;});
