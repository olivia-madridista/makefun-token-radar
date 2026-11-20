// Token Radar, token-radar-01 entry. Node 22, standard library only.
//
// What it does, in order:
//   1. reads the sealed snapshot (/input/snapshot.json, or --input <file|dir>)
//   2. scores every pre-token protocol with the radar-2 model in lib/model.ts
//   3. refuses to continue if the board would fail the gate, instead of
//      writing a board the judge throws out
//   4. writes /output/board.json and the dashboard's /output/data.js
//   5. copies dashboard/ and screenshots/ into /output
//   6. writes /output/dossier.json last, because the judge rebuilds it from
//      the finished /output and compares the bytes
//
// The dashboard is a static page with no framework and no network:
// dashboard/index.html, dashboard/app.css and dashboard/app.js read the
// data.js this program writes from the same board, so the page and the
// board can never drift apart.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

// Caps from the gate (reference/gate.json): the text cap shapes the bytes,
// the rest refuse an entry that breaks them.
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_MAX = 4;
const SCREENSHOT_MAX_BYTES = 524_288;
const DASHBOARD_MAX_FILES = 400;
const DASHBOARD_MAX_BYTES = 4_194_304;
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

const here = fileURLToPath(new URL('.', import.meta.url));

// Read a --name <value> (or --name=<value>) flag, or fall back.
function flag(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < process.argv.length) return process.argv[i + 1]!;
  const joined = process.argv.find((a) => a.startsWith(`--${name}=`));
  return joined === undefined ? fallback : joined.slice(name.length + 3);
}

function fail(message: string, code = 1): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(code);
}

// Copy every regular file in one directory, skipping dotfiles, and report
// the names it copied so the caller can check the count.
function copyDir(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const inputArg = flag('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  fail(
    `no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input`,
    2,
  );
}
const out = flag('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) fail(`the model wrote a board the gate refuses: ${issue}`);

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

const dashboardFiles = copyDir(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyDir(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  fail(
    `screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: ` +
      'hand in 3, the board, a detail view and a filtered view',
  );
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
  }
}

// The dossier is written last, from the finished /output.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: TEXT_MAX_BYTES,
    screenshots: { max: SCREENSHOT_MAX, max_bytes: SCREENSHOT_MAX_BYTES },
    dashboard: { max_files: DASHBOARD_MAX_FILES, max_bytes: DASHBOARD_MAX_BYTES },
  }),
);

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ` +
    `${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ` +
    `${join(out, 'dashboard')} (${dashboardFiles.length} files), ` +
    `${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
