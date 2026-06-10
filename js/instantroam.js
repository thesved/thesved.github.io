/*
 * Viktor's Instant Roam — instant, dark, cursor-ready capture on every open.
 * version: 0.2  (2026-06-11)
 * author: @ViktorTabori
 *
 * THE TRICK (proven on desktop CDP 2026-06-11, see instant-roam/):
 *   Roam boots from a Workbox-precached index.html and its OWN service worker serves that cached
 *   shell for the top-level navigation on every load. We can't register our own SW on
 *   roamresearch.com, but from this in-graph module (runs AFTER boot) we REWRITE the cached
 *   index.html in place. Roam's own SW then serves OUR shell at T=0 on the NEXT load — before any
 *   ClojureScript runs — painting dark instantly and rendering a focused capture box.
 *
 * v0.2 changes (from Viktor's feedback):
 *   - System-themed (prefers-color-scheme) dark shell; the overlay stays up until Roam is truly
 *     ready, so there's no white Roam-loader flash on entry OR exit.
 *   - Also poisons the manifest background_color (#FFF -> #182026) to kill the iOS native white
 *     splash. NOTE: iOS caches the splash at install time, so this only takes effect after you
 *     REMOVE + RE-ADD Roam to the Home Screen.
 *   - Seamless engage-gated handoff:
 *       (a) user never engages the box  -> overlay just melts to reveal Roam (no forced focus).
 *       (b) user taps but types nothing -> on ready, ensure an EMPTY top block on today's DNP is
 *           focused (reuse the empty top block, else insert one), ready to type.
 *       (c) user types during the boot  -> same, but the typed text is already in that top block
 *           with the caret at the end, so typing continues into the real editor unnoticed.
 *   Keystrokes are mirrored to localStorage throughout — nothing is ever lost.
 *
 * iOS caveat: iOS won't open the soft keyboard from a programmatic focus() without a gesture, so
 * the caret blinks but the first TAP opens the keyboard (tapping the overlay focuses the box).
 *
 * UNINSTALL: window.ViktorInstantroam.stop() (restores Roam's shell + manifest), then remove the
 * `instantroam` key from the roam/js loader's alphaChannel and reload.
 */
if (window.ViktorInstantroam && window.ViktorInstantroam.stop) window.ViktorInstantroam.stop();
window.ViktorInstantroam = (function () {
	var VERSION = '2';
	var DARK = '#182026';
	var LSO = 'IR_orig_shell', LSM = 'IR_orig_manifest';

	// ---------- the instant-capture app (serialized into the shell; must be self-contained) ----------
	function __IR_capture() {
		try {
			if (window.__IR_CAPTURE) return;
			var W = window, D = document, LS = 'IR_buffer';
			var CAP = { ts: Date.now(), done: false, engaged: false, hydrated: false, dismissed: false };
			W.__IR_CAPTURE = CAP;

			var light = false; try { light = W.matchMedia && W.matchMedia('(prefers-color-scheme: light)').matches; } catch (e) { }
			var bg = light ? '#ffffff' : '#182026', fg = light ? '#1a1a1a' : '#e8eaed', dim = light ? 'rgba(0,0,0,.45)' : 'rgba(255,255,255,.4)';

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
			ta.style.cssText = 'flex:1;width:100%;box-sizing:border-box;background:transparent;color:inherit;border:none;outline:none;resize:none;font-size:21px;line-height:1.5;padding:8px 18px calc(18px + env(safe-area-inset-bottom));caret-color:#4c9aff;font-family:inherit';
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

			function focusBlock(a, uid, caret, tries) {
				try { a.ui.setBlockFocusAndSelection({ location: { 'block-uid': uid, 'window-id': 'main-window' }, selection: { start: caret } }); } catch (e) { }
				if (tries > 0) setTimeout(function () {
					var f = null; try { f = a.ui.getFocusedBlock(); } catch (e) { }
					if (!f || f['block-uid'] !== uid) focusBlock(a, uid, caret, tries - 1);
				}, 130);
			}

			function hydrate(a) {
				if (CAP.hydrated || CAP.dismissed) return; CAP.hydrated = true;
				(async function () {
					try {
						var dnp = a.util.dateToPageUid(new Date());
						if (!a.pull('[:db/id]', [':block/uid', dnp])) { try { await a.createPage({ page: { title: a.util.dateToPageTitle(new Date()), uid: dnp } }); } catch (e) { } }
						try { await a.ui.mainWindow.openPage({ page: { uid: dnp } }); } catch (e) { }
						await sleep(60);
						var text = (ta.value || '').replace(/\s+$/, '');     // read as late as possible
						var p = a.pull('[{:block/children [:block/string :block/uid :block/order]}]', [':block/uid', dnp]);
						var kids = (p && p[':block/children']) || [];
						kids.sort(function (m, n) { return (m[':block/order'] || 0) - (n[':block/order'] || 0); });
						var top = kids[0], topUid = top ? top[':block/uid'] : null, topEmpty = top ? !((top[':block/string'] || '').trim()) : false;
						var target;
						if (topUid && topEmpty) { target = topUid; if (text) { try { await a.updateBlock({ block: { uid: topUid, string: text } }); } catch (e) { } } }
						else { target = a.util.generateUID(); try { await a.createBlock({ location: { 'parent-uid': dnp, order: 0 }, block: { uid: target, string: text } }); } catch (e) { } }
						clearBuf();
						await sleep(50);
						// reconcile any keystrokes typed during hydrate, then focus caret at the end
						var latest = (ta.value || '').replace(/\s+$/, '');
						if (latest !== text) { try { await a.updateBlock({ block: { uid: target, string: latest } }); } catch (e) { } text = latest; }
						focusBlock(a, target, text.length, 6);
						await sleep(90);
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

			// Poll for Roam readiness. Engaged -> seamless handoff. Not engaged -> wait until Roam has
			// actually painted, then melt away (so we never reveal a half-loaded/white screen).
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
			if (doLog) console.log('** instant-roam: index poisoned (v' + VERSION + ') **');
		} catch (_) { }
	}

	// Manifest: kill the iOS native white splash (background_color #FFF -> dark). Takes effect only
	// after the PWA is removed + re-added to the Home Screen (iOS caches the splash at install).
	async function poisonManifest() {
		try {
			var e = await cacheEntry(isManifest); if (!e) return;
			var txt = await (await e.cache.match(e.req)).text();
			var m; try { m = JSON.parse(txt); } catch (_) { return; }
			if (m.background_color === DARK) return;
			try { if (!localStorage.getItem(LSM)) localStorage.setItem(LSM, txt); } catch (_) { }
			m.background_color = DARK;
			await e.cache.put(e.req, new Response(JSON.stringify(m), { status: 200, headers: { 'Content-Type': 'application/manifest+json' } }));
			if (doLog) console.log('** instant-roam: manifest splash darkened (re-add to Home Screen) **');
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
			if (doLog) console.log('** instant-roam: restored Roam shell + manifest **');
		} catch (_) { }
	}

	var doLog = false, added = false;
	function start() { if (added) return; added = true; poison(); poisonManifest(); }
	function stop() {
		added = false;
		unpoison();
		var o = document.getElementById('IR_overlay'); if (o) o.remove();
		try { delete window.__IR_CAPTURE; } catch (_) { window.__IR_CAPTURE = undefined; }
	}

	start();
	return { start: start, stop: stop, poison: poison, poisonManifest: poisonManifest, unpoison: unpoison, version: VERSION };
})();
