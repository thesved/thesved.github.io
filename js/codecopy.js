/*
 * Viktor's Roam plugin: Code-block COPY button (delightful, Apple-grade)
 * version: 0.1  (2026-06-15)
 * author: @ViktorTabori
 *
 * WHAT: adds a hover-revealed "Copy" button to the top-right of every Roam ```code``` block
 * (.rm-code-block). Click → copies the EXACT multi-line source to the clipboard and flips to a
 * brief "Copied ✓". Hover-only on desktop (fades in on block hover / keyboard focus); ALWAYS
 * visible on touch (no hover there). Roam's own language picker lives at the BOTTOM-right of the
 * block, so the top-right corner is free — no collision.
 *
 * WHY a module (not pure CSS): Roam renders NO native copy button on .rm-code-block (live-verified
 * 2026-06-15 — the only button there is the bp3 language picker). So we add + wire it ourselves.
 *
 * GETTING THE TEXT — robustly (the whole point):
 *   PRIMARY: roamAlphaAPI. The block uid lives on the ancestor .roam-block-container as
 *     data-block-uid (live-verified). pull [:block/string] by uid → strip the ```lang fences.
 *     This returns ALL lines, always, regardless of scroll.
 *   WHY NOT the DOM: code editors are CodeMirror 6, which VIRTUALIZES — a 200-line block renders
 *     only ~60 .cm-line nodes (live-verified), so DOM scraping silently truncates long code. AND
 *     .cm-content.textContent concatenates lines with NO newline (live-verified) — it'd mangle even
 *     short blocks. The DOM path is therefore a LAST-RESORT fallback only (block not yet flushed to
 *     datascript), and it joins .cm-line nodes with "\n" (never uses .cm-content.textContent).
 *
 * CLIPBOARD: navigator.clipboard.writeText, called SYNCHRONOUSLY inside the click handler (Safari/
 * iOS require the write to ride the user gesture). Falls back to a hidden-textarea execCommand('copy')
 * when clipboard is unavailable (non-secure context / permission denied).
 *
 * ARCHITECTURE (matches relativelinks/scrolldamper conventions): IIFE → window.ViktorCodecopy with
 * .start()/.stop(); ONE delegated click + ONE delegated mousedown listener (NOT per-button), ONE
 * MutationObserver, ONE injected <style>. .stop() fully tears all of that down + removes the buttons.
 *
 * Loader: register `codecopy` in window.alphaChannel (block akZqEZMOC) → global ViktorCodecopy.
 */
