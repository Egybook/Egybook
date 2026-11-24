'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'egybook-bottom-nav-hitbox-guard.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');
const baseCss = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const headerScript = fs.readFileSync(path.join(root, 'script.js'), 'utf8');
const videoCss = fs.readFileSync(path.join(root, 'video-player.css'), 'utf8');
const swipeScript = fs.readFileSync(path.join(root, 'swipe-navigation.js'), 'utf8');

const expectedHref = '/Egybook/egybook-bottom-nav-hitbox-guard.css?v=236-bottom-nav-hitbox-guard';
assert.equal((html.match(/egybook-bottom-nav-hitbox-guard\.css/g) || []).length, 1,
  'the dedicated hitbox guard is linked exactly once');
assert.ok(html.includes(expectedHref), 'HTML links the versioned guard stylesheet');
assert.ok(html.indexOf(expectedHref) > html.indexOf('egybook-reels-rail-guard.css'),
  'the hitbox guard loads after the existing app stylesheets');

assert.match(css, /@media\s*\(hover:\s*none\)\s*and\s*\(pointer:\s*coarse\)/,
  'the repair is limited to touch/coarse-pointer devices');
assert.match(css, /body:not\(\.egybook-albums-open\):not\(\.post-route-open\):not\(\.messages-thread-open\)\s*\.bottom-navigation:not\(\.scroll-chrome-hidden\):not\(\.nav-scroll-hidden\)\s*\{\s*pointer-events:\s*auto\s*!important;/,
  'the visible bottom-nav surface captures taps instead of passing them through');
assert.doesNotMatch(css, /\.topbar|\.header|#egybookVideoBox|\.evp-/,
  'the guard does not target the top header or video player');
assert.doesNotMatch(css, /(?:^|[;{])\s*(?:position|top|right|bottom|left|inset|width|height|min-height|max-height|padding|margin|transform|translate|opacity|transition|animation|background|border|border-radius|box-shadow)\s*:/,
  'the guard contains no layout, visual, or motion declarations');

assert.match(baseCss, /\.bottom-navigation\.nav-scroll-hidden\s*\{\s*pointer-events:\s*none\s*\}/,
  'the existing legacy fully-hidden state remains available');
assert.match(headerScript, /el\.style\.pointerEvents=progress>=0\.985\?'none':''/,
  'the existing scroll engine still disables the fully-hidden header');
assert.match(headerScript, /el\.classList\.toggle\('scroll-chrome-hidden',progress>=0\.985\)/,
  'the existing hidden-state class threshold is unchanged');
assert.match(videoCss, /#egybookVideoBox/,
  'video player stylesheet remains present and independent');
assert.match(swipeScript, /(?:pointer|touch|swipe|gesture)/i,
  'the existing swipe module remains present and independent');

assert.ok(sw.includes("const VERSION = '2026-11-egybook-v241-handoff-audio-continuity';"),
  'Service Worker cache version advances to the current V238.1 shell');
assert.ok(sw.includes("'egybook-bottom-nav-hitbox-guard.css?v=236-bottom-nav-hitbox-guard'"),
  'Service Worker precaches the new independent stylesheet');

for (const file of [
  'tests/reels-return-recovery-v232.test.cjs',
  'tests/video-url-renewal-v231.test.cjs',
  'tests/live-preview-handoff-v234.test.cjs',
  'tests/navigation-restore-v2302.test.cjs',
  'tests/video-transition-guard-v233.test.cjs',
  'tests/reels-session-recovery-v2301.test.cjs'
]) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  assert.ok(source.includes('2026-11-egybook-v241-handoff-audio-continuity'),
    `${file} expects the current V238.1 cache version`);
}

console.log('V236 Bottom Navigation Hitbox Guard: PASS 15/15');
