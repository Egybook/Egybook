/* EgyBook Interaction Selection Guard v244
 * Prevents accidental native selection on the app surface while preserving editing.
 */
(() => {
  'use strict';
  if (window.__egybookSelectionGuardInstalled) return;
  window.__egybookSelectionGuardInstalled = true;
  const editableSelector = 'input, textarea, select, [contenteditable="true"], [contenteditable=""], .allow-native-selection';
  document.addEventListener('contextmenu', event => {
    if (event.target?.closest?.(editableSelector)) return;
    event.preventDefault();
  }, true);
  document.addEventListener('selectstart', event => {
    if (event.target?.closest?.(editableSelector)) return;
    event.preventDefault();
  }, true);
  document.addEventListener('dragstart', event => {
    if (event.target?.closest?.(editableSelector)) return;
    if (event.target?.closest?.('img, a, .post, .profile-page, .notification-card, button')) event.preventDefault();
  }, true);
})();
