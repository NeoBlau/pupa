#!/usr/bin/env node
/* run.mjs — the unit suites. `node test/run.mjs` from the project root.
   Each suite prints what it measured; a non-zero exit means something threw. */

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const suites = readdirSync(here).filter((f) => f.endsWith('.test.mjs')).sort();

let failed = 0;
for (const suite of suites) {
  process.stdout.write(`\n\x1b[1m── ${suite}\x1b[0m\n`);
  const res = spawnSync(process.execPath, [join(here, suite)], { stdio: 'inherit' });
  if (res.status !== 0) { failed++; process.stdout.write(`\x1b[31m   FAILED\x1b[0m\n`); }
}

process.stdout.write(`\n${suites.length - failed}/${suites.length} suites passed\n`);
process.exit(failed ? 1 : 0);
