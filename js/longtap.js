/*
 * Viktor's Roam Mobile Long tap → right-click on bullets + open-in-sidebar on pages/refs/filters
 * version: 0.6  (2026-05-30)
 * author: @ViktorTabori
 *
 * WHY v0.5 → v0.6 (block-push under the menu, first-principles fix):
 *   v0.5 opened the menu AT THE TOUCH POINT and pushed the block by (menu.right - block.left),
 *   clamped to 0.6 * innerWidth. For a top-level (left-most) block that landed it perfectly clear
 *   of the menu; but a NESTED block's bullet is further right, so the menu opened further right AND
 *   the required push hit the clamp — the block stayed half-under the menu, unreadable. The real
 *   fix isn't a bigger relative push: it's to make the menu's right edge CONSTANT. v0.6 opens the
 *   menu pinned to a fixed left X (menuLeft) regardless of where you tapped, then slides each block
 *   so its left lands at the same absolute X just past the menu — fixed target, per-block push, no
 *   clamp. Every block, any indent level, ends up equally clear of the menu.
 *
 * WHY v0.4 → v0.5 (the real root cause, finally):
 *   v0.4 ASSUMED iOS Safari's native long-press emits a trusted `contextmenu` that Roam opens
 *   its block menu from, so v0.4 did NOTHING on touch and only observed. That assumption is
 *   FALSE on a real iPhone Safari PWA: a long-press there is a TEXT-SELECTION gesture, which
 *   wins the race — you get a gray line highlight and NO menu. (The "verified live" in the old
 *   handoff was desktop-Chrome touch-emulation, where long-press DOES fire `contextmenu`.)
 *
 *   The other v0.4 premise — "current Roam ignores SYNTHETIC `contextmenu`" — is ALSO false.
 *   Tested directly on the live build: `el.dispatchEvent(new MouseEvent('contextmenu',…))` on a
 *   `.rm-bullet` DOES open the menu (body gains `bp3-overlay-open`), and a synthetic click on a
 *   bullet zooms into the block. v0.3 only *looked* broken because its own click-guard
 *   `preventDefault`-ed the real contextmenu and it fired a bogus synthetic `touchend`.
 *
 * WHAT v0.5 DOES (mobile bullet path — full ownership, no reliance on iOS gestures):
 *   On touchstart on a bullet/`.controls`, we `preventDefault()` (this is the fix: it KILLS the
 *   iOS text-selection + callout AND the native synthesized click) and start our OWN long-press
 *   timer:
 *     - hold ≥ LONG_PRESS_MS without moving  → clear any selection + dispatch a synthetic
 *       `contextmenu` on the bullet → Roam opens its block menu → the body-class observer slides
 *       the block clear of the menu + highlights it (revert on close). Reliable on iOS.
 *     - short tap (released before the timer) → dispatch a synthetic click on what was tapped →
 *       Roam zooms into the block (the normal bullet action we replaced by preventing default).
 *     - finger moves > MOVE_TOL          → it was a scroll/drag: cancel, do nothing.
 *   Desktop is untouched (no touch events; real right-click still opens the native menu).
 *
 *   PAGE REF / PAGE TITLE / SEARCH RESULT / FILTER (mobile): long-tap → shift-click to open in
 *   the right sidebar (unchanged from v0.4; uses normal click which Roam honors).
 */
