/* ===================================================================
 * build.js — bundle the app into one self-contained HTML file
 * Run with:  node build.js
 *
 * Produces forecaster.html, which inlines styles.css and all four JS
 * modules so the page works from a single file (and can be published
 * as a hosted artifact). Chart.js still loads from its pinned CDN.
 * =================================================================== */

'use strict';
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');

const css = read('styles.css');
const js = ['auth.js', 'money.js', 'tax-config.js', 'tax-engine.js', 'engine.js', 'app.js']
  .map((f) => `/* ===== ${f} ===== */\n${read(f)}`)
  .join('\n\n');

let html = read('index.html');

// NOTE: the replacements below pass a FUNCTION rather than a string.
// In String.replace, "$$" inside a replacement string is an escape
// sequence for a literal "$" — which silently turned app.js's `$$`
// query helper into `$`, colliding with the `$` helper declared just
// above it. A replacer function receives the text verbatim.

// Replace the stylesheet link with an inline <style>.
html = html.replace(
  /<link rel="stylesheet" href="styles\.css">/,
  () => `<style>\n${css}\n</style>`
);

// Replace the five local <script src> tags with one inline block,
// leaving the pinned Chart.js CDN tag in place.
html = html.replace(
  /<script src="auth\.js"><\/script>[\s\S]*?<script src="app\.js"><\/script>/,
  () => `<script>\n${js}\n</script>`
);

fs.writeFileSync(path.join(dir, 'forecaster.html'), html);

const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
console.log(`forecaster.html written — ${kb} KB, fully self-contained (Chart.js from CDN).`);

// Sanity checks on the bundle.
const problems = [];
if (html.includes('href="styles.css"')) problems.push('stylesheet was not inlined');
if (html.includes('src="app.js"')) problems.push('scripts were not inlined');
if (!html.includes('chart.umd.js')) problems.push('Chart.js tag missing');
if (!/Planning estimate only/.test(html)) problems.push('disclaimer missing');
// Guard against the $$ -> $ mangling described above ever coming back.
if (!html.includes('const $$')) problems.push('the $$ query helper was mangled during inlining');
if (!html.includes('AUTH_CONFIG')) problems.push('the password gate did not inline');
// Every source file must be present in full.
for (const marker of ['const Money', 'const TAX_CONFIG', 'function computeTaxes', 'function simulate', 'AUTH_CONFIG']) {
  if (!html.includes(marker)) problems.push(`missing "${marker}" — a source file did not inline`);
}
if (problems.length) { console.error('PROBLEMS: ' + problems.join('; ')); process.exit(1); }
console.log('Bundle checks passed.');
