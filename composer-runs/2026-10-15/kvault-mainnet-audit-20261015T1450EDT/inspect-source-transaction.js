#!/usr/bin/env node

// Persist the exact public account/meta/data tuple of one historical mainnet
// transaction for read-only replay and mutation. Authenticated RPC URLs are
// deliberately redacted from the output.
const fs = require("fs");

const signature = process.argv[2];
const output = process.argv[3];
if (!signature || !output) throw new Error("usage: inspect-source-transaction.js SIGNATURE OUTPUT.json");

const envPath = "/tmp/composer-helius-only.env";
const env = fs.existsSync(envPath) ? Object.fromEntries(fs.readFileSync(envPath, "utf8")
  .split("\n").filter(Boolean).map((line) => line.split(/=(.*)/s).slice(0, 2))) : {};
const rpcUrl = process.env.SOLANA_RPC || env.HEAVY_RPC_URL || env.RPC_URL
  || "https://api.mainnet-beta.solana.com";

async function rpc(method, params) {
  const response = await fetch(rpcUrl, {method: "POST", headers: {"content-type": "application/json"},
    body: JSON.stringify({jsonrpc: "2.0", id: 1, method, params})});
  if (!response.ok) throw new Error(`${method}: HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

(async () => {
  const tx = await rpc("getTransaction", [signature,
    {commitment: "finalized", encoding: "json", maxSupportedTransactionVersion: 1}]);
  if (!tx) throw new Error("transaction unavailable");
  const message = tx.transaction.message;
  const staticKeys = message.accountKeys;
  const loadedWritable = tx.meta?.loadedAddresses?.writable || [];
  const loadedReadonly = tx.meta?.loadedAddresses?.readonly || [];
  const allKeys = [...staticKeys, ...loadedWritable, ...loadedReadonly];
  const header = message.header;
  const signer = (index) => index < header.numRequiredSignatures;
  const writable = (index) => {
    if (index < staticKeys.length) {
      if (index < header.numRequiredSignatures) {
        return index < header.numRequiredSignatures - header.numReadonlySignedAccounts;
      }
      return index < staticKeys.length - header.numReadonlyUnsignedAccounts;
    }
    return index < staticKeys.length + loadedWritable.length;
  };
  const instructions = message.instructions.map((ix, instructionIndex) => ({
    instructionIndex,
    programId: allKeys[ix.programIdIndex],
    programIdIndex: ix.programIdIndex,
    accounts: ix.accounts.map((index) => ({index, pubkey: allKeys[index],
      isSigner: signer(index), isWritable: writable(index)})),
    data: ix.data,
  }));
  const out = {
    generatedAt: new Date().toISOString(),
    rpc: rpcUrl === "https://api.mainnet-beta.solana.com" ? rpcUrl
      : "configured authenticated Solana RPC (URL redacted)",
    signature,
    slot: tx.slot,
    blockTime: tx.blockTime,
    version: tx.version ?? "legacy",
    metaErr: tx.meta?.err || null,
    computeUnitsConsumed: tx.meta?.computeUnitsConsumed ?? null,
    fee: tx.meta?.fee ?? null,
    header,
    staticAccountCount: staticKeys.length,
    loadedWritableCount: loadedWritable.length,
    loadedReadonlyCount: loadedReadonly.length,
    instructions,
  };
  fs.writeFileSync(output, `${JSON.stringify(out, null, 2)}\n`, {flag: "wx"});
  process.stdout.write(`${JSON.stringify({signature, slot: out.slot, version: out.version,
    metaErr: out.metaErr, computeUnitsConsumed: out.computeUnitsConsumed,
    instructions: instructions.map((ix) => ({index: ix.instructionIndex,
      programId: ix.programId, accountCount: ix.accounts.length, data: ix.data}))}, null, 2)}\n`);
})().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
