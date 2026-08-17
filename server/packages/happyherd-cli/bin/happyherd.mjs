#!/usr/bin/env node

import { main } from '../dist/index.mjs';

process.exitCode = await main(process.argv.slice(2));
