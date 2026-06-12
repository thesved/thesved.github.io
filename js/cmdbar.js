/*
 * Viktor's Roam Mobile Command Bar — THE mobile toolbar (replaces Roam's native gray bar).
 * version: 0.3  (2026-06-12)
 * author: @ViktorTabori
 *
 * v0.2 = first-principles rewrite after live root-causing (see docs/cmdbar-v2-design.md):
 *   1. DEAD BUTTONS root cause: real taps bubbled to Roam's document-level press handlers which
 *      CLEAR multiselect / unfocus the editor before our click handler ran. Fix: a window-capture
 *      EVENT SHIELD around our chrome + we act on our own pointer gestures + `dont-unfocus-block`
 *      class (Roam's official "don't unfocus" passport, found in their source).
 *   2. GRAY BAR GAP root cause: Roam's live CSS has `bottom:46px` on #rm-mobile-bar and their
 *      visualViewport transform adds the keyboard on top → permanent ~46px gap. We HIDE their bar
 *      (display:none keeps its buttons clickable for proxying) and pin our own flush via
 *      visualViewport (overlap = innerHeight − vv.height − vv.offsetTop; ≤30px ⇒ closed, which
 *      also absorbs the iOS 26 residue bug).
 *   3. KNOB DRAG dead on device (suspected): Roam's global hotkey engine reads e.keyCode; the
 *      KeyboardEvent CONSTRUCTOR dict may drop keyCode on some WebKit builds → harden every
 *      synthetic key with Object.defineProperty(keyCode/which).
 *   4. `/`, `[[`, `((` are NOT key dispatches in Roam (direct React value splices) → PROXY-CLICK
 *      Roam's hidden native buttons; synthetic-key or insertText fallbacks where possible.
 *   5. Native-bar CONTRACT CHECK: we verify Roam's footer + every proxied button on start and on
 *      entering EDITING; drift ⇒ auto-fallback + console.warn + HUD badge (+ _state().contract).
 *
 * ONE bar, three forms (board-reviewed: Opus/Gemini/Codex 2026-06-12):
 *   IDLE      — FAB (or, toggled open, slim [undo][redo?]──[×] bar).
 *   EDITING   — block textarea focused:  [Select] │ [⇤][⇥][↑][↓][↶][↷*] │ [[[ ] [/]
 *               (no dismiss button — the OS accessory ✓ already does that; ↷ appears only when
 *               redo is available; todo/media/(( cut — they live behind / and [[).
 *   SELECTING — ≥1 block selected (keyboard down by nature): [+↑][+↓] │ [⇤][⇥][↑][↓][↶] │ [⌫] ─ [Done]
 *               + ONE live knob at the selection's focus edge (anchor gets a cosmetic tick),
 *               count chip rides the knob, extends auto-repeat on hold, knob drag = closed-loop
 *               elementFromPoint → one Shift+Arrow per crossed block, edge auto-scroll.
 *   Shared middle [⇤][⇥][↑][↓][↶] never moves between forms (shared-element morph; buttons are
 *   built ONCE and toggled via CSS — nothing is ever rebuilt under a finger).
 *
 * Engine: synthetic keydowns (keyCode-hardened) on window for Roam's global hotkey engine
 * (Escape enter/clear select, Shift+Arrow extend, Tab indent, Meta+Shift+Arrow move, Backspace
 * delete, Meta+Z undo) + proxy-clicks into the hidden native bar for editing ops. Single source
 * of truth = roamAlphaAPI.ui.multiselect.getSelected() + document.activeElement (closed loop:
 * re-read after every emit; never blind-fire).
 *
 * Debug: localStorage.VBS_debug='1' → on-screen HUD + ViktorCmdbar._log(). Desktop testing:
 * localStorage.VBS_force='1'. Kill: ViktorCmdbar.stop(). Loader: `cmdbar` in alphaChannel.
 *
 * v0.3 (2026-06-12, evening — six-agent evidence pass on the iPhone videos):
 *   - ROAM SELECTION MEMORY (root of "gapped selection / can't reach last child"): Roam keeps the
 *     previous selection after Esc-clear and UNIONS it into the next Esc-promote or even a single
 *     Shift+Arrow (reproduced with TRUSTED input — Roam-native bug). Mitigations: promote verifies
 *     the result is exactly [the focused block]; merged sets are healed by shrink-walking (extends
 *     toward the anchor converge — proven) + refocus-retry; extends and knob drags gap-check after
 *     the fact and rebuild a contiguous selection when an illegitimate gap appears.
 *   - KNOB DRAG remap: Roam extends stride≠1 at indent boundaries (subtree closure; ancestor-skip
 *     gaps; an UP key can grow DOWNWARD past the anchor; getSelected() order ≠ doc order). Drag now
 *     uses a COVERAGE test (block-highlight-blue), direction by selection extent (min/max DOM
 *     index), one keypress per settle (poll until set changes, ≤200ms), and an oscillation guard.
 *   - EDGE AUTO-SCROLL rebuilt to platform grammar (WebKit/Android/pragmatic-dnd constants):
 *     DIRECTIONAL ARMING (inert until ≥48px travel toward the edge + ≥120ms), zone anchored to the
 *     bar top (90px), linear depth velocity 50→550px/s, 400ms time-ramp resetting on zone exit,
 *     per-frame cap 9px. Extending under a stationary finger STAYS (universal grammar) — only
 *     engagement is gated.
 *   - Knob lag: handles update optimistically (~35ms) and the knob animates ONLY when crossing.
 *   - Extends share Select's blue (one visual family). `((` restored. #vt-handles clipped
 *     (overflow:hidden) so the 44pt knob hit-box can never make iOS pan the page.
 */
