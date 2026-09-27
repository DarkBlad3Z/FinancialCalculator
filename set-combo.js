#!/usr/bin/env node
/* ===================================================================
 * set-combo.js — set the ring lock's combination
 *
 *   node set-combo.js                 random combo, writes the hash
 *   node set-combo.js 7 2 11 4 9      a combo you choose (1-based)
 *   node set-combo.js --print         show it, write nothing
 *
 * Prints the combination ONCE to your terminal and writes only a
 * PBKDF2-SHA256 verifier into auth.js. The combination itself is never
 * written to disk, so it cannot leak through the repository.
 *
 * Generating it here rather than being told it is strictly better:
 * nobody else, and no chat log, ever sees it.
 *
 * Remember what this protects — see the header of auth.js. The markers
 * are visible, so the keyspace is arrows^rings and the gate is a
 * barrier, not security.
 * =================================================================== */

'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const AUTH_FILE = path.join(__dirname, 'auth.js');
const ITERATIONS = 250000;

function readConfig(src) {
  const num = (key, dflt) => {
    const m = src.match(new RegExp(key + ':\\s*(\\d+)'));
    return m ? parseInt(m[1], 10) : dflt;
  };
  return { rings: num('rings', 5), arrows: num('arrows', 12) };
}

const src = fs.readFileSync(AUTH_FILE, 'utf8');
const { rings, arrows } = readConfig(src);

const printOnly = process.argv.includes('--print');
const given = process.argv.slice(2).filter((a) => /^\d+$/.test(a)).map(Number);

let combo;
if (given.length) {
  if (given.length !== rings) {
    console.error(`Expected ${rings} numbers (one per ring), got ${given.length}.`);
    process.exit(1);
  }
  if (given.some((n) => n < 1 || n > arrows)) {
    console.error(`Marker numbers must be between 1 and ${arrows}.`);
    process.exit(1);
  }
  combo = given.map((n) => n - 1);          // store 0-based
} else {
  combo = Array.from({ length: rings }, () => crypto.randomInt(0, arrows));
}

const salt = crypto.randomBytes(16);
const hash = crypto.pbkdf2Sync(combo.join('-'), salt, ITERATIONS, 32, 'sha256');

const keyspace = Math.pow(arrows, rings);
console.log('');
console.log('  ┌─────────────────────────────────────────────┐');
console.log('  │  COMBINATION — write this down now.         │');
console.log('  │  It is not saved anywhere.                  │');
console.log('  └─────────────────────────────────────────────┘');
console.log('');
combo.forEach((k, i) => {
  console.log(`      ring ${i + 1}  ->  marker ${k + 1}`);
});
console.log('');
console.log(`      short form:  ${combo.map((k) => k + 1).join('-')}`);
console.log('');
console.log(`  ${rings} rings, ${arrows} markers = ${keyspace.toLocaleString()} combinations.`);
const hours = (keyspace * 0.05) / 2 / 3600;
console.log(`  Roughly ${hours < 1 ? (hours * 60).toFixed(0) + ' minutes' : hours.toFixed(1) + ' hours'}`
  + ' to brute-force on one core, much less on a GPU.');
console.log('');

if (printOnly) process.exit(0);

const block =
`    comboSalt: '${salt.toString('base64')}',
    comboHash: '${hash.toString('base64')}',
    comboIterations: ${ITERATIONS},`;

const re = /    comboSalt: '[^']*',\s*\n    comboHash: '[^']*',\s*\n    comboIterations: \d+,/;
if (!re.test(src)) {
  console.error('Could not find the combo block in auth.js. Paste this in by hand:\n');
  console.error(block);
  process.exit(1);
}
fs.writeFileSync(AUTH_FILE, src.replace(re, () => block));

console.log('  auth.js updated (hash only — the combo above is not in it).');
console.log('  Next:  node build.js');
console.log('');
