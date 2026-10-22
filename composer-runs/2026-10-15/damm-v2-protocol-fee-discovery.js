const fs = require('fs');
const { Connection, PublicKey } = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');

const PROGRAM = new PublicKey('cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG');
const RPC = process.env.RPC_URL;
const OUT = '/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/damm-v2-protocol-fee-pools.json';
if (!RPC) throw new Error('RPC_URL is required');

async function main() {
  const connection = new Connection(RPC, 'confirmed');
  // Pool is an 8-byte Anchor discriminator plus a 1,104-byte zero-copy body.
  // protocol_a_fee/protocol_b_fee are at body offsets 384/392.
  const rows = await connection.getProgramAccounts(PROGRAM, {
    commitment: 'confirmed',
    filters: [{ dataSize: 1112 }],
    dataSlice: { offset: 392, length: 16 },
  });
  const nonzero = rows.map(({ pubkey, account }) => {
    const data = Buffer.from(account.data);
    return {
      pool: pubkey.toBase58(),
      protocolAFee: data.readBigUInt64LE(0).toString(),
      protocolBFee: data.readBigUInt64LE(8).toString(),
    };
  }).filter((row) => row.protocolAFee !== '0' || row.protocolBFee !== '0')
    .sort((a, b) => {
      const av = BigInt(a.protocolAFee) + BigInt(a.protocolBFee);
      const bv = BigInt(b.protocolAFee) + BigInt(b.protocolBFee);
      return av === bv ? 0 : av > bv ? -1 : 1;
    });
  const output = { observedAt: new Date().toISOString(), accountCount: rows.length, nonzeroCount: nonzero.length, top: nonzero.slice(0, 100) };
  fs.writeFileSync(OUT, JSON.stringify(output, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ observedAt: output.observedAt, accountCount: output.accountCount, nonzeroCount: output.nonzeroCount, top: output.top.slice(0, 10) }, null, 2) + '\n');
}

main().catch((error) => { console.error(error.stack || String(error)); process.exitCode = 1; });
