#!/usr/bin/env node

// Read-only discovery of recent mainnet Kvault instructions. This emits only
// transaction metadata needed to select current-state simulation controls.
const fs = require("fs");
const crypto = require("crypto");
const bs = require("/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58");
const bs58 = bs.default || bs;

const localRpcEnv = "/tmp/composer-helius-only.env";
const configuredRpc = fs.existsSync(localRpcEnv) ? Object.fromEntries(
  fs.readFileSync(localRpcEnv, "utf8").split("\n").filter(Boolean)
    .map((line) => line.split(/=(.*)/s).slice(0, 2))) : {};
const RPC = process.env.SOLANA_RPC || configuredRpc.HEAVY_RPC_URL || configuredRpc.RPC_URL
  || "https://api.mainnet-beta.solana.com";
const RPC_LABEL = RPC === "https://api.mainnet-beta.solana.com"
  ? RPC : "configured authenticated Solana RPC (URL redacted)";
const PROGRAM = "KvauGMspG5k6rtzrqqn7WNn3oZdyKqLKwK2XWQ8FLjd";
const OUTPUT = process.argv[2];
if (!OUTPUT) throw new Error("usage: discover-exit-transactions.js OUTPUT.json");

const NAMES = [
  "deposit", "deposit_with_min_shares_out", "buy", "buy_with_min_shares_out",
  "withdraw", "sell", "withdraw_from_available", "redeem_in_kind",
  "withdraw_pending_fees", "withdraw_rewards", "invest", "invest_with_max_amount",
];
const DISCS = new Map(NAMES.map((name) => [
  crypto.createHash("sha256").update(`global:${name}`).digest("hex").slice(0, 16), name,
]));

async function rpc(method, params) {
  const response = await fetch(RPC, {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify({jsonrpc: "2.0", id: 1, method, params}),
  });
  if (!response.ok) throw new Error(`${method}: HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

async function rpcBatch(requests) {
  if (requests.length === 1) {
    return [await rpc(requests[0].method, requests[0].params)];
  }
  const body = requests.map((request, index) => ({jsonrpc: "2.0", id: index + 1, ...request}));
  const response = await fetch(RPC, {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`batch: HTTP ${response.status}`);
  const result = await response.json();
  if (!Array.isArray(result)) throw new Error(`batch: ${JSON.stringify(result)}`);
  return result.sort((a, b) => a.id - b.id).map((entry) => entry.error ? {rpcError: entry.error} : entry.result);
}

function decodeInstruction(data) {
  try {
    const raw = Buffer.from(bs58.decode(data));
    return {name: DISCS.get(raw.subarray(0, 8).toString("hex")) || "unknown", dataLength: raw.length};
  } catch (error) {
    return {name: "undecodable", dataLength: null, error: error.message};
  }
}

function keysFor(tx) {
  const message = tx.transaction.message;
  return [
    ...(message.accountKeys || []),
    ...(tx.meta?.loadedAddresses?.writable || []),
    ...(tx.meta?.loadedAddresses?.readonly || []),
  ].map((key) => typeof key === "string" ? key : key.pubkey);
}

(async () => {
  const signatureLimit = Number(process.env.KVAULT_SIGNATURE_LIMIT || 50);
  const batchSize = Number(process.env.KVAULT_RPC_BATCH || 5);
  const signatures = await rpc("getSignaturesForAddress", [PROGRAM, {limit: signatureLimit, commitment: "finalized"}]);
  const transactions = [];
  for (let start = 0; start < signatures.length; start += batchSize) {
    const chunk = signatures.slice(start, start + batchSize);
    const results = await rpcBatch(chunk.map((entry) => ({
      method: "getTransaction",
      params: [entry.signature, {commitment: "finalized", encoding: "json", maxSupportedTransactionVersion: 1}],
    })));
    for (let i = 0; i < chunk.length; i += 1) {
      const tx = results[i];
      if (!tx || tx.rpcError || tx.meta?.err) continue;
      const keys = keysFor(tx);
      const compiled = tx.transaction.message.instructions || tx.transaction.message.compiledInstructions || [];
      const kvault = compiled.flatMap((ix, instructionIndex) => {
        const programId = keys[ix.programIdIndex];
        if (programId !== PROGRAM) return [];
        const decoded = decodeInstruction(ix.data);
        return [{instructionIndex, ...decoded, accountCount: ix.accounts.length}];
      });
      if (kvault.length) transactions.push({
        signature: chunk[i].signature,
        slot: tx.slot,
        blockTime: tx.blockTime,
        version: tx.version ?? "legacy",
        computeUnitsConsumed: tx.meta?.computeUnitsConsumed ?? null,
        staticAccountCount: tx.transaction.message.accountKeys.length,
        loadedWritableCount: tx.meta?.loadedAddresses?.writable?.length || 0,
        loadedReadonlyCount: tx.meta?.loadedAddresses?.readonly?.length || 0,
        instructionCount: compiled.length,
        kvault,
      });
    }
    if (start + batchSize < signatures.length) {
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
  }
  const result = {
    generatedAt: new Date().toISOString(),
    rpc: RPC_LABEL,
    program: PROGRAM,
    signatureCount: signatures.length,
    successfulKvaultTransactionCount: transactions.length,
    byInstruction: Object.fromEntries(NAMES.map((name) => [name, transactions.filter((tx) => tx.kvault.some((ix) => ix.name === name)).length])),
    transactions,
  };
  fs.writeFileSync(OUTPUT, `${JSON.stringify(result, null, 2)}\n`, {flag: "wx"});
  process.stdout.write(`${JSON.stringify({
    generatedAt: result.generatedAt,
    signatureCount: result.signatureCount,
    successfulKvaultTransactionCount: result.successfulKvaultTransactionCount,
    byInstruction: result.byInstruction,
  }, null, 2)}\n`);
})().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
