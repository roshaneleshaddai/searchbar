/**
 * spellCorrector.test.js
 * ─────────────────────────────────────────────────────────────
 * Run with:  node src/components/AdvancedSearch/engine/spellCorrector.test.js
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

function assertArray(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
    console.log(`  ✓  ${label}`);
  } else {
    failed++;
    console.log(`  ✗  ${label}`);
    console.log(`       expected: ${e}`);
    console.log(`       got:      ${a}`);
  }
}

// ─────────────────────────────────────────────────────────────
// 1. levenshtein — basic correctness
// ─────────────────────────────────────────────────────────────
console.log('\n── levenshtein: basic correctness ──');

assert(levenshtein('', ''), 0, 'both empty');
assert(levenshtein('abc', ''), 3, 'b empty');
assert(levenshtein('', 'xyz'), 3, 'a empty');
assert(levenshtein('hello', 'hello'), 0, 'identical strings');
assert(levenshtein('a', 'b'), 1, 'single char substitution');
assert(levenshtein('a', ''), 1, 'single char vs empty');
assert(levenshtein('', 'a'), 1, 'empty vs single char');

// ─────────────────────────────────────────────────────────────
// 2. levenshtein — insertions, deletions, substitutions
// ─────────────────────────────────────────────────────────────
console.log('\n── levenshtein: edit operations ──');

assert(levenshtein('hello', 'hllo'), 1, 'deletion (e)');
assert(levenshtein('hllo', 'hello'), 1, 'insertion (e)');
assert(levenshtein('hello', 'hallo'), 1, 'substitution (e→a)');
assert(levenshtein('ab', 'ba'), 2, 'transposition (2 subs)');
assert(levenshtein('abc', 'def'), 3, 'completely different');

// ─────────────────────────────────────────────────────────────
// 3. levenshtein — classic examples
// ─────────────────────────────────────────────────────────────
console.log('\n── levenshtein: classic examples ──');

assert(levenshtein('kitten', 'sitting'), 3, 'kitten → sitting');
assert(levenshtein('saturday', 'sunday'), 3, 'saturday → sunday');
assert(levenshtein('intention', 'execution'), 5, 'intention → execution');

// ─────────────────────────────────────────────────────────────
// 4. levenshtein — real-world typos
// ─────────────────────────────────────────────────────────────
console.log('\n── levenshtein: real-world typos ──');

assert(levenshtein('vignesh', 'vignsh'), 1, 'vignesh → vignsh (missing e)');
assert(levenshtein('vignesh', 'vignash'), 1, 'vignesh → vignash (e→a)');
assert(levenshtein('vignesh', 'vignessh'), 1, 'vignesh → vignessh (extra s)');
assert(levenshtein('vignesh', 'wignesh'), 1, 'vignesh → wignesh (v→w)');
assert(levenshtein('channel', 'chanel'), 1, 'channel → chanel (missing n)');
assert(levenshtein('pradeep', 'pradep'), 1, 'pradeep → pradep (missing e)');
assert(levenshtein('shankar', 'shanker'), 1, 'shankar → shanker (a→e)');
assert(levenshtein('market', 'markt'), 1, 'market → markt (missing e)');
assert(levenshtein('market', 'markot'), 1, 'market → markot (e→o)');

// ─────────────────────────────────────────────────────────────
// 5. levenshtein — prefix trimming optimization
// ─────────────────────────────────────────────────────────────
console.log('\n── levenshtein: prefix trimming ──');

assert(levenshtein('prefix_same', 'prefix_diff'), 4, 'shared prefix, different suffix');
assert(levenshtein('abcdefgh', 'abcdefgh'), 0, 'all chars are prefix');
assert(levenshtein('abcdef', 'abcxyz'), 3, 'prefix abc, then 3 subs');
assert(levenshtein('aaa', 'aaab'), 1, 'prefix is entire shorter string');

// ─────────────────────────────────────────────────────────────
// 6. levenshtein — maxDistance cap
// ─────────────────────────────────────────────────────────────
console.log('\n── levenshtein: maxDistance ──');

assert(levenshtein('kitten', 'sitting', 2), 3, 'dist=3 > max=2 → returns max+1');
assert(levenshtein('kitten', 'sitting', 3), 3, 'dist=3 = max=3 → returns 3');
assert(levenshtein('kitten', 'sitting', 4), 3, 'dist=3 < max=4 → returns 3');
assert(levenshtein('vignesh', 'vignsh', 1), 1, 'dist=1 = max=1 → returns 1');
assert(levenshtein('vignesh', 'vignsh', 2), 1, 'dist=1 < max=2 → returns 1');
assert(levenshtein('abc', 'xyz', 2), 3, 'dist=3 > max=2 → returns 3');
assert(levenshtein('abc', 'xyz', 0), 1, 'dist=3 > max=0 → returns 1');
assert(levenshtein('hello', 'hello', 0), 0, 'identical, max=0 → returns 0');

// ─────────────────────────────────────────────────────────────
// 7. levenshtein — buffer reuse
// ─────────────────────────────────────────────────────────────
console.log('\n── levenshtein: buffer reuse ──');

const buf = new Int32Array(20);
assert(levenshtein('hello', 'hallo', Infinity, buf), 1, 'with buffer: hello→hallo');
assert(levenshtein('world', 'word', Infinity, buf), 1, 'with buffer: world→word');
assert(levenshtein('test', 'toast', Infinity, buf), 2, 'with buffer: test→toast');
assert(levenshtein('abc', 'abc', Infinity, buf), 0, 'with buffer: identical');

// ─────────────────────────────────────────────────────────────
// 8. levenshtein — swap optimization (m ≥ n)
// ─────────────────────────────────────────────────────────────
console.log('\n── levenshtein: symmetry (swap) ──');

assert(levenshtein('short', 'muchlongerstring'), levenshtein('muchlongerstring', 'short'), 'lev(a,b) = lev(b,a) — asymmetric lengths');
assert(levenshtein('ab', 'xyz'), levenshtein('xyz', 'ab'), 'lev(ab,xyz) = lev(xyz,ab)');
assert(levenshtein('a', 'abcdef'), levenshtein('abcdef', 'a'), 'lev(a,abcdef) = lev(abcdef,a)');

// ─────────────────────────────────────────────────────────────
// 9. levenshtein — edge cases
// ─────────────────────────────────────────────────────────────
console.log('\n── levenshtein: edge cases ──');

assert(levenshtein('a'.repeat(100), 'a'.repeat(100)), 0, '100 identical chars');
assert(levenshtein('a'.repeat(50), 'b'.repeat(50)), 50, '50 vs 50 all different');
assert(levenshtein('abc', 'ABC'), 3, 'case sensitive by default');
assert(levenshtein(' hello ', 'hello'), 2, 'spaces count as chars');

// ─────────────────────────────────────────────────────────────
// 10. findClosestMatches
// ─────────────────────────────────────────────────────────────
console.log('\n── findClosestMatches ──');

const candidates = [
  { name: 'Vignesh' },
  { name: 'Pradeep' },
  { name: 'Shankar' },
  { name: 'Market' },
  { name: 'Channel' },
];

let matches = findClosestMatches('vignsh', candidates, { maxDistance: 2 });
assert(matches.length > 0, true, 'finds matches for "vignsh"');
assert(matches[0].field, 'Vignesh', 'closest match is "Vignesh"');
assert(matches[0].distance, 1, 'distance is 1');

matches = findClosestMatches('pradep', candidates, { maxDistance: 2 });
assert(matches[0].field, 'Pradeep', 'closest match for "pradep" is "Pradeep"');

matches = findClosestMatches('xyzxyz', candidates, { maxDistance: 2 });
assert(matches.length, 0, 'no matches for "xyzxyz" within distance 2');

matches = findClosestMatches('', candidates, { maxDistance: 2 });
assert(matches.length, 0, 'empty query returns no matches');

matches = findClosestMatches('test', [], { maxDistance: 2 });
assert(matches.length, 0, 'empty candidates returns no matches');

// ─────────────────────────────────────────────────────────────
// 11. suggestCorrections
// ─────────────────────────────────────────────────────────────
console.log('\n── suggestCorrections ──');

const dictionary = ['vignesh', 'pradeep', 'shankar', 'market', 'channel', 'hello', 'world'];

let suggestions = suggestCorrections('vignsh', dictionary, { maxDistance: 2 });
assert(suggestions.length > 0, true, 'finds suggestions for "vignsh"');
assert(suggestions[0].suggestion, 'vignesh', 'top suggestion is "vignesh"');
assert(suggestions[0].distance, 1, 'distance is 1');

suggestions = suggestCorrections('helo', dictionary, { maxDistance: 2 });
assert(suggestions[0].suggestion, 'hello', 'top suggestion for "helo" is "hello"');

suggestions = suggestCorrections('zzzzz', dictionary, { maxDistance: 2 });
assert(suggestions.length, 0, 'no suggestions for "zzzzz"');

suggestions = suggestCorrections('', dictionary);
assert(suggestions.length, 0, 'empty query returns no suggestions');

suggestions = suggestCorrections('test', []);
assert(suggestions.length, 0, 'empty dictionary returns no suggestions');

// maxResults limit
suggestions = suggestCorrections('a', ['a', 'ab', 'abc', 'abcd', 'abcde', 'abcdef'], { maxDistance: 5, maxResults: 3 });
assert(suggestions.length, 3, 'maxResults=3 limits output');

// ─────────────────────────────────────────────────────────────
// 12. createSpellChecker
// ─────────────────────────────────────────────────────────────
console.log('\n── createSpellChecker ──');

const checker = createSpellChecker(['hello', 'world', 'vignesh', 'pradeep']);

assert(checker.check('hello'), true, 'check existing word');
assert(checker.check('xyz'), false, 'check non-existing word');
assert(checker.size(), 4, 'initial size is 4');

checker.addWord('channel');
assert(checker.check('channel'), true, 'check after addWord');
assert(checker.size(), 5, 'size after addWord is 5');

checker.addWord('hello'); // duplicate
assert(checker.size(), 5, 'duplicate addWord does not increase size');

checker.addWords(['market', 'shankar']);
assert(checker.size(), 7, 'addWords adds 2 new words');

let checkerSuggestions = checker.suggest('helo');
assert(checkerSuggestions.length > 0, true, 'suggest returns results');
assert(checkerSuggestions[0].suggestion, 'hello', 'suggest top result is "hello"');

// ─────────────────────────────────────────────────────────────
// 13. Performance benchmark
// ─────────────────────────────────────────────────────────────
console.log('\n── performance benchmark ──');

const iterations = 100_000;

const t1 = performance.now();
for (let i = 0; i < iterations; i++) levenshtein('vignesh', 'vignsh', 2);
const e1 = performance.now() - t1;
console.log(`  ${iterations} calls (short, maxDist=2):        ${e1.toFixed(2)}ms  (${(e1 / iterations * 1000).toFixed(2)} μs/call)`);

const t2 = performance.now();
for (let i = 0; i < iterations; i++) levenshtein('saturday morning coffee', 'sturday mornin cofee', 5);
const e2 = performance.now() - t2;
console.log(`  ${iterations} calls (long, maxDist=5):         ${e2.toFixed(2)}ms  (${(e2 / iterations * 1000).toFixed(2)} μs/call)`);

const sharedBuf = new Int32Array(50);
const t3 = performance.now();
for (let i = 0; i < iterations; i++) levenshtein('vignesh', 'vignsh', 2, sharedBuf);
const e3 = performance.now() - t3;
console.log(`  ${iterations} calls (short, shared buffer):    ${e3.toFixed(2)}ms  (${(e3 / iterations * 1000).toFixed(2)} μs/call)`);
console.log(`  Buffer reuse speedup: ${(e1 / e3).toFixed(2)}x`);

// ─────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(50));
console.log(`  TOTAL: ${passed + failed} tests — ${passed} passed, ${failed} failed`);
console.log('═'.repeat(50) + '\n');

process.exit(failed > 0 ? 1 : 0);
