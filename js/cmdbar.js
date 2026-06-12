/*
 * Viktor's Roam Mobile Command Bar — a contextual, openable/closable command toolbar for mobile.
 * version: 0.1  (2026-06-12)
 * author: @ViktorTabori
 *
 * WHY: On desktop, Esc selects the current block (line), Shift+Up/Down grows the selection block by
 * block, and you act on it (undo/redo, indent in/out, move up/down). On mobile there is no Esc and,
 * once nothing is in a text input, the above-keyboard bar vanishes — so block/line-selection and its
 * actions are unreachable. This module brings them to mobile as ONE surface with three chrome forms:
 *
 *   FAB   (closed)  — a small round toggle bottom-right, like the iOS keyboard show/hide control.
 *   BAR   (open)    — a full-bleed frosted bottom bar whose buttons are CONTEXTUAL.
 *   PILL  (editing) — a "Select line" pill above the keyboard (Roam's own bar already has undo/indent/
 *                     move while editing; the one thing it lacks is entry into block-select — the pill).
 *
 * CONTEXTS (single source of truth = roamAlphaAPI.ui.multiselect.getSelected() + document.activeElement):
 *   IDLE      nothing focused, no selection → FAB (or, if toggled open, BAR with just Undo/Redo).
 *   EDITING   a block textarea focused, keyboard up → PILL ("Select line").
 *   SELECTING ≥1 block selected, keyboard down → BAR with the full action set + drag handles.
 *
 * ENGINE (all proven live + corroborated against Roam's own compiled source — Roam's native mobile
 * bar drives indent/move by SIMULATING these very keydowns):
 *   enter select  = synthetic Escape keydown on the focused textarea (retry-until-selected; Escape
 *                   sometimes no-ops when fired with text selected — a ≤4× retry converges).
 *   extend/shrink = Shift+ArrowUp / Shift+ArrowDown on <body>  (single fixed ANCHOR = the escaped
 *                   block, one moving FOCUS; focus can cross the anchor to grow upward).
 *   undo / redo   = Meta+Z / Meta+Shift+Z              (Meta required; Ctrl does NOT work on Mac/iOS).
 *   indent/outdent= Tab / Shift+Tab.
 *   move up/down  = Meta+Shift+ArrowUp / Meta+Shift+ArrowDown (keeps the selection).
 *   getSelected() is READ-ONLY — we never set selection directly; we walk it with the keys above.
 *
 * Two entry modes into SELECTING (the user wanted both, to compare): (A) the PILL button, and
 * (B) AUTO-PROMOTE — selecting all of a block's text by touch promotes it to block-select; then the
 * draggable handle extends it. Auto-promote is conservative + cancelable + flag-gated (localStorage
 * VBS_autopromote, default on). Force the UI on for desktop CDP testing: localStorage VBS_force='1'.
 *
 * Mobile gate mirrors Roam's own: touch device (navigator.maxTouchPoints || 'ontouchstart') AND not
 * the Flutter native app (window.FlutterCurrentGraphChannel === undefined).
 *
 * Loader: registered as `cmdbar` in alphaChannel → global ViktorCmdbar with .start()/.stop().
 */
