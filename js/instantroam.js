/*
 * Viktor's Instant Roam — instant, dark, cursor-ready capture on every open.
 * version: 0.1  (2026-06-11)
 * author: @ViktorTabori
 *
 * THE TRICK (proven on desktop CDP 2026-06-11, see instant-roam/):
 *   Roam boots from a Workbox-precached index.html and its OWN service worker serves that
 *   cached shell for the top-level navigation on every load. We cannot register our own SW
 *   on roamresearch.com (can't host a sw.js there) — but from this in-graph module (which runs
 *   AFTER boot) we can REWRITE the cached index.html in place. Roam's own SW then serves OUR
 *   doctored shell at T=0 on the NEXT load — before a single byte of ClojureScript runs. That
 *   shell paints dark instantly and renders a focused capture box; once roamAlphaAPI is ready
 *   the typed text is flushed into today's Daily Note and the overlay melts away.
 *
 * TWO PARTS:
 *   1. INSTALLER (this module, runs each boot): (re)writes the poisoned shell into the precache.
 *      Idempotent + versioned: re-poisons after a Roam deploy (new clean entry) or when this
 *      module's VERSION bumps. stop() restores Roam's original shell.
 *   2. CAPTURE APP (__IR_capture, serialized into the shell as an inline <script>): runs at T=0
 *      on the next load, paints the dark box, buffers every keystroke to localStorage (nothing is
 *      ever lost), and on Save writes a block to today's DNP via roamAlphaAPI.
 *
 * iOS caveat: iOS Safari won't open the soft keyboard from a programmatic focus() without a user
 * gesture, so on iPhone the caret blinks but the first tap opens the keyboard (the overlay focuses
 * the box on pointerdown). The dark+instant paint and the buffer are unaffected.
 *
 * UNINSTALL: run `window.ViktorInstantroam.stop()` (restores Roam's shell), then remove the
 * `instantroam` key from the roam/js loader's alphaChannel and reload.
 */
