#!/usr/bin/env node

/**
 * validate-untrusted-content-coverage.mjs — structural coverage check for the
 * "untrusted external content" directive.
 *
 * Every mode that ingests raw external text (a job posting, a scraped
 * company/profile page, an ATS form field, a recruiter email) is a prompt-
 * injection surface: that text can contain imperative language aimed at an
 * AI ("ignore previous instructions", a fake system line, an embedded tool
 * call) and must be treated as data, never instructions. The canonical rule
 * lives once in AGENTS.md; every ingesting mode must carry a reference back
 * to it so the guidance travels with the file even when read in isolation
 * (a mode file opened standalone, a headless batch prompt with no AGENTS.md
 * in context).
 *
 * Checks (HTML comments are stripped first, so a commented-out rule counts
 * as missing):
 *   1. AGENTS.md has the canonical heading AND its section body still carries
 *      the load-bearing phrases (REQUIRED_DIRECTIVE_PHRASES). A heading over
 *      an emptied body is a gap, not a pass.
 *   2. Every covered file has a reference LINE naming the marker and stating
 *      "data, never instructions" — a stray mention of the marker ("rule does
 *      not apply here") does not count.
 *   3. Coverage is discovered, not hand-listed: any modes/**.md that calls a
 *      fetch/browse tool (INGESTION_SIGNAL) is covered, plus EXPLICIT_COVERAGE
 *      for modes that only ingest pasted text.
 *   4. Every modes/**\/_shared.md carries the short CANNOT list inline,
 *      because headless runners (batch workers, *-eval.mjs, openrouter-runner)
 *      load _shared.md + the mode file but never AGENTS.md.
 *
 * Run: node validate-untrusted-content-coverage.mjs [--root <dir>]
 * Exit 0 = clean. Exit 1 = coverage gap listed.
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { dirname, join, relative, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const MARKER = 'Untrusted External Content';
const CANONICAL_HEADING = `## ${MARKER} (CRITICAL)`;
const REFERENCE_PHRASE = 'data, never instructions';
const SHARED_PHRASE = 'submit or send anything';

const REQUIRED_DIRECTIVE_PHRASES = [
  REFERENCE_PHRASE,
  '**CANNOT do:**',
  SHARED_PHRASE,
  'reveal secrets',
  'stays untrusted after it is saved',
];

// A mode that calls any of these reads text it did not write.
const INGESTION_SIGNAL = /WebFetch|WebSearch|browser_navigate|browser_snapshot|Playwright/;

// Modes that ingest external text without naming a fetch tool (pasted JDs,
// recruiter emails, scheduling emails). Paths relative to the repo root.
const EXPLICIT_COVERAGE = [
  'batch/batch-prompt.md',
  'modes/reply-watch.md',
  'modes/cover.md',
  'modes/email.md',
  'modes/interview-redflag.md',
  'modes/interview/plan.md',
  'modes/interview/debrief.md',
  'modes/offer-prep.md',
  'modes/de/interview/plan.md',
];

// Docs and user-layer templates describe modes; they are not prompts.
const isExempt = (rel) => /(^|\/)README\.md$/.test(rel) || /\.template\.md$/.test(rel);

/** Remove <!-- ... --> blocks so commented-out text never satisfies a check. */
export function stripHtmlComments(text) {
  return typeof text === 'string' ? text.replace(/<!--[\s\S]*?-->/g, '') : '';
}

/** Body of a `## ` section, up to the next `## ` heading; null if absent. */
export function extractSection(text, heading) {
  const lines = stripHtmlComments(text).split('\n');
  const start = lines.findIndex((l) => l.trim() === heading);
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^## /.test(l));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n');
}

/** Problems with the canonical AGENTS.md section; [] = clean. */
export function checkDirective(agentsText) {
  const body = extractSection(agentsText, CANONICAL_HEADING);
  if (body === null) return [`AGENTS.md is missing the canonical heading "${CANONICAL_HEADING}"`];
  return REQUIRED_DIRECTIVE_PHRASES
    .filter((p) => !body.includes(p))
    .map((p) => `AGENTS.md "${MARKER}" section no longer contains "${p}"`);
}

