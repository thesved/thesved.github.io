/*
 * ViktorDatepreview (v0.2) — live "ghost" preview of a resolving :date: while you type.
 *
 * As you type an OPEN colon template (`:next fri…` with no closing `:` yet) inside a block, a small
 * frosted pill shows the resolved date BEFORE you commit. Click it to insert the date immediately.
 *
 * Design (board+think synthesis, planning/05) + fixes:
 *  - Bubble lives on document.body (NOT the block subtree) -> immune to Roam's React remounts.
 *  - WHOLE-SEGMENT, caret-independent: resolves the entire open `:segment` (opener ":" .. next ":" or
 *    end-of-line), not the text up to the caret — so `:3|rd thu next month` == `:3rd thu next month|`.
 *    This is exactly what the commit path (resolveTemplate) will see.
 *  - CHAINING: the segment is split on ";" and folded left-to-right (`:fullmoon; +1 month`), each part
 *    resolved relative to the previous result — same as parseFormatDate.
 *  - HONEST preview: the preview lib forces nativeDateFallback:false, so a blind native-Date guess
 *    (e.g. V8's 2001 garbage) NEVER previews; unresolvable -> no pill (the no-wrong-date cue).
 *  - CLICK-TO-INSERT: click (or tap) the pill to close the template + commit via resolveTemplate.
 *  - Format MATCHES post-commit display: dateformatter's format when that feature is on, else the
 *    template format ([[ ]] stripped, as Roam renders it).
 *  - rAF-debounced; AbortController teardown (stop() = clean inverse).
 *
 * Toggle: window.ViktorRoamOpts.livePreview !== false (default ON). Needs window.ViktorDateLib loaded.
 */
