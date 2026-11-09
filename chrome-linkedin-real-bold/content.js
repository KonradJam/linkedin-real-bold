(() => {
  'use strict';

  // LinkedIn Real Bold v0.3 — no network requests or clipboard permissions.
  // A top-layer popover is important: LinkedIn's composer can be a modal dialog,
  // whose backdrop would otherwise cover a toolbar appended to <html>/<body>.
  const LOADED = '__linkedinRealBoldV03__';
  if (window[LOADED]) return;
  window[LOADED] = true;

  const host = document.createElement('div');
  host.id = 'linkedin-real-bold-v03';
  host.setAttribute('popover', 'manual');
  host.style.cssText = [
    'position:fixed', 'inset:auto', 'left:0', 'top:0',
    'margin:0', 'padding:0', 'border:0',
    'width:max-content', 'height:auto', 'max-width:none',
    'background:transparent', 'overflow:visible',
    'z-index:2147483647', 'box-shadow:none'
  ].join(';');

  const shadow = host.attachShadow({ mode: 'open' });
  const styles = document.createElement('style');
  styles.textContent = `
    :host { color-scheme:light; }
    *, *::before, *::after { box-sizing:border-box; }
    .tools { display:flex; gap:4px; padding:4px; border-radius:10px;
      background:#202124; box-shadow:0 6px 22px rgb(0 0 0 / 30%);
      border:1px solid rgb(255 255 255 / 15%); }
    button { appearance:none; display:grid; place-items:center; cursor:pointer;
      border:0; border-radius:6px; width:36px; height:34px;
      font:800 20px/1 Arial,sans-serif; color:#fff; background:transparent; }
    button:hover, button[aria-pressed="true"] { background:#0a66c2; }
    button:focus-visible { outline:2px solid #a5d2ff; outline-offset:2px; }
    .message { display:none; padding:8px 10px; font:12px/1.35 Arial,sans-serif;
      background:#202124; border-radius:8px; color:white; max-width:250px; }
    .message:not(:empty) { display:block; }
  `;
  const tools = document.createElement('div');
  tools.className = 'tools';
  tools.setAttribute('role', 'toolbar');
  tools.setAttribute('aria-label', 'LinkedIn text formatting');
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'B';
  button.title = 'Toggle bold for selected text';
  button.setAttribute('aria-label', 'Toggle bold for selected text');
  button.setAttribute('aria-pressed', 'false');
  tools.append(button);
  const message = document.createElement('div');
  message.className = 'message';
  message.setAttribute('role', 'status');
  shadow.append(styles, tools, message);

  const hasPopover = typeof host.showPopover === 'function';
  if (!hasPopover) host.hidden = true;
  let state = null;
  let frame = 0;
  let pressing = false;
  let messageTimer;

  function editorFromNode(node) {
    let element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    if (!element || host.contains(element)) return null;
    while (element && element !== document.documentElement) {
      if (element.hasAttribute('contenteditable')) {
        const value = (element.getAttribute('contenteditable') || '').toLowerCase();
        if (value === 'false' || value === 'plaintext-only') return null;
        if (value === '' || value === 'true') return element;
      }
      element = element.parentElement;
    }
    return null;
  }

  function getSelectionState() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount ||
        !selection.toString().trim()) return null;

    const editor = editorFromNode(selection.anchorNode);
    if (!editor || editor !== editorFromNode(selection.focusNode) || !editor.isConnected) {
      return null;
    }
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) {
      return null;
    }
    const rectangles = Array.from(range.getClientRects())
      .filter(rect => rect.width > 1 && rect.height > 1 && rect.bottom > 0 &&
                      rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth);
    if (!rectangles.length) return null;

    // Match LinkedIn's post editor, including alternate markup/versions.
    // Any editable field is a fallback so an updated LinkedIn DOM still works.
    const modal = editor.closest('dialog[open], [role="dialog"], [aria-modal="true"], .artdeco-modal');
    return { editor, range: range.cloneRange(), rect: rectangles[0], modal };
  }

  function close() {
    if (hasPopover && host.matches(':popover-open')) {
      host.hidePopover();
    } else if (!hasPopover) {
      host.hidden = true;
    }
    state = null;
    message.textContent = '';
  }

  function mountFor(state) {
    // A native <dialog> lives in the browser's 'top layer'; toolbar must be
    // inside the dialog to stay interactive instead of behind its backdrop.
    const parent = state.modal || document.body || document.documentElement;
    if (host.parentElement !== parent) {
      if (hasPopover && host.matches(':popover-open')) host.hidePopover();
      parent.append(host);
    }
  }

  function show() {
    if (hasPopover) {
      if (!host.matches(':popover-open')) host.showPopover();
    } else {
      host.hidden = false;
    }
  }

  function position(state) {
    // Popovers are promoted to the browser's top layer. Position fixed uses
    // viewport coordinates, even when a dialog has its own stacking context.
    const rect = state.rect;
    const width = host.getBoundingClientRect().width || 46;
    const height = host.getBoundingClientRect().height || 44;
    const bounds = state.modal?.getBoundingClientRect();
    const minX = Math.max(8, bounds ? bounds.left + 8 : 8);
    const maxX = Math.min(innerWidth - width - 8,
                         bounds ? bounds.right - width - 8 : innerWidth - width - 8);
    const left = Math.max(minX, Math.min(maxX, rect.left + rect.width / 2 - width / 2));
    const minY = Math.max(8, bounds ? bounds.top + 8 : 8);
    const maxY = Math.min(innerHeight - height - 8,
                         bounds ? bounds.bottom - height - 8 : innerHeight - height - 8);
    const above = rect.top - height - 10;
    const desired = above >= minY ? above : rect.bottom + 10;
    const top = Math.max(minY, Math.min(maxY, desired));
    host.style.left = `${Math.round(left)}px`;
    host.style.top = `${Math.round(top)}px`;
  }

  function refresh() {
    frame = 0;
    if (pressing) return;
    const next = getSelectionState();
    if (!next) {
      close();
      return;
    }
    state = next;
    message.textContent = '';
    tools.style.display = 'flex';
    try {
      mountFor(next);
      show();
      position(next);
      button.setAttribute('aria-pressed', String(document.queryCommandState('bold')));
    } catch (error) {
      console.warn('[LinkedIn Real Bold] Could not show the button:', error);
      close();
    }
  }

  function scheduleRefresh() {
    if (pressing || frame) return;
    frame = requestAnimationFrame(refresh);
  }

  // The toolbar should not steal focus or trigger LinkedIn's outside-click
  // dismissal. It is mounted *inside* the active composer dialog when present.
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
    button.addEventListener(type, event => {
      event.stopPropagation();
      if (type === 'pointerdown' || type === 'mousedown') {
        pressing = true;
        event.preventDefault();
      }
    });
  }

  button.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    const saved = state;
    pressing = true;
    if (!saved || !saved.editor.isConnected) {
      close();
      pressing = false;
      return;
    }
    try {
      saved.editor.focus({ preventScroll:true });
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(saved.range);
      // execCommand is deprecated but still supports native undo in Chromium.
      // Crucially it does not substitute Unicode characters for Polish letters.
      if (!document.execCommand('bold', false, null)) {
        throw new Error('The editor rejected the formatting command');
      }
      close();
    } catch (error) {
      console.warn('[LinkedIn Real Bold]', error);
      tools.style.display = 'none';
      message.textContent = 'LinkedIn could not apply bold. Try again.';
      clearTimeout(messageTimer);
      messageTimer = setTimeout(close, 2300);
    } finally {
      pressing = false;
    }
  });

  document.addEventListener('selectionchange', scheduleRefresh);
  document.addEventListener('pointerup', scheduleRefresh, true);
  document.addEventListener('keyup', scheduleRefresh, true);
  document.addEventListener('focusin', scheduleRefresh, true);
  document.addEventListener('scroll', scheduleRefresh, true);
  window.addEventListener('resize', scheduleRefresh);
})();
