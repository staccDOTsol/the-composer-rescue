#!/usr/bin/env node
'use strict';

process.env.HYLO_RPC_ENV = '/private/tmp/codex-mainnet-rpc-2026-10-19.env';
process.env.HYLO_ATTESTATION_OUTPUT = `${__dirname}/hylo-exchange-deployment-attestation.json`;
process.env.HYLO_BINARY_PATH = `${__dirname}/hylo-exchange-current.so`;
require('../2026-10-15/hylo-exchange-deployment-attestation.js');
