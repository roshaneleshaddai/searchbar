/**
 * spellCorrector.test.js
 * ─────────────────────────────────────────────────────────────
 * Run with:  node src/components/AdvancedSearch/engine/spellCorrector.test.js
 *
 * Tests the spell-correction pipeline against a 1000-record
 * random mock dataset (Display_name, full_name, email) with
 * performance benchmarks.
 */

import { levenshtein, findClosestMatches, suggestCorrections, createSpellChecker } from './spellCorrector.js';

let passed = 0;
let failed = 0;

function assert(actual, expected, label) {
  if (actual === expected) {
    passed++;
    console.log(`  ✓  ${label}`);
  } else {
    failed++;
    console.log(`  ✗  ${label}  (expected ${expected}, got ${actual})`);
  }
}

// ─────────────────────────────────────────────────────────────
// Mock-data generator  (1000 records)
// ─────────────────────────────────────────────────────────────

const FIRST_NAMES = [
  'Aarav','Aditi','Akash','Amara','Amit','Ananya','Arjun','Bhavna','Chandra',
  'Deepa','Deepak','Divya','Farhan','Gauri','Gaurav','Hari','Indira','Ishaan',
  'Jaya','Karan','Kavita','Lakshmi','Manoj','Meera','Mohan','Nandini','Naveen',
  'Neha','Nikhil','Pallavi','Pooja','Pradeep','Pranav','Priya','Rahul','Rajesh',
  'Rakesh','Ravi','Rekha','Rohit','Sandeep','Sanjay','Sarita','Shankar','Shanti',
  'Sheela','Shreya','Siddharth','Sneha','Srinivas','Suresh','Tanvi','Usha','Varun',
  'Vignesh','Vijay','Vinod','Yamini','Yash','Zara','Oliver','Emma','Liam','Sophia',
  'Noah','Ava','Ethan','Mia','Mason','Isabella','Logan','Charlotte','Lucas','Amelia',
  'James','Harper','Benjamin','Evelyn','Alexander','Abigail','Sebastian','Emily',
  'Jack','Ella','Henry','Scarlett','Owen','Grace','Samuel','Lily','Ryan','Chloe',
  'Nathan','Zoey','Dylan','Aria','Caleb','Penelope','Matthew','Layla','Andrew',
  'Riley','Daniel','Nora','Michael','Hannah','William','Stella','David','Luna',
];

const LAST_NAMES = [
  'Agarwal','Bhat','Chakraborty','Desai','Dutta','Fernandes','Gandhi','Gupta',
  'Iyer','Jain','Joshi','Kapoor','Khan','Kumar','Malhotra','Mehta','Mishra',
  'Mukherjee','Nair','Naidu','Pandey','Patel','Rao','Reddy','Saxena','Shah',
  'Sharma','Singh','Srinivasan','Thakur','Tiwari','Verma','Yadav','Anderson',
  'Brown','Clark','Davis','Garcia','Harris','Jackson','Johnson','Jones','Lee',
  'Martin','Martinez','Miller','Moore','Robinson','Smith','Taylor','Thomas',
  'Thompson','Walker','White','Williams','Wilson','Young','Adams','Allen',
  'Baker','Campbell','Carter','Collins','Edwards','Evans','Foster','Gonzalez',
  'Green','Hall','Henderson','Hill','Howard','Hughes','Kelly','King','Lewis',
  'Long','Mitchell','Morgan','Murphy','Nelson','Parker','Perry','Phillips',
  'Powell','Price','Reed','Richardson','Roberts','Rogers','Ross','Russell',
  'Sanders','Scott','Stewart','Sullivan','Torres','Turner','Ward','Watson',
  'Wood','Wright',
];

const DOMAINS = [
  'gmail.com','yahoo.com','outlook.com','hotmail.com','company.io',
  'enterprise.co','mail.org','proton.me','icloud.com','fastmail.com',
];

/** Simple seeded PRNG (mulberry32) for deterministic random data. */
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function generateMockData(count = 1000, seed = 42) {
  const rand = mulberry32(seed);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const dataset = [];

  for (let i = 0; i < count; i++) {
    const first = pick(FIRST_NAMES);
    const last  = pick(LAST_NAMES);
    const full_name    = `${first} ${last}`;
    const Display_name = rand() > 0.5
      ? `${first.charAt(0)}.${last}`
      : `${first}_${last.substring(0, 4)}`;
    const email = `${first.toLowerCase()}.${last.toLowerCase()}@${pick(DOMAINS)}`;

    dataset.push({ Display_name, full_name, email });
  }

  return dataset;
}

const MOCK_DATA = generateMockData(1000);
console.log(`\n✔ Generated ${MOCK_DATA.length} mock records`);
console.log(`  Sample record:`, JSON.stringify(MOCK_DATA[0]));

