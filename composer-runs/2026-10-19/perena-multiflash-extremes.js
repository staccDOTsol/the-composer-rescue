#!/usr/bin/env node
'use strict';

// Re-target the reviewed v1 multi-provider composition harness to the exact
// current Perena USDC/USDT pool. The inherited harness contains no broadcast
// path; this adapter only performs asserted, deterministic source rewrites.

const fs = require('fs');
const path = require('path');
const Module = require('module');

const sourcePath = path.join(__dirname, 'solfi-v2-multiflash-extremes.js');
let source = fs.readFileSync(sourcePath, 'utf8');

function replaceExact(before, after, expected = 1) {
  const count = source.split(before).length - 1;
  if (count !== expected) throw new Error(`rewrite mismatch: expected ${expected}, found ${count}: ${before}`);
  source = source.split(before).join(after);
}

// Rename the target throughout first, then replace the exact identities.
source = source.split('SolFi V2').join('Perena');
source = source.split('SOLFI').join('PERENA');
source = source.split('SolFi').join('Perena');
source = source.split('solfi').join('perena');

replaceExact("const PERENA = P('SV2EYYJyRz2YhfXwXnhNAevDEui5Q6yrfyo13WtupPF');",
  "const PERENA = P('NUMERUNsFCP3kuNmWZuXtm1AaQCPj9uw6Guv2Ekoi5P');");
replaceExact("const POOL = 'FkEB6uvyzuoaGpgs4yRtFtxC4WJxhejNFbUkj5R6wR32';",
  "const POOL = '2w4A1eGyjRutakyFdmVyBiLPf98qKxNTC2LpuwhaCruZ';");
replaceExact("const POOL_USDC = P('ARWaajRJyF6PKQryJ4HLzLBfTWM2qmVQUQVtBjk6PgPc');",
  "const POOL_USDC = P('6B8k8At9879r5EsZAWg8W6DEpxzJ798Cwj48twu3pq4b');");
replaceExact("const POOL_USDT = P('5bHD9xdEzJdkVuhs54mGPC9BZgUshqgMg4tqmTwhWggc');",
  "const POOL_USDT = P('DJfYbGicp4AFXWsragNWv1baugqcdFhw6eFTcK2YWdyK');");
replaceExact("const FORK = process.env.PERENA_FORK_RPC || 'http://127.0.0.1:9139';",
  "const FORK = process.env.PERENA_FORK_RPC || 'http://127.0.0.1:19441';");

// The zero-token-seed run is the economic test. A nonzero seed is permitted
// only for an explicitly labelled construction control and is fully reported.
replaceExact('    1_000_000_000n), executable: false, lamports: 2_039_280,',
  "    BigInt(process.env.PERENA_SYNTHETIC_USDC_SEED_RAW || '0')), executable: false, lamports: 2_039_280,");
replaceExact('    1_000_000n), executable: false, lamports: 2_039_280,',
  "    BigInt(process.env.PERENA_SYNTHETIC_USDT_SEED_RAW || '0')), executable: false, lamports: 2_039_280,");
replaceExact("syntheticUsdcSeedRaw: '1000000000', syntheticUsdtSeedRaw: '1000000'",
  "syntheticUsdcSeedRaw: String(process.env.PERENA_SYNTHETIC_USDC_SEED_RAW || '0'), syntheticUsdtSeedRaw: String(process.env.PERENA_SYNTHETIC_USDT_SEED_RAW || '0')");

if (process.env.PERENA_VECTOR === 'reverse') {
  replaceExact("  if (mode === 'independent') params.set('excludeDexes', 'Perena');",
    "  if (mode === 'independent') params.set('dexes', process.env.PERENA_INDEPENDENT_DEX || 'Deriverse');");
  replaceExact("  const forward = await quote(USDC, USDT, TOTAL_RAW, 'perena');\n" +
    "  const forwardRoute = forward.routePlan || [];\n" +
    "  if (forwardRoute.length !== 1 || forwardRoute[0].swapInfo?.label !== 'Perena' ||\n" +
    "      forwardRoute[0].swapInfo?.ammKey !== POOL) throw new Error('forward route is not exact Perena pool');\n" +
    "  // The quote service observes a slightly newer bank than the nested fork. Keep\n" +
    "  // 1 bp of quoted Perena output as USDT so harmless bank drift cannot turn the\n" +
    "  // independent exit into an insufficient-funds false negative.\n" +
    "  const exitInputRaw = BigInt(forward.outAmount) * EXIT_INPUT_BPS / 10_000n;\n" +
    "  const exit = await quote(USDT, USDC, exitInputRaw, 'independent');",
    "  const exit = await quote(USDC, USDT, TOTAL_RAW, 'independent');\n" +
    "  const exitInputRaw = BigInt(exit.outAmount) * EXIT_INPUT_BPS / 10_000n;\n" +
    "  const forward = await quote(USDT, USDC, exitInputRaw, 'perena');\n" +
    "  const forwardRoute = forward.routePlan || [];\n" +
    "  if (forwardRoute.length !== 1 || forwardRoute[0].swapInfo?.label !== 'Perena' ||\n" +
    "      forwardRoute[0].swapInfo?.ammKey !== POOL) throw new Error('reverse route is not exact Perena pool');");
  replaceExact('  const routeInstructions = [...jupiterSet(forwardBuilt), ...jupiterSet(exitBuilt)];',
    '  const routeInstructions = [...jupiterSet(exitBuilt), ...jupiterSet(forwardBuilt)];');
  replaceExact("route: {inputRaw: TOTAL_RAW.toString(), perenaOutputRaw: forward.outAmount,\n" +
    "      exitInputBps: EXIT_INPUT_BPS.toString(),\n" +
    "      independentExitInputRaw: exitInputRaw.toString(), independentExitOutputRaw: exit.outAmount,\n" +
    "      quotedResidualUsdtRaw: (BigInt(forward.outAmount) - exitInputRaw).toString(),",
    "route: {vector: 'independent_USDC_to_USDT_then_Perena_USDT_to_USDC', inputRaw: TOTAL_RAW.toString(),\n" +
    "      perenaOutputRaw: forward.outAmount, exitInputBps: EXIT_INPUT_BPS.toString(),\n" +
    "      perenaInputRaw: exitInputRaw.toString(), independentEntryOutputRaw: exit.outAmount,\n" +
    "      quotedResidualUsdtRaw: (BigInt(exit.outAmount) - exitInputRaw).toString(),");
  replaceExact('      forwardContextSlot: forward.contextSlot, exitContextSlot: exit.contextSlot,',
    '      perenaContextSlot: forward.contextSlot, independentEntryContextSlot: exit.contextSlot,');
  replaceExact('      exit: (exit.routePlan || []).map(row => ({label: row.swapInfo?.label,',
    '      independentEntry: (exit.routePlan || []).map(row => ({label: row.swapInfo?.label,');
}

const adapted = new Module(__filename, module);
adapted.filename = __filename;
adapted.paths = module.paths;
adapted._compile(source, __filename);
