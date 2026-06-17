/*
 * Viktor's Roam plugin: Mobile block-scroll damper (kills the iOS "page jiggle")
 * version: 0.2  (2026-06-17)  — narrowed to ONE job: force preventScroll on block-<textarea> focus.
 *
 * BUG: on the iOS PWA, every block op (Enter / Backspace-merge / tap-to-another-block) makes the whole
 * outline JUMP down-then-up and snap back while the keyboard stays open. ROOT CAUSE (in Roam's compiled
 * route-app.js, NOT our theme): Roam destroys+recreates the block <textarea> on every edit-target change and,
 * on web only, focuses the new textarea WITHOUT preventScroll → WebKit reveal-scrolls it, then Roam force-
 * restores the old scrollTop across two rAFs → the reveal/restore fight is the jiggle. (Roam passes
 * preventScroll only on its Flutter native build.) FIX = "become the Flutter branch": force preventScroll on
 * block-textarea focus, so Roam's double-rAF restore writes an unchanged value (no-op) and the jiggle is gone.
 *
 * v0.1 ALSO did its own reveal-scroll; that is REMOVED in v0.2. The deliberate "seat the focused block a
 * comfortable margin above keyboard+cmdbar" reveal — for BOTH textareas and CM6 code blocks — now lives wholly
 * in cmdbar.js (the single owner of the keyboard-height + bar-height numbers), along with the reactive window-
 * scroll lock that neutralizes CM6's contentEditable caret-reveal. This module no longer touches scroll
 * positions or CM6; it only suppresses the textarea reveal at the source via preventScroll.
 *
 * Gate: touch devices, and NOT the Flutter native app (which already has the fix). Desktop untouched.
 * Loader: registered as `scrolldamper` in window.alphaChannel → global ViktorScrolldamper {start,stop}.
 */
window.ViktorScrolldamper = (function () {
	var BLOCK_ID = 'block-input';     // Roam editing textarea id = block-input-<windowId>-<blockUid>
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
	}

	function stop() {
		unpatchFocus();
	}

	start();
	return { start: start, stop: stop };
})();
