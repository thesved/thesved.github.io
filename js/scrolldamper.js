/*
 * Viktor's Roam plugin: Mobile block-scroll damper (kills the iOS "page jiggle")
 * version: 0.1  (2026-06-12)
 * author: @ViktorTabori
 *
 * BUG: on the iOS PWA, every block op (Enter / Backspace-merge / tap-to-another-block) makes the
 * whole outline JUMP down-then-up and snap back, while the keyboard stays open. Extremely annoying.
 *
 * ROOT CAUSE (found verbatim in Roam's compiled `route-app.js`, NOT our theme):
 *   Roam destroys+recreates the block <textarea> on every edit-target change. Two forces fight:
 *     1) DOWN — on web it focuses the new textarea WITHOUT preventScroll, so WebKit reveal-scrolls
 *        it into the keyboard-shortened viewport. (Roam DOES pass preventScroll — but ONLY for its
 *        Flutter native app: `nR()&&(Y.focus({preventScroll:!0}),uvc(Y))`, where
 *        `nR = ()=>window.FlutterQuickCaptureReadyChannel||window.FlutterCurrentGraphChannel`.)
 *     2) UP   — Roam then force-restores the OLD scrollTop across two rAFs, web-only:
 *        `nR()||requestAnimationFrame(()=>{M.scrollTop=P;return requestAnimationFrame(()=>M.scrollTop=P)})`.
 *   Reveal pushes ~1 line one way, restore yanks it back the next frames = the visible jiggle.
 *   Roam fixed this for Flutter only (preventScroll + a gentle IntersectionObserver reveal `uvc`);
 *   the web/PWA build never got it.
 *
 * FIX = "become the Flutter branch": force preventScroll on block-textarea focus (kills force #1),
 * then do our OWN gentle reveal (only if the caret would actually be hidden). With no reveal scroll,
 * Roam's double-rAF restore writes an unchanged value (no-op) and the jiggle is gone.
 *
 * Gate: touch devices, and NOT the Flutter native app (which already has the fix). Desktop untouched.
 * Loader: registered as `scrolldamper` in window.alphaChannel → global ViktorScrolldamper {start,stop}.
 */
window.ViktorScrolldamper = (function () {
	var BLOCK_ID = 'block-input';     // Roam editing textarea id = block-input-<windowId>-<blockUid>
	var TOP_MARGIN = 50;              // keep caret this far below the top of the visible band
	var BOTTOM_MARGIN = 52;           // ...and this far above the bottom (clears Roam's #rm-mobile-bar)
	var origFocus = null;             // the real HTMLElement.prototype.focus we wrapped

	function isFlutter() {
		return typeof window.FlutterQuickCaptureReadyChannel !== 'undefined'
			|| typeof window.FlutterCurrentGraphChannel !== 'undefined';
	}
	function isTouch() {
		return (navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in window;
	}
	function isBlockTextarea(el) {
		return !!el && el.tagName === 'TEXTAREA' && typeof el.id === 'string' && el.id.indexOf(BLOCK_ID) === 0;
	}

	// nearest vertically-scrollable ancestor (Roam resolves this dynamically too — don't hardcode it)
	function scrollParent(el) {
		var n = el && el.parentElement;
		while (n) {
			var oy = getComputedStyle(n).overflowY;
			if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight + 1) return n;
			n = n.parentElement;
		}
		return document.scrollingElement || document.documentElement;
	}

	// Gentle reveal: scroll ONLY if the focused textarea sits outside the visible (above-keyboard) band.
	function reveal(ta) {
		try {
			var vv = window.visualViewport;
			var top = (vv ? vv.offsetTop : 0) + TOP_MARGIN;
			var bot = (vv ? vv.offsetTop + vv.height : window.innerHeight) - BOTTOM_MARGIN;
			var r = ta.getBoundingClientRect();
			var d = 0;
			if (r.bottom > bot) d = r.bottom - bot;        // caret too low → scroll content up
			else if (r.top < top) d = r.top - top;          // caret too high → scroll content down
			if (Math.abs(d) > 2) scrollParent(ta).scrollBy({ top: d, behavior: 'auto' });
		} catch (e) { }
	}

	function onFocusIn(e) {
		if (!isBlockTextarea(e.target)) return;
		var ta = e.target;
		// after Roam's own focus/restore settles (it uses two rAFs); do ours last so it wins, but
		// only nudges when genuinely needed → normally a no-op, so no jiggle.
		requestAnimationFrame(function () { requestAnimationFrame(function () { reveal(ta); }); });
	}

	function patchFocus() {
		var proto = HTMLElement.prototype;
		if (proto.focus && proto.focus._vsd) return;        // already ours (prior instance) — leave it
		origFocus = proto.focus;
		var wrapped = function (opts) {
			if (isBlockTextarea(this)) {
				var o = opts ? Object.assign({}, opts) : {};
				o.preventScroll = true;
				return origFocus.call(this, o);
			}
			return origFocus.call(this, opts);
		};
		wrapped._vsd = true;
		wrapped._orig = origFocus;
		proto.focus = wrapped;
	}

	function unpatchFocus() {
		var proto = HTMLElement.prototype;
		if (proto.focus && proto.focus._vsd) proto.focus = proto.focus._orig || origFocus || proto.focus;
		origFocus = null;
	}

	function start() {
		stop();
		if (isFlutter() || !isTouch()) return;              // native app already fixed; desktop unaffected
		patchFocus();
		document.addEventListener('focusin', onFocusIn, true);
	}

	function stop() {
		document.removeEventListener('focusin', onFocusIn, true);
		unpatchFocus();
	}

	start();
	return { start: start, stop: stop };
})();
