/*
 * Viktor's Roam plugin: Mobile sidebar tap-to-close (+ mobile UX shims)
 * version: 0.2  (2026-06-12)  — search-tap keyboard relay: tapping the topbar search icon
 *   now autofocuses the full-screen search input WITH the iOS keyboard
 * author: @ViktorTabori
 *
 * On mobile the left sidebar (.roam-sidebar-container) opens as an overlay ON TOP of the
 * page with no backdrop, so there is no way to dismiss it by tapping the content (like a
 * normal drawer). This module adds a dimming scrim behind the open sidebar; tapping it
 * closes the sidebar.
 *
 * v0.2 search-tap keyboard relay: the mobile topbar search icon opens the full-screen
 * find-or-create modal; Roam DOES focus #rm-find-or-create-modal-input, but it does so
 * AFTER the modal mounts — outside the tap's user-gesture window — so iOS Safari/PWA shows
 * a focused input with NO keyboard (and to the user, "no autofocus"). Fix: in the tap's
 * click handler (still a trusted gesture) focus a tiny offscreen input SYNCHRONOUSLY —
 * that opens the keyboard — then hand focus to the modal input once it mounts
 * (editable→editable focus moves KEEP the iOS keyboard, same rule scrolldamper relies on).
 *
 * How it works (reverse-engineered from current Roam, May 2026):
 *  - Open/closed is driven by an inline style on .roam-sidebar-container: open sets
 *    `left: 0px` (animated via a 0.2s `left` transition); closed clears the inline style.
 *    So `el.style.left === '0px'` is the reliable open signal (the rect is mid-animation).
 *  - The close control is the menu button inside the sidebar:
 *    `.roam-sidebar-content .bp3-button.bp3-icon-menu-closed`. We click it to close.
 *  - The sidebar is z-index:999 inside .roam-app, so the scrim lives in .roam-app at
 *    z-index:998 — below the sidebar (sidebar stays tappable) but above the content.
 *  - Desktop (>600px) docks the sidebar in the layout, so the scrim is mobile-only.
 *
 * Loader wiring: registered via window.alphaChannel so the loader pulls it from a full URL
 * (thesved.github.io) without migrating the other modules. Exposes .stop() for reload.
 */
