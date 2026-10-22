'use strict';

const fs = require('fs');
const path = require('path');

function nodeModules() {
  const candidates = [
    process.env.ORCA_NODE_MODULES,
    process.env.WHIRLPOOLS_REPO && path.join(process.env.WHIRLPOOLS_REPO, 'node_modules'),
    path.join(process.cwd(), 'node_modules'),
    '/private/tmp/whirlpools-1396-post/node_modules',
  ].filter(Boolean);
  for (const directory of candidates) {
    if (fs.existsSync(path.join(directory, '@solana', 'web3.js')) &&
        fs.existsSync(path.join(directory, '@solana', 'spl-token')))
      return directory;
  }
  throw new Error('Set ORCA_NODE_MODULES or WHIRLPOOLS_REPO to a checkout with @solana/web3.js and @solana/spl-token installed');
}

module.exports = {nodeModules};
