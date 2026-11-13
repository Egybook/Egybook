/* EgyBook — branded dropdowns for native select fields across the site. */
(() => {
  'use strict';
  if (window.EgyBookCustomSelects) return;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const wrappers = new Set();

  function closeAll(except = null) {
    wrappers.forEach(wrapper => {
      if (!wrapper.isConnected) { wrappers.delete(wrapper); return; }
      if (wrapper === except) return;
      const trigger = $('.egybook-custom-select-trigger', wrapper);
      const menu = wrapper.__egybookMenu || $('.egybook-custom-select-menu', wrapper);
      wrapper.classList.remove('is-open', 'opens-up');
      trigger?.setAttribute('aria-expanded', 'false');
      if (menu) {
        menu.hidden = true; menu.style.top = ''; menu.style.left = ''; menu.style.width = ''; menu.style.maxHeight = '';
        if (menu.parentElement !== wrapper) wrapper.append(menu);
      }
    });
  }

  function focusOption(menu, index) {
    const options = $$('[role="option"]:not(:disabled)', menu);
    if (!options.length) return;
    const safe = Math.max(0, Math.min(options.length - 1, index));
    options[safe].focus();
  }

  function enhance(select) {
    if (!(select instanceof HTMLSelectElement) || select.dataset.egybookEnhanced === 'true') return;
    if (select.multiple || select.size > 1 || select.dataset.keepNative === 'true' || !select.options.length) return;

    const labels = [...(select.labels || [])];
    const containingLabel = labels.find(label => label.contains(select)) || null;
    const labelText = labels.map(label => {
      const clone = label.cloneNode(true);
      clone.querySelectorAll('select').forEach(node => node.remove());
      return clone.textContent.trim();
    }).filter(Boolean).join(' ');
    labels.forEach(label => label.removeAttribute('for'));
    select.dataset.egybookEnhanced = 'true';
    const wrapper = document.createElement('div');
    wrapper.className = 'egybook-custom-select';
    wrapper.dataset.selectId = select.id || '';
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'egybook-custom-select-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    const label = document.createElement('span');
    label.className = 'egybook-custom-select-value';
    const icon = document.createElement('span');
    icon.className = 'egybook-custom-select-chevron';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '⌄';
    trigger.append(label, icon);
    const menu = document.createElement('div');
    menu.className = 'egybook-custom-select-menu';
    menu.setAttribute('role', 'listbox');
    menu.hidden = true;
    wrapper.__egybookMenu = menu;
    trigger.setAttribute('aria-label', select.getAttribute('aria-label') || labelText || 'فتح قائمة الاختيار');
    wrapper.__egybookSelect = select;

    const syncValue = () => {
      const option = select.options[select.selectedIndex];
      label.textContent = option?.textContent?.trim() || 'اختر';
      trigger.disabled = select.matches(':disabled');
      trigger.setAttribute('aria-disabled', String(select.matches(':disabled')));
      menu.querySelectorAll('[role="option"]').forEach(button => {
        const selected = button.dataset.value === select.value;
        button.classList.toggle('is-selected', selected);
        button.setAttribute('aria-selected', String(selected));
      });
    };

    const rebuildOptions = () => {
      menu.replaceChildren();
      [...select.options].forEach((option, index) => {
        const choice = document.createElement('button');
        choice.type = 'button';
        choice.className = 'egybook-custom-select-option';
        choice.id = `${select.id || 'egybook-select'}-option-${index}-${Math.random().toString(36).slice(2, 6)}`;
        choice.setAttribute('role', 'option');
        choice.dataset.value = option.value;
        choice.textContent = option.textContent.trim() || '—';
        choice.disabled = option.disabled || option.parentElement?.disabled || false;
        choice.addEventListener('click', () => {
          if (choice.disabled) return;
          select.value = option.value;
          select.dispatchEvent(new Event('input', { bubbles: true }));
          select.dispatchEvent(new Event('change', { bubbles: true }));
          syncValue();
          closeAll();
          trigger.focus({ preventScroll: true });
        });
        menu.append(choice);
      });
      syncValue();
    };

    function openMenu() {
      closeAll(wrapper);
      if (menu.parentElement !== document.body) document.body.append(menu);
      menu.hidden = false;
      const rect = trigger.getBoundingClientRect();
      const maxHeight = Math.min(330, Math.max(150, window.innerHeight * .42));
      menu.style.maxHeight = `${maxHeight}px`;
      const actualHeight = Math.min(menu.scrollHeight || maxHeight, maxHeight);
      const openUp = window.innerHeight - rect.bottom < actualHeight + 18 && rect.top > actualHeight + 18;
      const left = Math.max(4, Math.min(rect.left, window.innerWidth - rect.width - 4));
      menu.style.top = `${Math.max(4, openUp ? rect.top - actualHeight - 8 : rect.bottom + 8)}px`;
      menu.style.left = `${left}px`;
      menu.style.width = `${Math.min(rect.width, window.innerWidth - 8)}px`;
      wrapper.classList.toggle('opens-up', openUp);
      wrapper.classList.add('is-open');
      trigger.setAttribute('aria-expanded', 'true');
    }
    function toggleMenu() {
      syncValue();
      if (wrapper.classList.contains('is-open')) closeAll();
      else openMenu();
    }

    trigger.addEventListener('click', toggleMenu);
    trigger.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (!wrapper.classList.contains('is-open')) openMenu();
        focusOption(menu, event.key === 'ArrowUp' ? menu.children.length - 1 : 0);
      } else if (event.key === 'Escape') {
        closeAll();
      }
    });
    menu.addEventListener('keydown', event => {
      const options = $$('[role="option"]:not(:disabled)', menu);
      const current = options.indexOf(document.activeElement);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        focusOption(menu, current + (event.key === 'ArrowDown' ? 1 : -1));
      } else if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        focusOption(menu, event.key === 'Home' ? 0 : options.length - 1);
      } else if (event.key === 'Escape') {
        event.preventDefault(); closeAll(); trigger.focus({ preventScroll: true });
      } else if (event.key === 'Tab') closeAll();
    });

    select.classList.add('egybook-native-select-source');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');
    if (containingLabel) {
      // Keep the branded button inside the visual field label, but move the
      // hidden form control outside it so tapping label text cannot open the
      // browser's native select popup.
      select.remove();
      containingLabel.insertAdjacentElement('afterend', select);
      containingLabel.append(wrapper);
    } else {
      select.insertAdjacentElement('afterend', wrapper);
    }
    wrapper.append(trigger, menu);
    wrappers.add(wrapper);
    rebuildOptions();
    select.addEventListener('change', syncValue);
    select.addEventListener('reset', syncValue);
    const optionObserver = new MutationObserver(rebuildOptions);
    optionObserver.observe(select, { childList: true, subtree: true, attributes: true, characterData: true });
    select.__egybookCustomSelectCleanup = () => { optionObserver.disconnect(); wrappers.delete(wrapper); };
  }

  function scan(root = document) {
    if (root instanceof HTMLSelectElement) { enhance(root); return; }
    if (!root?.querySelector || !root.querySelector('select')) return;
    $$('select', root).forEach(enhance);
  }

  document.addEventListener('click', event => {
    if (!event.target.closest('.egybook-custom-select, .egybook-custom-select-menu')) closeAll();
  }, true);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeAll();
  }, true);
  document.addEventListener('scroll', event => { if (event.target instanceof Element && event.target.closest('.egybook-custom-select-menu')) return; closeAll(); }, true);
  window.addEventListener('resize', () => closeAll(), { passive: true });
  document.addEventListener('reset', event => {
    setTimeout(() => { scan(event.target); syncAll(); }, 0);
  }, true);

  const observer = new MutationObserver(records => {
    records.forEach(record => {
      if (record.target instanceof HTMLSelectElement) enhance(record.target);
      record.addedNodes.forEach(node => {
        if (node.nodeType === Node.ELEMENT_NODE) scan(node);
      });
    });
  });

  function init() {
    scan(document);
    if (document.documentElement) observer.observe(document.documentElement, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();

  function syncAll() {
    wrappers.forEach(wrapper => {
      if (!wrapper.isConnected) { wrappers.delete(wrapper); return; }
      const select = wrapper.__egybookSelect;
      const trigger = $('.egybook-custom-select-trigger', wrapper);
      const label = $('.egybook-custom-select-value', wrapper);
      const menu = wrapper.__egybookMenu;
      if (!select || !trigger || !label) return;
      const option = select.options[select.selectedIndex];
      label.textContent = option?.textContent?.trim() || 'اختر';
      trigger.disabled = select.matches(':disabled');
      if (menu) menu.querySelectorAll('[role="option"]').forEach(button => {
        const selected = button.dataset.value === select.value;
        button.classList.toggle('is-selected', selected);
        button.setAttribute('aria-selected', String(selected));
      });
    });
  }
  window.EgyBookCustomSelects = { enhance: scan, closeAll, syncAll };
})();
