const fs = require('fs');
const crypto = require('crypto');
const MODULES = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/';
const { Connection, PublicKey } = require(MODULES + '@solana/web3.js');

const RPC = process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com';
const PROGRAM = new PublicKey('REALQqNEomY6cQGZJUGwywTBD2UmDT32rZcNnfxQ5N2');
const POOL = new PublicKey('Hv44BZaqT5URrrAtGk6jvfbWKL2PytWA4ur2r1QnvtQa');
const VAULTS = [
  new PublicKey('5JcntpKHEy2vyjCiiLY5e4Te1ZVG1zU6pp6ZU667d6tw'),
  new PublicKey('8feVD1rbhaE17kZiWhTssFrC75DUoJUCX9SLZ6C9oxhd'),
];
const UPGRADEABLE_LOADER = 'BPFLoaderUpgradeab1e11111111111111111111111';
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const u64 = (data, offset) => data.readBigUInt64LE(offset).toString();

(async () => {
  const connection = new Connection(RPC, 'confirmed');
  const slot = await connection.getSlot('confirmed');
  const [program, pool, ...vaults] = await connection.getMultipleAccountsInfo(
    [PROGRAM, POOL, ...VAULTS], 'confirmed');
  if (!program || program.data.readUInt32LE(0) !== 2) throw new Error('unexpected program account');
  const programdataKey = new PublicKey(program.data.subarray(4, 36));
  const programdata = await connection.getAccountInfo(programdataKey, 'confirmed');
  if (!programdata) throw new Error('missing programdata account');
  const result = {
    observedAt: new Date().toISOString(),
    rpc: RPC,
    slot,
    program: {
      address: PROGRAM.toBase58(), owner: program.owner.toBase58(), executable: program.executable,
      dataLength: program.data.length, sha256: sha256(program.data),
      programdataAddress: programdataKey.toBase58(),
    },
    programdata: {
      address: programdataKey.toBase58(), owner: programdata.owner.toBase58(),
      executable: programdata.executable, dataLength: programdata.data.length,
      sha256: sha256(programdata.data), loaderMatches: programdata.owner.toBase58() === UPGRADEABLE_LOADER,
    },
    pool: { address: POOL.toBase58(), owner: pool.owner.toBase58(), dataLength: pool.data.length,
      sha256: sha256(pool.data) },
    vaults: vaults.map((account, i) => ({ address: VAULTS[i].toBase58(), owner: account.owner.toBase58(),
      dataLength: account.data.length, rawAmount: u64(account.data, 64), sha256: sha256(account.data) })),
  };
  const output = __dirname + '/byreal-current-deployment.json';
  fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ output, ...result }, null, 2));
})().catch((error) => { console.error(error); process.exit(1); });
