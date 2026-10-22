#!/usr/bin/env node
// Oct 19 current-state wrapper for the shared signed multi-provider harness.
'use strict';

process.env.HYLO_OUTPUT = `${__dirname}/hylo-exchange-signed-multisource-v1.json`;
process.env.HYLO_RPC_ENV = '/private/tmp/codex-mainnet-rpc-2026-10-19.env';
process.env.HYLO_FORK_RPC = ['http:', '', '127.0.0.1:9187'].join('/');
process.env.HYLO_FORK_SLOT_MS = '200';
process.env.HYLO_ACTOR_BUFFER_RAW = '2000000000000000';
process.env.HYLO_ENABLE_SAVE = '1';
process.env.HYLO_JITOSOL_PROVIDER_INVENTORY = `${__dirname}/hylo-exchange-current-jitosol-provider-inventory.json`;
require('../2026-10-15/hylo-exchange-signed-multisource-v1.js');
