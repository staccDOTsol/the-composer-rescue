#!/usr/bin/env node
'use strict';

// Oct-19 entry point for the read-only provider crosswalk. The implementation
// is shared with the Oct-15 run; input and output are explicitly redirected so
// historical artifacts are not overwritten.
const path = require('path');

process.env.SVSP_TARGET_FILE = path.join(__dirname, 'svsp-live-finalized-evidence.json');
process.env.SVSP_CROSSWALK_OUT = path.join(__dirname, 'svsp-flash-provider-crosswalk.json');
require('../2026-10-15/svsp-flash-provider-crosswalk.js');
