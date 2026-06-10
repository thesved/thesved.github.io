/*
 * Viktor's Instant Roam — instant, dark, cursor-ready capture on every open.
 * version: 0.3.1  (2026-06-11)
 * author: @ViktorTabori
 *
 * v0.3.1: keyboard-continuity fix — the handoff now waits until Roam's editor has CONFIRMED focus
 *   before removing the overlay (no focus gap), so on iOS the soft keyboard never closes during the
 *   swap; the block stays synced with anything typed in the gap. (v0.3 removed the overlay on a
 *   fixed timer, which could race Roam's focus in the log view and drop the keyboard.)
 *
 * THE TRICK (proven on desktop CDP 2026-06-11, see instant-roam/):
 *   Roam boots from a Workbox-precached index.html and its OWN service worker serves that cached
 *   shell for the top-level navigation on every load. We can't register our own SW on
 *   roamresearch.com, but from this in-graph module (runs AFTER boot) we REWRITE the cached
 *   index.html in place. Roam's own SW then serves OUR shell at T=0 on the NEXT load — before any
 *   ClojureScript runs — painting instantly and rendering a focused capture box.
 *
 * v0.3 changes (Viktor's feedback):
 *   - Stays on the Daily Notes LOG (the default view) — no navigation to today's single page.
 *     The handoff focuses today's (topmost day's) top block in place.
 *   - The capture screen mirrors the graph's ACTUAL theme: each boot we sample the real
 *     background/text/accent colors and persist them, so next open's overlay matches whatever
 *     theme the graph uses (not just OS prefers-color-scheme). Falls back to OS theme on first run.
 *   - Enable/disable from Roam's Command Palette (Cmd/Ctrl-P, also in the ⋯ menu):
 *       "Instant Roam: disable …" / "Instant Roam: enable …". (Hard uninstall is still removing the
 *       roam/js loader key.)
 *
 * Handoff states:
 *   (a) user never engages  -> overlay melts the moment Roam is painted; nothing forced.
 *   (b) taps, types nothing  -> focuses an EMPTY top block of today's DNP (reuse/insert), ready.
 *   (c) types during boot    -> that text is already in the top block, caret at end, focused —
 *                               typing continues into the real editor with no visible seam.
 *   Keystrokes mirror to localStorage throughout — nothing is ever lost.
 *
 * iOS: programmatic focus() won't open the soft keyboard without a gesture, so the caret blinks
 * but the first TAP opens the keyboard. The manifest splash is darkened too, but iOS only reads
 * that at install — REMOVE + RE-ADD to the Home Screen to apply it.
 */
