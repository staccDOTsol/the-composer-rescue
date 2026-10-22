#!/usr/bin/env node
'use strict';

// Downloads only the public Exponent application shell and its JavaScript
// chunks, then extracts the embedded client IDL for the deployed generic SY
// program. No wallet, RPC credential, signature, or transaction is used.

const crypto = require('crypto');
const fs = require('fs');
const vm = require('vm');

const APP_URL = 'https://app.exponent.finance/';
const PROGRAM_ID = 'XP1BRLn8eCYSygrd8er5P4GKdzqKbC3DLoSsS5UYVZy';
const OUTPUT_IDL = `${__dirname}/xp1br-generic-standard-idl.json`;
const OUTPUT_EVIDENCE = `${__dirname}/xp1br-idl-source-evidence.json`;

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function fetchText(url) {
  const response = await fetch(url, {redirect: 'follow'});
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.text();
}

function embeddedJsonDocuments(source) {
  const pattern = /\.exports=JSON\.parse\(('(?:\\.|[^'\\])*')\)/g;
  const documents = [];
  for (const match of source.matchAll(pattern)) {
    // Evaluate only the captured JavaScript string literal, never surrounding
    // application code. The decoded string must then parse as JSON.
    const decoded = vm.runInNewContext(match[1], Object.create(null), {timeout: 1000});
    try {
      documents.push(JSON.parse(decoded));
    } catch {
      // Other webpack modules can contain JSON-like strings that are not IDLs.
    }
  }
  return documents;
}

async function main() {
  const html = await fetchText(APP_URL);
  const paths = [...new Set([...html.matchAll(/src="([^"]+\.js[^"]*)"/g)]
    .map((match) => match[1]))];
  if (!paths.length) throw new Error('No application JavaScript chunks found');

  let match;
  for (let offset = 0; offset < paths.length && !match; offset += 8) {
    const batch = paths.slice(offset, offset + 8);
    const chunks = await Promise.all(batch.map(async (path) => {
      const url = new URL(path, APP_URL).toString();
      return {path, url, source: await fetchText(url)};
    }));
    for (const chunk of chunks) {
      if (!chunk.source.includes(PROGRAM_ID)) continue;
      const idl = embeddedJsonDocuments(chunk.source).find((candidate) =>
        candidate?.address === PROGRAM_ID && candidate?.metadata?.name === 'generic_standard');
      if (idl) {
        match = {...chunk, idl};
        break;
      }
    }
  }
  if (!match) throw new Error(`Embedded IDL not found for ${PROGRAM_ID}`);

  const idlText = `${JSON.stringify(match.idl, null, 2)}\n`;
  const evidence = {
    generatedAt: new Date().toISOString(),
    publicApplication: APP_URL,
    applicationChunkPath: match.path,
    applicationChunkSha256: sha256(match.source),
    applicationChunkBytes: Buffer.byteLength(match.source),
    programId: PROGRAM_ID,
    idlName: match.idl.metadata?.name || null,
    idlVersion: match.idl.metadata?.version || null,
    idlSpec: match.idl.metadata?.spec || null,
    idlSha256: sha256(idlText),
    instructionNames: (match.idl.instructions || []).map((instruction) => instruction.name),
    note: 'Client-bundled IDL from the current public application; the canonical PMP and legacy Anchor on-chain IDL locations were empty at audit time.',
  };
  fs.writeFileSync(OUTPUT_IDL, idlText);
  fs.writeFileSync(OUTPUT_EVIDENCE, `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({OUTPUT_IDL, OUTPUT_EVIDENCE, ...evidence}, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
