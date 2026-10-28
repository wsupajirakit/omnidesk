/**
 * [PROG-20260905-CENSUS] Print the ratchet's own numbers without running jest.
 *
 * WHY IT EXISTS. Every save point has to answer "what does the method measure now, and
 * does it still fit the ceiling". Until this file, the only way to read those numbers was
 * to run the census spec, which loads ts-jest and the whole config for two integers — and
 * on a loaded machine that is the difference between checking a cut and guessing at it.
 * The owner's CPU rule is real: guessing is what the guessing costs.
 *
 * ⚠️ IT IMPORTS THE SAME RULER THE RATCHET USES (`z-test/lib/code-line-census.ts`). A
 * second implementation "just for reporting" would drift and then report a cut that the
 * ratchet does not agree happened. This file must never grow its own counting logic.
 *
 *   npx ts-node -T z-test/tools/census.ts
 *
 * eslint's `no-console` is disabled for this file, and only this file: printing to stdout
 * is what a command-line tool is FOR. A logger here would put the numbers somewhere the
 * person who ran the command cannot see them.
 */
/* eslint-disable no-console */

import { readFileSync } from 'fs';
import { join } from 'path';

import { census, findMethodRange } from '../lib/code-line-census';

const ROOT = join(__dirname, '../..');

interface Ratchet {
  file: string;
  methodSignature: string;
  methodCodeCeiling: number;
  fileCodeCeiling: number;
  baseline: { methodCode: number; fileCode: number };
}

const ratchet = JSON.parse(
  readFileSync(join(ROOT, 'z-test/fixtures/spine-size-ratchet.json'), 'utf8'),
) as Ratchet;

const source = readFileSync(join(ROOT, ratchet.file), 'utf8');
const range = findMethodRange(source, ratchet.methodSignature);
if (!range) {
  // A rotted anchor must be loud here for the same reason it is a failure in the spec:
  // measuring nothing reads as a perfect score.
  console.error(
    `ANCHOR ROT: "${ratchet.methodSignature}" not found in ${ratchet.file}`,
  );
  process.exit(2);
}

const method = census(source, range.from, range.to);
const file = census(source);
const pct = (from: number, now: number): string =>
  `${(((from - now) / from) * 100).toFixed(1)}%`;

const verdict = (now: number, ceiling: number): string =>
  now <= ceiling
    ? now < ceiling
      ? `UNDER by ${ceiling - now}`
      : 'AT'
    : `OVER by ${now - ceiling}`;

console.log(`file    : ${ratchet.file}`);
console.log(`method  : ${ratchet.methodSignature} @ ${range.from}-${range.to}`);
console.log('');
console.log(
  `method code : ${method.code}  (ceiling ${ratchet.methodCodeCeiling} — ${verdict(
    method.code,
    ratchet.methodCodeCeiling,
  )})  removed ${pct(ratchet.baseline.methodCode, method.code)} of ${ratchet.baseline.methodCode}`,
);
console.log(
  `file   code : ${file.code}  (ceiling ${ratchet.fileCodeCeiling} — ${verdict(
    file.code,
    ratchet.fileCodeCeiling,
  )})  removed ${pct(ratchet.baseline.fileCode, file.code)} of ${ratchet.baseline.fileCode}`,
);
console.log('');
console.log(
  `method raw ${method.raw} = code ${method.code} + comment ${method.comment} + blank ${method.blank}`,
);