if (window.ViktorInstantroam && window.ViktorInstantroam.stop) window.ViktorInstantroam.stop();
window.ViktorInstantroam = (function () {
	var VERSION = '1';
	var LSO = 'IR_orig_shell';   // pristine shell backup
	var DARK = '#1a1a1a';

	// ---------- the instant-capture app (serialized into the shell; must be self-contained) ----------
	function __IR_capture() {
		try {
			if (window.__IR_CAPTURE) return;
			var W = window, D = document, LS = 'IR_buffer';
			var CAP = { ts: Date.now(), done: false }; W.__IR_CAPTURE = CAP;

			var light = false; try { light = W.matchMedia && W.matchMedia('(prefers-color-scheme: light)').matches; } catch (e) { }
			var bg = light ? '#ffffff' : '#1a1a1a', fg = light ? '#1a1a1a' : '#e8e8e8', dim = light ? 'rgba(0,0,0,.5)' : 'rgba(255,255,255,.45)';

			var ov = D.createElement('div'); ov.id = 'IR_overlay';
			ov.style.cssText = 'position:fixed;inset:0;z-index:2147483600;background:' + bg + ';color:' + fg + ';display:flex;flex-direction:column;font-family:Inter,system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased';

			var head = D.createElement('div');
			head.id = 'IR_head';
			head.style.cssText = 'padding:16px 18px 6px;font-size:13px;color:' + dim + ';flex:none';
			head.textContent = 'Instant capture';

			var ta = D.createElement('textarea');
			ta.id = 'IR_input'; ta.placeholder = 'Jot your idea…'; ta.setAttribute('autocapitalize', 'sentences');
			ta.style.cssText = 'flex:1;width:100%;box-sizing:border-box;background:transparent;color:inherit;border:none;outline:none;resize:none;font-size:21px;line-height:1.5;padding:6px 18px 10px;caret-color:#3b82f6;font-family:inherit';
			try { var prev = localStorage.getItem(LS); if (prev) ta.value = prev; } catch (e) { }
			ta.addEventListener('input', function () { try { localStorage.setItem(LS, ta.value); } catch (e) { } });

			function mkBtn(label, primary) {
				var b = D.createElement('button'); b.textContent = label;
				b.style.cssText = 'font:600 15px Inter,system-ui,sans-serif;padding:10px 16px;border-radius:8px;border:none;cursor:pointer;-webkit-appearance:none;' +
					(primary ? 'background:#3b82f6;color:#fff' : 'background:transparent;color:' + dim + ';border:1px solid ' + dim);
				return b;
			}
			var foot = D.createElement('div');
			foot.style.cssText = 'padding:10px 14px calc(10px + env(safe-area-inset-bottom));display:flex;gap:10px;justify-content:flex-end;flex:none';
			var bDismiss = mkBtn('Dismiss', false), bSave = mkBtn('Save → Daily Notes', true);
			foot.appendChild(bDismiss); foot.appendChild(bSave);

			ov.appendChild(head); ov.appendChild(ta); ov.appendChild(foot);
			(D.body || D.documentElement).appendChild(ov);

			function focusBox() { try { ta.focus(); var n = ta.value.length; ta.setSelectionRange(n, n); } catch (e) { } }
			focusBox();
			ov.addEventListener('pointerdown', function (e) { if (e.target === ta || e.target === bSave || e.target === bDismiss) return; focusBox(); });
			ta.addEventListener('keydown', function (e) {
				if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); }
				else if (e.key === 'Escape') { e.preventDefault(); dismiss(); }
			});
			bSave.addEventListener('click', save);
			bDismiss.addEventListener('click', dismiss);

			function teardown() { try { ov.remove(); } catch (e) { } CAP.done = true; }
			function dismiss() { teardown(); }            // keep the localStorage buffer so a draft survives
			function clearBuf() { try { localStorage.removeItem(LS); } catch (e) { } }

			function whenReady(cb) {
				var a = W.roamAlphaAPI; if (a && a.createBlock && a.util) { cb(a); return; }
				var n = 0, p = setInterval(function () { n++; var b = W.roamAlphaAPI; if (b && b.createBlock && b.util) { clearInterval(p); cb(b); } else if (n > 900) clearInterval(p); }, 100);
			}

			var saving = false;
			function save() {
				if (saving) return; saving = true;
				var text = (ta.value || '').replace(/\s+$/, '');
				if (!text) { saving = false; dismiss(); return; }
				whenReady(function (a) {
					try {
						var uid = a.util.dateToPageUid(new Date());
						var title = a.util.dateToPageTitle(new Date());
						var ensure = a.pull('[:db/id]', [':block/uid', uid]) ? Promise.resolve()
							: Promise.resolve(a.createPage({ page: { title: title, uid: uid } })).catch(function () { });
						ensure.then(function () {
							var bu = a.util.generateUID();
							return a.createBlock({ location: { 'parent-uid': uid, order: 0 }, block: { uid: bu, string: text } }).then(function () { return bu; });
						}).then(function (bu) {
							clearBuf(); teardown();
							try { setTimeout(function () { a.ui.setBlockFocusAndSelection({ location: { 'block-uid': bu, 'window-id': 'main-window' }, selection: { start: text.length } }); }, 200); } catch (e) { }
						}).catch(function () { saving = false; });   // keep overlay + buffer on failure
					} catch (e) { saving = false; }
				});
			}

			// Once Roam is ready: if the box is empty the user opened to READ, not jot -> melt away and
			// reveal Roam. If they've typed, keep the box and nudge them to Save.
			var tries = 0;
			var poll = setInterval(function () {
				tries++;
				var a = W.roamAlphaAPI;
				if (a && a.util && a.createBlock && a.ui) {
					clearInterval(poll);
					if (!CAP.done) {
						if (!(ta.value || '').trim()) teardown();
						else head.textContent = 'Instant capture · ⌘⏎ or Save';
					}
				} else if (tries > 900) { clearInterval(poll); }
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

	async function precacheEntry() {
		try {
			if (!('caches' in window)) return null;
			var names = await caches.keys();
			var cn = names.find(function (n) { return /workbox-precache/.test(n); });
			if (!cn) return null;
			var c = await caches.open(cn);
			var reqs = await c.keys();
			var req = reqs.find(function (r) { var u = new URL(r.url); return /index\.html/.test(u.pathname) || u.pathname === '/'; });
			if (!req) return null;
			return { cache: c, req: req };
		} catch (e) { return null; }
	}

	function htmlResp(text) { return new Response(text, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }); }

	async function poison() {
		try {
			var e = await precacheEntry(); if (!e) return;
			var html = await (await e.cache.match(e.req)).text();
			var isP = html.indexOf('id="IR_style"') !== -1;
			if (isP && html.indexOf('data-irv="' + VERSION + '"') !== -1) return;   // already current — nothing to do
			var orig = isP ? strip(html) : html;
			try { if (!localStorage.getItem(LSO)) localStorage.setItem(LSO, orig); } catch (_) { }
			var styleTag = '<style id="IR_style" data-irv="' + VERSION + '">html,body{background:' + DARK + ' !important;}@media (prefers-color-scheme: light){html,body{background:#ffffff !important;}}</style>';
			var scriptTag = '<script id="IR_boot" data-irv="' + VERSION + '">' + CAPTURE_SRC + '<\/script>';
			var poisoned = orig.replace('</head>', styleTag + '</head>').replace(/<body[^>]*>/, function (m) { return m + scriptTag; });
			if (poisoned.indexOf('IR_boot') === -1 || poisoned.indexOf('IR_style') === -1) return;   // injection failed — never write a broken shell
			await e.cache.put(e.req, htmlResp(poisoned));
			if (doLog) console.log('** instant-roam: precache poisoned (v' + VERSION + ') **');
		} catch (_) { }
	}

	async function unpoison() {
		try {
			var e = await precacheEntry(); if (!e) return;
			var html = await (await e.cache.match(e.req)).text();
			if (html.indexOf('id="IR_style"') === -1) return;
			var orig = null; try { orig = localStorage.getItem(LSO); } catch (_) { }
			await e.cache.put(e.req, htmlResp(orig || strip(html)));
			if (doLog) console.log('** instant-roam: precache restored **');
		} catch (_) { }
	}

	var doLog = false, added = false;
	function start() { if (added) return; added = true; poison(); }
	function stop() {
		added = false;
		unpoison();
		var o = document.getElementById('IR_overlay'); if (o) o.remove();
		try { delete window.__IR_CAPTURE; } catch (_) { window.__IR_CAPTURE = undefined; }
	}

	start();
	return { start: start, stop: stop, poison: poison, unpoison: unpoison, version: VERSION };
})();
