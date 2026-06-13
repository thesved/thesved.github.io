/*
 * ViktorDatepreview (v0.1) — live "ghost" preview of a resolving :date: while you type.
 *
 * As you type an OPEN colon template (`:next fri…` with no closing `:` yet) inside a block, a small
 * frosted pill shows the resolved date BEFORE you commit — removing the "type-and-hope" + the silent-
 * wrong-date risk. Advisory only: it NEVER mutates block text (commit still happens on the closing `:`
 * via template-roam's resolveTemplate).
 *
 * Design (board+think synthesis, planning/05):
 *  - Bubble lives on document.body (NOT the block subtree) -> immune to Roam's React remounts.
 *  - Positioned from the live active <textarea> rect each rAF; hidden when activeElement isn't a block.
 *  - Honest-failure: no parse -> no bubble (doubles as the no-wrong-date cue).
 *  - Format MATCHES what the user will SEE post-commit: dateformatter's format when that feature is on
 *    (it reformats the committed [[Month Dth, YYYY]] page-ref on display), else the template format.
 *  - rAF-debounced; pointer-events:none; AbortController teardown (stop() = clean inverse).
 *
 * Toggle: window.ViktorRoamOpts.livePreview !== false (default ON). Needs window.ViktorDateLib loaded.
 */
if (window.ViktorDatepreview && typeof window.ViktorDatepreview.stop === 'function') window.ViktorDatepreview.stop();
window.ViktorDatepreview = (function () {
	'use strict';
	var bubble = null, raf = 0, started = false, ac = null, libCache = null, libKey = '';
	// an OPEN colon template at the caret: a ":" after start/space/bracket, then non-space/non-colon content.
	// Requiring the colon NOT to follow a word char kills prose false-positives ("Note: today").
	var OPEN_RE = /(?:^|[\s([{>])\:([^\s:`\n][^:`\n]{0,48})$/;

	function opts() { return window.ViktorRoamOpts || {}; }
	function enabled() { return opts().livePreview !== false; }

	// reuse the same opts as the commit path so the preview equals what will be inserted; recreate on change
	function lib() {
		var o = opts(), key;
		try { key = JSON.stringify({ w: o.weekStart, nf: o.nativeDateFallback, nd: o.nameDays, nm: o.nameMonths, a: o.dateAliases }); } catch (e) { key = ''; }
		if (!libCache || key !== libKey) { try { libCache = window.ViktorDateLib.create(o); libKey = key; } catch (e) { libCache = null; } }
		return libCache;
	}
	// preview format = dateformatter's display format when that feature is active, else the template format
	function fmt() {
		var df = window.ViktorDateformatter;
		if (df && df.dateformat && (typeof df.isStarted !== 'function' || df.isStarted())) return df.dateformat;
		return '[[Month Dth, YYYY]]';
	}

	function ensureBubble() {
		if (bubble) return bubble;
		bubble = document.createElement('div');
		bubble.className = 'vt-datepreview';
		bubble.style.cssText = 'position:fixed;z-index:2147483600;pointer-events:none;display:none;opacity:0;'
			+ 'font:12px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;'
			+ 'padding:3px 9px;border-radius:9px;color:#fff;max-width:60vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'
			+ 'background:rgba(28,30,36,.86);-webkit-backdrop-filter:blur(10px) saturate(1.4);backdrop-filter:blur(10px) saturate(1.4);'
			+ 'box-shadow:0 4px 18px rgba(0,0,0,.30),inset 0 0 0 .5px rgba(255,255,255,.12);'
			+ 'transition:opacity .12s ease;';
		document.body.appendChild(bubble);
		return bubble;
	}
	function hide() { if (bubble) { bubble.style.opacity = '0'; bubble.style.display = 'none'; } }
	function show(text, el) {
		var b = ensureBubble();
		b.textContent = '→ ' + text;            // "→ <date>"
		b.style.display = 'block';
		var r = el.getBoundingClientRect(), bw = b.offsetWidth, bh = b.offsetHeight;
		var top = r.bottom + 4, left = r.left;
		if (top + bh > window.innerHeight - 4) top = r.top - bh - 4;        // flip above if no room below
		if (left + bw > window.innerWidth - 4) left = window.innerWidth - bw - 4;
		b.style.top = top + 'px';
		b.style.left = Math.max(4, left) + 'px';
		b.style.opacity = '1';
	}

	function activeTextarea() {
		var el = document.activeElement;
		return (el && el.nodeName === 'TEXTAREA' && /^block-input-/.test(el.id || '')) ? el : null;
	}

	function update() {
		raf = 0;
		if (!enabled()) return hide();
		var el = activeTextarea(); if (!el) return hide();
		var before = el.value.substring(0, el.selectionEnd);
		var m = OPEN_RE.exec(before); if (!m) return hide();
		var partial = m[1]; if (!partial || !partial.trim()) return hide();
		var L = lib(); if (!L) return hide();
		var d; try { d = L.parse(partial); } catch (e) { d = false; }
		if (!d || isNaN(d.valueOf && d.valueOf())) return hide();
		var out; try { out = L.dateFormat(d, fmt()); } catch (e) { out = ''; }
		out = ('' + out).replace(/^\[\[|\]\]$/g, '');   // strip page-ref brackets (Roam renders them away)
		if (!out) return hide();
		show(out, el);
	}
	function schedule() { if (!raf) raf = requestAnimationFrame(update); }
	function onScrollResize() { if (bubble && bubble.style.display !== 'none') schedule(); }

	function start() {
		if (started) return window.ViktorDatepreview;
		started = true; ac = new AbortController(); var sig = { signal: ac.signal };
		document.addEventListener('input', schedule, sig);
		document.addEventListener('keyup', schedule, sig);
		document.addEventListener('click', schedule, sig);
		document.addEventListener('selectionchange', schedule, sig);
		document.addEventListener('blur', hide, { capture: true, signal: ac.signal });
		window.addEventListener('scroll', onScrollResize, { capture: true, passive: true, signal: ac.signal });
		window.addEventListener('resize', onScrollResize, sig);
		return window.ViktorDatepreview;
	}
	function stop() {
		started = false;
		if (ac) { ac.abort(); ac = null; }
		if (raf) { cancelAnimationFrame(raf); raf = 0; }
		if (bubble) { bubble.remove(); bubble = null; }
		libCache = null; libKey = '';
	}
	function isStarted() { return started; }

	start();
	return { start: start, stop: stop, isStarted: isStarted, update: update, _OPEN_RE: OPEN_RE, _fmt: fmt };
})();