if (window.ViktorCodecopy && window.ViktorCodecopy.stop) window.ViktorCodecopy.stop();
window.ViktorCodecopy = (function () {
	var BTN_CLASS = 'vcc-copy';
	var STYLE_ID = 'vcc-style';
	var DONE_FLAG = 'vccReady';        // dataset flag on a .rm-code-block we've already buttoned
	var RESET_MS = 1400;               // how long the "Copied ✓" state shows
	var observer = null;
	var started = false;

	// 15px line icons (currentColor). Defined HERE (top of the IIFE) so they're assigned BEFORE the
	// initial start()→decorate() sweep — `var` declarations hoist but their VALUES don't, so SVGs
	// declared below start() would be `undefined` when the first button is built.
	var COPY_SVG =
		'<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" ' +
		'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
		'<rect x="9" y="9" width="11" height="11" rx="2"/>' +
		'<path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
	var CHECK_SVG =
		'<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" ' +
		'stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">' +
		'<path d="M20 6 9 17l-5-5"/></svg>';

	start();

	return {
		start: start,
		stop: stop,
		isStarted: function () { return started; },
		getObserver: function () { return observer; },
		// exposed for tests / power use:
		getCode: getCode
	};

	// ---------------------------------------------------------------- lifecycle
	function start() {
		if (started) return false;
		started = true;

		addStyle();

		// initial sweep over anything already on the page
		decorateAll(document);

		// one delegated mousedown (capture): keep the click from focusing CM6 / popping the iOS keyboard
		document.addEventListener('mousedown', onMouseDown, true);
		// one delegated click (capture): the actual copy
		document.addEventListener('click', onClick, true);

		// one observer: button any code block that appears later (scroll-in, nav, new block)
		observer = new MutationObserver(function (list) {
			for (var i = 0; i < list.length; i++) {
				var added = list[i].addedNodes;
				for (var j = 0; j < added.length; j++) decorateAll(added[j]);
			}
		});
		observer.observe(document.body, { childList: true, subtree: true });

		console.log('codecopy: code-block copy buttons ON');
		return true;
	}

	function stop() {
		if (!started) return false;
		started = false;

		if (observer) { observer.disconnect(); observer = null; }
		document.removeEventListener('mousedown', onMouseDown, true);
		document.removeEventListener('click', onClick, true);

		// remove every button we added + clear the per-block flag
		var btns = document.querySelectorAll('.' + BTN_CLASS);
		for (var i = 0; i < btns.length; i++) btns[i].remove();
		var blocks = document.querySelectorAll('.rm-code-block[data-vcc-ready]'); // DONE_FLAG 'vccReady' ⇄ data-vcc-ready
		for (var k = 0; k < blocks.length; k++) delete blocks[k].dataset[DONE_FLAG];

		var st = document.getElementById(STYLE_ID);
		if (st) st.remove();

		console.log('codecopy: code-block copy buttons OFF');
		return true;
	}

	// ------------------------------------------------------------- decoration
	function decorateAll(root) {
		if (!root || !root.querySelectorAll) return;
		// the node itself may BE a code block (added directly)
		if (root.classList && root.classList.contains('rm-code-block')) decorate(root);
		var list = root.querySelectorAll('.rm-code-block');
		for (var i = 0; i < list.length; i++) decorate(list[i]);
	}

	function decorate(cb) {
		if (!cb || cb.dataset[DONE_FLAG]) return;          // already done (idempotent)
		cb.dataset[DONE_FLAG] = '1';

		var btn = document.createElement('button');
		btn.type = 'button';
		btn.className = BTN_CLASS;
		btn.setAttribute('aria-label', 'Copy code');
		btn.title = 'Copy code';
		// label + check live in spans so we can crossfade them via CSS, never reflowing the button
		btn.innerHTML =
			'<span class="vcc-ico vcc-ico-copy" aria-hidden="true">' + COPY_SVG + '</span>' +
			'<span class="vcc-ico vcc-ico-done" aria-hidden="true">' + CHECK_SVG + '</span>' +
			'<span class="vcc-label">Copy</span>';

		cb.appendChild(btn);
	}

	// ------------------------------------------------------------- interaction
	function onMouseDown(e) {
		var btn = e.target.closest ? e.target.closest('.' + BTN_CLASS) : null;
		if (!btn) return;
		// don't let the press focus the CodeMirror editor (desktop) or dismiss/pop the iOS keyboard
		e.preventDefault();
	}

	function onClick(e) {
		var btn = e.target.closest ? e.target.closest('.' + BTN_CLASS) : null;
		if (!btn) return;
		e.preventDefault();
		e.stopPropagation();

		var cb = btn.closest('.rm-code-block');
		var text = getCode(cb);
		if (text == null) { flash(btn, false); return; }

		// MUST be synchronous on the gesture for Safari/iOS:
		var ok = copyToClipboard(text);
		// writeText returns a promise; reflect its real result when we can, but optimistic on sync path
		if (ok && ok.then) {
			flash(btn, true);                              // optimistic — the gesture is consumed now
			ok.catch(function () { flash(btn, false); });
		} else {
			flash(btn, ok);
		}
	}

	// brief state flip: true → "Copied ✓", false → "Failed"
	function flash(btn, success) {
		var labelEl = btn.querySelector('.vcc-label');
		if (btn._vccT) { clearTimeout(btn._vccT); }
		btn.classList.remove('vcc-done', 'vcc-fail');
		btn.classList.add(success ? 'vcc-done' : 'vcc-fail');
		if (labelEl) labelEl.textContent = success ? 'Copied' : 'Failed';
		btn._vccT = setTimeout(function () {
			btn.classList.remove('vcc-done', 'vcc-fail');
			if (labelEl) labelEl.textContent = 'Copy';
			btn._vccT = null;
		}, RESET_MS);
	}

	// ------------------------------------------------------------- get the code
	// PRIMARY: roamAlphaAPI by block uid (all lines, scroll-independent). FALLBACK: join .cm-line.
	function getCode(cb) {
		if (!cb) return null;
		var cont = cb.closest('.roam-block-container');
		var uid = cont && cont.dataset ? cont.dataset.blockUid : null;

		if (uid && window.roamAlphaAPI && window.roamAlphaAPI.data && window.roamAlphaAPI.data.pull) {
			try {
				var res = window.roamAlphaAPI.data.pull('[:block/string]', [':block/uid', uid]);
				var raw = res && res[':block/string'];
				if (typeof raw === 'string') return stripFences(raw);
			} catch (e) { /* fall through to DOM */ }
		}

		// FALLBACK (block not yet flushed to datascript): join the RENDERED lines with "\n".
		// Caveat: CM6 virtualizes, so a long off-screen block may be truncated here — that's why
		// the API path is primary. .cm-content.textContent is NEVER used (it drops newlines).
		var lines = cb.querySelectorAll('.cm-line');
		if (lines.length) {
			var out = [];
			for (var i = 0; i < lines.length; i++) {
				// CM6 renders an empty line as a lone <br>; textContent of such a line is "" → preserved
				out.push(lines[i].textContent);
			}
			return out.join('\n');
		}
		return null;
	}

	// strip the leading ```lang\n and the trailing \n``` that Roam stores around code-block source
	function stripFences(s) {
		return s
			.replace(/^\s*```[^\n]*\n?/, '')   // opening fence + optional language token + its newline
			.replace(/\n?```\s*$/, '');         // closing fence (and the newline before it)
	}

	// --------------------------------------------------------------- clipboard
	// Returns the writeText promise when available (so the caller can catch a rejection), else a
	// boolean from the execCommand fallback. Always invoked synchronously from the click handler.
	function copyToClipboard(text) {
		if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) {
			try { return navigator.clipboard.writeText(text); } catch (e) { /* fall through */ }
		}
		return legacyCopy(text);
	}

	function legacyCopy(text) {
		var ta = document.createElement('textarea');
		ta.value = text;
		// keep it off-screen but selectable; readonly avoids the iOS keyboard popping
		ta.setAttribute('readonly', '');
		ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;opacity:0;';
		document.body.appendChild(ta);
		var ok = false;
		try {
			ta.focus();
			ta.select();
			ta.setSelectionRange(0, text.length);          // iOS needs an explicit range
			ok = document.execCommand('copy');
		} catch (e) { ok = false; }
		ta.remove();
		return ok;
	}

	// ------------------------------------------------------------------ statics
	// (COPY_SVG / CHECK_SVG are defined at the TOP of the IIFE — see the hoisting note there.)
	function addStyle() {
		if (document.getElementById(STYLE_ID)) return;
		var s = document.createElement('style');
		s.id = STYLE_ID;
		s.textContent = [
			// anchor: Roam ships .rm-code-block as position:static — make it the positioning context.
			// (roamCSS.css sets overflow:hidden on it; the button is inset within bounds, so no clip.)
			'.rm-code-block{position:relative!important;}',

			// the button: top-right, inset, frosted pill. Hidden by default on desktop (hover reveals).
			'.rm-code-block>.vcc-copy{',
			'  position:absolute;top:6px;right:6px;z-index:5;',
			'  display:inline-flex;align-items:center;gap:5px;',
			'  margin:0;padding:4px 9px;',
			'  font:500 12px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;',
			'  color:var(--text-color,#e6e6e6);',
			'  background:rgba(var(--bullet-color,128,128,128),0.16);',
			'  border:1px solid rgba(255,255,255,0.10);',
			'  border-radius:7px;cursor:pointer;',
			'  -webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);',
			'  opacity:0;transform:translateY(-2px);pointer-events:none;',
			'  transition:opacity .15s ease,transform .15s ease,background .15s ease,color .15s ease;',
			'  -webkit-user-select:none;user-select:none;',
			'}',
			// reveal on block hover / keyboard focus within the block / focus of the button itself
			'.rm-code-block:hover>.vcc-copy,',
			'.rm-code-block:focus-within>.vcc-copy,',
			'.rm-code-block>.vcc-copy:focus-visible{opacity:1;transform:none;pointer-events:auto;}',
			'.rm-code-block>.vcc-copy:hover{background:rgba(var(--bullet-color,128,128,128),0.30);}',
			'.rm-code-block>.vcc-copy:active{transform:scale(0.96);}',
			'.rm-code-block>.vcc-copy:focus-visible{outline:2px solid rgba(var(--bullet-color,128,128,128),0.9);outline-offset:1px;}',

			// crossfade copy-icon ↔ check-icon, stacked so the button never reflows
			'.rm-code-block>.vcc-copy .vcc-ico{display:inline-flex;width:15px;height:15px;}',
			'.rm-code-block>.vcc-copy .vcc-ico-done{display:none;}',
			'.rm-code-block>.vcc-copy.vcc-done .vcc-ico-copy{display:none;}',
			'.rm-code-block>.vcc-copy.vcc-done .vcc-ico-done{display:inline-flex;}',
			// success / failure tints
			'.rm-code-block>.vcc-copy.vcc-done{color:#3fb950;background:rgba(63,185,80,0.16);border-color:rgba(63,185,80,0.4);}',
			'.rm-code-block>.vcc-copy.vcc-fail{color:#f85149;background:rgba(248,81,73,0.16);border-color:rgba(248,81,73,0.4);}',

			// TOUCH: no hover → always visible (slightly dimmed so it doesn't shout over the code).
			// hover-capable pointers keep the reveal behaviour above.
			'@media (hover:none),(pointer:coarse){',
			'  .rm-code-block>.vcc-copy{opacity:0.6;transform:none;pointer-events:auto;}',
			'  .rm-code-block>.vcc-copy:active{opacity:1;}',
			'}',

			// reduced-motion: no slide/scale
			'@media (prefers-reduced-motion:reduce){',
			'  .rm-code-block>.vcc-copy{transition:opacity .12s linear;transform:none!important;}',
			'}',
		].join('\n');
		document.head.appendChild(s);
	}
})();