if (window.ViktorCmdbar && window.ViktorCmdbar.stop) window.ViktorCmdbar.stop();
window.ViktorCmdbar = (function () {
	var doLog = false;
	var BLUE = 'rgb(47,155,249)';
	var STYLE_ID = 'vt-cmdbar-style';
	var ROOT_ID = 'vt-cmd-root';

	var added = false;
	var root = null, fab = null, bar = null, pill = null, hLayer = null, knob = null, anchorLine = null, nub = null, dragMask = null;
	var mo = null, healTimer = null, ac = null, rafPos = 0, rafSync = 0;
	var open = false;                 // IDLE open/closed preference
	var state = 'OFF';
	var redoAvail = false;            // shadow flag: Undo pressed → redo becomes available (Roam's own heuristic)
	var lastBarKey = '';              // cache: rebuild bar only when (ctx, redoAvail, open) change
	// auto-promote state
	var apTimer = null, apArmed = false, apLastFull = false, apSawTouch = 0, apCooldown = 0, apGuardUid = null;
	// drag state
	var drag = null;

	// ---------- detection ----------
	function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
	function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { } }
	function isFlutter() { return typeof window.FlutterCurrentGraphChannel !== 'undefined'; }
	function isTouch() { return !!(navigator.maxTouchPoints > 0 || ('ontouchstart' in window)); }
	function enabled() { return (isTouch() && !isFlutter()) || lsGet('VBS_force') === '1'; }
	function autoPromoteOn() { return lsGet('VBS_autopromote') !== '0'; }

	// ---------- roam api / engine ----------
	function api() { return window.roamAlphaAPI; }
	function getSel() { try { return api().ui.multiselect.getSelected() || []; } catch (e) { return []; } }
	function selUids() { return getSel().map(function (x) { return x['block-uid']; }); }
	function isBlockTextarea(el) { return !!(el && el.tagName === 'TEXTAREA' && /^block-input-/.test(el.id || '')); }
	function uidNode(uid) {
		var el = document.querySelector('[id$="-' + uid + '"]');
		return el ? el.closest('.roam-block-container') : null;
	}
	// All currently-rendered block containers in DOM (== visual) order.
	function allBlocks() { return Array.prototype.slice.call(document.querySelectorAll('.roam-block-container')); }

	var K = {
		esc: { key: 'Escape', code: 'Escape', keyCode: 27, which: 27 },
		extendUp: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38, which: 38, shiftKey: true },
		extendDown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40, shiftKey: true },
		undo: { key: 'z', code: 'KeyZ', keyCode: 90, which: 90, metaKey: true },
		redo: { key: 'z', code: 'KeyZ', keyCode: 90, which: 90, metaKey: true, shiftKey: true },
		outdent: { key: 'Tab', code: 'Tab', keyCode: 9, which: 9, shiftKey: true },
		indent: { key: 'Tab', code: 'Tab', keyCode: 9, which: 9 },
		moveUp: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38, which: 38, metaKey: true, shiftKey: true },
		moveDown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40, metaKey: true, shiftKey: true }
	};
	function fire(target, spec) {
		(target || document.body).dispatchEvent(new KeyboardEvent('keydown',
			Object.assign({ bubbles: true, cancelable: true, view: window }, spec)));
	}

	// retry-until-selected Escape (the flaky-toggle-proof promotion)
	function promote(cb) {
		var tries = 0;
		(function attempt() {
			fire(document.activeElement, K.esc);
			setTimeout(function () {
				if (getSel().length) { cb(true); return; }
				if (++tries < 4) attempt(); else cb(false);
			}, 150);
		})();
	}

	// ---------- icons (inline SVG, stroke=currentColor) ----------
	function svg(paths, w) {
		return '<svg viewBox="0 0 24 24" width="' + (w || 23) + '" height="' + (w || 23) + '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + paths + '</svg>';
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
		select: svg('<path d="M8 4H6a2 2 0 0 0-2 2v2"/><path d="M16 4h2a2 2 0 0 1 2 2v2"/><path d="M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M16 20h2a2 2 0 0 0 2-2v-2"/><path d="M9 12h6"/>', 19)
	};

	// ---------- style ----------
	function injectStyle() {
		if (document.getElementById(STYLE_ID)) return;
		var css = document.createElement('style');
		css.id = STYLE_ID;
		css.textContent = [
			'#' + ROOT_ID + '{position:fixed;inset:0;z-index:9990;pointer-events:none;',
			'  --vt-kb:0px;--vt-nativebar:46px;',
			'  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;}',
			'#' + ROOT_ID + ' *{box-sizing:border-box;-webkit-tap-highlight-color:transparent;}',

			/* frosted material shared by BAR/FAB/PILL/NUB */
			'.vt-frost{background:color-mix(in srgb, var(--bg-color,#182026) 80%, transparent);',
			'  -webkit-backdrop-filter:saturate(1.6) blur(18px);backdrop-filter:saturate(1.6) blur(18px);}',
			'@supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){',
			'  .vt-frost{background:color-mix(in srgb, var(--bg-color,#182026) 96%, #000);}}',

			/* FAB */
			'#vt-fab{position:absolute;right:12px;pointer-events:auto;',
			'  bottom:calc(12px + env(safe-area-inset-bottom,0px) + var(--vt-kb));',
			'  width:42px;height:42px;border-radius:21px;display:none;align-items:center;justify-content:center;',
			'  color:var(--icon-color,#5c7080);border:1px solid color-mix(in srgb, var(--icon-color,#5c7080) 32%, transparent);',
			'  box-shadow:0 2px 10px rgba(0,0,0,.35);transition:transform .16s cubic-bezier(.2,.9,.25,1.2),opacity .16s ease;}',
			'#vt-fab:active{transform:scale(.9);}',

			/* BAR */
			'#vt-bar{position:absolute;left:0;right:0;bottom:0;pointer-events:auto;display:none;align-items:center;',
			'  height:calc(46px + env(safe-area-inset-bottom,0px));padding:0 max(8px,env(safe-area-inset-left,0)) env(safe-area-inset-bottom,0px) max(8px,env(safe-area-inset-right,0));',
			'  border-top:1px solid color-mix(in srgb, var(--icon-color,#5c7080) 28%, transparent);',
			'  box-shadow:0 -1px 14px rgba(0,0,0,.34);color:var(--icon-color,#5c7080);',
			'  transition:transform .24s cubic-bezier(.32,.72,0,1),opacity .2s ease;will-change:transform;}',
			'#vt-bar[data-anim="in"]{animation:vt-rise .26s cubic-bezier(.32,.72,0,1);}',
			'@keyframes vt-rise{from{transform:translateY(110%);opacity:.4;}to{transform:translateY(0);opacity:1;}}',

			'.vt-btn{flex:0 0 auto;width:40px;height:44px;margin:0;display:flex;align-items:center;justify-content:center;',
			'  background:transparent;border:0;color:inherit;border-radius:10px;padding:0;cursor:pointer;',
			'  transition:transform .2s cubic-bezier(.2,.9,.25,1.2),background .12s ease,color .12s ease;}',
			'.vt-btn:active{transform:scale(.9);background:rgba(47,155,249,.18);}',
			'.vt-btn[data-on="1"]{color:' + BLUE + ';}',
			'.vt-pulse{animation:vt-pulse .26s ease-in-out;}',
			'@keyframes vt-pulse{0%{transform:scale(1);}45%{transform:scale(.9);}70%{transform:scale(1.04);}100%{transform:scale(1);}}',
			'.vt-nudge{animation:vt-nudge .2s ease;}',
			'@keyframes vt-nudge{0%,100%{transform:translateX(0);}30%{transform:translateX(-4px);}60%{transform:translateX(4px);}}',
			'.vt-div{flex:0 0 auto;width:1px;height:24px;margin:0 4px;background:color-mix(in srgb, var(--icon-color,#5c7080) 20%, transparent);}',
			'.vt-spacer{flex:1 1 auto;}',
			'.vt-prim svg{filter:drop-shadow(0 1px 0 rgba(47,155,249,.0));}',
			'.vt-prim{position:relative;}',
			'.vt-prim::after{content:"";position:absolute;left:9px;right:9px;bottom:7px;height:1.5px;border-radius:1px;background:' + BLUE + ';opacity:.8;}',
			'.vt-done{flex:0 0 auto;height:32px;margin-left:4px;padding:0 15px;border:0;border-radius:9px;',
			'  background:' + BLUE + ';color:#fff;font:600 15px/32px -apple-system,sans-serif;cursor:pointer;}',
			'.vt-done:active{transform:scale(.95);}',

			/* PILL + NUB */
			'#vt-pill,#vt-nub{position:absolute;right:12px;pointer-events:auto;display:none;align-items:center;gap:6px;',
			'  bottom:calc(var(--vt-kb) + var(--vt-nativebar) + 10px);height:36px;padding:0 15px;border-radius:18px;',
			'  color:' + BLUE + ';font:600 14px/36px -apple-system,sans-serif;cursor:pointer;',
			'  background:color-mix(in srgb, ' + BLUE + ' 14%, var(--bg-color,#182026));',
			'  border:1px solid color-mix(in srgb, ' + BLUE + ' 34%, transparent);',
			'  box-shadow:0 2px 8px rgba(0,0,0,.32), inset 0 1px 0 rgba(255,255,255,.14);',
			'  transition:transform .16s cubic-bezier(.2,.9,.25,1.2),opacity .2s ease;}',
			'#vt-pill:active{transform:scale(.94);background:color-mix(in srgb, ' + BLUE + ' 24%, var(--bg-color,#182026));}',
			'#vt-pill.vt-shake{animation:vt-nudge .2s ease;}',
			'#vt-nub .vt-x{margin-left:2px;width:22px;height:22px;border-radius:11px;display:inline-flex;align-items:center;justify-content:center;opacity:.7;}',

			/* HANDLES */
			'#vt-handles{position:absolute;inset:0;pointer-events:none;display:none;}',
			'.vt-knob{position:absolute;pointer-events:auto;touch-action:none;}',
			'.vt-knob .vt-stem{position:absolute;width:2px;border-radius:1px;background:' + BLUE + ';left:50%;transform:translateX(-50%);}',
			'.vt-knob .vt-dot{position:absolute;width:13px;height:13px;border-radius:50%;background:' + BLUE + ';left:50%;transform:translateX(-50%);',
			'  box-shadow:0 1px 3px rgba(0,0,0,.4),0 0 0 1px var(--bg-color,#182026);transition:transform .12s ease;}',
			'.vt-knob .vt-hit{position:absolute;width:44px;height:44px;left:50%;top:50%;transform:translate(-50%,-50%);}',
			'.vt-knob[data-grab="1"] .vt-dot{transform:translateX(-50%) scale(1.25);box-shadow:0 1px 3px rgba(0,0,0,.4),0 0 0 8px rgba(47,155,249,.18),0 0 0 9px var(--bg-color,#182026);}',
			'#vt-anchorline{position:absolute;width:2px;border-radius:1px;background:' + BLUE + ';opacity:.55;pointer-events:none;display:none;}',
			'#vt-dragmask{position:fixed;inset:0;z-index:9989;display:none;}',

			'body.vt-bar-open .roam-body-main{padding-bottom:60px;}'
		].join('\n');
		document.head.appendChild(css);
	}

	// ---------- DOM build ----------
	function el(tag, id, cls) { var e = document.createElement(tag); if (id) e.id = id; if (cls) e.className = cls; return e; }
	function build() {
		root = el('div', ROOT_ID);
		fab = el('button', 'vt-fab', 'vt-frost'); fab.innerHTML = ICON.chevUp; fab.setAttribute('aria-label', 'Commands');
		bar = el('div', 'vt-bar', 'vt-frost');
		pill = el('button', 'vt-pill'); pill.innerHTML = ICON.select + '<span>Select line</span>';
		nub = el('div', 'vt-nub', 'vt-frost'); nub.innerHTML = '<span>Select line</span><span class="vt-x">✕</span>';
		hLayer = el('div', 'vt-handles');
		anchorLine = el('div', 'vt-anchorline');
		knob = el('div', null, 'vt-knob');
		knob.innerHTML = '<div class="vt-stem"></div><div class="vt-dot"></div><div class="vt-hit"></div>';
		hLayer.appendChild(anchorLine); hLayer.appendChild(knob);
		dragMask = el('div', 'vt-dragmask');
		root.appendChild(fab); root.appendChild(bar); root.appendChild(pill); root.appendChild(nub); root.appendChild(hLayer);
		document.body.appendChild(root); document.body.appendChild(dragMask);

		fab.addEventListener('click', function () { open = true; lsSet('VBS_cmdbar', '1'); applyState(true); });
		// pill: don't steal textarea focus before we read selection
		function pillTap(e) { e.preventDefault(); doSelectLine(); }
		pill.addEventListener('mousedown', pillTap);
		pill.addEventListener('touchstart', pillTap, { passive: false });
		nub.addEventListener('mousedown', function (e) { e.preventDefault(); cancelAutoPromote(); });
		nub.addEventListener('touchstart', function (e) { e.preventDefault(); cancelAutoPromote(); }, { passive: false });
		knob.addEventListener('touchstart', onKnobDown, { passive: false, capture: true });
		knob.addEventListener('mousedown', onKnobDown, { passive: false, capture: true }); // desktop CDP drag test
	}

	// ---------- bar content per context ----------
	function mkBtn(icon, label, key, opts) {
		var b = el('button', null, 'vt-btn' + (opts && opts.prim ? ' vt-prim' : ''));
		b.innerHTML = icon; b.setAttribute('aria-label', label); b.dataset.key = key;
		b.addEventListener('click', function () { onAction(key, b); });
		return b;
	}
	function mkDiv() { return el('div', null, 'vt-div'); }
	function mkSpacer() { return el('div', null, 'vt-spacer'); }

	function buildBar(ctx) {
		var keyCache = ctx + '|' + (redoAvail ? 'r' : '') + '|' + (open ? 'o' : '');
		if (keyCache === lastBarKey) return;
		lastBarKey = keyCache;
		bar.innerHTML = '';
		if (ctx === 'IDLE') {
			bar.appendChild(mkBtn(ICON.undo, 'Undo', 'undo'));
			if (redoAvail) bar.appendChild(mkBtn(ICON.redo, 'Redo', 'redo'));
			bar.appendChild(mkSpacer());
			var close = mkBtn(ICON.chevDown, 'Close', '__close');
			bar.appendChild(close);
		} else { // SELECTING
			bar.appendChild(mkBtn(ICON.extendUp, 'Extend up', 'extendUp', { prim: true }));
			bar.appendChild(mkBtn(ICON.extendDown, 'Extend down', 'extendDown', { prim: true }));
			bar.appendChild(mkDiv());
			bar.appendChild(mkBtn(ICON.undo, 'Undo', 'undo'));
			if (redoAvail) bar.appendChild(mkBtn(ICON.redo, 'Redo', 'redo'));
			bar.appendChild(mkDiv());
			bar.appendChild(mkBtn(ICON.outdent, 'Outdent', 'outdent'));
			bar.appendChild(mkBtn(ICON.indent, 'Indent', 'indent'));
			bar.appendChild(mkBtn(ICON.moveUp, 'Move up', 'moveUp'));
			bar.appendChild(mkBtn(ICON.moveDown, 'Move down', 'moveDown'));
			bar.appendChild(mkSpacer());
			var done = el('button', null, 'vt-done'); done.textContent = 'Done';
			done.addEventListener('click', function () { onAction('__done', done); });
			bar.appendChild(done);
		}
	}

	// ---------- actions ----------
	function pulse(b) { if (!b) return; b.classList.remove('vt-pulse'); void b.offsetWidth; b.classList.add('vt-pulse'); }
	function nudge(b) { if (!b) return; b.classList.remove('vt-nudge'); void b.offsetWidth; b.classList.add('vt-nudge'); }

	function onAction(key, btn) {
		if (key === '__close') { open = false; lsSet('VBS_cmdbar', '0'); applyState(true); return; }
		if (key === '__done') { exitSelect(); return; }
		if (key === 'undo') { fire(document.body, K.undo); redoAvail = true; pulse(btn); afterAction(); return; }
		if (key === 'redo') { fire(document.body, K.redo); pulse(btn); afterAction(); return; }

		// SELECTING-only structural/extend actions — require body focus + a live selection
		if (state !== 'SELECTING') { return; }
		if (document.activeElement && document.activeElement.tagName === 'TEXTAREA') { try { document.activeElement.blur(); } catch (e) { } }
		if (!getSel().length) { exitSelect(); return; }

		var before = selUids().length;
		fire(document.body, K[key]);
		redoAvail = redoAvail && (key === 'undo'); // any mutating action clears the redo branch
		if (key === 'indent' || key === 'outdent' || key === 'moveUp' || key === 'moveDown') redoAvail = false;
		pulse(btn);
		setTimeout(function () {
			var after = getSel();
			if (!after.length) { // indent on a single block can drop back to edit — re-promote to stay in select
				if (key === 'indent' || key === 'outdent') { promote(function () { afterAction(); }); return; }
				exitSelect(); return;
			}
			if ((key === 'extendUp' || key === 'extendDown') && after.length === before) nudge(btn); // hit doc edge
			afterAction();
		}, 140);
	}
	function afterAction() { lastBarKey = ''; buildBar(state); updateHandles(); }

	function doSelectLine() {
		var ta = document.activeElement;
		if (!isBlockTextarea(ta)) return;
		promote(function (ok) {
			if (ok) { applyState(true); }
			else { pill.classList.remove('vt-shake'); void pill.offsetWidth; pill.classList.add('vt-shake'); }
		});
	}
	function exitSelect() {
		fire(document.body, K.esc);
		setTimeout(function () {
			if (getSel().length) { try { var b = document.querySelector('.roam-article'); if (b) b.click(); } catch (e) { } }
			applyState(true);
		}, 60);
	}

	// ---------- positioning (visualViewport keyboard oracle) ----------
	function kbHeight() {
		var vv = window.visualViewport;
		if (!vv) return 0;
		return Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
	}
	function kbUp() { return kbHeight() > 60; }
	function reposition() {
		if (!root) return;
		root.style.setProperty('--vt-kb', kbHeight() + 'px');
		// keep BAR above a still-animating keyboard
		var kb = kbHeight();
		bar.style.transform = kb > 0 && state !== 'SELECTING' ? 'translateY(-' + kb + 'px)' : '';
		if (state === 'SELECTING') updateHandles();
	}
	function schedulePos() { if (rafPos) return; rafPos = requestAnimationFrame(function () { rafPos = 0; reposition(); }); }

	// ---------- handles ----------
	function hideHandles() { if (hLayer) hLayer.style.display = 'none'; }
	function lineHeightOf(node) {
		var t = node && node.querySelector('.rm-block-text');
		if (!t) return 24;
		var lh = parseFloat(getComputedStyle(t).lineHeight);
		return isFinite(lh) && lh > 8 ? lh : 24;
	}
	function rectOf(uid) {
		var node = uidNode(uid); if (!node) return null;
		var t = node.querySelector('.rm-block-text') || node;
		return { r: t.getBoundingClientRect(), node: node, lh: lineHeightOf(node) };
	}
	function updateHandles() {
		var sel = getSel();
		if (!sel.length) { hideHandles(); return; }
		hLayer.style.display = 'block';
		var uids = sel.map(function (x) { return x['block-uid']; });
		// anchor = first entry (getSelected returns [anchor, ...]); focus = the geometric far end
		var nodes = uids.map(function (u) { return { uid: u, info: rectOf(u) }; }).filter(function (x) { return x.info; });
		if (!nodes.length) { hideHandles(); return; }
		// sort by visual top
		nodes.sort(function (a, b) { return a.info.r.top - b.info.r.top; });
		var top = nodes[0].info, bot = nodes[nodes.length - 1].info;
		var anchorUid = uids[0];
		// the focus (movable) end is the one that is NOT the anchor; with 1 block it's the bottom
		var focusIsBottom = (anchorUid === nodes[0].uid) || nodes.length === 1;
		// KNOB at focus edge
		var kr = focusIsBottom ? bot.r : top.r;
		var lh = focusIsBottom ? bot.lh : top.lh;
		placeKnob(focusIsBottom, kr, lh);
		// cosmetic anchor line at the opposite edge
		var ar = focusIsBottom ? top.r : bot.r;
		anchorLine.style.display = 'block';
		anchorLine.style.left = (focusIsBottom ? ar.left : ar.right) + 'px';
		anchorLine.style.top = (focusIsBottom ? ar.top : ar.bottom - (focusIsBottom ? 0 : ar.height)) + 'px';
		anchorLine.style.height = ar.height + 'px';
		// simpler: anchor line spans the anchor block's left edge height
		anchorLine.style.top = ar.top + 'px';
		anchorLine.style.left = (focusIsBottom ? ar.left : ar.right) + 'px';
	}
	function placeKnob(bottom, r, lh) {
		var x = bottom ? r.right : r.left;
		var yEdge = bottom ? r.bottom : r.top;
		knob.style.left = x + 'px';
		knob.style.top = yEdge + 'px';
		var stem = knob.querySelector('.vt-stem'), dot = knob.querySelector('.vt-dot');
		if (bottom) { // stem rises into block, knob below
			stem.style.height = lh + 'px'; stem.style.top = (-lh) + 'px';
			dot.style.top = '4px';
		} else {       // stem descends into block, knob above
			stem.style.height = lh + 'px'; stem.style.top = '0px';
			dot.style.top = (-15) + 'px';
		}
	}

	// ---------- drag (device-only-verifiable) ----------
	function evPoint(e) { var t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]) || e; return { x: t.clientX, y: t.clientY }; }
	function onKnobDown(e) {
		if (state !== 'SELECTING') return;
		e.preventDefault(); e.stopPropagation();
		var p = evPoint(e);
		drag = { startY: p.y, x: p.x, y: p.y, moved: false, lastTarget: null, busy: false };
		knob.setAttribute('data-grab', '1');
		dragMask.style.display = 'block';
		document.body.style.touchAction = 'none';
		window.addEventListener('touchmove', onKnobMove, { passive: false, capture: true });
		window.addEventListener('mousemove', onKnobMove, { passive: false, capture: true });
		window.addEventListener('touchend', onKnobUp, { passive: false, capture: true });
		window.addEventListener('mouseup', onKnobUp, { passive: false, capture: true });
		window.addEventListener('touchcancel', onKnobUp, { passive: false, capture: true });
		dragLoop();
	}
	function onKnobMove(e) {
		if (!drag) return;
		e.preventDefault();
		var p = evPoint(e); drag.x = p.x; drag.y = p.y;
		if (Math.abs(p.y - drag.startY) > 8) drag.moved = true;
	}
	function dragLoop() {
		if (!drag) return;
		if (drag.moved && !drag.busy) {
			var sel = getSel();
			if (!sel.length) { endDrag(); return; } // selection vanished — abort, never blind-emit
			// find block under finger
			hLayer.style.pointerEvents = 'none';
			var hit = document.elementFromPoint(drag.x, Math.max(2, Math.min(window.innerHeight - 2, drag.y)));
			var targetEl = hit && hit.closest ? hit.closest('.roam-block-container') : null;
			if (!targetEl) targetEl = drag.lastTarget;
			if (targetEl) {
				drag.lastTarget = targetEl;
				var list = allBlocks();
				var tIdx = list.indexOf(targetEl);
				// current focus index = the selected block furthest from anchor, in DOM order
				var uids = sel.map(function (x) { return x['block-uid']; });
				var idxs = uids.map(function (u) { var n = uidNode(u); return list.indexOf(n); }).filter(function (i) { return i >= 0; }).sort(function (a, b) { return a - b; });
				var anchorIdx = list.indexOf(uidNode(uids[0]));
				var focusIdx = (anchorIdx === idxs[0]) ? idxs[idxs.length - 1] : idxs[0]; // far end
				if (tIdx >= 0 && tIdx !== focusIdx) {
					var spec = tIdx > focusIdx ? K.extendDown : K.extendUp;
					drag.busy = true;
					fire(document.body, spec);
					setTimeout(function () { drag.busy = false; updateHandles(); }, 50);
				}
			}
		}
		drag.raf = requestAnimationFrame(dragLoop);
	}
	function endDrag() {
		if (!drag) return;
		if (drag.raf) cancelAnimationFrame(drag.raf);
		drag = null;
		knob.removeAttribute('data-grab');
		dragMask.style.display = 'none';
		document.body.style.touchAction = '';
		window.removeEventListener('touchmove', onKnobMove, { capture: true });
		window.removeEventListener('mousemove', onKnobMove, { capture: true });
		window.removeEventListener('touchend', onKnobUp, { capture: true });
		window.removeEventListener('mouseup', onKnobUp, { capture: true });
		window.removeEventListener('touchcancel', onKnobUp, { capture: true });
		updateHandles();
	}
	function onKnobUp(e) { if (e && e.preventDefault) e.preventDefault(); endDrag(); }

	// ---------- auto-promote (mode B, device-only-verifiable) ----------
	function onSelectionChange() {
		if (!autoPromoteOn()) return;
		var ta = document.activeElement;
		if (!isBlockTextarea(ta)) { clearAP(); return; }
		var full = ta.selectionStart === 0 && ta.selectionEnd === ta.value.length && ta.value.trim().length >= 2;
		if (!full) {
			if (apArmed && apTimer) { /* shrank — abort */ }
			clearAP(); apLastFull = false; return;
		}
		// require: grew INTO full on this gesture, a recent real touch, not in cooldown, not already handled for this focus
		var grewInto = !apLastFull; apLastFull = true;
		if (apArmed) return;
		if (Date.now() < apCooldown) return;
		if (apGuardUid === ta.id) return;
		if (Date.now() - apSawTouch > 800) return;     // provenance: a real touch select, not programmatic/Cmd+A/CDP
		if (!grewInto) return;
		apArmed = true;
		showNub();
		apTimer = setTimeout(function () { fireAutoPromote(ta); }, 380);
	}
	function showNub() { nub.style.display = 'inline-flex'; }
	function hideNub() { nub.style.display = 'none'; }
	function clearAP() { if (apTimer) { clearTimeout(apTimer); apTimer = null; } apArmed = false; hideNub(); }
	function cancelAutoPromote() { clearAP(); apCooldown = Date.now() + 1500; }
	function fireAutoPromote(ta) {
		clearAP();
		apGuardUid = ta.id;
		if (document.activeElement !== ta) return;
		promote(function (ok) { if (ok) applyState(true); });
	}

	// ---------- state machine ----------
	function ctxNow() {
		if (getSel().length) return 'SELECTING';
		var ae = document.activeElement;
		if (isBlockTextarea(ae) && kbUp()) return 'EDITING';
		return 'IDLE';
	}
	function applyState(force) {
		if (!added) return;
		var ctx = ctxNow();
		if (!force && ctx === state) {
			if (ctx === 'SELECTING') updateHandles();
			return;
		}
		state = ctx;
		fab.style.display = 'none'; bar.style.display = 'none'; pill.style.display = 'none'; hideHandles();
		bar.removeAttribute('data-anim');
		if (ctx === 'IDLE') {
			if (open) { buildBar('IDLE'); bar.style.display = 'flex'; }
			else { fab.style.display = 'flex'; }
		} else if (ctx === 'EDITING') {
			pill.style.display = 'inline-flex';
		} else if (ctx === 'SELECTING') {
			buildBar('SELECTING'); bar.style.display = 'flex'; bar.setAttribute('data-anim', 'in');
			updateHandles();
		}
		document.body.classList.toggle('vt-bar-open', bar.style.display !== 'none');
		reposition();
		if (doLog) console.log('[cmdbar]', state, 'sel=', selUids().length);
	}
	function scheduleSync() { if (rafSync) return; rafSync = requestAnimationFrame(function () { rafSync = 0; applyState(false); }); }

	// ---------- wiring ----------
	function start() {
		if (added) return;
		if (!enabled()) { if (doLog) console.log('[cmdbar] not a touch device / flutter app — idle'); return; }
		added = true;
		open = lsGet('VBS_cmdbar') === '1';
		injectStyle();
		build();
		ac = new AbortController(); var sig = ac.signal;
		document.addEventListener('focusin', scheduleSync, { capture: true, signal: sig });
		document.addEventListener('focusout', function () { setTimeout(scheduleSync, 60); }, { capture: true, signal: sig });
		document.addEventListener('selectionchange', onSelectionChange, { signal: sig });
		document.addEventListener('touchend', function (e) { var t = e.target; if (t && t.closest && t.closest('textarea')) apSawTouch = Date.now(); }, { capture: true, passive: true, signal: sig });
		// undo/redo shadow flag: any typing into a block clears the redo branch
		document.addEventListener('input', function (e) { if (isBlockTextarea(e.target)) redoAvail = false; }, { capture: true, signal: sig });
		if (window.visualViewport) {
			window.visualViewport.addEventListener('resize', function () { schedulePos(); scheduleSync(); }, { signal: sig });
			window.visualViewport.addEventListener('scroll', schedulePos, { signal: sig });
		}
		window.addEventListener('orientationchange', function () { setTimeout(function () { schedulePos(); scheduleSync(); }, 80); }, { signal: sig });
		window.addEventListener('scroll', function () { if (state === 'SELECTING') schedulePos(); }, { capture: true, passive: true, signal: sig });
		// body-class flips (bp3 overlays, theme) are cheap to watch and catch most state changes
		mo = new MutationObserver(scheduleSync);
		mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
		// Cheap poll (getSelected() read + 2 compares; applyState early-returns when unchanged) instead
		// of a heavy .roam-app subtree/attribute observer — Roam re-renders constantly. Also re-asserts
		// the <style> if Roam dropped it, and re-anchors handles for scroll/re-render while SELECTING.
		healTimer = setInterval(function () {
			if (!document.getElementById(STYLE_ID)) injectStyle();
			applyState(false);
			if (state === 'SELECTING' && !drag) updateHandles();
		}, 280);
		applyState(true);
		if (doLog) console.log('** cmdbar v0.1 installed **');
	}
	function stop() {
		if (!added) return; added = false;
		if (ac) { ac.abort(); ac = null; }
		if (mo) { mo.disconnect(); mo = null; }
		if (healTimer) { clearInterval(healTimer); healTimer = null; }
		endDrag(); clearAP();
		document.body.classList.remove('vt-bar-open');
		if (root && root.parentNode) root.parentNode.removeChild(root);
		if (dragMask && dragMask.parentNode) dragMask.parentNode.removeChild(dragMask);
		var st = document.getElementById(STYLE_ID); if (st) st.remove();
		root = fab = bar = pill = hLayer = knob = anchorLine = nub = dragMask = null;
		state = 'OFF';
		if (doLog) console.log('** cmdbar v0.1 STOPPED **');
	}

	start();
	return {
		isAdded: function () { return added; }, start: start, stop: stop,
		_state: function () { return { state: state, sel: selUids(), open: open, redoAvail: redoAvail, kb: kbHeight() }; },
		_force: function (v) { lsSet('VBS_force', v ? '1' : '0'); }
	};
})();
