/*
 * Viktor's Roam Mobile Long tap → right-click on bullets + open-in-sidebar on pages/refs/filters
 * version: 0.4  (2026-05-30)
 * author: @ViktorTabori
 *
 * WHY THIS WAS REWRITTEN (v0.3 → v0.4):
 *   v0.3 tried to OPEN Roam's context menu itself by dispatching a synthetic `contextmenu`
 *   event, and shoved the block aside immediately. Current Roam (2026) ignores synthetic
 *   contextmenu events (its menu handler only fires on TRUSTED events), so the menu never
 *   opened. Worse, v0.3 actively BROKE the browser's own long-press: it dispatched a synthetic
 *   `touchend` (cancelling the native long-press gesture) and its click-blocker
 *   `preventDefault`-ed the real `contextmenu` — so even the native menu was suppressed, the
 *   block stayed shoved, and the revert (which waited for `body` to lose `bp3-overlay-open`,
 *   a class that was now never added) never fired. Net: block pushed + highlighted, no menu,
 *   never reverts. Exactly the reported bug.
 *
 * WHAT v0.4 DOES:
 *   Verified live: on mobile a real long-press already makes the browser emit a trusted
 *   `contextmenu`, and Roam DOES open its block menu from it (body gains `bp3-overlay-open`).
 *   So we stop fighting it:
 *     - BULLET (mobile only): do NOTHING on touch — let the native long-press open the menu.
 *       We only OBSERVE: when `body` gains `bp3-overlay-open` shortly after a bullet touch and a
 *       block context menu is open, slide that block clear of the menu + highlight it; revert
 *       when the menu closes. The menu sits in a fixed portal, so moving the block doesn't move
 *       the menu. Desktop never pushes (the menu opens beside the bullet and there's no touch).
 *     - PAGE REF / PAGE TITLE / SEARCH RESULT / FILTER (mobile): long-tap → shift-click to open
 *       in the right sidebar (unchanged behaviour; these use normal click which Roam still honors).
 *   We never block the native `contextmenu` anymore.
 */
if (window.ViktorLongtap && window.ViktorLongtap.stop) window.ViktorLongtap.stop();
window.ViktorLongtap = (function () {
	var doLog = false,
		minWaitTime = 200,        // ms a touch must be held to count as a long-tap (page/ref/filter path)
		clickBlockTime = 800,     // ms after a long-tap during which the follow-up click is swallowed
		animTime = 400,
		MOBILE_MAX = 600,
		highlightColor = 'rgba(255, 165, 0, 0.18)',
		menuGap = 8,              // px gap between the menu's right edge and the pushed block
		deduplicateSidebar = true,
		added = false,
		last = new Date(),
		tapStatus = { status: false, target: null, latestLongTap: null },
		// bullet-menu push state
		pendingBlock = null,      // .roam-block-container last touched on a bullet
		pendingAt = 0,            // timestamp of that touch
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
		_state: function () { return { pendingBlock: !!pendingBlock, pushedEl: !!pushedEl, mobile: isMobile(), agoMs: Date.now() - pendingAt }; }
	};

	function isMobile() { return window.innerWidth <= MOBILE_MAX; }

	function start() {
		if (added) return;
		added = true;
		// NOTE: 'contextmenu' is intentionally NOT blocked anymore — the native long-press menu needs it.
		'click mousedown mouseup touchstart touchmove touchend selectionchange'.split(' ').forEach(function (type) {
			document.addEventListener(type, process, { passive: true, capture: true });
		});
		// the click-swallow needs to actually cancel, so attach a non-passive click guard too
		document.addEventListener('click', clickGuard, { passive: false, capture: true });
		// observe the block context menu opening/closing to drive the push/revert
		bodyObserver = new MutationObserver(onBodyClass);
		bodyObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
		document.head.appendChild(css);
		if (doLog) console.log('** long tap v0.4 installed **');
	}

	function stop() {
		if (!added) return;
		added = false;
		'click mousedown mouseup touchstart touchmove touchend selectionchange'.split(' ').forEach(function (type) {
			document.removeEventListener(type, process, { passive: true, capture: true });
		});
		document.removeEventListener('click', clickGuard, { passive: false, capture: true });
		if (bodyObserver) { bodyObserver.disconnect(); bodyObserver = null; }
		revert();
		if (css.parentNode) css.parentNode.removeChild(css);
		if (doLog) console.log('** long tap v0.4 STOPPED **');
	}

	// Swallow the normal tap/click that follows a page/ref/filter long-tap (so it doesn't ALSO navigate).
	function clickGuard(e) {
		if (e.simulated) return;
		if (tapStatus.latestLongTap && (Date.now() - tapStatus.latestLongTap.getTime()) < clickBlockTime) {
			e.preventDefault();
			e.stopPropagation();
			if (window.getSelection().rangeCount) window.getSelection().removeAllRanges();
		}
	}

	function process(e) {
		last = new Date();
		var target = e.target;
		var location = {
			x: e.clientX || (e.targetTouches && e.targetTouches.length && e.targetTouches[0].clientX),
			y: e.clientY || (e.targetTouches && e.targetTouches.length && e.targetTouches[0].clientY),
		};

		// a moved/ended touch aborts a pending page/ref/filter long-tap
		if (e.type == 'touchmove' || e.type == 'touchend') { tapStatus.status = false; return; }

		// reset the long-tap arming flag on any mouse/selection noise (does NOT touch contextmenu)
		if (e.type.match(/^(click|mousedown|mouseup|selectionchange)$/i)) { tapStatus.status = false; return; }

		if (e.type != 'touchstart') return;

		// ---- BULLET path (mobile only): let the native long-press open the menu; we just record the block ----
		var controls = target.closest && target.closest('.controls');
		if (controls) {
			if (isMobile()) {
				pendingBlock = controls.closest('.roam-block-container');
				pendingAt = Date.now();
			}
			return; // no synthetic events, no preventDefault — the browser drives the long-press
		}

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
		// slide the block right so its left clears the menu's right edge (menu opens at the touch point)
		var push = Math.round(m.right - b.left + menuGap);
		push = Math.max(0, Math.min(push, Math.round(window.innerWidth * 0.6))); // keep it partly visible
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