if (window.ViktorInstantroam && window.ViktorInstantroam.stop) window.ViktorInstantroam.stop();
window.ViktorInstantroam = (function () {
	var SALT = '3';                 // bump only if you change the injected <style> (capture-app changes auto-bump)
	var DARK = '#182026';
	var LSO = 'IR_orig_shell', LSM = 'IR_orig_manifest', LST = 'IR_theme', LSD = 'IR_disabled';

	// ---------- the instant-capture app (serialized into the shell; must be self-contained) ----------
	function __IR_capture() {
		try {
			if (window.__IR_CAPTURE) return;
			var W = window, D = document, LS = 'IR_buffer';
			var CAP = { ts: Date.now(), done: false, engaged: false, hydrated: false, dismissed: false };
			W.__IR_CAPTURE = CAP;

			// Theme: mirror the graph's real colors (persisted by the module last boot); else OS theme.
			function alpha(c, a) { var m = (c || '').match(/(\d+)[,\s]+(\d+)[,\s]+(\d+)/); return m ? 'rgba(' + m[1] + ',' + m[2] + ',' + m[3] + ',' + a + ')' : c; }
			var bg, fg, dim, caret, th = null;
			try { th = JSON.parse(localStorage.getItem('IR_theme') || 'null'); } catch (e) { }
			if (th && th.bg && th.fg) { bg = th.bg; fg = th.fg; dim = alpha(fg, 0.45); caret = th.accent || fg; }
			else { var lt = false; try { lt = W.matchMedia && W.matchMedia('(prefers-color-scheme: light)').matches; } catch (e) { } bg = lt ? '#ffffff' : '#182026'; fg = lt ? '#1a1a1a' : '#e8eaed'; dim = lt ? 'rgba(0,0,0,.45)' : 'rgba(255,255,255,.4)'; caret = '#4c9aff'; }

			var ov = D.createElement('div'); ov.id = 'IR_overlay';
			ov.style.cssText = 'position:fixed;inset:0;z-index:2147483600;background:' + bg + ';color:' + fg + ';display:flex;flex-direction:column;font-family:Inter,system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased;opacity:1;transition:opacity .16s ease';

			var head = D.createElement('div');
			head.style.cssText = 'padding:16px 18px 4px;font-size:13px;color:' + dim + ';flex:none;display:flex;justify-content:space-between;align-items:center';
			var label = D.createElement('span'); label.textContent = 'Jot to today’s Daily Notes';
			var x = D.createElement('button'); x.textContent = '✕'; x.setAttribute('aria-label', 'close');
			x.style.cssText = 'background:none;border:none;color:' + dim + ';font-size:16px;cursor:pointer;padding:2px 6px;line-height:1';
			head.appendChild(label); head.appendChild(x);

			var ta = D.createElement('textarea'); ta.id = 'IR_input';
			ta.placeholder = 'Type your idea…'; ta.setAttribute('autocapitalize', 'sentences'); ta.setAttribute('autocorrect', 'on');
			ta.style.cssText = 'flex:1;width:100%;box-sizing:border-box;background:transparent;color:inherit;border:none;outline:none;resize:none;font-size:21px;line-height:1.5;padding:8px 18px calc(18px + env(safe-area-inset-bottom));caret-color:' + caret + ';font-family:inherit';
			try { var prev = localStorage.getItem(LS); if (prev) { ta.value = prev; if (prev.trim()) CAP.engaged = true; } } catch (e) { }

			ov.appendChild(head); ov.appendChild(ta);
			(D.body || D.documentElement).appendChild(ov);

			function focusBox() { try { ta.focus(); var n = ta.value.length; ta.setSelectionRange(n, n); } catch (e) { } }
			focusBox();
			ta.addEventListener('input', function () { CAP.engaged = true; try { localStorage.setItem(LS, ta.value); } catch (e) { } });
			ta.addEventListener('keydown', function (e) { CAP.engaged = true; if (e.key === 'Escape') { e.preventDefault(); dismiss(); } });
			ta.addEventListener('pointerdown', function () { CAP.engaged = true; });
			ov.addEventListener('pointerdown', function (e) { if (e.target === x) return; CAP.engaged = true; focusBox(); });
			x.addEventListener('click', function (e) { e.stopPropagation(); dismiss(); });

			function fadeRemove() { CAP.done = true; try { ov.style.opacity = '0'; } catch (e) { } setTimeout(function () { try { ov.remove(); } catch (e) { } }, 210); }
			function dismiss() { CAP.dismissed = true; fadeRemove(); }     // keep buffer; never force focus
			function clearBuf() { try { localStorage.removeItem(LS); } catch (e) { } }
			function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

			// Ensure today's DNP has an empty top block (reuse/insert), put any typed text there, and
			// hand the keyboard to Roam's real editor WITHOUT a focus gap so iOS never closes it. We
			// stay on the Daily Notes log (no navigation).
			function hydrate(a) {
				if (CAP.hydrated || CAP.dismissed) return; CAP.hydrated = true;
				(async function () {
					try {
						var dnp = a.util.dateToPageUid(new Date());
						if (!a.pull('[:db/id]', [':block/uid', dnp])) { try { await a.createPage({ page: { title: a.util.dateToPageTitle(new Date()), uid: dnp } }); } catch (e) { } }
						await sleep(30);
						var text = (ta.value || '').replace(/\s+$/, '');     // read as late as possible
						var p = a.pull('[{:block/children [:block/string :block/uid :block/order]}]', [':block/uid', dnp]);
						var kids = (p && p[':block/children']) || [];
						kids.sort(function (m, n) { return (m[':block/order'] || 0) - (n[':block/order'] || 0); });
						var top = kids[0], topUid = top ? top[':block/uid'] : null, topEmpty = top ? !((top[':block/string'] || '').trim()) : false;
						var target;
						if (topUid && topEmpty) { target = topUid; if (text) { try { await a.updateBlock({ block: { uid: topUid, string: text } }); } catch (e) { } } }
						else { target = a.util.generateUID(); try { await a.createBlock({ location: { 'parent-uid': dnp, order: 0 }, block: { uid: target, string: text } }); } catch (e) { } }
						clearBuf();
						// Keep OUR textarea focused (keyboard up) and poll Roam's focus until its editor
						// actually holds the block, syncing anything typed in the gap. ONLY THEN remove the
						// overlay — there is never an instant with nothing focused, so the keyboard stays up
						// and the user just keeps typing into the real top block without noticing the swap.
						var written = text, caret = text.length, settled = false;
						for (var i = 0; i < 40 && !CAP.dismissed; i++) {
							var cur = (ta.value || '').replace(/\s+$/, '');
							if (cur !== written) { try { await a.updateBlock({ block: { uid: target, string: cur } }); } catch (e) { } written = cur; caret = cur.length; }
							try { a.ui.setBlockFocusAndSelection({ location: { 'block-uid': target, 'window-id': 'main-window' }, selection: { start: caret } }); } catch (e) { }
							await sleep(70);
							var f = null; try { f = a.ui.getFocusedBlock(); } catch (e) { }
							if (f && f['block-uid'] === target) { settled = true; break; }
						}
						fadeRemove();
					} catch (e) { fadeRemove(); }
				})();
			}

			function painted() {
				var app = D.getElementById('app');
				if (!(app && app.children.length > 0)) return false;
				var spin = D.querySelector('[class*="astrolabe"],img[src*="astrolabe"],.loading-astrolabe');
				var spinnerVisible = spin && spin.getClientRects().length > 0;   // a HIDDEN astrolabe lingers post-boot — ignore it
				return !spinnerVisible;
			}

			// Engaged -> seamless handoff. Not engaged -> wait until Roam has painted, then melt (so we
			// never reveal a half-loaded/white screen).
			var tries = 0;
			var poll = setInterval(function () {
				tries++;
				var a = W.roamAlphaAPI;
				var ready = a && a.util && a.createBlock && a.ui && a.ui.mainWindow;
				if (CAP.done || CAP.dismissed) { clearInterval(poll); return; }
				if (ready && CAP.engaged) { clearInterval(poll); hydrate(a); }
				else if (ready && painted()) { clearInterval(poll); fadeRemove(); }
				else if (tries > 1500) { clearInterval(poll); fadeRemove(); }   // ~150s hard safety
			}, 100);
		} catch (e) { }
	}

	var CAPTURE_SRC = '(' + __IR_capture.toString() + ')();';
	function hashStr(s) { var h = 5381, i = s.length; while (i) h = (h * 33) ^ s.charCodeAt(--i); return (h >>> 0).toString(36); }
	var VERSION = SALT + '-' + hashStr(CAPTURE_SRC);   // auto-bumps whenever the capture app changes -> forces a re-poison

	// ---------- installer ----------
	function strip(html) {
		return html
			.replace(/<style id="IR_style"[\s\S]*?<\/style>\s*/g, '')
			.replace(/<script id="IR_boot"[\s\S]*?<\/script>\s*/g, '');
	}
	async function cacheEntry(pred) {
		try {
			if (!('caches' in window)) return null;
			var names = await caches.keys();
			var cn = names.find(function (n) { return /workbox-precache/.test(n); });
			if (!cn) return null;
			var c = await caches.open(cn);
			var reqs = await c.keys();
			var req = reqs.find(function (r) { return pred(new URL(r.url).pathname); });
			return req ? { cache: c, req: req } : null;
		} catch (e) { return null; }
	}
	var isIndex = function (p) { return /index\.html/.test(p) || p === '/'; };
	var isManifest = function (p) { return /manifest\.webmanifest/.test(p); };
	function htmlResp(t) { return new Response(t, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }); }

	async function poison() {
		try {
			var e = await cacheEntry(isIndex); if (!e) return;
			var html = await (await e.cache.match(e.req)).text();
			var isP = html.indexOf('id="IR_style"') !== -1;
			if (isP && html.indexOf('data-irv="' + VERSION + '"') !== -1) return;     // already current
			var orig = isP ? strip(html) : html;
			try { if (!localStorage.getItem(LSO)) localStorage.setItem(LSO, orig); } catch (_) { }
			var styleTag = '<style id="IR_style" data-irv="' + VERSION + '">html,body{background:' + DARK + ' !important;}@media (prefers-color-scheme: light){html,body{background:#ffffff !important;}}</style>';
			var scriptTag = '<script id="IR_boot" data-irv="' + VERSION + '">' + CAPTURE_SRC + '<\/script>';
			var poisoned = orig.replace('</head>', styleTag + '</head>').replace(/<body[^>]*>/, function (m) { return m + scriptTag; });
			if (poisoned.indexOf('IR_boot') === -1 || poisoned.indexOf('IR_style') === -1) return;   // never write a broken shell
			await e.cache.put(e.req, htmlResp(poisoned));
			if (doLog) console.log('** instant-roam: index poisoned (' + VERSION + ') **');
		} catch (_) { }
	}

	// Kill the iOS native white splash (manifest background_color #FFF -> dark). Applies only after
	// the PWA is removed + re-added to the Home Screen (iOS caches the splash at install).
	async function poisonManifest() {
		try {
			var e = await cacheEntry(isManifest); if (!e) return;
			var txt = await (await e.cache.match(e.req)).text();
			var m; try { m = JSON.parse(txt); } catch (_) { return; }
			if (m.background_color === DARK) return;
			try { if (!localStorage.getItem(LSM)) localStorage.setItem(LSM, txt); } catch (_) { }
			m.background_color = DARK;
			await e.cache.put(e.req, new Response(JSON.stringify(m), { status: 200, headers: { 'Content-Type': 'application/manifest+json' } }));
		} catch (_) { }
	}

	async function unpoison() {
		try {
			var e = await cacheEntry(isIndex);
			if (e) {
				var html = await (await e.cache.match(e.req)).text();
				if (html.indexOf('id="IR_style"') !== -1) {
					var orig = null; try { orig = localStorage.getItem(LSO); } catch (_) { }
					await e.cache.put(e.req, htmlResp(orig || strip(html)));
				}
			}
			var mraw = null; try { mraw = localStorage.getItem(LSM); } catch (_) { }
			if (mraw) { var me = await cacheEntry(isManifest); if (me) await me.cache.put(me.req, new Response(mraw, { status: 200, headers: { 'Content-Type': 'application/manifest+json' } })); }
		} catch (_) { }
	}

	// Sample the graph's actual theme so next open's overlay matches it (not just OS theme).
	function captureTheme() {
		try {
			var tries = 0;
			var iv = setInterval(function () {
				tries++;
				var txtEl = document.querySelector('.rm-block-text, .roam-article .rm-block, .roam-article');
				if (!txtEl && tries <= 50) return;
				clearInterval(iv);
				try {
					var fg = getComputedStyle(txtEl || document.body).color;
					var el = txtEl || document.querySelector('.roam-article, .roam-body-main, .roam-app, #app') || document.body, bg = null;
					while (el) { var c = getComputedStyle(el).backgroundColor; if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') { bg = c; break; } el = el.parentElement; }
					if (!bg) bg = getComputedStyle(document.body).backgroundColor || '#ffffff';
					var accent = null, lk = document.querySelector('.rm-page-ref--link, .rm-page-ref, .roam-article a'); if (lk) accent = getComputedStyle(lk).color;
					localStorage.setItem(LST, JSON.stringify({ bg: bg, fg: fg, accent: accent }));
				} catch (e) { }
			}, 200);
		} catch (_) { }
	}

	// ---------- enable / disable (Command Palette) ----------
	var CMD_OFF = 'Instant Roam: disable (instant dark capture)';
	var CMD_ON = 'Instant Roam: enable (instant dark capture)';
	function toast(msg) {
		try { var d = document.createElement('div'); d.textContent = msg; d.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#182026;color:#fff;padding:10px 16px;border-radius:8px;font:14px Inter,system-ui,sans-serif;z-index:2147483647;box-shadow:0 4px 16px rgba(0,0,0,.4)'; document.body.appendChild(d); setTimeout(function () { try { d.remove(); } catch (e) { } }, 2400); } catch (e) { }
	}
	function isDisabled() { try { return localStorage.getItem(LSD) === '1'; } catch (e) { return false; } }
	function disable() { try { localStorage.setItem(LSD, '1'); } catch (e) { } unpoison(); var o = document.getElementById('IR_overlay'); if (o) o.remove(); toast('Instant Roam disabled — back to normal Roam on next open.'); }
	function enable() { try { localStorage.removeItem(LSD); } catch (e) { } poison(); poisonManifest(); captureTheme(); toast('Instant Roam enabled — reopen Roam to see it.'); }
	function addCommands() { try { var cp = window.roamAlphaAPI.ui.commandPalette; cp.addCommand({ label: CMD_OFF, callback: disable }); cp.addCommand({ label: CMD_ON, callback: enable }); } catch (e) { } }
	function removeCommands() { try { var cp = window.roamAlphaAPI.ui.commandPalette; cp.removeCommand({ label: CMD_OFF }); cp.removeCommand({ label: CMD_ON }); } catch (e) { } }

	var doLog = false, added = false;
	function start() {
		if (added) return; added = true;
		addCommands();
		if (isDisabled()) { unpoison(); return; }
		poison(); poisonManifest(); captureTheme();
	}
	function stop() {
		added = false;
		removeCommands();
		unpoison();
		var o = document.getElementById('IR_overlay'); if (o) o.remove();
		try { delete window.__IR_CAPTURE; } catch (_) { window.__IR_CAPTURE = undefined; }
	}

	start();
	return { start: start, stop: stop, poison: poison, poisonManifest: poisonManifest, unpoison: unpoison, captureTheme: captureTheme, enable: enable, disable: disable, version: VERSION };
})();