if (window.ViktorDatepreview && typeof window.ViktorDatepreview.stop === 'function') window.ViktorDatepreview.stop();
window.ViktorDatepreview = (function () {
	'use strict';
	var bubble = null, raf = 0, started = false, ac = null, libCache = null, libKey = '';
	var curEl = null, curEnd = null;   // the textarea + insert index (end of the open segment) currently previewed
	// a template-opener ":" = a colon after start/space/bracket, followed by non-space content.
	// Requiring NOT-after-a-word-char kills prose false-positives ("Note: today").
	var OPENER_RE = /(?:^|[\s([{>])\:(?=[^\s:`\n])/g;

	function opts() { return window.ViktorRoamOpts || {}; }
	function enabled() { return opts().livePreview !== false; }

	// preview lib mirrors commit opts BUT forces honest-failure so a blind native guess never previews
	function lib() {
		var o = opts(), key;
		try { key = JSON.stringify({ w: o.weekStart, nd: o.nameDays, nm: o.nameMonths, a: o.dateAliases }); } catch (e) { key = ''; }
		if (!libCache || key !== libKey) {
			try { libCache = window.ViktorDateLib.create(Object.assign({}, o, { nativeDateFallback: false })); libKey = key; }
			catch (e) { libCache = null; }
		}
		return libCache;
	}
	function fmt() {
		var df = window.ViktorDateformatter;
		if (df && df.dateformat && (typeof df.isStarted !== 'function' || df.isStarted())) return df.dateformat;
		return '[[Month Dth, YYYY]]';
	}

	function activeTextarea() {
		var el = document.activeElement;
		return (el && el.nodeName === 'TEXTAREA' && /^block-input-/.test(el.id || '')) ? el : null;
	}
	// the OPEN colon-template segment the caret is inside -> {partial, end} (end = insert index for ":"),
	// or null. Caret-INDEPENDENT within the segment. A closing ":" on the line => not open => null.
	function openSegment(val, caret) {
		var le = val.indexOf('\n', caret); if (le === -1) le = val.length;       // end of current line
		var head = val.slice(0, caret);
		OPENER_RE.lastIndex = 0;
		var open = -1, mm;
		while ((mm = OPENER_RE.exec(head)) !== null) open = mm.index + mm[0].length - 1; // index of last opener ":" <= caret
		if (open === -1) return null;
		var rest = val.slice(open + 1, le);
		if (rest.indexOf(':') !== -1) return null;        // closing ":" present -> resolveTemplate commits it
		var seg = rest.replace(/\s+$/, '');
		if (!seg.trim() || seg.length > 80) return null;
		return { partial: seg, end: open + 1 + seg.length };
	}
	// fold the segment over ";" exactly like parseFormatDate's chaining
	function resolveChain(L, partial) {
		var parts = partial.split(';'), got = false;
		var d = parts.reduce(function (ref, s) {
			var r; try { r = L.parse(s, ref); } catch (e) { r = false; }
			if (r) got = true;
			return r || ref;
		}, undefined);
		return got && d && !isNaN(d.valueOf()) ? d : null;
	}

	function ensureBubble() {
		if (bubble) return bubble;
		bubble = document.createElement('div');
		bubble.className = 'vt-datepreview';
		bubble.title = 'Click to insert';
		bubble.style.cssText = 'position:fixed;z-index:2147483600;pointer-events:auto;cursor:pointer;display:none;opacity:0;'
			+ 'font:12px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;'
			+ 'padding:3px 9px;border-radius:9px;color:#fff;max-width:60vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'
			+ 'background:rgba(28,30,36,.86);-webkit-backdrop-filter:blur(10px) saturate(1.4);backdrop-filter:blur(10px) saturate(1.4);'
			+ 'box-shadow:0 4px 18px rgba(0,0,0,.30),inset 0 0 0 .5px rgba(255,255,255,.12);'
			+ 'transition:opacity .12s ease;user-select:none;-webkit-user-select:none;';
		// keep the textarea focused on press (so commit() can fire input on it), then commit on click/tap
		var keepFocus = function (e) { e.preventDefault(); };
		bubble.addEventListener('mousedown', keepFocus);
		bubble.addEventListener('touchstart', keepFocus, { passive: false });
		bubble.addEventListener('click', commit);
		document.body.appendChild(bubble);
		return bubble;
	}
	function hide() { curEl = null; curEnd = null; if (bubble) { bubble.style.opacity = '0'; bubble.style.display = 'none'; } }
	function show(text, el, end) {
		var b = ensureBubble();
		b.textContent = '→ ' + text;
		b.style.display = 'block';
		curEl = el; curEnd = end;
		var r = el.getBoundingClientRect(), bw = b.offsetWidth, bh = b.offsetHeight;
		var top = r.bottom + 4, left = r.left;
		if (top + bh > window.innerHeight - 4) top = r.top - bh - 4;        // flip above if no room below
		if (left + bw > window.innerWidth - 4) left = window.innerWidth - bw - 4;
		b.style.top = top + 'px';
		b.style.left = Math.max(4, left) + 'px';
		b.style.opacity = '1';
	}

	// close the open template + let resolveTemplate commit it, exactly as if the user typed the ":"
	function commit(e) {
		if (e) { e.preventDefault(); e.stopPropagation(); }
		var el = curEl, end = curEnd;
		if (!el || end == null) return;
		var v = el.value, nv = v.slice(0, end) + ':' + v.slice(end);
		var set = (window.ViktorInputLib && window.ViktorInputLib.nativeSetter)
			|| Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
		el.focus();
		set.call(el, nv);
		el.selectionStart = el.selectionEnd = end + 1;
		el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, data: ':', inputType: 'insertText' }));
		hide();
	}

	function update() {
		raf = 0;
		if (!enabled()) return hide();
		var el = activeTextarea(); if (!el) return hide();
		var seg = openSegment(el.value, el.selectionEnd); if (!seg) return hide();
		var L = lib(); if (!L) return hide();
		var d = resolveChain(L, seg.partial); if (!d) return hide();
		var out; try { out = L.dateFormat(d, fmt()); } catch (e) { out = ''; }
		out = ('' + out).replace(/^\[\[|\]\]$/g, '');     // strip page-ref brackets (Roam renders them away)
		if (!out) return hide();
		show(out, el, seg.end);
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
		libCache = null; libKey = ''; curEl = null; curEnd = null;
	}
	function isStarted() { return started; }

	start();
	return { start: start, stop: stop, isStarted: isStarted, update: update, commit: commit, _openSegment: openSegment };
})();