if (window.ViktorCmdbar && window.ViktorCmdbar.stop) window.ViktorCmdbar.stop();
window.ViktorCmdbar = (function () {
	var BLUE = 'rgb(47,155,249)';
	var STYLE_ID = 'vt-cmdbar-style';
	var ROOT_ID = 'vt-cmd-root';
	var KB_CURVE = 'cubic-bezier(0.17,0.59,0.4,0.77)'; // ≈ iOS keyboard
	var added = false;
	var root = null, dock = null, bar = null, fab = null, hLayer = null, knob = null, tick = null, chip = null, hud = null;
	var btns = {};                    // id -> button element
	var mo = null, healTimer = null, ac = null, rafPos = 0, rafSync = 0;
	var open = false, ctx = 'OFF', redoAvail = false;
	var kbAnimUntil = 0;              // while now()<this, dock transitions (focus/blur moments only)
	var gesture = null, drag = null;  // shield gesture state
	var prevFocusBottom = null, crossT = null; // knob crossing detector
	var lastEdge = 'bottom';          // which end of the selection the user is working (knob side)
	var healing = false;              // re-entrancy guard for gap healing
	var contract = { ok: true, missing: [] };
	var logRing = [];
	var lastSelN = 0;

	// ---------- utils ----------
	function now() { return Date.now(); }
	function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
	function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { } }
	function isFlutter() { return typeof window.FlutterCurrentGraphChannel !== 'undefined'; }
	function isTouch() { return !!(navigator.maxTouchPoints > 0 || ('ontouchstart' in window)); }
	function enabled() { return (isTouch() && !isFlutter()) || lsGet('VBS_force') === '1'; }
	function debugOn() { return lsGet('VBS_debug') === '1'; }
	function log(m) {
		logRing.push(now() % 100000 + ' ' + m);
		if (logRing.length > 60) logRing.shift();
		if (debugOn()) { try { console.log('[cmdbar]', m); } catch (e) { } hudPaint(); }
	}
	function api() { return window.roamAlphaAPI; }
	function getSel() { try { return api().ui.multiselect.getSelected() || []; } catch (e) { return []; } }
	function selUids() { return getSel().map(function (x) { return x['block-uid']; }); }
	function isBlockTextarea(el) { return !!(el && el.tagName === 'TEXTAREA' && /^block-input-/.test(el.id || '')); }
	function uidNode(uid) {
		var el = document.querySelector('[id$="-' + uid + '"]');
		return el ? el.closest('.roam-block-container') : null;
	}
	function allBlocks() { return Array.prototype.slice.call(document.querySelectorAll('.roam-block-container')); }
	function scroller() { return document.querySelector('.rm-article-wrapper') || document.scrollingElement; }

	// ---------- synthetic key engine (keyCode-hardened) ----------
	var K = {
		esc: { key: 'Escape', code: 'Escape', kc: 27 },
		extendUp: { key: 'ArrowUp', code: 'ArrowUp', kc: 38, shiftKey: true },
		extendDown: { key: 'ArrowDown', code: 'ArrowDown', kc: 40, shiftKey: true },
		undo: { key: 'z', code: 'KeyZ', kc: 90, metaKey: true },
		redo: { key: 'z', code: 'KeyZ', kc: 90, metaKey: true, shiftKey: true },
		outdent: { key: 'Tab', code: 'Tab', kc: 9, shiftKey: true },
		indent: { key: 'Tab', code: 'Tab', kc: 9 },
		moveUp: { key: 'ArrowUp', code: 'ArrowUp', kc: 38, metaKey: true, shiftKey: true },
		moveDown: { key: 'ArrowDown', code: 'ArrowDown', kc: 40, metaKey: true, shiftKey: true },
		del: { key: 'Backspace', code: 'Backspace', kc: 8 }
	};
	function fire(target, spec) {
		var init = { key: spec.key, code: spec.code, bubbles: true, cancelable: true, view: window,
			shiftKey: !!spec.shiftKey, metaKey: !!spec.metaKey, altKey: !!spec.altKey, ctrlKey: !!spec.ctrlKey,
			keyCode: spec.kc, which: spec.kc };
		var ev = new KeyboardEvent('keydown', init);
		// Roam's global hotkey engine reads e.keyCode; constructor dicts may drop it → force it.
		try {
			Object.defineProperty(ev, 'keyCode', { get: function () { return spec.kc; } });
			Object.defineProperty(ev, 'which', { get: function () { return spec.kc; } });
		} catch (e) { }
		(target || window).dispatchEvent(ev);
	}

	// retry-until-selected Escape (Esc toggles; a ≤4× retry converges — proven live)
	function promoteRaw(cb) {
		var tries = 0;
		(function attempt() {
			fire(document.activeElement || window, K.esc);
			setTimeout(function () {
				if (getSel().length) { cb(true); return; }
				if (++tries < 4) attempt(); else cb(false);
			}, 150);
		})();
	}

	// ---------- selection-memory countermeasures ----------
	// Roam keeps the previous selection after Esc-clear and UNIONS it into the next promote/extend
	// (Roam-native, reproduced with trusted input). We detect and heal.
	function domIdx(uid) { var n = uidNode(uid); return n ? allBlocks().indexOf(n) : -1; }
	// DOM-order extent of the current selection + gaps not explained by subtree containment
	function selGapInfo() {
		var list = allBlocks();
		var sel = getSel();
		if (!sel.length) return null;
		var nodes = [], idxs = [], minUid = null, maxUid = null, min = 1e9, max = -1;
		sel.forEach(function (s) {
			var n = uidNode(s['block-uid']); if (!n) return;
			var i = list.indexOf(n); if (i < 0) return;
			nodes.push(n); idxs.push(i);
			if (i < min) { min = i; minUid = s['block-uid']; }
			if (i > max) { max = i; maxUid = s['block-uid']; }
		});
		if (!idxs.length) return null;
		var set = {}; idxs.forEach(function (i) { set[i] = 1; });
		var gaps = [];
		for (var i = min + 1; i < max; i++) {
			if (set[i]) continue;
			var el = list[i];
			var ok = false;
			for (var k = 0; k < nodes.length; k++) { if (el.contains(nodes[k]) || nodes[k].contains(el)) { ok = true; break; } }
			if (!ok) gaps.push(i);
		}
		return { min: min, max: max, minUid: minUid, maxUid: maxUid, gaps: gaps, win: sel[0]['window-id'] };
	}
	// shrink the selection one step at a time toward its anchor; converges to [anchor] (proven)
	function shrinkWalk(cb) {
		var steps = 0, flips = 0, dir = K.extendUp, lastLen = getSel().length;
		(function step() {
			var n = getSel().length;
			if (n <= 1 || steps > 24) { cb(); return; }
			steps++;
			fire(window, dir);
			setTimeout(function () {
				var m = getSel().length;
				if (m < lastLen) { lastLen = m; step(); return; }
				flips++;
				if (flips > 3) { cb(); return; }
				dir = (dir === K.extendUp) ? K.extendDown : K.extendUp;
				lastLen = m; step();
			}, 130);
		})();
	}
	// promote that GUARANTEES the result is exactly [intendedUid] (heals stale-memory merges)
	function ensureClean(intendedUid, win, cb, outer) {
		outer = outer || 0;
		promoteRaw(function (ok) {
			if (!ok) { cb(false); return; }
			var sel = getSel();
			if (!intendedUid || (sel.length === 1 && sel[0]['block-uid'] === intendedUid)) { cb(true); return; }
			log('promote merged ' + sel.length + ' — healing (shrink-walk)');
			shrinkWalk(function () {
				var s2 = getSel();
				if (s2.length === 1 && s2[0]['block-uid'] === intendedUid) { log('heal ok (walk)'); cb(true); return; }
				if (outer >= 2) { log('heal cap — accepting ' + s2.length); cb(s2.length >= 1); return; }
				fire(window, K.esc); // clear
				setTimeout(function () {
					try { api().ui.setBlockFocusAndSelection({ location: { 'block-uid': intendedUid, 'window-id': win || 'log-outline' } }); } catch (e) { }
					setTimeout(function () { ensureClean(intendedUid, win, cb, outer + 1); }, 400);
				}, 160);
			});
		});
	}
	function promote(cb) {
		var fb = null;
		try { fb = api().ui.getFocusedBlock(); } catch (e) { }
		ensureClean(fb && fb['block-uid'], fb && fb['window-id'], cb);
	}
	// gap healing: when an extend/drag resurrects a stale remembered set (illegitimate gap),
	// COLLAPSE to the anchor (shrink-walk converges — proven) rather than bridging the span:
	// bridging a memory-resurrected gap would select a swath of unrelated content. After the
	// collapse the live selection is clean and further extends grow normally (no clear happens,
	// so the memory cannot re-union mid-session).
	function healGaps(reason) {
		if (healing || ctx !== 'SELECTING') return;
		var gi = selGapInfo();
		if (!gi || !gi.gaps.length) return;
		healing = true;
		log('GAP (' + reason + '): ' + gi.gaps.length + ' — collapsing to anchor');
		shrinkWalk(function () {
			healing = false;
			lastSelN = getSel().length;
			updateHandles();
			log('gap collapse done sel=' + lastSelN);
		});
	}

	// ---------- native-bar proxy layer + contract ----------
	function nativeBar() { return document.getElementById('rm-mobile-bar'); }
	function nativeBtn(matcher) {
		var f = nativeBar(); if (!f) return null;
		if (matcher.icon) { var i = f.querySelector(matcher.icon); return i ? i.closest('button') : null; }
		if (matcher.text) {
			return Array.prototype.find.call(f.querySelectorAll('button'), function (b) {
				return (b.textContent || '').trim() === matcher.text;
			}) || null;
		}
		return null;
	}
	function proxyClick(matcher) {
		var b = nativeBtn(matcher); if (!b) return false;
		// cover both onMouseDown- and onClick-bound handlers; untrusted events are fine for React
		['mousedown', 'mouseup', 'click'].forEach(function (t) {
			b.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }));
		});
		return true;
	}
	var PROXY = {
		undo: { icon: '.zmdi-undo' },
		redo: { icon: '.zmdi-redo' },                        // exists only after their undo; fallback covers
		outdent: { icon: '.zmdi-format-indent-decrease' },
		indent: { icon: '.zmdi-format-indent-increase' },
		moveUp: { icon: '.bp3-icon-arrow-up' },
		moveDown: { icon: '.bp3-icon-arrow-down' },
		wikilink: { text: '[[' },
		blockref: { text: '((' },
		slash: { text: '/' }
	};
	function checkContract() {
		var f = nativeBar();
		// footer mounts only while editing — absent+not-editing proves nothing
		if (!f && !isBlockTextarea(document.activeElement)) { contract = { ok: true, missing: [], unverified: true, t: now() }; return true; }
		var missing = [];
		if (!f) missing.push('#rm-mobile-bar');
		else {
			for (var id in PROXY) { if (id !== 'redo' && !nativeBtn(PROXY[id])) missing.push(id); }
		}
		var ok = missing.length === 0;
		if (!ok && (contract.ok || contract.missing.join() !== missing.join())) {
			try { console.warn('[cmdbar] native-bar CONTRACT DRIFT — fallbacks engaged for:', missing.join(', ')); } catch (e) { }
		}
		contract = { ok: ok, missing: missing, t: now() };
		if (bar) bar.toggleAttribute('data-drift', !ok);
		return ok;
	}
	// typing-equivalent fallback for the splice buttons
	function insertText(s) {
		var ta = document.activeElement;
		if (!isBlockTextarea(ta)) return false;
		try { document.execCommand('insertText', false, s); return true; } catch (e) { return false; }
	}

	// ---------- actions ----------
	// show: which forms display the button (E/S/I); rep: auto-repeat on hold
	var ACTIONS = {
		select: { show: 'E', run: function () { doSelect(); } },
		extendUp: { show: 'S', rep: true, run: function () { fire(window, K.extendUp); } },
		extendDown: { show: 'S', rep: true, run: function () { fire(window, K.extendDown); } },
		outdent: { show: 'ES', run: function (c) { if (c === 'EDITING') { proxyClick(PROXY.outdent) || fire(document.activeElement, K.outdent); } else fire(window, K.outdent); } },
		indent: { show: 'ES', run: function (c) { if (c === 'EDITING') { proxyClick(PROXY.indent) || fire(document.activeElement, K.indent); } else fire(window, K.indent); } },
		moveUp: { show: 'ES', rep: true, run: function (c) { if (c === 'EDITING') { proxyClick(PROXY.moveUp) || fire(document.activeElement, K.moveUp); } else fire(window, K.moveUp); } },
		moveDown: { show: 'ES', rep: true, run: function (c) { if (c === 'EDITING') { proxyClick(PROXY.moveDown) || fire(document.activeElement, K.moveDown); } else fire(window, K.moveDown); } },
		undo: { show: 'ESI', run: function (c) { (c === 'EDITING' && proxyClick(PROXY.undo)) || fire(window, K.undo); redoAvail = true; paintRedo(); } },
		redo: { show: 'EI', redoGated: true, run: function (c) { (c === 'EDITING' && proxyClick(PROXY.redo)) || fire(window, K.redo); } },
		wikilink: { show: 'E', run: function () { proxyClick(PROXY.wikilink) || insertText('[['); } },
		blockref: { show: 'E', run: function () { proxyClick(PROXY.blockref) || insertText('(('); } },
		slash: { show: 'E', run: function () { proxyClick(PROXY.slash) || insertText('/'); } },
		del: { show: 'S', run: function () { fire(window, K.del); } },
		done: { show: 'S', run: function () { doDone(); } },
		close: { show: 'I', run: function () { open = false; lsSet('VBS_cmdbar', '0'); applyCtx(true); } }
	};
	function doSelect() {
		var ta = document.activeElement;
		if (!isBlockTextarea(ta)) { shake(btns.select); return; }
		checkContract();
		promote(function (ok) {
			if (ok) { lastEdge = 'bottom'; applyCtx(true); } else shake(btns.select);
		});
	}
	function doDone() {
		// Esc with an active selection = full clear in Roam's engine (source-verified)
		fire(window, K.esc);
		setTimeout(function () {
			if (getSel().length) fire(window, K.esc); // belt
			setTimeout(function () { applyCtx(true); }, 80);
		}, 80);
	}
	function act(id, viaRepeat) {
		var a = ACTIONS[id]; if (!a) return;
		var c = ctx;
		log('act ' + id + (viaRepeat ? ' (rep)' : '') + ' ctx=' + c);
		if (id !== 'undo' && id !== 'redo') { if (id !== 'select' && id !== 'close') redoAvail = false, paintRedo(); }
		if (id === 'extendUp') lastEdge = 'top';
		if (id === 'extendDown') lastEdge = 'bottom';
		a.run(c);
		// closed loop for selection ops
		if (c === 'SELECTING' && id !== 'done') {
			setTimeout(updateHandles, 35);   // optimistic: knob/chip track the highlight, not the verify
			setTimeout(function () {
				var n = getSel().length;
				if (!n) {
					if (id === 'indent' || id === 'outdent') { promote(function () { applyCtx(true); }); return; }
					if (id === 'del') { applyCtx(true); return; }   // deletion legitimately empties
					log('sel lost after ' + id + ' — exiting');
					applyCtx(true); return;
				}
				if ((id === 'extendUp' || id === 'extendDown') && n === lastSelN && !viaRepeat) nudge(btns[id]);
				lastSelN = n;
				updateHandles();
				// selection-memory resurrection guard: a single extend can union a stale set (Roam bug)
				if (id === 'extendUp' || id === 'extendDown') healGaps('extend');
			}, 140);
		}
	}

	// ---------- icons ----------
	function svg(paths, w) {
		return '<svg viewBox="0 0 24 24" width="' + (w || 22) + '" height="' + (w || 22) + '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + paths + '</svg>';
	}
	var ICON = {
		undo: svg('<path d="M4 11h11a5 5 0 0 1 0 10h-5"/><path d="M4 11l5-5"/><path d="M4 11l5 5"/>'),
		redo: svg('<path d="M20 11H9a5 5 0 0 0 0 10h5"/><path d="M20 11l-5-5"/><path d="M20 11l-5 5"/>'),
		outdent: svg('<path d="M21 6H3"/><path d="M21 18H3"/><path d="M21 12h-9"/><path d="M7 9l-4 3 4 3"/>'),
		indent: svg('<path d="M3 6h18"/><path d="M3 18h18"/><path d="M3 12h9"/><path d="M17 9l4 3-4 3"/>'),
		moveUp: svg('<path d="M5 4h14"/><path d="M12 21V9"/><path d="M7 14l5-5 5 5"/>'),
		moveDown: svg('<path d="M5 20h14"/><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/>'),
		extendUp: svg('<path d="M6 12l6-5 6 5"/><path d="M6 17l6-5 6 5"/>'),
		extendDown: svg('<path d="M6 12l6 5 6-5"/><path d="M6 7l6 5 6-5"/>'),
		chevUp: svg('<path d="M5 15l7-7 7 7"/>', 20),
		chevDown: svg('<path d="M5 9l7 7 7-7"/>', 20),
		del: svg('<path d="M20 6H9l-5 6 5 6h11a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1z"/><path d="M12 9l5 5"/><path d="M17 9l-5 5"/>', 21),
		select: svg('<path d="M8 4H6a2 2 0 0 0-2 2v2"/><path d="M16 4h2a2 2 0 0 1 2 2v2"/><path d="M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M16 20h2a2 2 0 0 0 2-2v-2"/><path d="M9 12h6"/>', 18)
	};

	// ---------- style ----------
	function injectStyle() {
		if (document.getElementById(STYLE_ID)) return;
		var css = document.createElement('style');
		css.id = STYLE_ID;
		css.textContent = [
			// replace the native bar (display:none keeps its buttons proxy-clickable)
			'footer#rm-mobile-bar{display:none!important;}',

			'#' + ROOT_ID + '{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;}',
			'#' + ROOT_ID + ' *{box-sizing:border-box;-webkit-tap-highlight-color:transparent;-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;}',

			'.vt-frost{background:color-mix(in srgb, var(--bg-color,#182026) 82%, transparent);',
			'  -webkit-backdrop-filter:saturate(1.6) blur(18px);backdrop-filter:saturate(1.6) blur(18px);}',
			'@supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){',
			'  .vt-frost{background:color-mix(in srgb, var(--bg-color,#182026) 97%, #000);}}',

			/* dock = the only transformed element (rides the keyboard) */
			'#vt-dock{position:fixed;left:0;right:0;bottom:0;z-index:9990;pointer-events:none;will-change:transform;}',
			'#vt-dock.vt-anim{transition:transform .25s ' + KB_CURVE + ';}',

			/* BAR */
			'#vt-bar{pointer-events:auto;display:none;align-items:center;gap:1px;',
			'  height:48px;padding:0 max(6px,env(safe-area-inset-left,0)) 0 max(6px,env(safe-area-inset-right,0));',
			'  border-top:0.5px solid color-mix(in srgb, var(--icon-color,#5c7080) 30%, transparent);',
			'  box-shadow:0 -1px 14px rgba(0,0,0,.30);color:var(--icon-color,#8a9ba8);}',
			'#' + ROOT_ID + '[data-bar="1"] #vt-bar{display:flex;}',
			'#vt-dock[data-kb="down"] #vt-bar{padding-bottom:env(safe-area-inset-bottom,0px);height:calc(48px + env(safe-area-inset-bottom,0px));}',
			'#vt-bar[data-drift]::after{content:"";position:absolute;top:6px;right:6px;width:6px;height:6px;border-radius:3px;background:#f5a623;}',

			/* buttons: built once, morphed via max-width/opacity per form (no rebuilds) */
			'.vt-b{flex:0 0 auto;height:44px;margin:0;display:flex;align-items:center;justify-content:center;',
			'  background:transparent;border:0;color:inherit;border-radius:10px;padding:0;cursor:pointer;overflow:hidden;',
			'  max-width:0;opacity:0;transform:scale(.62);',
			'  transition:max-width .20s cubic-bezier(.32,.72,0,1),opacity .15s ease,transform .20s cubic-bezier(.32,.72,0,1),background .12s ease;}',
			'.vt-b.vt-on{flex:0 1 auto;max-width:46px;width:42px;min-width:33px;opacity:1;transform:scale(1);}',
			'.vt-b.vt-pressed{transform:scale(.88);background:rgba(47,155,249,.16);}',
			'.vt-b:disabled{opacity:.35;}',
			'.vt-div{flex:0 0 auto;width:1px;height:22px;margin:0 3px;background:color-mix(in srgb, var(--icon-color,#5c7080) 22%, transparent);',
			'  max-width:0;opacity:0;transition:max-width .2s,opacity .15s,margin .2s;}',
			'.vt-div.vt-on{max-width:1px;opacity:1;}',
			'.vt-spacer{flex:1 1 auto;}',
			'.vt-txt{font:600 16px/1 -apple-system,sans-serif;letter-spacing:.2px;}',

			/* selection family shares the Select blue (extends continue what Select started) */
			'#vt-b-extendUp.vt-on,#vt-b-extendDown.vt-on{color:' + BLUE + ';}',

			/* Select + Done pills */
			'#vt-b-select.vt-on{max-width:96px;width:auto;padding:0 10px;gap:5px;color:' + BLUE + ';}',
			'#vt-b-select span{font:600 14px/1 -apple-system,sans-serif;}',
			'#vt-b-done{background:' + BLUE + ';color:#fff;height:34px;border-radius:9px;}',
			'#vt-b-done.vt-on{max-width:84px;width:auto;padding:0 16px;}',
			'#vt-b-done span{font:600 15px/1 -apple-system,sans-serif;}',
			'#vt-b-done.vt-pressed{transform:scale(.94);background:' + BLUE + ';}',

			'.vt-nudge{animation:vt-nudge .2s ease;}',
			'@keyframes vt-nudge{0%,100%{transform:translateX(0) scale(1);}30%{transform:translateX(-4px) scale(1);}60%{transform:translateX(4px) scale(1);}}',
			'.vt-shake{animation:vt-nudge .2s ease;}',

			/* FAB */
			'#vt-fab{position:absolute;right:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px));pointer-events:auto;',
			'  width:42px;height:42px;border-radius:21px;display:none;align-items:center;justify-content:center;',
			'  color:var(--icon-color,#5c7080);border:0.5px solid color-mix(in srgb, var(--icon-color,#5c7080) 32%, transparent);',
			'  box-shadow:0 2px 10px rgba(0,0,0,.35);transition:transform .16s cubic-bezier(.2,.9,.25,1.2);}',
			'#' + ROOT_ID + '[data-fab="1"] #vt-fab{display:flex;}',
			'#vt-fab.vt-pressed{transform:scale(.88);}',

			/* HANDLES (separate fixed layer — never transformed; clipped so the 44pt knob hit-box
			   can never poke past the right edge and make iOS pan the page) */
			'#vt-handles{position:fixed;inset:0;z-index:9991;pointer-events:none;display:none;overflow:hidden;}',
			'#' + ROOT_ID + '[data-handles="1"] #vt-handles{display:block;}',
			'.vt-knob{position:absolute;pointer-events:auto;touch-action:none;width:44px;height:44px;margin:-22px 0 0 -22px;}',
			'.vt-knob::before{content:"";position:absolute;left:50%;top:50%;width:15px;height:15px;border-radius:50%;background:' + BLUE + ';',
			'  transform:translate(-50%,-50%);box-shadow:0 1px 4px rgba(0,0,0,.45),0 0 0 1.5px var(--bg-color,#182026);transition:transform .12s ease;}',
			'.vt-knob[data-grab]::before{transform:translate(-50%,-50%) scale(1.3);box-shadow:0 1px 4px rgba(0,0,0,.45),0 0 0 8px rgba(47,155,249,.16),0 0 0 9.5px var(--bg-color,#182026);}',
			'.vt-knob.vt-cross{transition:left .16s ease,top .16s ease;}', // animate ONLY when the knob crosses to the other end
			'#vt-tick{position:absolute;width:3px;border-radius:1.5px;background:' + BLUE + ';opacity:.6;pointer-events:none;transition:left .14s ease,top .14s ease,height .14s ease;}',
			'#vt-chip{position:absolute;pointer-events:none;min-width:22px;height:22px;padding:0 6px;border-radius:11px;',
			'  background:' + BLUE + ';color:#fff;font:700 12px/22px -apple-system,sans-serif;text-align:center;',
			'  box-shadow:0 1px 4px rgba(0,0,0,.4);}',

			/* HUD */
			'#vt-hud{position:fixed;left:8px;top:8px;z-index:9999;pointer-events:none;display:none;max-width:70vw;',
			'  background:rgba(0,0,0,.72);color:#9fe3a1;font:10px/1.45 ui-monospace,Menlo,monospace;padding:6px 8px;border-radius:8px;white-space:pre-wrap;}',
			'#' + ROOT_ID + '[data-debug="1"] #vt-hud{display:block;}',

			/* page accommodation + overlay suppression */
			'body.vt-bar-open .roam-body-main{padding-bottom:64px;}',
			'body.bp3-overlay-open #vt-dock,body.bp3-overlay-open #vt-handles{display:none!important;}'
		].join('\n');
		document.head.appendChild(css);
	}

	// ---------- DOM ----------
	function el(tag, id, cls) { var e = document.createElement(tag); if (id) e.id = id; if (cls) e.className = cls; return e; }
	function mkBtn(id, html, label, rep) {
		var b = el('button', 'vt-b-' + id, 'vt-b');
		b.innerHTML = html; b.setAttribute('aria-label', label); b.tabIndex = -1;
		b.dataset.act = id; if (rep) b.dataset.rep = '1';
		btns[id] = b; return b;
	}
	function build() {
		root = el('div', ROOT_ID, 'dont-unfocus-block');   // Roam's official "don't unfocus the editor" passport
		dock = el('div', 'vt-dock', 'dont-unfocus-block');
		dock.dataset.kb = 'down';
		bar = el('div', 'vt-bar', 'vt-frost');
		// DOM order = shared-element order; visibility toggled per form, never rebuilt
		bar.appendChild(mkBtn('select', ICON.select + '<span>Select</span>', 'Select line'));
		bar.appendChild(mkBtn('extendUp', ICON.extendUp, 'Extend up', true));
		bar.appendChild(mkBtn('extendDown', ICON.extendDown, 'Extend down', true));
		var d1 = el('div', 'vt-d1', 'vt-div'); bar.appendChild(d1);
		bar.appendChild(mkBtn('outdent', ICON.outdent, 'Outdent'));
		bar.appendChild(mkBtn('indent', ICON.indent, 'Indent'));
		bar.appendChild(mkBtn('moveUp', ICON.moveUp, 'Move up', true));
		bar.appendChild(mkBtn('moveDown', ICON.moveDown, 'Move down', true));
		bar.appendChild(mkBtn('undo', ICON.undo, 'Undo'));
		bar.appendChild(mkBtn('redo', ICON.redo, 'Redo'));
		var d2 = el('div', 'vt-d2', 'vt-div'); bar.appendChild(d2);
		bar.appendChild(mkBtn('wikilink', '<span class="vt-txt">[[</span>', 'Page link'));
		bar.appendChild(mkBtn('blockref', '<span class="vt-txt">((</span>', 'Block ref'));
		bar.appendChild(mkBtn('slash', '<span class="vt-txt">/</span>', 'Command'));
		bar.appendChild(mkBtn('del', ICON.del, 'Delete blocks'));
		bar.appendChild(el('div', null, 'vt-spacer'));
		bar.appendChild(mkBtn('done', '<span>Done</span>', 'Done'));
		bar.appendChild(mkBtn('close', ICON.chevDown, 'Close bar'));
		fab = el('button', 'vt-fab', 'vt-frost'); fab.innerHTML = ICON.chevUp; fab.tabIndex = -1; fab.setAttribute('aria-label', 'Commands');
		dock.appendChild(bar); dock.appendChild(fab);

		hLayer = el('div', 'vt-handles', 'dont-unfocus-block');
		knob = el('div', null, 'vt-knob');
		tick = el('div', 'vt-tick');
		chip = el('div', 'vt-chip');
		hLayer.appendChild(tick); hLayer.appendChild(knob); hLayer.appendChild(chip);

		hud = el('div', 'vt-hud');

		root.appendChild(dock); root.appendChild(hLayer); root.appendChild(hud);
		document.body.appendChild(root);
		root.dataset.debug = debugOn() ? '1' : '0';
	}

	// which buttons show in which form
	var FORM = {
		IDLE: ['undo', 'redo*', 'close'],
		EDITING: ['select', 'd1', 'outdent', 'indent', 'moveUp', 'moveDown', 'undo', 'redo*', 'd2', 'wikilink', 'blockref', 'slash'],
		SELECTING: ['extendUp', 'extendDown', 'd1', 'outdent', 'indent', 'moveUp', 'moveDown', 'undo', 'd2', 'del', 'done']
	};
	function paintForm() {
		var list = FORM[ctx] || [];
		var on = {};
		list.forEach(function (id) {
			if (id === 'redo*') { if (redoAvail) on.redo = 1; }
			else on[id] = 1;
		});
		for (var id in btns) btns[id].classList.toggle('vt-on', !!on[id]);
		document.getElementById('vt-d1').classList.toggle('vt-on', !!on.d1);
		document.getElementById('vt-d2').classList.toggle('vt-on', !!on.d2);
	}
	function paintRedo() { if (ctx !== 'OFF') paintForm(); }
	function shake(b) { if (!b) return; b.classList.remove('vt-shake'); void b.offsetWidth; b.classList.add('vt-shake'); }
	function nudge(b) { if (!b) return; b.classList.remove('vt-nudge'); void b.offsetWidth; b.classList.add('vt-nudge'); }

	// ---------- positioning (visualViewport keyboard oracle) ----------
	function overlap() {
		var vv = window.visualViewport;
		if (!vv) return 0;
		var o = Math.round(window.innerHeight - vv.height - vv.offsetTop);
		return o <= 30 ? 0 : o;   // ≤30 ⇒ closed (also absorbs the iOS 26 residue bug)
	}
	function orientKey() { return window.innerHeight >= window.innerWidth ? 'p' : 'l'; }
	function place() {
		if (!dock) return;
		var o = overlap();
		dock.classList.toggle('vt-anim', now() < kbAnimUntil);
		dock.style.transform = o ? 'translateY(' + (-o) + 'px)' : '';
		dock.dataset.kb = o ? 'up' : 'down';
		if (o > 60) lsSet('VBS_kb_' + orientKey(), String(o));
		if (ctx === 'SELECTING') updateHandles();
	}
	function schedulePos() { if (rafPos) return; rafPos = requestAnimationFrame(function () { rafPos = 0; place(); }); }
	function preRide() {
		// keyboard is coming (focusin) — ride with it using the cached height; settle on real resize
		var cached = parseInt(lsGet('VBS_kb_' + orientKey()) || '0', 10);
		kbAnimUntil = now() + 450;
		if (cached > 60 && overlap() <= 30) {
			dock.classList.add('vt-anim');
			dock.style.transform = 'translateY(' + (-cached) + 'px)';
			dock.dataset.kb = 'up';
		}
	}

	// ---------- handles ----------
	function rectOf(uid) {
		var node = uidNode(uid); if (!node) return null;
		var t = node.querySelector('.rm-block-text') || node;
		return t.getBoundingClientRect();
	}
	function updateHandles() {
		var sel = getSel();
		if (!sel.length) { root.dataset.handles = '0'; prevFocusBottom = null; return; }
		root.dataset.handles = '1';
		var uids = sel.map(function (x) { return x['block-uid']; });
		var rects = uids.map(function (u) { return { uid: u, r: rectOf(u) }; }).filter(function (x) { return x.r; });
		if (!rects.length) { root.dataset.handles = '0'; prevFocusBottom = null; return; }
		rects.sort(function (a, b) { return a.r.top - b.r.top; });
		var top = rects[0], bot = rects[rects.length - 1];
		// getSelected() order is INSERTION order, not document order (proven) — never derive the
		// anchor from uids[0]; the knob lives at the edge the user is working (lastEdge).
		var focusIsBottom = lastEdge !== 'top';
		// animate the knob ONLY when it crosses to the other end (the moment worth selling)
		if (prevFocusBottom !== null && focusIsBottom !== prevFocusBottom && !drag) {
			knob.classList.add('vt-cross');
			if (crossT) clearTimeout(crossT);
			crossT = setTimeout(function () { knob.classList.remove('vt-cross'); }, 200);
		}
		prevFocusBottom = focusIsBottom;
		var vw = window.innerWidth;
		var kr = focusIsBottom ? bot.r : top.r;
		knob.style.left = Math.max(14, Math.min(focusIsBottom ? kr.right + 6 : kr.left - 6, vw - 14)) + 'px';
		knob.style.top = (focusIsBottom ? kr.bottom - 4 : kr.top + 4) + 'px';
		var ar = focusIsBottom ? top.r : bot.r;
		tick.style.left = (focusIsBottom ? ar.left - 7 : Math.min(ar.right + 4, vw - 8)) + 'px';
		tick.style.top = ar.top + 'px';
		tick.style.height = ar.height + 'px';
		chip.textContent = String(rects.length);
		chip.style.left = (focusIsBottom ? Math.min(kr.right + 22, vw - 38) : Math.max(8, kr.left - 52)) + 'px';
		chip.style.top = (focusIsBottom ? kr.bottom + 2 : kr.top - 26) + 'px';
	}

	// ---------- the EVENT SHIELD + gesture engine ----------
	// Everything inside #vt-cmd-root is invisible to Roam (window-capture stop) and we act on our
	// own pointer gestures. Untrusted clicks pass through (our proxy clicks must reach React).
	var SHIELD_TYPES = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel',
		'mousedown', 'mousemove', 'mouseup', 'touchstart', 'touchmove', 'touchend', 'touchcancel',
		'click', 'contextmenu', 'dblclick'];
	function inRoot(t) { return !!(t && t.closest && t.closest('#' + ROOT_ID)); }
	function shield(e) {
		var inside = inRoot(e.target);
		// during a knob drag we own the whole screen's move/up events
		if (!inside && !(drag && (e.type.indexOf('move') > 0 || e.type.indexOf('up') > 0 || e.type.indexOf('cancel') > 0 || e.type.indexOf('end') > 0))) return;
		if (e.type === 'click' && !e.isTrusted) return;       // our proxies / programmatic clicks
		if (inside || drag) e.stopPropagation();
		if (e.type === 'touchstart' || e.type === 'touchmove' || e.type === 'mousedown' || e.type === 'contextmenu') {
			if (e.cancelable) e.preventDefault();             // keep focus+selection, kill zoom/callout/scroll
		}
		route(e);
	}
	function evPoint(e) {
		if (e.touches && e.touches.length) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
		if (e.changedTouches && e.changedTouches.length) return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
		return { x: e.clientX, y: e.clientY };
	}
	function route(e) {
		var t = e.type;
		// gestures are driven by POINTER events; touch/mouse only feed preventDefault above
		if (t === 'pointerdown') {
			var p = evPoint(e);
			if (e.target.closest && e.target.closest('.vt-knob')) { dragStart(e.pointerId, p); return; }
			var b = e.target.closest && e.target.closest('.vt-b,#vt-fab');
			if (b) gestureStart(e.pointerId, b, p);
			return;
		}
		if (t === 'pointermove') {
			var p2 = evPoint(e);
			if (drag && e.pointerId === drag.pid) { drag.x = p2.x; drag.y = p2.y; if (Math.abs(p2.y - drag.startY) > 8) drag.moved = true; return; }
			if (gesture && e.pointerId === gesture.pid) {
				if (Math.abs(p2.x - gesture.x) > 12 || Math.abs(p2.y - gesture.y) > 12) gestureCancel();
			}
			return;
		}
		if (t === 'pointerup') {
			if (drag && e.pointerId === drag.pid) { dragEnd(); return; }
			if (gesture && e.pointerId === gesture.pid) gestureEnd(true);
			return;
		}
		if (t === 'pointercancel') {
			if (drag && e.pointerId === drag.pid) dragEnd();
			if (gesture && e.pointerId === gesture.pid) gestureCancel();
		}
	}
	// --- button gesture (press visual, auto-repeat, act on release if not repeated) ---
	function gestureStart(pid, btn, p) {
		if (gesture) gestureCancel();
		gesture = { pid: pid, btn: btn, x: p.x, y: p.y, fired: 0, repT: null };
		btn.classList.add('vt-pressed');
		if (btn.dataset.rep) {
			gesture.repT = setTimeout(function repeat() {
				if (!gesture || gesture.btn !== btn) return;
				gesture.fired++;
				act(btn === fab ? '__fab' : btn.dataset.act, true);
				var iv = gesture.fired > 6 ? 70 : 120;
				gesture.repT = setTimeout(repeat, iv);
			}, 350);
		}
	}
	function gestureEnd(actNow) {
		if (!gesture) return;
		var g = gesture; gesture = null;
		if (g.repT) clearTimeout(g.repT);
		g.btn.classList.remove('vt-pressed');
		if (actNow && !g.fired) {
			if (g.btn === fab) { open = true; lsSet('VBS_cmdbar', '1'); applyCtx(true); }
			else act(g.btn.dataset.act, false);
		}
	}
	function gestureCancel() { gestureEnd(false); }
	// --- knob drag (closed loop; one extend per crossed block; edge auto-scroll) ---
	// Auto-scroll grammar (WebKit/Android/pragmatic-dnd constants): zones are INERT until the finger
	// travels ≥48px toward that edge (directional arming) and ≥120ms passed; velocity is linear in
	// zone depth (50→550px/s) × a 400ms time-ramp that resets on zone exit; per-frame cap 9px.
	// Extending under a stationary finger while content scrolls is the universal grammar — kept.
	var AS = { ARM_PX: 48, ARM_MS: 120, ZONE: 90, TOPZ: 80, VMIN: 50, VMAX: 550, RAMP: 400, CAP: 9 };
	function dragStart(pid, p) {
		if (ctx !== 'SELECTING') return;
		drag = {
			pid: pid, startY: p.y, x: p.x, y: p.y, moved: false, busy: false, raf: 0,
			t0: now(), lastT: now(), minY: p.y, maxY: p.y,
			armUp: false, armDown: false, engUp: 0, engDown: 0,
			seenEl: null, seen: {}
		};
		knob.setAttribute('data-grab', '1');
		log('drag start');
		dragLoop();
	}
	function dragLoop() {
		if (!drag) return;
		var t = now();
		var dt = Math.min(50, t - drag.lastT); drag.lastT = t;
		if (drag.moved) {
			var sel = getSel();
			if (!sel.length) { log('drag: sel vanished — abort'); dragEnd(); return; }
			// --- directional arming + tracking ---
			if (drag.y > drag.maxY) drag.maxY = drag.y;
			if (drag.y < drag.minY) drag.minY = drag.y;
			if (!drag.armDown && drag.y - drag.minY >= AS.ARM_PX && t - drag.t0 >= AS.ARM_MS) { drag.armDown = true; drag.maxY = drag.y; }
			if (drag.armDown && drag.maxY - drag.y >= AS.ARM_PX) { drag.armDown = false; drag.engDown = 0; drag.minY = drag.y; }
			if (!drag.armUp && drag.maxY - drag.y >= AS.ARM_PX && t - drag.t0 >= AS.ARM_MS) { drag.armUp = true; drag.minY = drag.y; }
			if (drag.armUp && drag.y - drag.minY >= AS.ARM_PX) { drag.armUp = false; drag.engUp = 0; drag.maxY = drag.y; }
			// --- ramped edge auto-scroll (zone anchored to the bar top, not the screen bottom) ---
			var vv = window.visualViewport;
			var vpBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
			var barTop = vpBottom - ((root.dataset.bar === '1') ? bar.getBoundingClientRect().height : 0);
			var sc = scroller();
			if (drag.armDown && drag.y > barTop - AS.ZONE) {
				if (!drag.engDown) drag.engDown = t;
				var depth = Math.min(1, (drag.y - (barTop - AS.ZONE)) / AS.ZONE);
				var v = (AS.VMIN + depth * (AS.VMAX - AS.VMIN)) * Math.min(1, (t - drag.engDown) / AS.RAMP);
				sc.scrollBy(0, Math.max(1, Math.min(AS.CAP, v * dt / 1000)));
			} else drag.engDown = 0;
			if (drag.armUp && drag.y < AS.TOPZ) {
				if (!drag.engUp) drag.engUp = t;
				var depthU = Math.min(1, (AS.TOPZ - drag.y) / AS.TOPZ);
				var vU = (AS.VMIN + depthU * (AS.VMAX - AS.VMIN)) * Math.min(1, (t - drag.engUp) / AS.RAMP);
				sc.scrollBy(0, -Math.max(1, Math.min(AS.CAP, vU * dt / 1000)));
			} else drag.engUp = 0;
			// --- extend toward the finger (coverage test; one keypress per settle; oscillation guard) ---
			if (!drag.busy) {
				var hit = document.elementFromPoint(drag.x, Math.max(2, Math.min(window.innerHeight - 2, drag.y)));
				var targetEl = hit && hit.closest ? hit.closest('.roam-block-container') : null;
				if (targetEl) {
					// covered = the finger's block is already part of the selection (incl. via a
					// selected ancestor — children of a selected parent are never independently addressable)
					var covered = targetEl.classList.contains('block-highlight-blue') ||
						!!targetEl.closest('.block-highlight-blue') ||
						!!targetEl.querySelector('.block-highlight-blue');
					var gi = selGapInfo();
					var list = allBlocks();
					var tIdx = list.indexOf(targetEl);
					var key = null;
					if (gi && tIdx >= 0) {
						if (!covered && tIdx > gi.max) key = K.extendDown;
						else if (!covered && tIdx < gi.min) key = K.extendUp;
						else if (covered) {
							// inside the range: shrink the working edge toward the finger
							if (lastEdge === 'bottom' && tIdx < gi.max) key = K.extendUp;
							else if (lastEdge === 'top' && tIdx > gi.min) key = K.extendDown;
						}
					}
					if (key) {
						if (drag.seenEl !== targetEl) { drag.seen = {}; drag.seenEl = targetEl; }
						var sig = selUids().slice().sort().join(',') + '|' + (key === K.extendDown ? 'd' : 'u');
						if (!drag.seen[sig]) {        // never repeat a press that produced a seen state
							drag.seen[sig] = 1;
							drag.busy = true;
							var pre = selUids().slice().sort().join(',');
							fire(window, key);
							lastEdge = (key === K.extendDown) ? 'bottom' : 'top';
							var t0s = now();
							(function settle() {
								if (!drag) return;
								var cur = selUids().slice().sort().join(',');
								if (cur !== pre || now() - t0s > 200) { drag.busy = false; updateHandles(); }
								else setTimeout(settle, 40);
							})();
						}
					}
				}
			}
		}
		drag.raf = requestAnimationFrame(dragLoop);
	}
	function dragEnd() {
		if (!drag) return;
		if (drag.raf) cancelAnimationFrame(drag.raf);
		drag = null;
		knob.removeAttribute('data-grab');
		log('drag end sel=' + getSel().length);
		updateHandles();
		healGaps('drag');   // selection-memory resurrection mid-drag → rebuild contiguous
	}

	// ---------- state machine ----------
	function ctxNow() {
		if (getSel().length) return 'SELECTING';
		if (isBlockTextarea(document.activeElement)) return 'EDITING';
		return 'IDLE';
	}
	function applyCtx(force) {
		if (!added) return;
		var c = ctxNow();
		if (!force && c === ctx) {
			if (c === 'SELECTING' && !drag) updateHandles();
			return;
		}
		var prev = ctx; ctx = c;
		lastSelN = getSel().length;
		root.dataset.bar = (c === 'EDITING' || c === 'SELECTING' || (c === 'IDLE' && open)) ? '1' : '0';
		root.dataset.fab = (c === 'IDLE' && !open) ? '1' : '0';
		root.dataset.handles = (c === 'SELECTING') ? '1' : '0';
		paintForm();
		if (c === 'SELECTING') updateHandles();
		if (c === 'EDITING' && prev !== 'EDITING') checkContract();
		document.body.classList.toggle('vt-bar-open', root.dataset.bar === '1');
		place();
		log('ctx ' + prev + '→' + c + ' sel=' + lastSelN);
		hudPaint();
	}
	function scheduleSync() { if (rafSync) return; rafSync = requestAnimationFrame(function () { rafSync = 0; applyCtx(false); }); }

	// ---------- HUD ----------
	function hudPaint() {
		if (!hud || !debugOn()) return;
		hud.textContent = 'ctx=' + ctx + ' sel=' + getSel().length + ' kb=' + overlap() +
			' redo=' + (redoAvail ? 1 : 0) + ' contract=' + (contract.ok ? 'ok' : 'DRIFT:' + contract.missing.join(',')) +
			'\n' + logRing.slice(-8).join('\n');
	}

	// ---------- wiring ----------
	function start() {
		if (added) return;
		if (!enabled()) return;
		added = true;
		open = lsGet('VBS_cmdbar') === '1';
		injectStyle();
		build();
		checkContract();
		ac = new AbortController(); var sig = ac.signal;
		SHIELD_TYPES.forEach(function (t) {
			window.addEventListener(t, shield, { capture: true, passive: false, signal: sig });
		});
		document.addEventListener('focusin', function (e) {
			if (isBlockTextarea(e.target)) preRide();
			scheduleSync();
		}, { capture: true, signal: sig });
		document.addEventListener('focusout', function () {
			kbAnimUntil = now() + 450;
			setTimeout(scheduleSync, 60);
			schedulePos();
		}, { capture: true, signal: sig });
		document.addEventListener('input', function (e) { if (isBlockTextarea(e.target)) { redoAvail = false; paintRedo(); } }, { capture: true, signal: sig });
		if (window.visualViewport) {
			window.visualViewport.addEventListener('resize', function () { schedulePos(); scheduleSync(); }, { signal: sig });
			window.visualViewport.addEventListener('scroll', schedulePos, { signal: sig });
		}
		window.addEventListener('orientationchange', function () { setTimeout(function () { schedulePos(); scheduleSync(); }, 120); }, { signal: sig });
		window.addEventListener('scroll', function () { if (ctx === 'SELECTING') schedulePos(); }, { capture: true, passive: true, signal: sig });
		mo = new MutationObserver(scheduleSync);
		mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
		healTimer = setInterval(function () {
			if (!document.getElementById(STYLE_ID)) injectStyle();
			applyCtx(false);
			if (ctx === 'SELECTING' && !drag) updateHandles();
			if (debugOn()) hudPaint();
		}, 280);
		applyCtx(true);
		log('cmdbar v0.2 up');
	}
	function stop() {
		if (!added) return; added = false;
		if (ac) { ac.abort(); ac = null; }
		if (mo) { mo.disconnect(); mo = null; }
		if (healTimer) { clearInterval(healTimer); healTimer = null; }
		if (gesture) gestureCancel();
		if (drag) dragEnd();
		document.body.classList.remove('vt-bar-open');
		if (root && root.parentNode) root.parentNode.removeChild(root);
		var st = document.getElementById(STYLE_ID); if (st) st.remove();   // un-hides the native bar
		root = dock = bar = fab = hLayer = knob = tick = chip = hud = null;
		btns = {}; ctx = 'OFF';
	}

	start();
	return {
		isAdded: function () { return added; }, start: start, stop: stop,
		_state: function () { return { ctx: ctx, sel: selUids(), open: open, redoAvail: redoAvail, kb: overlap(), contract: contract }; },
		_log: function () { return logRing.slice(); },
		_force: function (v) { lsSet('VBS_force', v ? '1' : '0'); }
	};
})();
