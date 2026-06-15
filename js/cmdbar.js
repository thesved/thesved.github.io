/*
 * Viktor's Roam Mobile Command Bar — THE mobile toolbar (replaces Roam's native gray bar).
 * version: 0.6.1  (2026-06-15)  — KEYBOARD-RIDE, final piece (board Opus/Gemini/Codex + web research,
 *   UNANIMOUS): v0.6.0 was scroll/overscroll-immune (good) but left a CONSTANT gap under the bar when an
 *   input was focused (content showing through) — on iOS, focusing OFFSETS the layout viewport up by
 *   `vv.offsetTop` (it does NOT resize it), so the true kb height is `innerHeight − vv.height −
 *   vv.offsetTop`; v0.6.0's `innerHeight − vv.height` over-lifted by exactly offsetTop = the gap (large
 *   in Safari, ~0 in PWA). FIX: re-add offsetTop but LATCH it (frozenTop) only on a SETTLED resize/focus
 *   (double-rAF; WebKit #237851 reads 0 too soon) and reuse the constant in the heal — NEVER read live
 *   (rubber-band spikes it). offsetTop is stable during Roam's inner `.rm-article-wrapper` scroll, so
 *   frozen value + still-NO scroll listener = correct flush position AND scroll/overscroll immunity.
 * version: 0.6.0  (2026-06-15)  — KEYBOARD-RIDE, root cause found (board Opus/Gemini/Codex + wide web
 *   research, UNANIMOUS): the `vv.offsetTop` term was the single root cause of EVERY keyboard-ride bug
 *   (code-block sink in v0.5.7; AND the scroll-coupled gap users saw after v0.5.8/0.5.9 — Gemini video:
 *   the bar rode the page scroll + climbed on rubber-band overscroll, gap depended on whether the focus
 *   auto-scrolled the page). On iOS, `position:fixed` anchors to the LAYOUT viewport (the keyboard only
 *   OVERLAYS it; innerHeight stays full); the keyboard's on-screen height is the SCROLL-INVARIANT
 *   `innerHeight − vv.height`. `vv.offsetTop` is a PAN artifact (shifts on pan/overscroll/reveal-scroll)
 *   — folding it into the lift made the bar chase scroll and a reveal-scroll spike sink it. FIX: revert
 *   to `bottom:0` + a STATIC `translateY(−(kb+GAP))`, `kb = max(0, innerHeight − vv.height)`; DROP the
 *   `vv 'scroll'` listener and the offsetTop term and the whole top:0/dockH machinery (v0.5.8/0.5.9).
 *   The compositor now keeps the bar pinned through scroll/overscroll with zero JS lag. iOS 26 #297779
 *   dismiss residue absorbed by the ≤30→0 clamp. Reverted v0.5.8/0.5.9 (superseded).
 * version: 0.5.9  (2026-06-15)  — KEYBOARD-RIDE follow-up: v0.5.8 left a CONSTANT gap (= safe-area
 *   inset) between the bar and the keyboard when a field was focused (both normal + code; iPhone-only,
 *   invisible on desktop where safe-area=0). Board (Opus/Gemini/Codex unanimous): `measureDock()` read
 *   `bar.offsetHeight` while `data-kb="down"` → 48 + safe-area (the bar carries the home-indicator
 *   padding ONLY when down); `place()` then flipped to "up" (bar→48) but reused the cached padded
 *   height → bar floated safe-area+GAP above the kb. Fix: place() flips `data-kb` FIRST, then re-measures
 *   ON THE FLIP (not per frame) so dockH always matches the current rendered height. CDP-verified with a
 *   simulated 34px safe-area: down→up gap collapses 42px→8px; down stays flush at the screen bottom.
 * version: 0.5.8  (2026-06-15)  — KEYBOARD-RIDE fix: the bar sank BEHIND the keyboard when tapping
 *   into a CM6 code block (correct for normal blocks). Root cause (board Opus/Gemini/Codex unanimous +
 *   Gemini video): a CM6 tap focuses the contentEditable NATIVELY → WebKit reveal-scrolls the visual
 *   viewport (offsetTop>0); the old bottom:0 base + translateY(−overlap) anchors to the LAYOUT viewport
 *   (which doesn't shift) → subtracting offsetTop under-lifted the bar. Fix: anchor the dock from
 *   top:0 and translateY to the VISUAL-viewport bottom (vv.offsetTop+vv.height−dockH−GAP) — offsetTop
 *   additive, immune to reveal-scroll. Plus settlePlace() re-samples across the keyboard/scroll settle
 *   window (no 'resize' fires on a block→code switch) and the heal interval re-places continuously.
 * version: 0.5.7  (2026-06-15)  — CODE-BLOCK move/select FIDELITY (3 bugs, all CDP-ground-truthed):
 *   (1) move now replicates Roam's NATIVE visible-outline traversal — a code block CROSSES into the
 *   parent's adjacent sibling at a boundary (last child + parent has next sibling → that sibling's first
 *   child; symmetric up), instead of being stuck within its parent. Roam never descends into an expanded
 *   sibling nor pops to a grandparent — verified across every boundary. (2) the full selection RANGE
 *   {anchor,head} is now saved + restored on EVERY move (was head-only + skipped on move-down) → ranges
 *   survive move-down/indent/outdent (not just move-up). (3) SELECT is INSTANT — codeSelect fires Escapes
 *   at the CM6 contentDOM and stops the moment it's selected, dropping v0.5.6's exit-poll + 120ms settle +
 *   separate promote Esc. See learnings/2026-06-15-cmdbar-codeblock-ops.md.
 * version: 0.5.6  (2026-06-15)  — CODE-BLOCK ops are now INSTANT + cursor-preserving via DIRECT
 *   graph mutation (roamAlphaAPI.moveBlock), replacing v0.5.5's slow (~1.2s) CM6→textarea exit dance
 *   that also dropped the in-code cursor. Same-parent move keeps the CM6 instance (focus+caret survive);
 *   reparent (indent/outdent) remounts CM6 → refocus + restore caret offset. SELECT still exits CM6
 *   (no selection-setter API). Also: ride the keyboard on CM6 focus too (bar sat below the kb in code
 *   blocks). Caret/selection visibility on iOS = roamCSS.css (caret-color was transparent). See
 *   learnings/2026-06-15-cmdbar-codeblock-ops.md.
 * version: 0.5.5  (2026-06-15)  — CODE-BLOCK ops now work. CM6 doesn't plug into Roam's block
 *   keyboard/focus/selection layer (getFocusedBlock()===null; synthetic Esc/Tab/Cmd+Shift+Arrow never
 *   reach Roam; no selection API) → select/indent/outdent/move all no-op'd in a code block. Fix: on
 *   such an op, exit CM6 to the raw block-input TEXTAREA via the CM6 EditorView (.cm-content.cmView.view
 *   → focus → Escape at contentDOM = Roam's own behavior), then run the op through the unchanged
 *   normal-block paths. See learnings/2026-06-15-cmdbar-codeblock-ops.md.
 * v0.5.4  (2026-06-15)  — selection WORKSPACE scoping: `uidNode` resolves a uid to its
 *   CANONICAL outline render (NOT a linked-reference/embed render — querySelector returned the ref
 *   render that sits above the source page on a DNP → knob landed on another page's references);
 *   `blocksIn` + `dragTarget` exclude `.rm-reference-main`/`.rm-reference-container` so extend/drag
 *   no longer jump the selection into the linked-references section. (CSS: `.bp3-text-small` opacity
 *   no longer dims the bullet context menu.) See learnings/2026-06-15-cmdbar-workspace-scoping.md.
 * v0.5.3  (2026-06-15)  — selection handles (knob/tick/chip) RE-PARENTED into the scroll
 *   container as position:absolute in CONTENT coords: the compositor scrolls them in lockstep with the
 *   blocks (zero JS on scroll → no jitter), they live inside #app below the topbar and are clipped by the
 *   scroller's overflow (z-index solved STRUCTURALLY, no clip-path), and per-call DOM writes are change-
 *   guarded (setS/setTxt). Dropped the window scroll listener (was the shake source). inRoot() now counts
 *   #vt-handles so the knob drag still routes. See learnings/2026-06-15-cmdbar-handles-compositor-scroll.md.
 * v0.5.2  (2026-06-15)  — desktop is now a SETTING (window.ViktorOpts.cmdbarDesktop=true;
 *   VBS_force kept as legacy override). 0.5.1: desktop/wide bar = CENTERED COMPACT PILL; mobile (<=600) edge-to-edge.
 * v0.5.0  — extend ↑/↓ = native iOS Shift+Arrow (anchor fixed, focus edge derived
 *   LIVE each press from selExtent vs anchor — no stored focus); collapse-to-single is KEYBOARD-FREE via
 *   native Shift+Arrow toward the anchor (plain-click focus flashed the iOS keyboard). extShrink guards the
 *   async collapse window. See learnings/2026-06-14-cmdbar-selection-colonmenu-nativescroll.md.
 * version: 0.4.3  (2026-06-12)  — count chip anchors to the KNOB (measured width + mirrored
 *   8px gap), fixing the chip drifting ~17px left of the dot when extending the selection upward
 * v0.4.2 — divider right of [⌫] (was visually glued to [Done]);
 *   hidden flex items no longer contribute the bar's 1px gap (⌫ sat asymmetric between dividers)
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
 *   EDITING   — block textarea focused:  [Select] │ [⇤][⇥][↑][↓][↶][↷*] │ [[[ ] [✓] [img] [/]
 *               (no dismiss button — the OS accessory ✓ already does that; ↷ appears only when
 *               redo is available and then borrows the [img] slot — 390pt budget).
 *   SELECTING — ≥1 block selected (keyboard down by nature): [+↑][+↓] │ [⇤][⇥][↑][↓][↶] │ [⌫] │ ─ [Done]
 *               + ONE live knob at the selection's focus edge (anchor gets a cosmetic tick),
 *               count chip rides the knob, extends auto-repeat on hold, edge auto-scroll.
 *   Shared middle [⇤][⇥][↑][↓][↶] never moves between forms (shared-element morph; buttons are
 *   built ONCE and toggled via CSS — nothing is ever rebuilt under a finger).
 *
 * Engine v0.4 — ABSOLUTE SELECTION (the big simplification, live-verified 2026-06-12):
 *   A synthetic (untrusted) shift-click on a block's content div makes Roam compute the selection
 *   as anchor..target ABSOLUTELY: replaces any previous extension, native subtree closure, both
 *   directions, idempotent on repeat. That one primitive (assertRange) now drives the knob drag,
 *   the extend buttons and gap healing — the v0.3 keyboard stepping (Shift+Arrow per block with
 *   coverage tests, seen-set oscillation guards and settle polling) is GONE; it no-oped at subtree
 *   boundaries (bricked drags through a parent's children — iPhone video, HUD-confirmed) and could
 *   resurrect Roam's remembered selection. Esc keydowns remain only for promote (Select) and as
 *   clear fallback; editing ops still proxy-click the hidden native bar.
 *
 * v0.4 (2026-06-12, night — evidence: 2 iPhone videos w/ HUD + 11 live CDP isolation tests):
 *   - THE DANCE root cause: v0.3 ensureClean demanded promote == exactly [seed]; a parent's
 *     LEGIT subtree promote (Roam enumerates parent+descendants) was misread as a memory-merge
 *     → shrink-walk (which no-ops on subtree sets) → Esc-clear/refocus/re-promote loop → the
 *     highlight flashed on/off ~1.6s and "danced". Fix: subtreeOk() accepts seed ∪ descendants
 *     (DOM containment; a selected uid with NO DOM node = collapsed descendant = inside).
 *   - Promote heal (real memory-union): ONE assertRange(seed) → verify → ONE clear+refocus+
 *     re-promote → verify → else HONEST FAILURE (clear + shake, never accept foreign blocks —
 *     a foreign selection is one [⌫] away from deleting unrelated content, and never loop).
 *   - Knob drag: absolute shift-click on the block under the finger (throttled 120ms, retry ≤4
 *     per target until the extent covers it, embed containers resolve to their HOST block,
 *     scope = the anchor's article). Final assert at dragEnd (fast flick inside the throttle
 *     window must not under-select). Autoscroll grammar from v0.3 kept verbatim.
 *   - Extend buttons: absolute too — target = block before/after the current DOM extent,
 *     assertRange(target), keyboard Shift+Arrow only as one-shot fallback (page boundaries /
 *     virtualized targets). Auto-repeat is now safe (idempotent).
 *   - healGaps: gap ⇒ ONE assertRange(working-edge extent) re-asserts anchor..edge contiguity;
 *     persists ⇒ reset ladder (clear+refocus+re-promote, honest-exit). No more shrink-walk.
 *   - Seed invariant: seedUid tracked from promote; if it ever leaves the selection (Roam's
 *     internal anchor drifted — the state the memory bug corrupts) ⇒ reset ladder.
 *   - Done: plain synthetic click on safe whitespace (article corner / topbar gap) clears the
 *     multiselect WITHOUT Esc — live-verified — so Roam's selection memory is never primed on
 *     the main path; Esc stays as fallback.
 *   - SHIELD: our own synthetic page-targeted events are tagged (ev.__vt) and exempted FIRST —
 *     v0.3's drag-ownership clause would have eaten our own shift-click mouseup mid-drag.
 *   - Handles: tick/knob/chip SNAP on a new selection session (no more blue line flying in from
 *     the previous selection's position — the user's "animated from above/below" artifact #3);
 *     transitions enabled only within a live session. Knob crossing animation state reset too.
 *   - Buttons: `((` replaced by [✓] todo (proxy .zmdi-check-square, fallback inserts
 *     {{[[TODO]]}}) and [img] media upload (proxy .bp3-icon-media, no fallback — contract-drift
 *     badge covers). 390pt: .vt-b min-width 33→30, divider margins 3→2px, redo⇄media slot-share.
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
	var open = false, ctx = 'OFF', redoAvail = false, editingCode = false;
	var kbAnimUntil = 0;              // while now()<this, dock transitions (focus/blur moments only)
	var gesture = null, drag = null;  // shield gesture state
	var dragGuardUntil = 0;           // eat the ghost mouseup/click that trails a knob release
	var prevFocusBottom = null, crossT = null; // knob crossing detector
	var lastEdge = 'bottom';          // which end of the selection the user is working (knob side)
	var healing = false;              // re-entrancy guard for heal/ladder
	var seedUid = null, seedWin = null; // the promoted anchor (invariant: stays in the selection)
	var extShrink = false;            // collapse-to-single in flight: owns its async window (re-entrancy + ctx guard)
	var contract = { ok: true, missing: [] };
	var logRing = [];
	var lastSelN = 0;

	// ---------- utils ----------
	function now() { return Date.now(); }
	function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
	function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { } }
	function isFlutter() { return typeof window.FlutterCurrentGraphChannel !== 'undefined'; }
	function isTouch() { return !!(navigator.maxTouchPoints > 0 || ('ontouchstart' in window)); }
	function opts() { return window.ViktorOpts || {}; }
	// Touch (non-Flutter) always gets the bar. On DESKTOP it's opt-in via the loader-block setting
	// window.ViktorOpts.cmdbarDesktop = true (legacy localStorage VBS_force === '1' still honored).
	function desktopOptIn() { return opts().cmdbarDesktop === true || lsGet('VBS_force') === '1'; }
	function enabled() { return (isTouch() && !isFlutter()) || desktopOptIn(); }
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
	// Roam code blocks are CodeMirror 6 (a contenteditable .cm-content, NOT a block-input textarea), so
	// focusing one isn't isBlockTextarea — but you ARE editing a block. Treat it as EDITING so the bar
	// shows indent/outdent/move/etc. (the ops proxy to Roam's native bar, same as a normal block).
	function inCodeBlock(el) { return !!(el && el.closest && el.closest('.rm-code-block')); }
	// A uid can render in MANY DOM places — its canonical outline block AND, simultaneously, linked-
	// reference renders, breadcrumbs, embeds (each a separate window-id, same `-<uid>` id suffix). The
	// plain `querySelector` returned the FIRST match, which on a DNP is the linked-reference render
	// (it sits ABOVE the source page in the log) → the knob landed on the wrong instance / another
	// page's references. Resolve to the CANONICAL render: the one NOT inside a reference/embed section.
	// Fall back to the first hit if the source page isn't in the DOM (only a reference is visible).
	function isRefOrEmbed(c) { return !!(c.closest('.rm-reference-main') || c.closest('.rm-reference-container') || c.closest('.rm-embed-container')); }
	function uidNode(uid) {
		var nodes = document.querySelectorAll('[id$="-' + uid + '"]'), fallback = null;
		for (var i = 0; i < nodes.length; i++) {
			var c = nodes[i].closest('.roam-block-container');
			if (!c) continue;
			if (!fallback) fallback = c;
			if (!isRefOrEmbed(c)) return c;
		}
		return fallback;
	}
	function scroller() { return document.querySelector('.rm-article-wrapper') || document.scrollingElement; }
	// selection workspace scoping: the anchor's article (log/page or right-sidebar window);
	// embed-inner containers belong to a FOREIGN page — never addressable, never gap-relevant
	function articleOf(node) {
		return (node && node.closest && (node.closest('.roam-article') || node.closest('#roam-right-sidebar-content')))
			|| document.querySelector('.roam-article') || document.body;
	}
	function blocksIn(scope) {
		// the workspace is the OUTLINE only — exclude embeds, our own UI, and (the bug) linked/unlinked
		// REFERENCE sections. They are a different window: extending into them made Roam reset the
		// multiselect to just the reference block ("selection jumps to the reference").
		return Array.prototype.slice.call(scope.querySelectorAll('.roam-block-container')).filter(function (n) {
			return !n.closest('.rm-embed-container') && !n.closest('#' + ROOT_ID)
				&& !n.closest('.rm-reference-main') && !n.closest('.rm-reference-container');
		});
	}

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
			// code blocks: Esc fired AT the CM6 editor is swallowed; fire at window so Roam's global handler
			// exits edit + selects the WHOLE block (verified — CM6 doesn't get the synthetic Esc otherwise).
			fire(inCodeBlock(document.activeElement) ? window : (document.activeElement || window), K.esc);
			setTimeout(function () {
				if (getSel().length) { cb(true); return; }
				if (++tries < 4) attempt(); else cb(false);
			}, 150);
		})();
	}

	// ---------- absolute selection engine (ONE primitive) ----------
	// A synthetic shift-click makes Roam compute anchor..target ABSOLUTELY (live-verified:
	// replaces previous extension, native subtree closure, idempotent, works upward, works on
	// ancestors, safe on the anchor itself). Tagged __vt so our own shield never eats it.
	function contentEl(cont) {
		return cont.querySelector('.rm-block-main .roam-block') ||
			cont.querySelector('.rm-block-main div[id^="block-input"]') ||
			cont.querySelector('.rm-block-main') || cont;
	}
	function tagged(el, types, opts) {
		types.forEach(function (t) {
			var ev = new MouseEvent(t, opts);
			ev.__vt = 1;
			el.dispatchEvent(ev);
		});
	}
	function assertRange(target) {   // target: container element or uid
		var cont = typeof target === 'string' ? uidNode(target) : target;
		if (!cont) return false;
		var el = contentEl(cont);
		var r = el.getBoundingClientRect();
		if (!r.width && !r.height) return false;
		tagged(el, ['mousedown', 'mouseup', 'click'], {
			bubbles: true, cancelable: true, view: window, shiftKey: true, button: 0,
			clientX: r.left + Math.min(20, Math.max(2, r.width / 2)),
			clientY: r.top + Math.min(10, Math.max(2, r.height / 2))
		});
		return true;
	}
	// plain (no-shift) click on a block's content ⇒ exits multiselect + focuses that block.
	function focusBlock(uid) {
		var cont = uidNode(uid); if (!cont) return false;
		var el = contentEl(cont), r = el.getBoundingClientRect();
		if (!r.width && !r.height) return false;
		tagged(el, ['mousedown', 'mouseup', 'click'], {
			bubbles: true, cancelable: true, view: window, button: 0,
			clientX: r.left + Math.min(20, Math.max(2, r.width / 2)),
			clientY: r.top + Math.min(10, Math.max(2, r.height / 2))
		});
		return true;
	}
	// set the multiselect to EXACTLY {uid}. assertRange can't do this — a shift-click on the anchor
	// itself no-ops — so focus the block then promote it back to a one-block selection.
	function selectSingle(uid, cb) {
		if (!focusBlock(uid)) { cb && cb(false); return; }
		setTimeout(function () { promoteRaw(function (ok) { cb && cb(ok); }); }, 60);
	}

	// DOM-order extent of the current selection + gaps not explained by subtree containment
	function selExtent() {
		var sel = getSel();
		if (!sel.length) return null;
		var first = null;
		for (var f = 0; f < sel.length && !first; f++) first = uidNode(sel[f]['block-uid']);
		if (!first) return null;
		var scope = articleOf(first);
		var list = blocksIn(scope);
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
		return { scope: scope, list: list, min: min, max: max, minUid: minUid, maxUid: maxUid, gaps: gaps };
	}

	// ---------- promote + selection-memory countermeasures ----------
	// Promoting a PARENT legitimately selects the whole subtree (Roam enumerates every visible
	// descendant; collapsed descendants may be in the set with no DOM node). v0.3 treated that as
	// a memory-merge and "healed" it into an Esc on/off dance — THE bug. Acceptance is now:
	// seed ∈ selection AND every selected node is seed's container or inside it (null node ⇒
	// collapsed descendant ⇒ inside).
	function subtreeOk(uid) {
		var sel = getSel(); if (!sel.length) return false;
		var host = uidNode(uid); if (!host) return false;
		var hasSeed = false;
		var ok = sel.every(function (s) {
			if (s['block-uid'] === uid) { hasSeed = true; return true; }
			var n = uidNode(s['block-uid']);
			return !n || host.contains(n);
		});
		return ok && hasSeed;
	}
	// promote with decisive, non-looping heal. NEVER accepts foreign blocks (a foreign selection
	// is one [⌫] away from deleting unrelated content) and NEVER dances (each rung runs ONCE).
	function promote(cb) {
		var fb = null;
		try { fb = api().ui.getFocusedBlock(); } catch (e) { }
		var uid = fb && fb['block-uid'], win = fb && fb['window-id'];
		// code blocks: getFocusedBlock() is often stale (focus is CM6, not a block textarea) → trust the DOM uid
		if (inCodeBlock(document.activeElement)) {
			var cc = document.activeElement.closest('.roam-block-container');
			var du = cc && cc.dataset ? cc.dataset.blockUid : null;
			if (du) uid = du;
		}
		if (!uid) { cb(false); return; }
		promoteRaw(function (ok) {
			if (!ok) { cb(false); return; }
			if (subtreeOk(uid)) { seedUid = uid; seedWin = win; cb(true); return; }
			log('promote union ' + getSel().length + ' — heal: assertRange(seed)');
			assertRange(uid);
			setTimeout(function () {
				if (subtreeOk(uid)) { seedUid = uid; seedWin = win; cb(true); return; }
				log('heal 1 failed — clear+refocus+re-promote');
				fire(window, K.esc);
				setTimeout(function () {
					try { api().ui.setBlockFocusAndSelection({ location: { 'block-uid': uid, 'window-id': win || 'log-outline' } }); } catch (e) { }
					setTimeout(function () {
						promoteRaw(function (ok2) {
							if (ok2 && subtreeOk(uid)) { seedUid = uid; seedWin = win; cb(true); return; }
							log('promote heal failed — honest exit');
							if (getSel().length) fire(window, K.esc);   // never leave a foreign selection armed
							cb(false);
						});
					}, 400);
				}, 160);
			}, 250);
		});
	}
	// shared honest-failure path: clear + refocus seed + one re-promote; still bad ⇒ clear + shake
	function resetLadder(reason) {
		if (healing || !seedUid) return;
		healing = true;
		log('reset ladder (' + reason + ')');
		fire(window, K.esc);
		setTimeout(function () {
			try { api().ui.setBlockFocusAndSelection({ location: { 'block-uid': seedUid, 'window-id': seedWin || 'log-outline' } }); } catch (e) { }
			setTimeout(function () {
				promoteRaw(function (ok) {
					if (!ok || !subtreeOk(seedUid)) {
						if (getSel().length) fire(window, K.esc);
						shake(btns.select);
					}
					healing = false;
					lastSelN = getSel().length;
					applyCtx(true);
				});
			}, 350);
		}, 160);
	}
	// seed invariant: the anchor must stay inside the selection (extends and absolute clicks
	// always include it). Seed gone ⇒ Roam's internal anchor drifted (memory bug) ⇒ ladder.
	function seedCheck(reason) {
		if (ctx !== 'SELECTING' || !seedUid || healing) return;
		if (!getSel().length) return;
		if (selUids().indexOf(seedUid) >= 0) return;
		log('seed left selection (' + reason + ')');
		resetLadder('seed:' + reason);
	}
	// gap healing: an illegitimate gap means a stale remembered set got unioned in. ONE absolute
	// re-assert of the working edge rebuilds anchor..edge contiguously; if the gap survives that,
	// the anchor itself is suspect → reset ladder. (Never bridge: gaps span unrelated content.)
	function healGaps(reason) {
		if (healing || ctx !== 'SELECTING') return;
		var gi = selExtent();
		if (!gi || !gi.gaps.length) return;
		log('GAP (' + reason + '): ' + gi.gaps.length + ' — re-assert edge');
		assertRange(lastEdge === 'top' ? gi.minUid : gi.maxUid);
		setTimeout(function () {
			var g2 = selExtent();
			if (g2 && g2.gaps.length) { resetLadder('gap:' + reason); return; }
			lastSelN = getSel().length;
			updateHandles();
		}, 200);
	}
	// Done without Esc: a plain click on safe whitespace clears the multiselect (live-verified)
	// WITHOUT priming Roam's selection memory. Esc remains the fallback.
	function clearByClick() {
		var pts = [];
		var art = document.querySelector('.roam-article');
		if (art) {
			var r = art.getBoundingClientRect();
			pts.push([r.right - 24, r.top + 8], [r.left + 24, r.top + 8]);
		}
		var tb = document.querySelector('.rm-topbar');
		if (tb) { var t = tb.getBoundingClientRect(); pts.push([t.left + t.width / 2, t.top + t.height / 2]); }
		for (var i = 0; i < pts.length; i++) {
			var el = document.elementFromPoint(pts[i][0], pts[i][1]);
			if (!el) continue;
			if (el.closest('.roam-block-container,a,button,input,textarea,[contenteditable],.rm-title-display,.bp3-button,#' + ROOT_ID)) continue;
			tagged(el, ['mousedown', 'mouseup', 'click'], {
				bubbles: true, cancelable: true, view: window, button: 0,
				clientX: pts[i][0], clientY: pts[i][1]
			});
			return true;
		}
		return false;
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
			var ev = new MouseEvent(t, { bubbles: true, cancelable: true, view: window });
			ev.__vt = 1;
			b.dispatchEvent(ev);
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
		todo: { icon: '.zmdi-check-square' },
		media: { icon: '.bp3-icon-media' },
		wikilink: { text: '[[' },
		blockref: { text: '((' },                            // unused in the bar; still contract-watched
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
	// Collapse the multiselect back to the single anchor block WITHOUT focusing its textarea — a
	// focus would mount edit mode and FLASH the iOS soft keyboard mid-shrink (the reported bug).
	// Native Shift+Arrow TOWARD the anchor reduces the block-select in place (no edit mode); we
	// verify it landed on the anchor (its own subtree), stepping again for deep subtrees, and only
	// fall back to focus+promote (which flashes the keyboard) if the keyboard-free path stalls.
	function collapseToAnchor(dirDown) {
		extShrink = true;
		lastEdge = 'bottom';
		var key = dirDown ? K.extendDown : K.extendUp;   // the press direction already points at the anchor
		var t0 = now(), tries = 0, prevLen = getSel().length;
		function clearLater() {                          // hold extShrink past act()'s +220ms follow-up (no spurious nudge)
			var wait = Math.max(40, 240 - (now() - t0));
			setTimeout(function () { extShrink = false; }, wait);
		}
		function finish() { lastSelN = getSel().length; updateHandles(); clearLater(); }
		function fallback() {                            // keyboard-free path stalled — accept the flash
			var sd = seedUid, sw = seedWin;
			selectSingle(sd, function () {
				seedUid = sd; seedWin = sw;             // restore (belt; applyCtx's extShrink guard prevents the wipe)
				lastSelN = getSel().length;
				applyCtx(true);
				clearLater();
			});
		}
		(function step() {
			if (subtreeOk(seedUid)) { finish(); return; }            // reduced to just the anchor (+ its own subtree)
			if (tries >= 6) { fallback(); return; }
			fire(window, key);
			tries++;
			setTimeout(function () {
				var len = getSel().length;
				if (!len) { fallback(); return; }                                    // native overshot to empty → recover now
				if (!subtreeOk(seedUid) && len === prevLen) { fallback(); return; }   // native won't shrink further
				prevLen = len;
				step();
			}, 90);
		})();
	}
	// Shift+Arrow semantics: the anchor (seedUid) is FIXED; the MOVING edge is the extent side away
	// from the anchor — DERIVED LIVE each press (never stored), so it can't go stale on autorepeat,
	// after a drag, or when Roam's subtree closure re-expands the range. A press toward the anchor
	// SHRINKS; landing on/across the anchor (or a shrink that makes no progress because a subtree
	// re-closed) collapses to the single anchor block.
	function extendAbs(dirDown) {
		if (extShrink) return;                                  // collapse owns its window — ignore re-entrant repeats
		var gi = selExtent();
		if (!gi) { fire(window, dirDown ? K.extendDown : K.extendUp); return; }
		var anchorNode = seedUid ? uidNode(seedUid) : null;
		var anchorIdx = anchorNode ? gi.list.indexOf(anchorNode) : -1;
		var focusSide;                                          // which extent edge is the moving focus
		if (anchorIdx < 0) focusSide = (lastEdge === 'top') ? 'min' : 'max';   // anchor unrendered: trust knob side
		else if (gi.min === gi.max) focusSide = dirDown ? 'max' : 'min';        // single block: the press picks a side
		else if (anchorIdx <= gi.min) focusSide = 'max';                        // anchor at top → focus is bottom edge
		else if (anchorIdx >= gi.max) focusSide = 'min';                        // anchor at bottom → focus is top edge
		else focusSide = (lastEdge === 'top') ? 'min' : 'max';                  // anchor interior (rare): trust knob side
		var growing = dirDown ? (focusSide === 'max') : (focusSide === 'min');
		var nidx = growing
			? (focusSide === 'max' ? gi.max + 1 : gi.min - 1)   // grow outward, past any subtree at the edge
			: (focusSide === 'max' ? gi.max - 1 : gi.min + 1);  // shrink inward toward the anchor
		// shrinking onto / across the anchor ⇒ collapse to the single anchor block
		if (!growing && anchorIdx >= 0 && (focusSide === 'max' ? nidx <= anchorIdx : nidx >= anchorIdx)) {
			collapseToAnchor(dirDown); return;
		}
		if (nidx < 0 || nidx >= gi.list.length) { nudge(btns[dirDown ? 'extendDown' : 'extendUp']); return; }
		lastEdge = focusSide === 'max' ? 'bottom' : 'top';
		var target = gi.list[nidx];
		var pre = gi.min + ':' + gi.max + ':' + getSel().length;
		assertRange(target);
		setTimeout(function () {
			if (extShrink) return;                               // a collapse started meanwhile — it owns the window
			var g2 = selExtent();
			var post = g2 ? g2.min + ':' + g2.max + ':' + getSel().length : '';
			if (post === pre) {                                  // no progress
				if (!growing) collapseToAnchor(dirDown);         // a subtree re-closed → don't get stuck, collapse
				else fire(window, dirDown ? K.extendDown : K.extendUp);   // grow boundary → one-shot legacy fallback
			}
		}, 150);
	}
	// ---------- code-block (CodeMirror 6) bridge ----------
	// CM6 does NOT plug into Roam's block keyboard/focus/selection layer: getFocusedBlock() returns
	// null, synthetic Esc/Tab/Cmd+Shift+Arrow never reach Roam's handlers, and there is no selection
	// API — so select/indent/outdent/move ALL no-op inside a code block (the old proxy-to-native-bar
	// path is absent on desktop and dead on mobile). Roam's OWN answer (what a real Escape does) is to
	// exit CM6 to the block's raw block-input TEXTAREA. We drive exactly that via the CM6 EditorView
	// (reachable at .cm-content.cmView.view): focus it, then dispatch Escape at its contentDOM. Once
	// it is a normal textarea, EVERY normal-block path (select/indent/outdent/move) works unchanged.
	function codeView(el) {
		var cb = el && el.closest && el.closest('.rm-code-block');
		var cm = cb && cb.querySelector('.cm-content');
		return (cm && cm.cmView && cm.cmView.view) || null;
	}
	// window-id from the DOM (getFocusedBlock is null for CM6) — parse `block-input-<win>-<uid>`.
	function winOf(uid) {
		var c = uidNode(uid); if (!c) return null;
		var el = c.querySelector('[id^="block-input-"]'); if (!el) return null;
		var pre = 'block-input-';
		return el.id.slice(pre.length, el.id.length - uid.length - 1) || null;
	}
	// FAST code-block → multiselect. Roam selects a code block ONLY via Escapes at the CM6 contentDOM —
	// Esc-at-window is a no-op while CM6 holds focus (CDP-verified). Sequence (≈45ms apart): esc#1 CM6
	// clears its own selection, esc#2 exit to the raw textarea, esc#3 select the block. We poll getSel and
	// STOP the instant it's selected — no fixed exit poll + 120ms settle + separate promote Esc (the old
	// path). Fire at the contentDOM while still in CM6, then at the (now) textarea/activeElement.
	function codeSelect(cb) {
		var v = codeView(document.activeElement);
		if (!v) { cb && cb(getSel().length > 0); return; }
		var d = v.contentDOM, tries = 0;
		(function step() {
			if (getSel().length) { cb && cb(true); return; }
			var inCM = document.activeElement && document.activeElement.closest && document.activeElement.closest('.cm-content');
			fire(inCM ? d : (document.activeElement || window), K.esc);
			if (++tries >= 5) { setTimeout(function () { cb && cb(getSel().length > 0); }, 50); return; }
			setTimeout(step, 45);
		})();
	}

	// ---------- DIRECT graph ops for code blocks (replaces the slow CM6→textarea exit) ----------
	// The old code path EXITED CM6 to the raw block-input textarea (2 Escapes + poll + ~120ms settle ≈
	// 1.2s on device — user-confirmed via Gemini video) then proxied Roam's native bar. That was slow
	// AND it dropped the user's in-code cursor (the block left edit mode). roamAlphaAPI.moveBlock mutates
	// the tree with NO focus change. CDP-verified 2026-06-15 (dark, real graph): a SAME-PARENT move keeps
	// the SAME CM6 EditorView instance → focus + caret offset survive untouched; a REPARENT (indent/
	// outdent) REMOUNTS CM6 (focus→<body>, caret→0) → we refocus the new view + restore the offset.
	// moveBlock order quirk (CDP-verified): same-parent move-DOWN target = order cur+2 (cur+1 NO-OPS —
	// Roam counts the block's own slot); move-UP = cur-1; indent = under prev sibling at its child count
	// (append); outdent = under grandparent at parent-order+1. Top-level blocks: parent is the PAGE
	// entity (no :block/order, no :block/_children) → outdent guarded off, the rest still resolve.
	function blockInfo(uid) {
		try {
			// block → parent (siblings) → grandparent (uncles = parent's siblings, for cross-parent move)
			var r = api().pull('[:block/order {:block/_children [:block/uid :block/order {:block/children [:block/uid :block/order]} {:block/_children [:block/uid {:block/children [:block/uid :block/order]}]}]}]', [':block/uid', uid]);
			var par = r && r[':block/_children'] && r[':block/_children'][0];
			if (!par) return null;
			var O = r[':block/order'], sibs = par[':block/children'] || [], PO = par[':block/order'];
			var gpEnt = par[':block/_children'] && par[':block/_children'][0];
			var GP = gpEnt ? gpEnt[':block/uid'] : null, uncles = gpEnt ? (gpEnt[':block/children'] || []) : [];
			var prev = null, NS = null, PS = null;
			for (var i = 0; i < sibs.length; i++) if (sibs[i][':block/order'] === O - 1) prev = sibs[i][':block/uid'];
			// parent's adjacent siblings (PO undefined ⇒ parent is the PAGE ⇒ no uncles ⇒ no cross-move)
			if (PO != null) for (var j = 0; j < uncles.length; j++) {
				if (uncles[j][':block/order'] === PO + 1) NS = uncles[j][':block/uid'];
				else if (uncles[j][':block/order'] === PO - 1) PS = uncles[j][':block/uid'];
			}
			return { O: O, P: par[':block/uid'], PO: PO, GP: GP, prev: prev, sibCount: sibs.length, NS: NS, PS: PS };
		} catch (e) { return null; }
	}
	function childCount(uid) {
		try { var r = api().pull('[{:block/children [:block/uid]}]', [':block/uid', uid]); return (r && r[':block/children'] || []).length; } catch (e) { return 0; }
	}
	var codeBusy = false;   // serialize moves so press-and-hold auto-repeat can't out-run the datascript commit (race-free)
	// Replicate Roam's NATIVE visible-outline move (CDP-derived 2026-06-15, verified across every boundary):
	//   move-down: has next sibling → SWAP (moveBlock O+2; O+1 no-ops, Roam counts the block's own slot);
	//              else parent has a next sibling NS → become NS's FIRST child (order 0); else no-op.
	//   move-up:   has prev sibling → SWAP (moveBlock O-1);
	//              else parent has a prev sibling PS → become PS's LAST child (childCount); else no-op.
	// Roam does NOT descend into an expanded adjacent sibling and does NOT pop to a grandparent — at a
	// boundary it crosses ONE level into the parent's adjacent sibling, or no-ops. indent/outdent unchanged.
	function directCodeOp(op) {
		if (codeBusy) return true;                              // prior move still committing — swallow this repeat
		var elc = document.activeElement;
		var cc = elc && elc.closest && elc.closest('.roam-block-container');
		var uid = cc && cc.dataset ? cc.dataset.blockUid : null;
		if (!uid) return false;
		var info = blockInfo(uid); if (!info) return false;
		var view = codeView(elc), sel = view ? view.state.selection.main : null;
		var anchor = sel ? sel.anchor : null, head = sel ? sel.head : null;
		var loc = null, reparent = false;
		if (op === 'moveDown') {
			if (info.O < info.sibCount - 1) loc = { 'parent-uid': info.P, order: info.O + 2 };          // swap with next sibling
			else if (info.NS) { loc = { 'parent-uid': info.NS, order: 0 }; reparent = true; }             // → first child of parent's next sibling
			else return true;                                                                             // bottom of outline
		} else if (op === 'moveUp') {
			if (info.O > 0) loc = { 'parent-uid': info.P, order: info.O - 1 };                             // swap with prev sibling
			else if (info.PS) { loc = { 'parent-uid': info.PS, order: childCount(info.PS) }; reparent = true; }  // → last child of parent's prev sibling
			else return true;                                                                             // top of outline
		} else if (op === 'indent') { if (!info.prev) return true; loc = { 'parent-uid': info.prev, order: childCount(info.prev) }; reparent = true; }
		else if (op === 'outdent') { if (!info.GP) return true; loc = { 'parent-uid': info.GP, order: info.PO + 1 }; reparent = true; }
		else return false;
		codeBusy = true;
		try {
			var rp = reparent;
			api().moveBlock({ location: loc, block: { uid: uid } }).then(function () {
				codeBusy = false;
				if (anchor != null) restoreCodeSel(uid, anchor, head, view, rp);   // always restore the RANGE (heals same-parent collapse + remount)
			}).catch(function () { codeBusy = false; });
		} catch (e) { codeBusy = false; return false; }
		return true;
	}
	// Restore the full SELECTION RANGE {anchor,head} after a move.
	//  • same-parent reorder (reparent=false): the CM6 EditorView is KEPT (caret survives), but a range can
	//    momentarily collapse (move-down) → re-dispatch on the live view heals it.
	//  • REPARENT (reparent=true): CM6 REMOUNTS. The OLD .cm-content lingers a frame STILL IN the document,
	//    so we must wait for a DIFFERENT view instance (v !== oldView) — restoring on the dying old view lets
	//    the remount then reset the fresh view to {0,0} (the v0.5.7-rc bug). A final re-assert (next frame)
	//    survives CM6's own post-mount selection init. NOTE: on iOS programmatic focus may not re-summon the
	//    soft keyboard (gesture-gated); the range is restored regardless.
	function restoreCodeSel(uid, anchor, head, oldView, reparent) {
		var tries = 0, done = false;
		function put(v) {
			try { v.focus(); var len = v.state.doc.length, a = Math.min(anchor, len), h = Math.min(head, len); v.dispatch({ selection: { anchor: a, head: h } }); } catch (e) { }
		}
		(function wait() {
			var c = uidNode(uid), cm = c && c.querySelector('.cm-content'), v = cm && cm.cmView && cm.cmView.view;
			var ready = v && (reparent ? v !== oldView : true);
			if (ready) {
				put(v);
				if (!done) { done = true; requestAnimationFrame(function () { var c2 = uidNode(uid), m2 = c2 && c2.querySelector('.cm-content'), v2 = m2 && m2.cmView && m2.cmView.view; if (v2) put(v2); }); }  // re-assert past CM6's mount-time reset
				return;
			}
			if (++tries > 30) return;
			requestAnimationFrame(wait);
		})();
	}

	// EDITING block op (indent/outdent/move). NORMAL block: proxy Roam's native bar (keystroke fallback).
	// CODE block: mutate the graph directly (directCodeOp) — instant, cursor preserved. SELECTING/other:
	// fire on window so Roam moves the whole selection.
	function editOp(c, op, proxy, key) {
		if (c === 'EDITING') {
			if (inCodeBlock(document.activeElement)) { if (!directCodeOp(op)) shake(btns[op]); return; }
			proxyClick(proxy) || fire(document.activeElement, key);
		} else { fire(window, key); }
	}
	var ACTIONS = {
		select: { show: 'E', run: function () { doSelect(); } },
		extendUp: { show: 'S', rep: true, run: function () { extendAbs(false); } },
		extendDown: { show: 'S', rep: true, run: function () { extendAbs(true); } },
		outdent: { show: 'ES', run: function (c) { editOp(c, 'outdent', PROXY.outdent, K.outdent); } },
		indent: { show: 'ES', run: function (c) { editOp(c, 'indent', PROXY.indent, K.indent); } },
		moveUp: { show: 'ES', rep: true, run: function (c) { editOp(c, 'moveUp', PROXY.moveUp, K.moveUp); } },
		moveDown: { show: 'ES', rep: true, run: function (c) { editOp(c, 'moveDown', PROXY.moveDown, K.moveDown); } },
		undo: { show: 'ESI', run: function (c) { (c === 'EDITING' && proxyClick(PROXY.undo)) || fire(window, K.undo); redoAvail = true; paintRedo(); } },
		redo: { show: 'EI', redoGated: true, run: function (c) { (c === 'EDITING' && proxyClick(PROXY.redo)) || fire(window, K.redo); } },
		wikilink: { show: 'E', run: function () { proxyClick(PROXY.wikilink) || insertText('[['); } },
		todo: { show: 'E', run: function () { proxyClick(PROXY.todo) || insertText('{{[[TODO]]}} ') || shake(btns.todo); } },
		media: { show: 'E', run: function () { proxyClick(PROXY.media) || shake(btns.media); } },
		slash: { show: 'E', run: function () { proxyClick(PROXY.slash) || insertText('/'); } },
		del: { show: 'S', run: function () { fire(window, K.del); } },
		done: { show: 'S', run: function () { doDone(); } },
		close: { show: 'I', run: function () { open = false; lsSet('VBS_cmdbar', '0'); applyCtx(true); } }
	};
	function doSelect() {
		var ta = document.activeElement;
		if (!isBlockTextarea(ta) && !inCodeBlock(ta)) { shake(btns.select); return; }
		// CODE block: select INSTANTLY via codeSelect (Esc-at-contentDOM), skipping the CM6→textarea exit
		// dance + promote ladder. The block becomes a single-block multiselect; seed it as the anchor.
		if (inCodeBlock(ta)) {
			var cc = ta.closest('.roam-block-container');
			var uid = cc && cc.dataset ? cc.dataset.blockUid : null;
			if (!uid) { shake(btns.select); return; }
			codeSelect(function (ok) {
				if (ok) { seedUid = uid; seedWin = winOf(uid); lastEdge = 'bottom'; applyCtx(true); }
				else { shake(btns.select); applyCtx(true); }
			});
			return;
		}
		checkContract();
		promote(function (ok) {
			if (ok) { lastEdge = 'bottom'; applyCtx(true); } else { shake(btns.select); applyCtx(true); }
		});
	}
	function doDone() {
		var clicked = clearByClick();   // memory-safe clear (no Esc on the main path)
		setTimeout(function () {
			if (getSel().length) {
				// fallback: Esc with an active selection = full clear in Roam's engine (source-verified)
				fire(window, K.esc);
				setTimeout(function () {
					if (getSel().length) fire(window, K.esc); // belt
					setTimeout(function () { applyCtx(true); }, 80);
				}, 80);
				return;
			}
			applyCtx(true);
		}, clicked ? 160 : 0);
	}
	function act(id, viaRepeat, converted) {
		var a = ACTIONS[id]; if (!a) return;
		// CM6 code blocks no longer need a textarea-exit: move/indent/outdent mutate the graph directly
		// (directCodeOp) and select converts in place (codeSelect). All code paths are handled in a.run.
		var c = ctx;
		log('act ' + id + (viaRepeat ? ' (rep)' : '') + ' ctx=' + c);
		if (id !== 'undo' && id !== 'redo') { if (id !== 'select' && id !== 'close') redoAvail = false, paintRedo(); }
		a.run(c);   // extendAbs sets lastEdge itself from the live focus side (grow vs shrink)
		// closed loop for selection ops
		if (c === 'SELECTING' && id !== 'done') {
			setTimeout(updateHandles, 35);   // optimistic: knob/chip track the highlight, not the verify
			setTimeout(function () {
				if (extShrink) return;   // shrink-to-single owns its own state via selectSingle's callback
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
				if (id === 'extendUp' || id === 'extendDown') { healGaps('extend'); seedCheck('extend'); }
			}, 220);
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
		select: svg('<path d="M8 4H6a2 2 0 0 0-2 2v2"/><path d="M16 4h2a2 2 0 0 1 2 2v2"/><path d="M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M16 20h2a2 2 0 0 0 2-2v-2"/><path d="M9 12h6"/>', 18),
		todo: svg('<rect x="4" y="4.5" width="15" height="15" rx="3"/><path d="M8.2 12.4l2.6 2.6 4.6-5.2"/>', 21),
		media: svg('<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><circle cx="9" cy="10.2" r="1.6"/><path d="M20 15l-4.5-4.5L6.5 19"/>', 21)
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

			/* dock = the only transformed element (rides the keyboard). `position:fixed; bottom:0`
			   anchors to the LAYOUT-viewport bottom (= screen bottom; iOS keeps fixed elements on the
			   layout viewport, which the keyboard only OVERLAYS). place() lifts it by the keyboard
			   height (innerHeight − vv.height, scroll-invariant). A static transform → the compositor
			   pins it through scroll/overscroll with no JS-follow lag. */
			'#vt-dock{position:fixed;left:0;right:0;bottom:0;z-index:9990;pointer-events:none;will-change:transform;}',
			'#vt-dock.vt-anim{transition:transform .25s ' + KB_CURVE + ';}',

			/* BAR */
			'#vt-bar{pointer-events:auto;display:none;align-items:center;gap:1px;',
			'  height:48px;padding:0 max(6px,env(safe-area-inset-left,0)) 0 max(6px,env(safe-area-inset-right,0));',
			'  border-top:0.5px solid color-mix(in srgb, var(--icon-color,#5c7080) 30%, transparent);',
			'  box-shadow:0 -1px 14px rgba(0,0,0,.30);color:var(--icon-color,#8a9ba8);}',
			'#' + ROOT_ID + '[data-bar="1"] #vt-bar{display:flex;}',
			'#vt-dock[data-kb="down"] #vt-bar{padding-bottom:env(safe-area-inset-bottom,0px);height:calc(48px + env(safe-area-inset-bottom,0px));}',
			'#' + ROOT_ID + '[data-debug="1"] #vt-bar[data-drift]::after{content:"";position:absolute;top:6px;right:6px;width:6px;height:6px;border-radius:3px;background:#f5a623;}',  /* drift warning = DEBUG-only diagnostic (was always-on orange dot) */

			/* buttons: built once, morphed via max-width/opacity per form (no rebuilds) */
			'.vt-b{flex:0 0 auto;height:44px;margin:0;display:flex;align-items:center;justify-content:center;',
			'  background:transparent;border:0;color:inherit;border-radius:10px;padding:0;cursor:pointer;overflow:hidden;',
			'  max-width:0;opacity:0;transform:scale(.62);',
			'  transition:max-width .20s cubic-bezier(.32,.72,0,1),opacity .15s ease,transform .20s cubic-bezier(.32,.72,0,1),background .12s ease,margin .20s ease;}',
			/* the bar has gap:1px — a COLLAPSED flex item still contributes a gap, so a run of
			   hidden buttons (e.g. [[/todo/media/slash between d2 and ⌫ in SELECTING) pads its
			   left side wider than its right (user-visible asymmetry). margin-right:-1px makes
			   each hidden item net 0px regardless of run length. */
			'.vt-b:not(.vt-on){margin-right:-1px;}',
			'.vt-b.vt-on{flex:0 1 auto;max-width:46px;width:42px;min-width:30px;opacity:1;transform:scale(1);}',
			'.vt-b.vt-pressed{transform:scale(.88);background:rgba(47,155,249,.16);}',
			'.vt-b:disabled{opacity:.35;}',
			'.vt-div{flex:0 0 auto;width:1px;height:22px;margin:0 2px;background:color-mix(in srgb, var(--icon-color,#5c7080) 22%, transparent);',
			'  max-width:0;opacity:0;transition:max-width .2s,opacity .15s,margin .2s;}',
			'.vt-div:not(.vt-on){margin:0 -1px 0 0;}',   /* hidden divider: no side margins + cancel its gap */
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

			/* HANDLES — a 0×0 absolute anchor that is RE-PARENTED into the scroll container
			   (.rm-article-wrapper). Its abspos children (knob/tick/chip) are positioned in the
			   scroller's CONTENT coordinates, so the COMPOSITOR scrolls them in lockstep with the
			   blocks — zero JS on scroll, no jitter. Being inside the scroller also means:
			   (a) z-index is solved structurally — the scroller clips us at its top edge (= topbar
			   bottom) via overflow, so we can NEVER paint over the topbar (and within #app, the
			   topbar's z9995 > our z100 anyway); (b) the knob hit-box can't poke past the scroller's
			   right edge. NO overflow:hidden here (we're 0×0 — it would clip the children to nothing;
			   the scroller does the clipping). */
			'#app .rm-article-wrapper{position:relative;}',   /* make the scroller the containing block + enable overflow-clip of our abspos layer (layout-neutral: relative w/o z-index = no stacking context) */
			'#vt-handles{position:absolute;top:0;left:0;width:0;height:0;z-index:100;pointer-events:none;display:none;}',
			'#vt-handles.vt-show{display:block;}',
			'.vt-knob{position:absolute;pointer-events:auto;touch-action:none;width:44px;height:44px;margin:-22px 0 0 -22px;}',
			'.vt-knob::before{content:"";position:absolute;left:50%;top:50%;width:15px;height:15px;border-radius:50%;background:' + BLUE + ';',
			'  transform:translate(-50%,-50%);box-shadow:0 1px 4px rgba(0,0,0,.45),0 0 0 1.5px var(--bg-color,#182026);transition:transform .12s ease;}',
			'.vt-knob[data-grab]::before{transform:translate(-50%,-50%) scale(1.3);box-shadow:0 1px 4px rgba(0,0,0,.45),0 0 0 8px rgba(47,155,249,.16),0 0 0 9.5px var(--bg-color,#182026);}',
			/* NO position transition on the knob either (user: the dot must never fly — it snaps,
			   both across sessions and when crossing to the selection's other end) */
			/* NO transition on the tick: it must never "fly in" from the previous selection's spot
			   (user-reported artifact) nor smear behind scrolling — it snaps, always. */
			'#vt-tick{position:absolute;width:3px;border-radius:1.5px;background:' + BLUE + ';opacity:.6;pointer-events:none;}',
			'#vt-chip{position:absolute;pointer-events:none;min-width:22px;height:22px;padding:0 6px;border-radius:11px;',
			'  background:' + BLUE + ';color:#fff;font:700 12px/22px -apple-system,sans-serif;text-align:center;',
			'  box-shadow:0 1px 4px rgba(0,0,0,.4);}',
			/* new selection session: handles SNAP into place (never fly in from the last session) */
			'#vt-handles.vt-snap #vt-tick,#vt-handles.vt-snap .vt-knob{transition:none!important;}',

			/* HUD */
			'#vt-hud{position:fixed;left:8px;top:8px;z-index:9999;pointer-events:none;display:none;max-width:70vw;',
			'  background:rgba(0,0,0,.72);color:#9fe3a1;font:10px/1.45 ui-monospace,Menlo,monospace;padding:6px 8px;border-radius:8px;white-space:pre-wrap;}',
			'#' + ROOT_ID + '[data-debug="1"] #vt-hud{display:block;}',

			/* page accommodation + overlay suppression */
			'body.vt-bar-open .roam-body-main{padding-bottom:64px;}',
			'body.bp3-overlay-open #vt-dock,body.bp3-overlay-open #vt-handles{display:none!important;}',

			/* DESKTOP / wide viewport: the bar is a CENTERED COMPACT PILL, not a full-page-width strip.
			   On mobile (<=600) it stays edge-to-edge (the iOS toolbar idiom). The dock is full-width
			   fixed; width:max-content + margin auto shrinks the bar to its buttons and centers it. */
			'@media (min-width:601px){',
			'  #vt-bar{width:max-content;max-width:min(620px,92vw);margin:0 auto 10px;border-radius:14px;',
			'    border:0.5px solid color-mix(in srgb, var(--icon-color,#5c7080) 30%, transparent);',
			'    box-shadow:0 6px 20px rgba(0,0,0,.30);}',   /* floating pill: balanced drop shadow (mobile keeps the edge-to-edge upward shadow) */
			'}'
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
		bar.appendChild(mkBtn('todo', ICON.todo, 'Todo checkbox'));
		bar.appendChild(mkBtn('media', ICON.media, 'Upload image'));
		bar.appendChild(mkBtn('slash', '<span class="vt-txt">/</span>', 'Command'));
		bar.appendChild(mkBtn('del', ICON.del, 'Delete blocks'));
		var d3 = el('div', 'vt-d3', 'vt-div'); bar.appendChild(d3);
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

		root.appendChild(dock); root.appendChild(hud);
		// hLayer is NOT a child of root — it is re-parented into the live scroll container on demand
		// (ensureHandles), so it scrolls natively with the blocks. dock/hud stay body-fixed.
		document.body.appendChild(root);
		root.dataset.debug = debugOn() ? '1' : '0';
		place();   // park the dock (bottom:0, kb-down) before first paint
	}

	// which buttons show in which form
	var FORM = {
		IDLE: ['undo', 'redo*', 'close'],
		EDITING: ['select', 'd1', 'outdent', 'indent', 'moveUp', 'moveDown', 'undo', 'redo*', 'd2', 'wikilink', 'todo', 'media', 'slash'],
		// code blocks: [[ / todo / media / slash all insert Roam markup, which is nonsense inside code →
		// show block ops only (select + indent/outdent/move + undo/redo).
		CODE: ['select', 'd1', 'outdent', 'indent', 'moveUp', 'moveDown', 'undo', 'redo*'],
		SELECTING: ['extendUp', 'extendDown', 'd1', 'outdent', 'indent', 'moveUp', 'moveDown', 'undo', 'd2', 'del', 'd3', 'done']
	};
	function paintForm() {
		var list = (ctx === 'EDITING' && inCodeBlock(document.activeElement)) ? FORM.CODE : (FORM[ctx] || []);
		var on = {};
		list.forEach(function (id) {
			if (id === 'redo*') { if (redoAvail) on.redo = 1; }
			else on[id] = 1;
		});
		if (on.redo && on.media) delete on.media;   // slot-share: 390pt budget (redo is transient)
		for (var id in btns) btns[id].classList.toggle('vt-on', !!on[id]);
		document.getElementById('vt-d1').classList.toggle('vt-on', !!on.d1);
		document.getElementById('vt-d2').classList.toggle('vt-on', !!on.d2);
		document.getElementById('vt-d3').classList.toggle('vt-on', !!on.d3);
	}
	function paintRedo() { if (ctx !== 'OFF') paintForm(); }
	function shake(b) { if (!b) return; b.classList.remove('vt-shake'); void b.offsetWidth; b.classList.add('vt-shake'); }
	function nudge(b) { if (!b) return; b.classList.remove('vt-nudge'); void b.offsetWidth; b.classList.add('vt-nudge'); }

	// ---------- positioning (visualViewport keyboard oracle) ----------
	// ---- keyboard occlusion (the value we lift the bar by) ----
	// On iOS, focusing an input does NOT shrink the layout viewport — it OFFSETS it (slides it up by
	// `vv.offsetTop`) to keep the caret above the keyboard; only the VISUAL viewport shrinks. So the
	// keyboard's true on-screen height is `innerHeight − vv.height − vv.offsetTop`. Dropping offsetTop
	// (v0.6.0) over-lifted by exactly offsetTop → a constant GAP under the bar with content showing
	// through (Safari, where offsetTop is large; PWA offsetTop≈0 so it was hidden there).
	// BUT offsetTop must NOT be read live in place(): it spikes during rubber-band overscroll, and the
	// 280ms heal would then jump the bar. So we LATCH it (frozenTop) only on a SETTLED resize/focus and
	// reuse the constant everywhere else. offsetTop is stable during Roam's inner `.rm-article-wrapper`
	// scroll (WebKit changes it only on layout-viewport pan), so a frozen value + NO scroll listener =
	// correct static position AND scroll/overscroll immunity. (Board Opus/Gemini/Codex + web research
	// unanimous; WebKit #237851 = offsetTop reads 0 if sampled too soon → latch in a double-rAF.)
	var frozenTop = 0;   // latched visualViewport.offsetTop; NEVER read live in place()/heal
	function latchTop() { var vv = window.visualViewport; frozenTop = vv ? Math.max(0, Math.round(vv.offsetTop)) : 0; }
	function overlap() {
		var vv = window.visualViewport;
		if (!vv) return 0;
		var o = Math.round(window.innerHeight - vv.height - frozenTop);
		return o <= 30 ? 0 : o;   // ≤30→0 absorbs the iOS 26 #297779 dismiss residue (vv.height short)
	}
	function orientKey() { return window.innerHeight >= window.innerWidth ? 'p' : 'l'; }
	var GAP = 8;   // small safety lift so the iOS keyboard accessory/predictive pill never clips the bar
	// place: the dock is `position:fixed; bottom:0` (iOS anchors fixed to the LAYOUT viewport, which is
	// itself slid up by frozenTop when focused). Lift by the kb occlusion → bar bottom lands at the
	// visual-viewport bottom (= just above the keyboard). STATIC transform while stable → the compositor
	// pins it through scroll/overscroll with ZERO JS lag; we never reposition on scroll.
	function place() {
		if (!dock) return;
		var o = overlap();
		dock.classList.toggle('vt-anim', now() < kbAnimUntil);
		setS(dock, 'transform', o ? 'translateY(' + (-(o + GAP)) + 'px)' : 'translateY(0px)');
		dock.dataset.kb = o ? 'up' : 'down';   // CSS adds the bar's home-indicator safe-area padding when down
		if (o > 60) lsSet('VBS_kb_' + orientKey(), String(o));
		if (ctx === 'SELECTING') updateHandles();
	}
	function schedulePos() { if (rafPos) return; rafPos = requestAnimationFrame(function () { rafPos = 0; place(); }); }
	// re-latch + re-place across the keyboard settle window: a focusin fires BEFORE the kb animates and a
	// block→code switch keeps the kb open so NO 'resize' fires. Latch offsetTop each tick (double-rAF
	// first — it reads 0 if sampled too soon), then place. Sampling only on these settle ticks (not live)
	// is what keeps the bar from chasing overscroll.
	function settlePlace() {
		requestAnimationFrame(function () { requestAnimationFrame(function () { latchTop(); place(); }); });
		[120, 300, 550].forEach(function (t) { setTimeout(function () { latchTop(); place(); }, t); });
	}
	function preRide() {
		// keyboard is coming (focusin) — pre-lift with the cached height so the bar rides up WITH the
		// keyboard animation instead of lagging; the real resize then settles the exact value.
		var cached = parseInt(lsGet('VBS_kb_' + orientKey()) || '0', 10);
		kbAnimUntil = now() + 450;
		if (cached > 60 && overlap() <= 30) {
			dock.classList.add('vt-anim');
			setS(dock, 'transform', 'translateY(' + (-(cached + GAP)) + 'px)');
			dock.dataset.kb = 'up';
		}
	}

	// ---------- handles ----------
	function rectOf(uid) {
		var node = uidNode(uid); if (!node) return null;
		var t = node.querySelector('.rm-block-text') || node;
		return t.getBoundingClientRect();
	}
	// write an inline style/text only when it actually changed (kills the per-call DOM churn that
	// fired on every scroll frame — chip.textContent in particular rebuilt a text node = reflow)
	function setS(el, prop, val) { var c = el._vtc || (el._vtc = {}); if (c[prop] !== val) { el.style.setProperty(prop, val); c[prop] = val; } }
	function setTxt(el, val) { if (el._vtt !== val) { el.textContent = val; el._vtt = val; } }
	// re-parent the handles layer into the LIVE scroll container so it rides the compositor scroll.
	// Self-heals if Roam swapped the container (returns the scroller, or null if none yet).
	function ensureHandles() {
		var sc = scroller(); if (!sc || !sc.appendChild) return null;
		if (hLayer.parentNode !== sc) sc.appendChild(hLayer);
		return sc;
	}
	function handlesSnap() {
		// new selection session: paint in place, no transitions from the previous session's spot
		if (!hLayer) return;
		hLayer.classList.add('vt-snap');
		prevFocusBottom = null;
		updateHandles();
		requestAnimationFrame(function () { requestAnimationFrame(function () {
			if (hLayer) hLayer.classList.remove('vt-snap');
		}); });
	}
	function updateHandles() {
		var sel = getSel();
		if (!sel.length) { hLayer.classList.remove('vt-show'); prevFocusBottom = null; return; }
		var sc = ensureHandles();
		if (!sc) { hLayer.classList.remove('vt-show'); prevFocusBottom = null; return; }
		var uids = sel.map(function (x) { return x['block-uid']; });
		var rects = uids.map(function (u) { return { uid: u, r: rectOf(u) }; }).filter(function (x) { return x.r; });
		if (!rects.length) { hLayer.classList.remove('vt-show'); prevFocusBottom = null; return; }
		hLayer.classList.add('vt-show');
		rects.sort(function (a, b) { return a.r.top - b.r.top; });
		var top = rects[0], bot = rects[rects.length - 1];
		// getSelected() order is INSERTION order, not document order (proven) — never derive the
		// anchor from uids[0]; the knob lives at the edge the user is working (lastEdge).
		var focusIsBottom = lastEdge !== 'top';
		prevFocusBottom = focusIsBottom;
		// block rects are VIEWPORT coords; the handles live in the scroller's CONTENT coords, so
		// convert: contentX = viewportX - scR.left + scrollLeft, contentY = viewportY - scR.top +
		// scrollTop. We clamp in VIEWPORT space (against the scroller's client box) then convert, so
		// the knob/chip can never poke past the scroller edges (= the old vw clamp, now scroller-local).
		var scR = sc.getBoundingClientRect();
		var cw = sc.clientWidth, dx = sc.scrollLeft - scR.left, dy = sc.scrollTop - scR.top;
		var loX = scR.left + 14, hiX = scR.left + cw - 14;
		var kr = focusIsBottom ? bot.r : top.r;
		var knobVX = Math.max(loX, Math.min(focusIsBottom ? kr.right + 6 : kr.left - 6, hiX));
		setS(knob, 'left', (knobVX + dx) + 'px');
		setS(knob, 'top', ((focusIsBottom ? kr.bottom - 4 : kr.top + 4) + dy) + 'px');
		var ar = focusIsBottom ? top.r : bot.r;
		var tickVX = Math.max(scR.left, Math.min(focusIsBottom ? ar.left - 7 : ar.right + 4, scR.left + cw - 8));
		setS(tick, 'left', (tickVX + dx) + 'px');
		setS(tick, 'top', (ar.top + dy) + 'px');
		setS(tick, 'height', ar.height + 'px');
		setTxt(chip, String(rects.length));
		// chip hugs the KNOB on both edges (anchor to the knob's clamped VIEWPORT x, not the block
		// rect): measure the chip and mirror the bottom case's ~8px dot-edge gap when extending
		// upward — the old fixed kr.left-52 sat ~17px off the dot (user-reported, 2026-06-12).
		var chw = chip.offsetWidth || 22;
		var chipVX = focusIsBottom ? Math.min(knobVX + 16, scR.left + cw - chw - 4) : Math.max(scR.left + 4, knobVX - 16 - chw);
		setS(chip, 'left', (chipVX + dx) + 'px');
		setS(chip, 'top', ((focusIsBottom ? kr.bottom + 2 : kr.top - 26) + dy) + 'px');
	}

	// ---------- the EVENT SHIELD + gesture engine ----------
	// Everything inside #vt-cmd-root is invisible to Roam (window-capture stop) and we act on our
	// own pointer gestures. Our own synthetic page-targeted events carry ev.__vt and are exempt
	// FIRST (the drag-ownership clause below would otherwise eat our shift-click mouseup mid-drag).
	var SHIELD_TYPES = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel',
		'mousedown', 'mousemove', 'mouseup', 'touchstart', 'touchmove', 'touchend', 'touchcancel',
		'click', 'contextmenu', 'dblclick'];
	// #vt-handles now lives OUTSIDE the root (re-parented into the scroller), so the event shield
	// must still treat its knob/tick as "ours" or the knob drag would be ignored (route() never runs).
	function inRoot(t) { return !!(t && t.closest && (t.closest('#' + ROOT_ID) || t.closest('#vt-handles'))); }
	function shield(e) {
		if (e.__vt) return;                                   // our own synthetics — Roam must see them
		var inside = inRoot(e.target);
		// the trusted mouseup/click pair that trails a knob release targets a page block (no
		// matching mousedown — we owned it) and would make Roam clear/zoom — eat it (desktop/CDP;
		// real iOS never synthesizes it because the knob's touchstart is preventDefault'd)
		if (!inside && now() < dragGuardUntil && (e.type === 'mouseup' || e.type === 'click' || e.type === 'dblclick')) {
			e.stopPropagation();
			return;
		}
		// during a knob drag we own the whole screen's move/up events
		if (!inside && !(drag && (e.type.indexOf('move') > 0 || e.type.indexOf('up') > 0 || e.type.indexOf('cancel') > 0 || e.type.indexOf('end') > 0))) return;
		if (e.type === 'click' && !e.isTrusted) return;       // other modules' programmatic clicks
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
	// --- knob drag (ABSOLUTE: selection follows the finger via assertRange; edge auto-scroll) ---
	// Auto-scroll grammar (WebKit/Android/pragmatic-dnd constants): zones are INERT until the finger
	// travels ≥48px toward that edge (directional arming) and ≥120ms passed; velocity is linear in
	// zone depth (50→550px/s) × a 400ms time-ramp that resets on zone exit; per-frame cap 9px.
	// Extending under a stationary finger while content scrolls is the universal grammar — kept
	// (the scroll slides new blocks under the finger ⇒ new target ⇒ assertRange).
	var AS = { ARM_PX: 48, ARM_MS: 120, ZONE: 90, TOPZ: 80, VMIN: 50, VMAX: 550, RAMP: 400, CAP: 9 };
	function dragTarget(x, y) {
		var hit = document.elementFromPoint(x, Math.max(2, Math.min(window.innerHeight - 2, y)));
		var cont = hit && hit.closest ? hit.closest('.roam-block-container') : null;
		if (!cont) return null;
		var emb = cont.closest('.rm-embed-container');           // embeds are a foreign page —
		if (emb) cont = emb.closest('.roam-block-container');    // address their HOST block instead
		// reference sections are a different window — dragging the knob into them must NOT select them
		if (!cont || cont.closest('#' + ROOT_ID) || cont.closest('.rm-reference-main') || cont.closest('.rm-reference-container')) return null;
		return cont;
	}
	function dragStart(pid, p) {
		if (ctx !== 'SELECTING') return;
		var gi = selExtent();
		drag = {
			pid: pid, startY: p.y, x: p.x, y: p.y, moved: false, raf: 0,
			t0: now(), lastT: now(), minY: p.y, maxY: p.y,
			armUp: false, armDown: false, engUp: 0, engDown: 0,
			scope: gi ? gi.scope : articleOf(null),
			lastCont: null, clickT: 0, retries: 0, extentSig: ''
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
			// --- ABSOLUTE extend: selection = anchor..finger (Roam computes; idempotent) ---
			if (t - drag.clickT >= 120) {
				var cont = dragTarget(drag.x, drag.y);
				if (cont && drag.scope.contains(cont)) {
					var gi = selExtent();
					var sig = gi ? gi.min + ':' + gi.max : '';
					if (sig !== drag.extentSig) { drag.extentSig = sig; drag.retries = 0; }
					var tIdx = gi ? gi.list.indexOf(cont) : -1;
					var covered = gi && tIdx >= gi.min && tIdx <= gi.max;
					var isNew = cont !== drag.lastCont;
					// new row ⇒ re-assert (absolute, handles shrink too); same row uncovered ⇒
					// retry ≤4 until the extent covers it (unreachable targets must not click-storm)
					if (isNew || (!covered && drag.retries < 4)) {
						if (isNew) { drag.lastCont = cont; drag.retries = 0; } else drag.retries++;
						assertRange(cont);
						drag.clickT = t;
						if (gi && tIdx > gi.max) lastEdge = 'bottom';
						else if (gi && tIdx >= 0 && tIdx < gi.min) lastEdge = 'top';
						setTimeout(updateHandles, 60);
					}
				}
			}
		}
		drag.raf = requestAnimationFrame(dragLoop);
	}
	function dragEnd() {
		if (!drag) return;
		var x = drag.x, y = drag.y, lastCont = drag.lastCont, scope = drag.scope;
		if (drag.raf) cancelAnimationFrame(drag.raf);
		drag = null;
		dragGuardUntil = now() + 350;
		knob.removeAttribute('data-grab');
		// final assert: a fast flick can lift inside the 120ms throttle window — the selection
		// must still end exactly at the finger
		var cont = dragTarget(x, y) || lastCont;
		if (cont && scope.contains(cont)) {
			var gi = selExtent();
			var tIdx = gi ? gi.list.indexOf(cont) : -1;
			if (gi && tIdx >= 0 && (tIdx < gi.min || tIdx > gi.max)) {
				assertRange(cont);
				if (tIdx > gi.max) lastEdge = 'bottom'; else lastEdge = 'top';
			}
		}
		log('drag end sel=' + getSel().length);
		setTimeout(function () {
			updateHandles();
			healGaps('drag');
			seedCheck('drag-end');
		}, 200);
	}

	// ---------- state machine ----------
	function ctxNow() {
		if (getSel().length) return 'SELECTING';
		if (isBlockTextarea(document.activeElement) || inCodeBlock(document.activeElement)) return 'EDITING';
		return 'IDLE';
	}
	function applyCtx(force) {
		if (!added) return;
		var c = ctxNow();
		var codeNow = (c === 'EDITING') && inCodeBlock(document.activeElement);
		// collapse-to-single momentarily focuses the anchor textarea with an empty selection; ignore that
		// transient EDITING/IDLE flicker (it would otherwise wipe seedUid and flash the bar form).
		if (extShrink && c !== 'SELECTING') return;
		// EDITING↔EDITING but code↔normal flips the button form (FORM.CODE vs FORM.EDITING) → must repaint
		if (!force && c === ctx && codeNow === editingCode) {
			if (c === 'SELECTING' && !drag) updateHandles();
			return;
		}
		editingCode = codeNow;
		var prev = ctx; ctx = c;
		lastSelN = getSel().length;
		if (c !== 'SELECTING') { seedUid = null; seedWin = null; }
		root.dataset.bar = (c === 'EDITING' || c === 'SELECTING' || (c === 'IDLE' && open)) ? '1' : '0';
		root.dataset.fab = (c === 'IDLE' && !open) ? '1' : '0';
		if (hLayer && c !== 'SELECTING') hLayer.classList.remove('vt-show');   // entering SELECTING, updateHandles adds it back
		paintForm();
		if (c === 'SELECTING') {
			if (prev !== 'SELECTING') handlesSnap(); else updateHandles();
		}
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
		var vv = window.visualViewport;
		var vvl = vv ? ' ih' + window.innerHeight + ' vvh' + Math.round(vv.height) + ' vvtop' + Math.round(vv.offsetTop) : '';
		hud.textContent = 'ctx=' + ctx + ' sel=' + getSel().length + ' kb=' + overlap() + ' code=' + (inCodeBlock(document.activeElement) ? 1 : 0) + vvl +
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
			// CM6 code blocks are editing too (focus = .cm-content, not a textarea) → ride the keyboard
			// for them as well. A CM6 tap reveal-scrolls the visual viewport over several frames with
			// NO 'resize' (kb already open on a block→code switch) → preRide alone left the bar behind
			// the keyboard. settlePlace re-samples the geometry across the settle window so it lands.
			if (isBlockTextarea(e.target) || inCodeBlock(e.target)) { preRide(); settlePlace(); }
			scheduleSync();
		}, { capture: true, signal: sig });
		document.addEventListener('focusout', function () {
			kbAnimUntil = now() + 450;
			frozenTop = 0;   // keyboard is dismissing → the layout-viewport offset collapses back to 0
			setTimeout(scheduleSync, 60);
			// settle ladder on close too: the kb-dismiss resize can land late, and on iOS 26 (#297779)
			// vv.height/offsetTop restore short for a beat → settlePlace re-latches + the ≤30 clamp zeroes it.
			settlePlace();
		}, { capture: true, signal: sig });
		document.addEventListener('input', function (e) { if (isBlockTextarea(e.target)) { redoAvail = false; paintRedo(); } }, { capture: true, signal: sig });
		if (window.visualViewport) {
			// resize = the keyboard opened/closed/changed height (the ONLY thing that should move the bar).
			// Re-latch offsetTop HERE (the layout-viewport offset settled with the kb) and re-place.
			// NO 'scroll' listener: offsetTop changes only on layout-viewport pan/overscroll (not on Roam's
			// inner-container scroll), and we use the FROZEN latch — so the static-transform bar can never
			// chase scroll/overscroll; the compositor pins it for free.
			window.visualViewport.addEventListener('resize', function () { latchTop(); schedulePos(); scheduleSync(); }, { signal: sig });
		}
		window.addEventListener('orientationchange', function () { setTimeout(function () { latchTop(); schedulePos(); scheduleSync(); }, 120); }, { signal: sig });
		// NO scroll listener: the handles are abspos children of the scroller now, so the compositor
		// scrolls them in lockstep with the blocks — repositioning them in JS on scroll was exactly
		// what made them shake (a frame behind iOS momentum scroll). Gone.
		mo = new MutationObserver(scheduleSync);
		mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
		healTimer = setInterval(function () {
			if (!document.getElementById(STYLE_ID)) injectStyle();
			applyCtx(false);
			// continuously re-anchor to the visual-viewport bottom — self-heals if a settle/resize
			// event was missed (the CM6 reveal-scroll that left the bar behind the kb). setS dedups
			// so a steady keyboard writes nothing; gated off mid-drag so it can't fight the knob.
			if (!drag) schedulePos();
			if (ctx === 'SELECTING' && !drag) updateHandles();
			if (debugOn()) hudPaint();
		}, 280);
		applyCtx(true);
		log('cmdbar v0.6.1 up');
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
		if (hLayer && hLayer.parentNode) hLayer.parentNode.removeChild(hLayer);   // re-parented into the scroller, not root
		var st = document.getElementById(STYLE_ID); if (st) st.remove();   // un-hides the native bar
		root = dock = bar = fab = hLayer = knob = tick = chip = hud = null;
		btns = {}; ctx = 'OFF'; editingCode = false;
	}

	start();
	return {
		isAdded: function () { return added; }, start: start, stop: stop,
		_state: function () { return { ctx: ctx, sel: selUids(), seed: seedUid, open: open, redoAvail: redoAvail, kb: overlap(), contract: contract }; },
		_log: function () { return logRing.slice(); },
		_force: function (v) { lsSet('VBS_force', v ? '1' : '0'); },  // legacy localStorage override
		_desktop: function () { return desktopOptIn(); }             // is the desktop bar currently enabled?
	};
})();
