#!/usr/bin/env node
'use strict';

// Read-only public-client inspection.  This does not log in, create a wallet
// session, solve/evade Turnstile, request a token, or submit an order.

const crypto = require('crypto');
const fs = require('fs');

const DIR = __dirname;
const OUT = `${DIR}/janusfi-world-public-client-probe.json`;
const HOME = 'https://world.xyz/';
const AGGREGATOR = 'https://aggregator-api-proxy.world-xyz.workers.dev';
const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

async function get(url, options = {}) {
  const response = await fetch(url, {redirect: 'follow', signal: AbortSignal.timeout(20_000),
    ...options});
  const body = await response.text();
  return {url: response.url, status: response.status,
    contentType: response.headers.get('content-type'), bytes: Buffer.byteLength(body),
    sha256: sha256(body), body};
}

function asset(html, expression, label) {
  const match = html.match(expression);
  if (!match) throw new Error(`Could not find current ${label} asset`);
  return new URL(match[0], HOME).href;
}

async function main() {
  const home = await get(HOME);
  const indexUrl = asset(home.body, /assets\/index-[A-Za-z0-9_-]+\.js/, 'index');
  const index = await get(indexUrl);
  const apiUrl = asset(index.body, /assets\/api-[A-Za-z0-9_-]+\.js/, 'API');
  const appUrl = asset(index.body, /assets\/App-[A-Za-z0-9_-]+\.js/, 'App');
  const clientUrl = asset(index.body, /assets\/client-[A-Za-z0-9_-]+\.js/, 'client');
  const scrollRailUrl = asset(index.body, /assets\/ScrollRail-[A-Za-z0-9_-]+\.js/, 'ScrollRail');
  const [api, app, client, scrollRail, unauthenticatedOrder] = await Promise.all([
    get(apiUrl), get(appUrl), get(clientUrl), get(scrollRailUrl), get(`${AGGREGATOR}/order`),
  ]);
  const bundles = {api: api.body, app: app.body, client: client.body,
    scrollRail: scrollRail.body};
  const bundlesContaining = (needle) => Object.entries(bundles)
    .filter(([, body]) => body.includes(needle)).map(([name]) => name);
  const output = {
    generatedAt: new Date().toISOString(), readOnly: true, liveSubmission: false,
    loginAttempted: false, turnstileAttempted: false, tokenRequested: false,
    assets: {
      home: {url: home.url, status: home.status, bytes: home.bytes, sha256: home.sha256},
      index: {url: index.url, status: index.status, bytes: index.bytes, sha256: index.sha256},
      api: {url: api.url, status: api.status, bytes: api.bytes, sha256: api.sha256},
      app: {url: app.url, status: app.status, bytes: app.bytes, sha256: app.sha256},
      client: {url: client.url, status: client.status, bytes: client.bytes, sha256: client.sha256},
      scrollRail: {url: scrollRail.url, status: scrollRail.status,
        bytes: scrollRail.bytes, sha256: scrollRail.sha256},
    },
    currentClientIndicators: {
      aggregatorBasePresent: bundlesContaining(AGGREGATOR).length > 0,
      aggregatorBaseBundles: bundlesContaining(AGGREGATOR),
      orderGetPresent: bundlesContaining('/order?').length > 0,
      orderGetBundles: bundlesContaining('/order?'),
      turnstileJwtStoragePresent: bundlesContaining('TURNSTILE_JWT').length > 0,
      turnstileJwtStorageBundles: bundlesContaining('TURNSTILE_JWT'),
      turnstileExchangePresent: Object.entries(bundles).some(([, body]) =>
        body.includes('/auth/token') && body.includes('x-turnstile-token')),
      turnstileExchangeBundles: Object.entries(bundles).filter(([, body]) =>
        body.includes('/auth/token') && body.includes('x-turnstile-token')).map(([name]) => name),
      bearerAuthorizationPresent: Object.entries(bundles).some(([, body]) =>
        body.includes('Authorization') && body.includes('Bearer')),
      bearerAuthorizationBundles: Object.entries(bundles).filter(([, body]) =>
        body.includes('Authorization') && body.includes('Bearer')).map(([name]) => name),
      empty404TriggersTokenRefreshPresent: Object.entries(bundles).some(([, body]) =>
        body.includes('status!==404') && body.includes('clone().text()')),
    },
    unauthenticatedOrderProbe: {
      method: 'GET', url: `${AGGREGATOR}/order`, queryParameters: false,
      authorizationHeader: false, status: unauthenticatedOrder.status,
      responseBytes: unauthenticatedOrder.bytes, responseSha256: unauthenticatedOrder.sha256,
      contentType: unauthenticatedOrder.contentType,
    },
    limitation: 'A fresh authorized quote was not obtained because the current public client requires an anonymous JWT exchanged from Cloudflare Turnstile. The challenge was not solved or bypassed.',
  };
  fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