if (window.ViktorLongtap && window.ViktorLongtap.stop) window.ViktorLongtap.stop();
window.ViktorLongtap = (function () {
	var doLog = false,
		minWaitTime = 200,        // ms a touch must be held to count as a long-tap (page/ref/filter path)
		clickBlockTime = 800,     // ms after a page/ref long-tap during which the follow-up click is swallowed
		LONG_PRESS_MS = 500,      // ms a bullet must be held to fire the context menu
		MOVE_TOL = 10,            // px of finger movement that aborts a bullet long-press (= it's a scroll)
		animTime = 400,
		MOBILE_MAX = 600,
		highlightColor = 'rgba(255, 165, 0, 0.18)',
		menuGap = -22,            // px gap between the menu's right edge and the pushed block
		menuLeft = 6,             // px: open the block menu pinned this far from the screen's left edge,
		                          // so its right edge — and thus the pushed block's landing X — is the
		                          // SAME for every block regardless of its indent level
		deduplicateSidebar = true,
		added = false,
		last = new Date(),
		tapStatus = { status: false, target: null, latestLongTap: null },
		// bullet long-press state (we drive it ourselves)
		bp = null,                // { x, y, target, bullet, block, timer, fired, moved }
		// bullet-menu push state
		pendingBlock = null,      // .roam-block-container whose menu we just opened
		pendingAt = 0,            // timestamp of that long-press
		pushedEl = null,          // block currently shifted (so we always revert exactly one)
		bodyObserver = null,
		css = document.createElement('style');
	css.id = 'CSSViktorMobileLongTap';
	css.innerHTML = `
		:root {
		  --animate-delay: 0ms;
		  --animate-duration: ${animTime}ms;
		  --animation-overshoot: 1.02;
		}
		.animate__animated {
		  -webkit-animation-duration: 1s; animation-duration: 1s;
		  -webkit-animation-duration: var(--animate-duration); animation-duration: var(--animate-duration);
		  -webkit-animation-fill-mode: both; animation-fill-mode: both;
		}
		@-webkit-keyframes pulseReverse { from,to {-webkit-transform:scale3d(1,1,1);transform:scale3d(1,1,1);} 50%{-webkit-transform:scale3d(.95,.95,.95);transform:scale3d(.95,.95,.95);} 90%{-webkit-transform:scale3d(var(--animation-overshoot),var(--animation-overshoot),var(--animation-overshoot));transform:scale3d(var(--animation-overshoot),var(--animation-overshoot),var(--animation-overshoot));} }
		@keyframes pulseReverse { from,to {-webkit-transform:scale3d(1,1,1);transform:scale3d(1,1,1);} 50%{-webkit-transform:scale3d(.95,.95,.95);transform:scale3d(.95,.95,.95);} 90%{-webkit-transform:scale3d(var(--animation-overshoot),var(--animation-overshoot),var(--animation-overshoot));transform:scale3d(var(--animation-overshoot),var(--animation-overshoot),var(--animation-overshoot));} }
		.animate__pulseReverse { -webkit-animation-name:pulseReverse; animation-name:pulseReverse; -webkit-animation-timing-function:ease-in-out; animation-timing-function:ease-in-out; }

		/* the block slides smoothly when we shift it out from under the menu */
		.roam-block-container { transition: transform 0.18s ease-out; }

		/* keep the context menu above the left sidebar */
		.bp3-transition-container { z-index: 9999 !important; }
		`;

	start();

	return {
		isAdded: () => added, start: start, stop: stop,
		_state: function () { return { holding: !!bp, fired: !!(bp && bp.fired), pushedEl: !!pushedEl, mobile: isMobile(), agoMs: Date.now() - pendingAt }; }
	};

	function isMobile() { return true; /* for touch we dont care about size return window.innerWidth <= MOBILE_MAX; */ }

	function start() {
		if (added) return;
		added = true;
		// general arming/disarming for the page-ref/title/filter long-tap path (passive is fine)
		'click mousedown mouseup touchmove touchend selectionchange'.split(' ').forEach(function (type) {
			document.addEventListener(type, process, { passive: true, capture: true });
		});
		document.addEventListener('touchstart', process, { passive: true, capture: true });
		// bullet long-press needs to CANCEL the native gesture (selection/callout/click), so its
		// touch handlers must be NON-passive (preventDefault) and run at capture, before Roam/iOS.
		document.addEventListener('touchstart', bulletTouchStart, { passive: false, capture: true });
		document.addEventListener('touchmove', bulletTouchMove, { passive: false, capture: true });
		document.addEventListener('touchend', bulletTouchEnd, { passive: false, capture: true });
		document.addEventListener('touchcancel', bulletTouchEnd, { passive: false, capture: true });
		// swallow the click that follows a page/ref/filter long-tap (so it doesn't ALSO navigate)
		document.addEventListener('click', clickGuard, { passive: false, capture: true });
		// observe the block context menu opening/closing to drive the push/revert
		bodyObserver = new MutationObserver(onBodyClass);
		bodyObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
		document.head.appendChild(css);
		if (doLog) console.log('** long tap v0.5 installed **');
	}

	function stop() {
		if (!added) return;
		added = false;
		'click mousedown mouseup touchmove touchend selectionchange'.split(' ').forEach(function (type) {
			document.removeEventListener(type, process, { passive: true, capture: true });
		});
		document.removeEventListener('touchstart', process, { passive: true, capture: true });
		document.removeEventListener('touchstart', bulletTouchStart, { passive: false, capture: true });
		document.removeEventListener('touchmove', bulletTouchMove, { passive: false, capture: true });
		document.removeEventListener('touchend', bulletTouchEnd, { passive: false, capture: true });
		document.removeEventListener('touchcancel', bulletTouchEnd, { passive: false, capture: true });
		document.removeEventListener('click', clickGuard, { passive: false, capture: true });
		if (bodyObserver) { bodyObserver.disconnect(); bodyObserver = null; }
		clearBullet();
		revert();
		if (css.parentNode) css.parentNode.removeChild(css);
		if (doLog) console.log('** long tap v0.5 STOPPED **');
	}

	// ---------- BULLET long-press (mobile only) ----------

	function clearBullet() { if (bp && bp.timer) clearTimeout(bp.timer); bp = null; }

	function bulletTouchStart(e) {
		if (!isMobile() || !e.target || !e.target.closest) return;
		var controls = e.target.closest('.controls');
		if (!controls) return;                       // not a bullet/gutter touch — leave it alone
		if (e.touches && e.touches.length > 1) { clearBullet(); return; } // multi-touch → ignore
		var bullet = controls.querySelector('.rm-bullet') || controls;
		var t = (e.targetTouches && e.targetTouches[0]) || e;
		// THE FIX: cancel the native long-press gesture (iOS text-selection + callout) AND the
		// synthesized click. We replicate whichever one the user meant (zoom vs. menu) ourselves.
		e.preventDefault();
		clearBullet();
		bp = {
			x: t.clientX, y: t.clientY, target: e.target, bullet: bullet,
			block: controls.closest('.roam-block-container'), timer: null, fired: false, moved: false
		};
		bp.timer = setTimeout(function () {
			if (!bp || bp.moved) return;
			bp.fired = true;
			last = new Date();
			clearSelection();
			// arm the push observer for this block, then open Roam's menu with a synthetic event.
			// Open the menu PINNED to the left (fixed clientX = menuLeft), NOT at the touch point, so
			// the menu's right edge is constant and the block always lands at the same absolute X (see
			// pushBlock). Roam/popper positions the menu via the event's clientX; the bullet target still
			// selects the right block. clientY stays at the touch so the menu sits near the finger.
			pendingBlock = bp.block;
			pendingAt = Date.now();
			openBlockMenu(bp.bullet, menuLeft, bp.y);
			if (doLog) console.log('long-press → contextmenu on', bp.bullet);
		}, LONG_PRESS_MS);
	}

	function bulletTouchMove(e) {
		if (!bp) return;
		var t = (e.targetTouches && e.targetTouches[0]) || e;
		if (Math.abs(t.clientX - bp.x) > MOVE_TOL || Math.abs(t.clientY - bp.y) > MOVE_TOL) {
			bp.moved = true;                         // it's a scroll/drag, not a long-press
			if (bp.timer) { clearTimeout(bp.timer); bp.timer = null; }
		}
	}

	function bulletTouchEnd(e) {
		if (!bp) return;
		var b = bp;
		clearBullet();
		if (b.fired) {                               // long-press already opened the menu — swallow
			if (e.cancelable) e.preventDefault();
			return;
		}
		if (b.moved) return;                         // was a drag — do nothing
		// short tap: replicate the native bullet action (zoom into the block) we preventDefault-ed
		simulateClick(b.target, ['mousedown', 'mouseup', 'click'], true);
	}

	function openBlockMenu(el, x, y) {
		if (!el) return;
		var ev = new MouseEvent('contextmenu', {
			view: window, bubbles: true, cancelable: true, button: 2, buttons: 2, clientX: x, clientY: y
		});
		el.dispatchEvent(ev);
	}

	function clearSelection() {
		try { var s = window.getSelection(); if (s && s.rangeCount) s.removeAllRanges(); } catch (_) { }
	}

	// ---------- PAGE REF / TITLE / SEARCH / FILTER long-tap → open in sidebar (unchanged) ----------

	// Swallow the normal tap/click that follows a page/ref/filter long-tap (so it doesn't ALSO navigate).
	function clickGuard(e) {
		if (e.simulated) return;
		if (tapStatus.latestLongTap && (Date.now() - tapStatus.latestLongTap.getTime()) < clickBlockTime) {
			e.preventDefault();
			e.stopPropagation();
			clearSelection();
		}
	}

	function process(e) {
		last = new Date();
		var target = e.target;

		// a moved/ended touch aborts a pending page/ref/filter long-tap
		if (e.type == 'touchmove' || e.type == 'touchend') { tapStatus.status = false; return; }

		// reset the long-tap arming flag on any mouse/selection noise (does NOT touch contextmenu)
		if (e.type.match(/^(click|mousedown|mouseup|selectionchange)$/i)) { tapStatus.status = false; return; }

		if (e.type != 'touchstart') return;

		// bullets are handled by the dedicated non-passive handler above — skip here
		if (target.closest && target.closest('.controls')) return;

		// ---- PAGE REF / TITLE / SEARCH / FILTER path: long-tap → shift-click to open in sidebar ----
		var action = null;
		try {
			if (target.classList && (
					target.classList.contains('rm-search-title')
					|| (target.closest('.bp3-popover-content button.bp3-button') && target.parentNode.firstChild.nodeName.match(/button/i))
					|| target.closest('.rm-page-ref'))
				|| target.closest('.rm-pages-title-text')) {
				action = function () {
					var sidebar;
					if (deduplicateSidebar && (!target.classList || !target.classList.contains('bp3-button'))) {
						sidebar = (document.getElementById('roam-right-sidebar-content') && document.getElementById('roam-right-sidebar-content').children) || [];
						Array.from(sidebar)
							.filter(function (el) { var t = el.querySelector('h1'); return t && t.textContent == target.textContent; })
							.forEach(function (el) { simulateClick(el.querySelector('.bp3-icon-cross'), ['mousedown', 'click', 'mouseup'], true); });
					}
					simulateClick(target, ['mousedown', 'click', 'mouseup'], true, { shiftKey: true });
					var _animate = sidebar && (target.closest('.rm-pages-title-col') || target.closest('.flex-h-box'));
					if (_animate) animateCSS(_animate, ['pulseReverse']);
				};
			}
		} catch (_) { }

		if (!action) return;

		tapStatus.status = true;
		tapStatus.target = target;
		setTimeout(function () {
			if (!tapStatus.status) return;
			last = new Date();
			tapStatus.status = false;
			tapStatus.latestLongTap = new Date();
			action();
		}, minWaitTime);
	}

	// ---------- block push/revert under the open menu (mobile only) ----------

	// Driven by body's class flipping bp3-overlay-open on/off (a block menu opening/closing).
	function onBodyClass() {
		var open = document.body.classList.contains('bp3-overlay-open');
		if (open) {
			if (!pushedEl && isMobile() && pendingBlock && (Date.now() - pendingAt) < 1500) {
				// body gains the class slightly BEFORE the .bp3-menu paints, so retry across a few frames
				var block = pendingBlock, tries = 0;
				(function wait() {
					if (pushedEl || !document.body.classList.contains('bp3-overlay-open')) return;
					var menu = findBlockMenu();
					if (menu) { pushBlock(block, menu); return; }
					if (++tries < 12) requestAnimationFrame(wait);
				})();
			}
		} else {
			revert();
		}
	}

	function findBlockMenu() {
		var menus = Array.prototype.slice.call(document.querySelectorAll('.bp3-menu'))
			.filter(function (m) { return m.getBoundingClientRect().height > 80; });
		return menus.length ? menus[menus.length - 1] : null;
	}

	function pushBlock(el, menu) {
		if (!el) return;
		var b = el.getBoundingClientRect();
		var m = menu.getBoundingClientRect();
		// The menu is pinned to the left (openBlockMenu), so m.right is the SAME for every block. Land the
		// block's left just past it: target = m.right + gap is a FIXED absolute X; the push (a relative
		// shift) therefore differs per block (deeper blocks start further right → smaller push) but every
		// block ends at the same X, clear of the menu. No upper clamp: the left-pinned menu already bounds
		// the landing X on-screen, and clamping is exactly what left deep blocks stuck under the menu.
		var target = Math.round(m.right + menuGap);
		var push = Math.max(0, target - Math.round(b.left));
		el.style.webkitTransform = 'translate3d(' + push + 'px, 0, 0)';
		el.style.transform = 'translate3d(' + push + 'px, 0, 0)';
		el.style.backgroundColor = highlightColor;
		el.style.borderRadius = '4px';
		pushedEl = el;
	}

	function revert() {
		if (pushedEl) {
			pushedEl.style.webkitTransform = '';
			pushedEl.style.transform = '';
			pushedEl.style.backgroundColor = '';
			pushedEl.style.borderRadius = '';
			pushedEl = null;
		}
		pendingBlock = null;
	}

	function simulateClick(element, events, leftButton, opts) {
		if (!element) return;
		setTimeout(function () {
			events.forEach(function (type) {
				var _event = new MouseEvent(type, { view: window, bubbles: true, cancelable: true, buttons: leftButton ? 1 : 2, ...opts });
				_event.simulated = true;
				element.dispatchEvent(_event);
			});
		}, 0);
	}

	function animateCSS(node, animations, prefix) {
		prefix = prefix || 'animate__';
		return new Promise(function (resolve) {
			animations = animations.map(function (a) { return `${prefix}${a}`; });
			animations.push(`${prefix}animated`);
			node.classList.add(...animations);
			function done() { node.classList.remove(...animations); node.removeEventListener('animationend', done); resolve('ok'); }
			node.addEventListener('animationend', done);
		});
	}
})();