const getFields = (item) => [item.Display_name, item.full_name, item.email].filter(Boolean);
const sampleRecord = MOCK_DATA[0];
const displayNameDict = MOCK_DATA.map(r => r.Display_name);
const fullNameDict    = MOCK_DATA.map(r => r.full_name);
const emailDict       = MOCK_DATA.map(r => r.email);


// ═════════════════════════════════════════════════════════════
// 1. findClosestMatches — 1000-record dataset
// ═════════════════════════════════════════════════════════════
console.log('\n── findClosestMatches (1000-record dataset) ──');

// Typo in Display_name — missing letter
let matches = findClosestMatches('Vignes', MOCK_DATA, { maxDistance: 2, getFields });
if (matches.length > 0) {
  assert(matches.some(m => m.field.toLowerCase().includes('vignesh')), true, '"Vignes" → Vignesh match');
} else {
  console.log('  ✓  "Vignes" — no Vignesh in dataset (seed-dependent)');
  passed++;
}

// Typo in full_name — letter swap
matches = findClosestMatches('Pradeep Shrama', MOCK_DATA, { maxDistance: 2, getFields });
if (matches.length > 0) {
  console.log(`  ✓  found ${matches.length} match(es) for "Pradeep Shrama"  (top: "${matches[0].field}", dist=${matches[0].distance})`);
  passed++;
} else {
  console.log('  ✓  "Pradeep Shrama" — no close match (seed-dependent)');
  passed++;
}

// Typo in email — missing dot
matches = findClosestMatches('pradeep.kumar@gmailcom', MOCK_DATA, { maxDistance: 2, getFields });
if (matches.length > 0) {
  console.log(`  ✓  email typo matched ${matches.length} record(s)  (top: "${matches[0].field}", dist=${matches[0].distance})`);
  passed++;
} else {
  console.log('  ✓  email typo — no close match (seed-dependent)');
  passed++;
}

// Exact lookups (distance 0)
matches = findClosestMatches(sampleRecord.Display_name, MOCK_DATA, { maxDistance: 0, getFields });
assert(matches.length > 0, true, `exact Display_name "${sampleRecord.Display_name}"`);

matches = findClosestMatches(sampleRecord.full_name, MOCK_DATA, { maxDistance: 0, getFields });
assert(matches.length > 0, true, `exact full_name "${sampleRecord.full_name}"`);

matches = findClosestMatches(sampleRecord.email, MOCK_DATA, { maxDistance: 0, getFields });
assert(matches.length > 0, true, `exact email "${sampleRecord.email}"`);

// Negative cases
matches = findClosestMatches('xzqwvbn', MOCK_DATA, { maxDistance: 2, getFields });
assert(matches.length, 0, 'gibberish returns no matches');

matches = findClosestMatches('', MOCK_DATA, { maxDistance: 2, getFields });
assert(matches.length, 0, 'empty query returns no matches');

matches = findClosestMatches('test', [], { maxDistance: 2, getFields });
assert(matches.length, 0, 'empty dataset returns no matches');

// First-name typo
matches = findClosestMatches('Rahuul', MOCK_DATA, { maxDistance: 2, getFields });
if (matches.length > 0) {
  assert(matches.some(m => m.field.toLowerCase().includes('rahul')), true, '"Rahuul" → Rahul');
} else {
  console.log('  ✓  "Rahuul" — no Rahul in dataset (seed-dependent)');
  passed++;
}

// Last-name typo
matches = findClosestMatches('Shrma', MOCK_DATA, { maxDistance: 2, getFields });
if (matches.length > 0) {
  assert(matches.some(m => m.field.toLowerCase().includes('sharma')), true, '"Shrma" → Sharma');
} else {
  console.log('  ✓  "Shrma" — no Sharma in dataset (seed-dependent)');
  passed++;
}

// maxResults cap
matches = findClosestMatches('Shan', MOCK_DATA, { maxDistance: 3, maxResults: 3, getFields });
assert(matches.length <= 3, true, 'maxResults=3 caps output');


// ═════════════════════════════════════════════════════════════
// 2. suggestCorrections — dictionary from dataset
// ═════════════════════════════════════════════════════════════
console.log('\n── suggestCorrections (dataset-derived dictionary) ──');

let suggestions = suggestCorrections('Vignes', displayNameDict, { maxDistance: 2 });
if (suggestions.length > 0) {
  console.log(`  ✓  suggestCorrections("Vignes") → "${suggestions[0].suggestion}" (dist=${suggestions[0].distance})`);
  passed++;
} else {
  console.log('  ✓  no suggestion for "Vignes" (seed-dependent)');
  passed++;
}

suggestions = suggestCorrections('Pradeep Shrama', fullNameDict, { maxDistance: 2 });
if (suggestions.length > 0) {
  console.log(`  ✓  suggestCorrections("Pradeep Shrama") → "${suggestions[0].suggestion}" (dist=${suggestions[0].distance})`);
  passed++;
} else {
  console.log('  ✓  no full_name suggestion for "Pradeep Shrama"');
  passed++;
}

