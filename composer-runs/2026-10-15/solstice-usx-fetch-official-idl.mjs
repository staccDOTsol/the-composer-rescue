#!/usr/bin/env node

// Fetch the current official Solstice dApp bundle and extract the embedded
// YieldVault Anchor IDL. This performs only public HTTP GET requests.

import crypto from 'node:crypto';
import fs from 'node:fs';

const DASHBOARD = 'https://dapp.prod.solsticelabs.io/dashboard';
const ORIGIN = new URL(DASHBOARD).origin;
const PROGRAM = 'eUSXyKoZ6aGejYVbnp3wtWQ1E8zuokLAJPecPxxtgG3';
const OUTPUT = new URL('./solstice-usx-official-frontend-idl.json', import.meta.url).pathname;

async function getText(url) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`GET ${new URL(url).hostname} failed with HTTP ${response.status}`);
  return response.text();
}

function decodeSingleQuotedLiteral(source, start) {
  let escaped = false;
  let encoded = '';
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (!escaped && character === "'") return { encoded, end: index };
    encoded += character;
    if (escaped) escaped = false;
    else if (character === '\\') escaped = true;
  }
  throw new Error('Unterminated embedded IDL string');
}

function decodeJavascriptEscapes(encoded) {
  let decoded = '';
  for (let index = 0; index < encoded.length; index += 1) {
    const character = encoded[index];
    if (character !== '\\') {
      decoded += character;
      continue;
    }
    index += 1;
    if (index >= encoded.length) throw new Error('Trailing escape in embedded IDL string');
    const escape = encoded[index];
    const simple = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '0': '\0' };
    if (Object.hasOwn(simple, escape)) {
      decoded += simple[escape];
    } else if (escape === 'x') {
      decoded += String.fromCodePoint(Number.parseInt(encoded.slice(index + 1, index + 3), 16));
      index += 2;
    } else if (escape === 'u') {
      if (encoded[index + 1] === '{') {
        const end = encoded.indexOf('}', index + 2);
        if (end < 0) throw new Error('Unterminated Unicode code point escape');
        decoded += String.fromCodePoint(Number.parseInt(encoded.slice(index + 2, end), 16));
        index = end;
      } else {
        decoded += String.fromCodePoint(Number.parseInt(encoded.slice(index + 1, index + 5), 16));
        index += 4;
      }
    } else if (escape === '\n') {
      // JavaScript line continuation.
    } else if (escape === '\r') {
      if (encoded[index + 1] === '\n') index += 1;
    } else {
      decoded += escape;
    }
  }
  return decoded;
}

function extractIdl(source) {
  const prefix = `JSON.parse('{"address":"${PROGRAM}"`;
  const marker = source.indexOf(prefix);
  if (marker < 0) return null;
  const literalStart = marker + "JSON.parse('".length;
  const { encoded } = decodeSingleQuotedLiteral(source, literalStart);
  const decoded = decodeJavascriptEscapes(encoded);
  const idl = JSON.parse(decoded);
  if (idl.address !== PROGRAM) throw new Error('Extracted IDL address mismatch');
  return idl;
}

async function main() {
  const html = await getText(DASHBOARD);
  const scriptPaths = [...html.matchAll(/<script[^>]+src="([^"]+\.js[^"]*)"/g)].map((match) => match[1]);
  for (const scriptPath of [...new Set(scriptPaths)]) {
    const url = new URL(scriptPath, ORIGIN).toString();
    const source = await getText(url);
    const idl = extractIdl(source);
    if (!idl) continue;
    const output = {
      fetchedAt: new Date().toISOString(),
      source: {
        dashboard: DASHBOARD,
        bundlePath: new URL(url).pathname,
        bundleSha256: crypto.createHash('sha256').update(source).digest('hex'),
      },
      idl,
    };
    fs.writeFileSync(OUTPUT, `${JSON.stringify(output, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({
      output: OUTPUT,
      fetchedAt: output.fetchedAt,
      bundlePath: output.source.bundlePath,
      bundleSha256: output.source.bundleSha256,
      programId: idl.address,
      version: idl.metadata?.version || null,
      instructionCount: idl.instructions?.length || 0,
      accountTypeCount: idl.accounts?.length || 0,
      errorCount: idl.errors?.length || 0,
    }, null, 2)}\n`);
    return;
  }
  throw new Error('YieldVault IDL was not present in the current official dApp bundles');
}

main().catch((error) => {
  process.stderr.write(`${String(error?.stack || error)}\n`);
  process.exitCode = 1;
});