/** True if some uncommented line names the marker and states the rule. */
export function hasDirectiveReference(text) {
  if (typeof text !== 'string') return false;
  return stripHtmlComments(text).split('\n').some((l) => l.includes(MARKER) && l.includes(REFERENCE_PHRASE));
}

export function ingestsExternalText(text) {
  return typeof text === 'string' && INGESTION_SIGNAL.test(stripHtmlComments(text));
}

function listMarkdown(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listMarkdown(full));
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

/** { problems, coveredCount } for the tree under root; problems [] = clean. */
export function findProblems(root) {
  const problems = [];
  const read = (rel) => readFileSync(join(root, rel), 'utf-8');

  if (!existsSync(join(root, 'AGENTS.md'))) return { problems: ['AGENTS.md not found'], coveredCount: 0 };
  problems.push(...checkDirective(read('AGENTS.md')));

  const modeFiles = listMarkdown(join(root, 'modes')).map((p) => relative(root, p).split('\\').join('/'));
  if (!modeFiles.includes('modes/_shared.md')) problems.push('modes/_shared.md not found');

  const covered = new Set();
  for (const rel of EXPLICIT_COVERAGE) {
    if (existsSync(join(root, rel))) covered.add(rel);
  }
  for (const rel of modeFiles) {
    if (isExempt(rel)) continue;
    if (rel.endsWith('/_shared.md') || ingestsExternalText(read(rel))) covered.add(rel);
  }

  for (const rel of [...covered].sort()) {
    const text = read(rel);
    if (!hasDirectiveReference(text)) {
      problems.push(`${rel} does not reference "${MARKER}" with "${REFERENCE_PHRASE}"`);
    }
    if (rel.endsWith('/_shared.md') && !stripHtmlComments(text).includes(SHARED_PHRASE)) {
      problems.push(`${rel} is missing the inline CANNOT list ("${SHARED_PHRASE}") — headless runners never load AGENTS.md`);
    }
  }
  return { problems, coveredCount: covered.size };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  const rootIdx = process.argv.indexOf('--root');
  const ROOT = rootIdx !== -1 && process.argv[rootIdx + 1]
    ? resolve(process.argv[rootIdx + 1])
    : dirname(fileURLToPath(import.meta.url));

  if (process.argv.includes('--self-test')) {
    console.log('Running validate-untrusted-content-coverage.mjs self-tests...');
    const assert = (condition, message) => {
      if (!condition) {
        console.error(`FAIL: ${message}`);
        process.exit(1);
      }
    };
    assert(stripHtmlComments('a<!-- b -->c') === 'ac', 'HTML comments must be stripped');
    assert(extractSection(`x\n${CANONICAL_HEADING}\nbody\n## Next\nno`, CANONICAL_HEADING) === 'body', 'section must stop at the next ## heading');
    assert(checkDirective('').length === 1, 'missing heading must be one problem');
    assert(hasDirectiveReference(`See "${MARKER}" — ${REFERENCE_PHRASE}.`) === true, 'a reference line must be detected');
    assert(hasDirectiveReference(`See "${MARKER}".`) === false, 'marker alone must not count as a reference');
    assert(ingestsExternalText('run WebSearch') === true, 'WebSearch must count as ingestion');
    console.log('ALL SELF-TESTS PASSED');
    process.exit(0);
  }

  const { problems, coveredCount } = findProblems(ROOT);
  if (problems.length > 0) {
    console.error('Coverage gap — untrusted-content directive missing or unreferenced:');
    for (const p of problems) console.error(`  ${p}`);
    console.error('');
    console.error(`Keep the "${CANONICAL_HEADING}" section in AGENTS.md intact, and give every`);
    console.error(`ingesting mode a line naming "${MARKER}" and stating "${REFERENCE_PHRASE}".`);
    process.exit(1);
  }
  console.log(`OK: canonical directive intact in AGENTS.md and referenced by ${coveredCount} ingesting mode files`);
  process.exit(0);
}