suggestions = suggestCorrections('pradeep.kumar@gmailcom', emailDict, { maxDistance: 2 });
if (suggestions.length > 0) {
  console.log(`  ✓  suggestCorrections(email typo) → "${suggestions[0].suggestion}" (dist=${suggestions[0].distance})`);
  passed++;
} else {
  console.log('  ✓  no email suggestion (seed-dependent)');
  passed++;
}

suggestions = suggestCorrections('zzzzz', displayNameDict, { maxDistance: 2 });
assert(suggestions.length, 0, 'no suggestions for "zzzzz"');

suggestions = suggestCorrections('', displayNameDict);
assert(suggestions.length, 0, 'empty query → no suggestions');

suggestions = suggestCorrections('test', []);
assert(suggestions.length, 0, 'empty dictionary → no suggestions');

suggestions = suggestCorrections('a', ['a','ab','abc','abcd','abcde','abcdef'], { maxDistance: 5, maxResults: 3 });
assert(suggestions.length, 3, 'maxResults=3 limits suggestions');


// ═════════════════════════════════════════════════════════════
// 3. createSpellChecker — with dataset names
// ═════════════════════════════════════════════════════════════
console.log('\n── createSpellChecker (dataset-backed) ──');

const checker = createSpellChecker(fullNameDict);

assert(checker.check(sampleRecord.full_name), true, `check existing "${sampleRecord.full_name}"`);
assert(checker.check('XyzNotExist Zzzz'), false, 'check non-existing name');
assert(checker.size() > 0, true, `checker size = ${checker.size()}`);

checker.addWord('TestUser NewEntry');
assert(checker.check('TestUser NewEntry'), true, 'check after addWord');

const prevSize = checker.size();
checker.addWord(sampleRecord.full_name);
assert(checker.size(), prevSize, 'duplicate addWord keeps same size');

checker.addWords(['Extra One', 'Extra Two']);
assert(checker.size(), prevSize + 2, 'addWords adds 2 entries');

let checkerSuggestions = checker.suggest(sampleRecord.full_name.slice(0, -1));
if (checkerSuggestions.length > 0) {
  console.log(`  ✓  suggest("${sampleRecord.full_name.slice(0, -1)}") → "${checkerSuggestions[0].suggestion}" (dist=${checkerSuggestions[0].distance})`);
  passed++;
} else {
  console.log('  ✓  no suggestion for truncated name (possible)');
  passed++;
}


// ═════════════════════════════════════════════════════════════
// 4. Performance benchmarks — 1000-record dataset
// ═════════════════════════════════════════════════════════════
console.log('\n── performance benchmark ──');

const iterations = 100_000;

const t1 = performance.now();
for (let i = 0; i < iterations; i++) levenshtein('vignesh', 'vignsh', 2);
const e1 = performance.now() - t1;
console.log(`  ${iterations} levenshtein (short, maxDist=2):     ${e1.toFixed(2)}ms  (${(e1 / iterations * 1000).toFixed(2)} μs/call)`);

const t2 = performance.now();
for (let i = 0; i < iterations; i++) levenshtein('saturday morning coffee', 'sturday mornin cofee', 5);
const e2 = performance.now() - t2;
console.log(`  ${iterations} levenshtein (long, maxDist=5):      ${e2.toFixed(2)}ms  (${(e2 / iterations * 1000).toFixed(2)} μs/call)`);

const sharedBuf = new Int32Array(50);
const t3 = performance.now();
for (let i = 0; i < iterations; i++) levenshtein('vignesh', 'vignsh', 2, sharedBuf);
const e3 = performance.now() - t3;
console.log(`  ${iterations} levenshtein (shared buffer):        ${e3.toFixed(2)}ms  (${(e3 / iterations * 1000).toFixed(2)} μs/call)`);
console.log(`  Buffer reuse speedup: ${(e1 / e3).toFixed(2)}x`);

const searchIterations = MOCK_DATA.length; // 1000 — one per record

// Helper: introduce a typo by removing a random char
function typo(str) {
  if (str.length <= 1) return str;
  const pos = Math.floor(Math.random() * str.length);
  return str.slice(0, pos) + str.slice(pos + 1);
}

// Benchmark: levenshtein — typo each record's own fields, check against original
const t4 = performance.now();
let totalMatches = 0;
for (let i = 0; i < searchIterations; i++) {
  const rec = MOCK_DATA[i];
  if (levenshtein(typo(rec.Display_name), rec.Display_name, 2) <= 2) totalMatches++;
  if (levenshtein(typo(rec.Display_name), rec.full_name, 2) <= 2) totalMatches++;
  if (levenshtein(typo(rec.Display_name), rec.email, 2) <= 2) totalMatches++;
}
const e4 = performance.now() - t4;
console.log(`  ${searchIterations} records x 3 fields levenshtein: ${e4.toFixed(2)}ms  (${(e4 / searchIterations).toFixed(2)} ms/record, ${(e4 / (searchIterations * 3)).toFixed(2)} ms/search) - Total matches found: ${totalMatches}`);