window.ViktorMobilesidebar = (function () {
	var MOBILE_MAX = 600;
	var BACKDROP_ID = 'viktor-mobile-sidebar-backdrop';
	var backdrop = null;
	var styleObserver = null;
	var treeObserver = null;
	var watched = null;

	function isMobile() { return window.innerWidth <= MOBILE_MAX; }
	function sidebarEl() { return document.querySelector('.roam-sidebar-container'); }

	// Open intent = inline `left: 0px` set by Roam (the bounding rect lags during the
	// 0.2s slide-in/out, so trust the style target, not the animated geometry).
	function isOpen(el) {
		if (!el) return false;
		var l = el.style.left;
		return !!l && parseFloat(l) >= 0;
	}

	function closeSidebar() {
		var btn = document.querySelector('.roam-sidebar-content .bp3-button.bp3-icon-menu-closed')
			|| document.querySelector('.roam-sidebar-content .bp3-icon-menu-closed');
		if (btn) btn.click();
	}

	function onTap(e) {
		e.preventDefault();
		e.stopPropagation();
		closeSidebar();
	}

	function showBackdrop(el) {
		if (!backdrop) {
			backdrop = document.createElement('div');
			backdrop.id = BACKDROP_ID;
			backdrop.style.cssText = [
				'position:fixed', 'top:0', 'left:0', 'right:0', 'bottom:0',
				'z-index:998', 'background:rgba(0,0,0,0.35)',
				'-webkit-tap-highlight-color:transparent', 'touch-action:manipulation'
			].join(';') + ';';
			backdrop.addEventListener('click', onTap);
			backdrop.addEventListener('touchstart', onTap, { passive: false });
		}
		// Live inside .roam-app so it shares the sidebar's stacking context (998 < 999).
		var host = (el && el.parentElement) || document.body;
		if (backdrop.parentElement !== host) host.appendChild(backdrop);
	}

	function hideBackdrop() {
		if (backdrop && backdrop.parentElement) backdrop.parentElement.removeChild(backdrop);
	}

	// ---------- v0.2: search-tap keyboard relay ----------
	var RELAY_ID = 'viktor-search-kbd-relay';
	var MODAL_INPUT = 'rm-find-or-create-modal-input';
	var relayRaf = 0;

	function relayInput() {
		var tmp = document.getElementById(RELAY_ID);
		if (!tmp) {
			tmp = document.createElement('input');
			tmp.id = RELAY_ID;
			tmp.type = 'text';
			tmp.setAttribute('autocapitalize', 'off');
			tmp.setAttribute('autocorrect', 'off');
			tmp.setAttribute('aria-hidden', 'true');
			// NOT display:none (unfocusable); 16px font so iOS doesn't zoom; opacity ~0 offscreen-ish
			tmp.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;' +
				'opacity:0.01;font-size:16px;background:transparent;color:transparent;caret-color:transparent;';
			document.body.appendChild(tmp);
		}
		return tmp;
	}

	function removeRelay() {
		if (relayRaf) { cancelAnimationFrame(relayRaf); relayRaf = 0; }
		var tmp = document.getElementById(RELAY_ID);
		if (tmp) tmp.remove();
	}

	function onSearchTap(e) {
		if (!isMobile()) return;
		// mobile topbar search trigger = a bp3-button wrapping bp3-icon-search (the desktop
		// layout has no such button — its icon is a plain span beside #find-or-create-input)
		var btn = e.target && e.target.closest && e.target.closest('.rm-topbar .bp3-button');
		if (!btn || !btn.querySelector('.bp3-icon-search')) return;
		// synchronous focus INSIDE the trusted tap → iOS opens the keyboard
		relayInput().focus({ preventScroll: true });
		// hand off to the modal input as soon as React mounts it (editable→editable keeps the kbd)
		var t0 = performance.now();
		(function poll() {
			relayRaf = 0;
			var inp = document.getElementById(MODAL_INPUT);
			if (inp) { inp.focus({ preventScroll: true }); removeRelay(); return; }
			if (performance.now() - t0 < 2500) relayRaf = requestAnimationFrame(poll);
			else removeRelay();
		})();
	}

	function sync() {
		var el = sidebarEl();
		// Re-attach the style observer if Roam re-created the sidebar node.
		if (el !== watched) attachStyleObserver(el);
		if (isMobile() && isOpen(el)) showBackdrop(el);
		else hideBackdrop();
	}

	function attachStyleObserver(el) {
		if (styleObserver) styleObserver.disconnect();
		watched = el || null;
		if (el) {
			styleObserver = new MutationObserver(sync);
			styleObserver.observe(el, { attributes: true, attributeFilter: ['style'] });
		}
	}

	function start() {
		stop();
		attachStyleObserver(sidebarEl());
		// Detect the sidebar being added/removed/replaced by React.
		treeObserver = new MutationObserver(sync);
		var app = document.querySelector('.roam-app') || document.body;
		treeObserver.observe(app, { childList: true });
		window.addEventListener('resize', sync);
		window.addEventListener('orientationchange', sync);
		document.addEventListener('click', onSearchTap, true);
		sync();
	}

	function stop() {
		if (styleObserver) { styleObserver.disconnect(); styleObserver = null; }
		if (treeObserver) { treeObserver.disconnect(); treeObserver = null; }
		window.removeEventListener('resize', sync);
		window.removeEventListener('orientationchange', sync);
		document.removeEventListener('click', onSearchTap, true);
		removeRelay();
		watched = null;
		hideBackdrop();
		backdrop = null;
		document.getElementById(BACKDROP_ID) && document.getElementById(BACKDROP_ID).remove();
	}

	start();
	return { start: start, stop: stop, sync: sync };
})();
