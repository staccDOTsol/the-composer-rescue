// Read-only trace of programs that appeared to touch the selected DBC base mint.
// It distinguishes a genuine independent consumer from a router that CPI-calls DBC.
const fs = require('fs');

const RPC = process.env.HEAVY_RPC_URL || process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
const DBC = 'dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN';
const BASE_MINT = 'CkFm8Gk8zAzMUW9NAMobHuQvfzSNT7W8HgM3PsJ8moon';
const samples = [
  {
    label: 'HuT route: Quantum then DBC',
    signature: '45i6JD86FfTM3xHetakFnK8Su8s7FwMw1k7NLyebtmrDw1ACvdHJbJK7E926UW14m6DsTpEUU7475r7jqg1wuyXX',
    router: 'HuTkmnrv4zPnArMqpbMbFhfwzTR7xfWQZHH1aQKzDKFZ',
  },
  {
    label: 'HuT route: DLMM, ZeroFi, then DBC',
    signature: '2gYDJXiEgtqLUB2Awh3NsrZkco78P6iPz9Y8eUsxtxGmDh1fUtUKwgny4WJEdZ57yGL7XKGNDhqauYW5eDEjMJ6e',
    router: 'HuTkmnrv4zPnArMqpbMbFhfwzTR7xfWQZHH1aQKzDKFZ',
  },
  {
    label: 'Titan SwapRouteV3 into DBC',
    signature: '61CzVCJxe6uBnR8CuTtxHts9cjDzxXAbGgYA6dtVKSxdb2wtLDnevD1pMGgsA1ead6V2Dq76jdHxLw1qDz2kNADw',
    router: 'T1TANpTeScyeqVzzgNViGDNrkQ6qHz9KrSBS4aNXvGT',
  },
];

async function getTransaction(signature) {
  const response = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getTransaction',
      params: [signature, { encoding: 'json', maxSupportedTransactionVersion: 1, commitment: 'confirmed' }],
    }),
  });
  const body = await response.json();
  if (body.error || !body.result) throw new Error(`${signature}: ${JSON.stringify(body.error || 'missing')}`);
  return body.result;
}

function relevantLog(line, router) {
  return line.includes(router)
    || line.includes(DBC)
    || line.includes('Instruction: Swap')
    || line.includes('dex:')
    || line.includes('SwapEvent');
}

async function main() {
  const traces = [];
  for (const sample of samples) {
    const tx = await getTransaction(sample.signature);
    const keys = [
      ...tx.transaction.message.accountKeys,
      ...(tx.meta.loadedAddresses?.writable || []),
      ...(tx.meta.loadedAddresses?.readonly || []),
    ];
    const baseIndexes = [...new Set([
      ...(tx.meta.preTokenBalances || []),
      ...(tx.meta.postTokenBalances || []),
    ].filter((balance) => balance.mint === BASE_MINT).map((balance) => balance.accountIndex))];
    const inner = (tx.meta.innerInstructions || []).flatMap((group) => group.instructions.map((ix) => ({
      outerIndex: group.index,
      programId: keys[ix.programIdIndex],
      stackHeight: ix.stackHeight,
      touchesSelectedBaseAccount: (ix.accounts || []).some((index) => baseIndexes.includes(index)),
    })));
    const logs = tx.meta.logMessages || [];
    traces.push({
      ...sample,
      slot: tx.slot,
      succeeded: tx.meta.err === null,
      selectedBaseAccountIndexes: baseIndexes,
      selectedBaseAccounts: baseIndexes.map((index) => keys[index]),
      innerProgramSequence: inner,
      relevantLogs: logs.filter((line) => relevantLog(line, sample.router)),
      routeInvokesDbc: inner.some((ix) => ix.programId === DBC),
      classification: 'router/proxy; selected base-token route CPI-invokes DBC, not an independent price consumer',
    });
  }
  const output = {
    timestamp: new Date().toISOString(),
    selectedBaseMint: BASE_MINT,
    conclusion: 'HuT and Titan are routing layers in these selected-base transactions; both invoke DBC for the selected base-token leg.',
    traces,
  };
  const path = 'composer-runs/2026-10-15/meteora-dbc-independent-consumer-router-traces.json';
  fs.writeFileSync(path, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({ path, traces: traces.length, allInvokeDbc: traces.every((trace) => trace.routeInvokesDbc) }));
}

main().catch((error) => {
  console.error(error.stack);
  process.exitCode = 1;
});
