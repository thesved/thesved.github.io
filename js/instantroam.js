/*
 * Viktor's Instant Roam — instant, dark, cursor-ready capture on every open.
 * version: 0.6.0  (2026-07-03) — per-graph scoping + capture cmdbar + [[ ]]/#/: autocomplete +
 *                                  cached page-name store + templates + subtle loading ladder.
 *   - ROUTE/GRAPH SCOPING: the T=0 shell classifies location.hash itself. Overlay shows ONLY on
 *     /app/<graph> (or /offline/<graph>) when that graph is enabled in IR2:graphs (the module
 *     enables its own graph on boot; ViktorOpts.instantRoam===false disables). signin / signup /
 *     graph picker / quick-capture / other graphs get the plain shell (dark bg only, no overlay).
 *     Any classifier throw = fail-closed (inert shell). All state is per-graph: IR2:<g>:*.
 *   - PAGE-NAME STORE: every tab of a graph maintains IR2:<g>:pages = 'hash|n|ts\n' + titles
 *     newline-joined, recency-ordered (edit-time DESC, DNP date-pages demoted, \n\r titles
 *     dropped). Idempotent across tabs: djb2 content-hash compare-and-swap — identical bytes by
 *     construction, so the first writer wins and the rest skip (no locks, no thrash). Sync write
 *     on visibilitychange→hidden / pagehide (freshest at next T=0); idle write post-boot + 5-min.
 *   - CAPTURE CMDBAR (touch devices): [[ , checkbox toggle, image, undo/redo. SB2 keyboard pin
 *     (translateY(vv.height+vv.offsetTop−SCREEN_H), rAF ride — ported from cmdbar.js). All taps
 *     mousedown-preventDefault (iOS keyboard never drops). ONE mutation primitive everywhere:
 *     setSelectionRange + execCommand('insertText') → native undo stack stays coherent.
 *   - AUTOCOMPLETE: typing [[ (auto-closes ]]), #tag, or :template opens a menu fed from the
 *     cached stores. Menu anchors under the caret line, repositions with the keyboard, commits on
 *     tap/Enter/Tab. ':' Enter-commit needs a 2+ char partial (Return stays the newline key).
 *   - TEMPLATES: module caches static-safe templates (pages under ViktorRoamOpts.searchPages,
 *     default 'template/'; bodies with js/fetch/clipboard/rand/embed markers are skipped) into
 *     IR2:<g>:templates for the ':' menu. $cursor honored.
 *   - IMAGES: queued in memory as Files (chips above the bar) — NEVER inline in the typed text.
 *     After the v0.5.4 write→focus→reconcile→seal→read-back-confirmed-clear chain finishes
 *     UNTOUCHED, each image becomes its own sibling block → roamAlphaAPI.file.upload → updateBlock.
 *     The focused text block is never written to asynchronously.
 *   - LOADING LADDER: 1.5px hairline (fades in at 800ms, fake-determinate vs the rolling-7 boot
 *     median, parks at 88%); offline short-circuits at 5s and pauses the fill; tier1 (2×median,
 *     ≤25s) swaps the caption to a calm reassure line; 30s adds a diagnosis; 60s adds 'Reload'
 *     (silent once-per-session guard) + 'Open plain Roam' (kill-switch URL). No red, no modal,
 *     typing never interrupted. Successful boots feed IR2:<g>:boot (last 7, capped 60s).
 *   - SAFETY: buffer > everything on quota (evicts IR2:*:pages/templates/boot and retries);
 *     hashchange dismissal conservative (instant only for signin/signup/mobile-graph-too-large/
 *     DIFFERENT graph; else 400ms re-check); hydrate refuses to write unless
 *     roamAlphaAPI.graph.name === the graph parsed at T=0; poison() refreshes IR_orig_shell
 *     whenever it sees a clean shell; unpoison() prefers strip(current) over the stale backup;
 *     manifest start_url is poisoned to /#/app/<lastGraph> so a Home-Screen re-add still lands on
 *     the graph (Roam's default /#/pwa would strand the overlay on quick-capture).
 * version: 0.5.4  (2026-06-11) — stale-buffer seal (see learnings). 0.5.x history in git.
 * author: @ViktorTabori
 *
 * THE TRICK (proven on desktop CDP 2026-06-11, see instant-roam/):
 *   Roam boots from a Workbox-precached index.html and its OWN service worker serves that cached
 *   shell for the top-level navigation on every load. We can't register our own SW on
 *   roamresearch.com, but from this in-graph module (runs AFTER boot) we REWRITE the cached
 *   index.html in place. Roam's own SW then serves OUR shell at T=0 on the NEXT load — before any
 *   ClojureScript runs — painting dark instantly and rendering a focused capture box.
 *
 * iOS caveat: iOS won't open the soft keyboard from a programmatic focus() without a gesture, so
 * the caret blinks but the first TAP opens the keyboard (tapping the overlay focuses the box).
 * DEBUG: localStorage.IR_debug='1' → trace + ⧉ copy button (see v0.2.1-dbg notes in git history).
 *
 * UNINSTALL: window.ViktorInstantroam.stop() (restores Roam's shell + manifest), then remove the
 * `instantroam` key from the roam/js loader's alphaChannel and reload.
 */
if (window.ViktorInstantroam && window.ViktorInstantroam.stop) window.ViktorInstantroam.stop();
window.ViktorInstantroam = (function () {
	var SALT = '3';                 // bump only if you change the injected <style> (capture-app changes auto-bump)
	var DEFER_BOOT = false;         // NEVER re-enable blind: deferred boot bricked real iOS (learnings 2026-06-11)
	var DARK = '#182026';
	var LSO = 'IR_orig_shell', LSM = 'IR_orig_manifest';

	// ---------- the instant-capture app (serialized into the shell; must be self-contained) ----------
	function __IR_capture() {
		try {
			if (window.__IR_CAPTURE) return;
			var W = window, D = document;

			// ---------- route + graph classifier (fail-closed: any throw → inert shell) ----------
			function classify(h) {
				try {
					h = String(h || ''); var hi = h.indexOf('#'); if (hi >= 0) h = h.slice(hi + 1);
					h = h.split('?')[0]; if (h.charAt(0) !== '/') h = '/' + h;
					var m = /^\/(app|offline)\/([^\/]+)/.exec(h);
					if (m) { var g = m[2]; try { g = decodeURIComponent(g); } catch (e) { } return { k: 'graph', g: g, r: '/' + m[1] }; }
					return { k: 'other', g: null, r: (h.match(/^\/[^\/]*/) || ['/'])[0].toLowerCase() };
				} catch (e) { return { k: 'other', g: null, r: '' }; }
			}
			try { localStorage.setItem('IR2:lastHash', String(W.location.hash || '')); } catch (e) { }
			var CLS = classify(W.location.hash);
			var EN = {}; try { EN = JSON.parse(localStorage.getItem('IR2:graphs') || '{}') || {}; } catch (e) { }
			// The installed-PWA start_url is /#/pwa → Roam redirects it to /quick-capture (a non-graph
			// route where capture can never hydrate), and the webmanifest is NOT precached anymore so we
			// can't poison start_url. We run BEFORE Roam's router initializes: when exactly ONE graph is
			// enabled and there is no share-target payload, retarget the hash to that graph — the PWA
			// boots straight into it, exactly like a pre-/#/pwa install. replaceState: no history entry,
			// no hashchange.
			if (CLS.k === 'other' && (CLS.r === '/pwa' || CLS.r === '/quick-capture')) {
				try {
					var enN = []; for (var ek in EN) { if (EN[ek] && EN[ek].on) enN.push(ek); }
					var hasShare = /[?&](title|text|url)=/.test(String(W.location.search || '')) || String(W.location.hash || '').indexOf('?') >= 0;
					if (enN.length === 1 && !hasShare) {
						var nh = '#/app/' + encodeURIComponent(enN[0]);
						try { history.replaceState(null, '', W.location.pathname + W.location.search + nh); } catch (e2) { W.location.hash = nh; }
						CLS = classify(nh);
					}
				} catch (e) { }
			}
			if (CLS.k !== 'graph' || !(EN[CLS.g] && EN[CLS.g].on)) return;   // inert: login / picker / other graphs / disabled
			var G = CLS.g;
			function KK(n) { return 'IR2:' + G + ':' + n; }
			var LS = KK('buffer');

			var CAP = { ts: Date.now(), done: false, engaged: false, hydrated: false, dismissed: false, sealed: false, graph: G };
			W.__IR_CAPTURE = CAP;

			// ---------- debug layer (opt-in: localStorage.IR_debug='1') ----------
			var DBG = false; try { DBG = localStorage.getItem('IR_debug') === '1'; } catch (e) { }
			var IRV = ''; try { var bt = D.getElementById('IR_boot'); IRV = (bt && bt.getAttribute('data-irv')) || ''; } catch (e) { }
			var labKey = 'IR_lab_done_' + IRV;
			var LAB = false; try { LAB = DBG && localStorage.getItem('IR_lab') === '1' && !localStorage.getItem(labKey); } catch (e) { }
			var labFinished = false;
			var T0 = Date.now(), LOG = [], flushQ = false;
			if (DBG) W.__IR_LOG = LOG;
			function vvh() { try { return Math.round(W.visualViewport ? W.visualViewport.height : W.innerHeight); } catch (e) { return -1; } }
			function cls(el) {
				if (!el) return 'null';
				if (el === D.body) return 'body';
				if (el === D.documentElement) return 'html';
				var id = el.id || '', tag = (el.tagName || '').toLowerCase();
				if (id === 'IR_input') return 'IR_input';
				if (id === 'IR_lab_b') return 'IR_lab_b';
				var cn = (typeof el.className === 'string' && el.className) ? el.className : '';
				if (tag === 'textarea' && /rm-block-input/.test(cn)) return 'ROAM-TA#' + id;
				var edit = tag === 'textarea' || tag === 'input' || el.isContentEditable;
				return (edit ? 'EDIT:' : '') + tag + (id ? '#' + id : '') + (cn ? '.' + cn.split(/\s+/).slice(0, 2).join('.') : '');
			}
			function L(m) {
				if (!DBG) return;
				LOG.push((Date.now() - T0) + ' ' + m);
				if (!flushQ) { flushQ = true; setTimeout(function () { flushQ = false; try { localStorage.setItem('IR_log', LOG.join('\n')); } catch (e) { } }, 150); }
			}
			function engage(src) {
				if (!CAP.engaged) { L('ENGAGED via ' + src + ' vv=' + vvh()); CAP.engaged = true; }
				scheduleLab();
			}
			if (DBG) {
				try { var pv = localStorage.getItem('IR_log'); if (pv) localStorage.setItem('IR_log_prev', pv); localStorage.removeItem('IR_log'); } catch (e) { }
				L('boot irv=' + IRV + ' graph=' + G + ' lab=' + (LAB ? 'armed' : 'off') + ' vv=' + vvh() + ' ih=' + W.innerHeight + ' ua=' + (W.navigator && W.navigator.userAgent));
				D.addEventListener('focusin', function (e) { L('focusin  ' + cls(e.target) + '  (from ' + cls(e.relatedTarget) + ') vv=' + vvh()); }, true);
				D.addEventListener('focusout', function (e) { L('focusout ' + cls(e.target) + '  (to ' + cls(e.relatedTarget) + ') vv=' + vvh()); }, true);
				try { if (W.visualViewport) W.visualViewport.addEventListener('resize', function () { L('vv-resize ' + vvh() + ' ot=' + Math.round(W.visualViewport.offsetTop) + ' active=' + cls(D.activeElement)); }); } catch (e) { }
				var lastA = '', lastV = -1;
				setInterval(function () {
					var a = cls(D.activeElement), v = vvh();
					if (a !== lastA || Math.abs(v - lastV) > 2) { L('tick active=' + a + ' vv=' + v); lastA = a; lastV = v; }
				}, 200);
				var cb = D.createElement('button'); cb.id = 'IR_dbgbtn'; cb.textContent = '⧉'; cb.setAttribute('aria-label', 'copy IR trace');
				cb.style.cssText = 'position:fixed;right:8px;bottom:calc(8px + env(safe-area-inset-bottom));z-index:2147483647;width:34px;height:34px;border-radius:17px;border:1px solid rgba(127,127,127,.45);background:rgba(32,38,46,.88);color:#9ecbff;font-size:15px;line-height:1;padding:0';
				cb.addEventListener('mousedown', function (e) { e.preventDefault(); });
				cb.addEventListener('click', function (e) {
					e.preventDefault(); e.stopPropagation();
					var txt = LOG.join('\n'); try { var pp0 = localStorage.getItem('IR_log_prev'); if (pp0) txt += '\n--- prev boot ---\n' + pp0; } catch (e2) { }
					function fb() { try { var t = D.createElement('textarea'); t.value = txt; t.readOnly = true; t.style.cssText = 'position:fixed;left:5%;right:5%;top:10%;height:60%;z-index:2147483647;font-size:11px;background:#fff;color:#000'; (D.body || D.documentElement).appendChild(t); t.onblur = function () { t.remove(); }; t.focus(); t.select(); } catch (e3) { } }
					function ok() { cb.textContent = '✓'; setTimeout(function () { cb.textContent = '⧉'; }, 1200); }
					try { W.navigator.clipboard.writeText(txt).then(ok, fb); } catch (e4) { fb(); }
				});
				(D.body || D.documentElement).appendChild(cb);
			}

			// ---------- quota-safe buffer mirror: the buffer outranks every regenerable cache ----------
			function setBuf(v) {
				try { localStorage.setItem(LS, v); }
				catch (e) {
					try {
						var ks = [];
						for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (/^IR2:.*:(pages|templates|boot)$/.test(k)) ks.push(k); }
						for (var j = 0; j < ks.length; j++) localStorage.removeItem(ks[j]);
						localStorage.setItem(LS, v);
						L('buffer write recovered by cache eviction');
					} catch (e2) { L('buffer write FAILED (quota)'); }
				}
			}

			// Zero date-flash early-load (see v0.5.x): gated on the user's cached dateformatter config.
			try {
				if (localStorage.getItem('Viktor_dfcfg') && !W.ViktorDateformatter) {
					var dfs = D.createElement('script');
					dfs.src = 'https://thesved.github.io/js/dateformatter.js';
					dfs.async = false; dfs.id = 'IR_dateformatter_early';
					(D.head || D.documentElement).appendChild(dfs);
					L('date-formatter early-loaded (T=0)');
				}
			} catch (e) { }

			// ---------- theme + layout (per-graph cached by cacheEnv) ----------
			var light = false; try { light = W.matchMedia && W.matchMedia('(prefers-color-scheme: light)').matches; } catch (e) { }
			var scheme = light ? 'light' : 'dark';
			var form = (W.matchMedia && W.matchMedia('(max-width: 767px)').matches) ? 'm' : 'd';
			var DEFC = { dark: { bg: '#182026', text: '#e8eaed' }, light: { bg: '#ffffff', text: '#1a1a1a' } };
			var DEFP = { d: 230, m: 285 };
			var col = DEFC[scheme], pos = DEFP[form];
			try { var cc = JSON.parse(localStorage.getItem(KK('colors')) || '{}'); if (cc[scheme] && cc[scheme].bg && cc[scheme].text) col = cc[scheme]; } catch (e) { }
			try { var pp = JSON.parse(localStorage.getItem(KK('pos')) || '{}'); if (typeof pp[form] === 'number') pos = pp[form]; } catch (e) { }
			function dimOf(c, a) { a = a == null ? .5 : a; var m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(c); return m ? 'rgba(' + m[1] + ',' + m[2] + ',' + m[3] + ',' + a + ')' : (light ? 'rgba(0,0,0,' + a + ')' : 'rgba(255,255,255,' + a + ')'); }
			var bg = col.bg, fg = col.text, dim = dimOf(fg);
			function bgA(a) {   // bg with alpha — handles both computed rgb() and the hex defaults
				var m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(bg);
				if (m) return 'rgba(' + m[1] + ',' + m[2] + ',' + m[3] + ',' + a + ')';
				var h = /^#([0-9a-f]{6})$/i.exec(bg);
				if (h) { var n = parseInt(h[1], 16); return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')'; }
				return light ? 'rgba(255,255,255,' + a + ')' : 'rgba(24,32,38,' + a + ')';
			}
			try { var vh0 = W.innerHeight || 800; pos = Math.max(72, Math.min(pos, Math.round(vh0 * 0.6))); } catch (e) { }
			var sidePad = (form === 'd') ? '25%' : '18px';
			var TOUCH = false; try { TOUCH = ('ontouchstart' in W) || (((W.navigator && W.navigator.maxTouchPoints) || 0) > 0); } catch (e) { }
			var BLUE = 'rgb(47,155,249)';

			var ov = D.createElement('div'); ov.id = 'IR_overlay'; ov.className = 'dont-unfocus-block';
			ov.style.cssText = 'position:fixed;inset:0;z-index:2147483600;background:' + bg + ';color:' + fg + ';display:flex;flex-direction:column;font-family:Inter,system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased;opacity:1;transition:opacity .16s ease;cursor:text';

			var spacer = D.createElement('div'); spacer.style.cssText = 'flex:none;height:' + Math.max(0, pos - 30) + 'px';
			var head = D.createElement('div');
			head.style.cssText = 'padding:0 ' + sidePad + ';margin-bottom:8px;font-size:13px;flex:none;line-height:1.5';
			var label = D.createElement('span'); label.id = 'IR_cap'; label.textContent = 'Jot to today’s Daily Notes';
			label.style.cssText = 'color:' + dimOf(fg, .5) + ';transition:opacity .4s ease';
			head.appendChild(label);

			var ta = D.createElement('textarea'); ta.id = 'IR_input';
			ta.placeholder = 'Type your idea…'; ta.setAttribute('autocapitalize', 'sentences'); ta.setAttribute('autocorrect', 'on'); ta.setAttribute('autocomplete', 'off');
			ta.style.cssText = 'flex:1;width:100%;box-sizing:border-box;background:transparent;color:inherit;border:none;outline:none;resize:none;font-size:21px;line-height:1.5;padding:4px ' + sidePad + ' calc(18px + env(safe-area-inset-bottom));caret-color:#4c9aff;font-family:inherit';
			try { var prev = localStorage.getItem(LS); if (prev) { ta.value = prev; if (prev.trim()) CAP.engaged = true; } } catch (e) { }

			var phStyle = D.createElement('style');
			phStyle.textContent = '#IR_input::placeholder{color:' + dimOf(fg, .33) + ' !important;opacity:1}#IR_input:focus::placeholder{color:' + dimOf(fg, .25) + ' !important}'
				+ '#IR_dock .IRb{transition:transform .12s ease}#IR_dock .IRb.IRp{transform:scale(.9)}';
			(D.head || D.documentElement).appendChild(phStyle);

			ov.appendChild(spacer); ov.appendChild(head); ov.appendChild(ta);

			// ---------- subtle loading hairline + escalation ladder ----------
			var hl = D.createElement('div');
			hl.style.cssText = 'position:absolute;top:env(safe-area-inset-top,0px);left:0;height:1.5px;width:0%;background:' + fg + ';opacity:0;transition:opacity .3s ease,width .25s linear;pointer-events:none';
			ov.appendChild(hl);
			var esc = D.createElement('div');   // absolutely positioned in the spacer band → zero layout shift
			esc.style.cssText = 'position:absolute;top:calc(env(safe-area-inset-top,0px) + 14px);left:' + sidePad + ';right:18px;font-size:13px;line-height:1.5;color:' + dimOf(fg, .45) + ';pointer-events:none';
			var diag = D.createElement('div'); diag.id = 'IR_diag'; diag.style.cssText = 'opacity:0;transition:opacity .4s ease';
			var acts = D.createElement('div'); acts.id = 'IR_acts'; acts.style.cssText = 'opacity:0;transition:opacity .4s ease;pointer-events:none;margin-top:2px';
			esc.appendChild(diag); esc.appendChild(acts); ov.appendChild(esc);
			function mkLink(txt, fn) {
				var a = D.createElement('span'); a.textContent = txt; a.className = 'dont-unfocus-block';
				a.style.cssText = 'display:inline-block;color:' + dimOf(fg, .7) + ';text-decoration:underline;text-underline-offset:3px;padding:14px 12px 14px 0;margin-right:24px;cursor:pointer';
				a.addEventListener('mousedown', function (e) { e.preventDefault(); });
				a.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); fn(); });
				return a;
			}
			var bootStats = []; try { bootStats = JSON.parse(localStorage.getItem(KK('boot')) || '[]') || []; } catch (e) { }
			var med = 7000;
			if (bootStats.length) { var so = bootStats.slice().sort(function (a, b) { return a - b; }); med = so[Math.floor(so.length / 2)] || 7000; }
			var baseOp = light ? 0.30 : 0.22, offline = false, tier = 0;
			var T1 = Math.min(Math.max(12000, 2 * med), 25000);
			function setOffline(on) {
				if (offline === on) return; offline = on;
				if (CAP.done || CAP.dismissed) return;
				if (on) { diag.textContent = 'You’re offline. Your note will land when you’re back.'; diag.style.opacity = '1'; hl.style.opacity = String(baseOp * 0.4); L('ladder offline'); }
				else { if (tier < 2) diag.style.opacity = '0'; hl.style.opacity = String(tier >= 1 ? 0.4 : baseOp); L('ladder online'); }
			}
			try { W.addEventListener('offline', function () { setOffline(true); }); W.addEventListener('online', function () { setOffline(false); }); } catch (e) { }
			function swapLabel(txt) {
				label.style.opacity = '0';
				setTimeout(function () { label.textContent = txt; label.style.opacity = '1'; }, 400);
			}
			var hlTimer = setInterval(function () {
				if (CAP.done || CAP.dismissed) { clearInterval(hlTimer); return; }
				var t = Date.now() - T0;
				if (t > 5000 && W.navigator && W.navigator.onLine === false) setOffline(true);
				if (!offline) {
					if (t > 800) hl.style.opacity = String(tier >= 1 ? 0.4 : baseOp);
					hl.style.width = Math.min(88, 88 * t / (t + med * 0.9)) + '%';
				}
				if (tier < 1 && t > T1) {
					tier = 1; swapLabel('Still loading. Your note is safe, keep typing.'); L('ladder tier1 @' + t);
				}
				if (tier < 2 && t > 30000) {
					tier = 2;
					if (!offline) { diag.textContent = 'Roam is taking unusually long.'; diag.style.opacity = '1'; }
					L('ladder tier2 @' + t);
				}
				if (tier < 3 && t > 60000) {
					tier = 3; acts.textContent = '';
					var reloaded = false; try { reloaded = sessionStorage.getItem('IR2_reloaded') === '1'; } catch (e) { }
					if (!reloaded) acts.appendChild(mkLink('Reload', function () { try { sessionStorage.setItem('IR2_reloaded', '1'); } catch (e) { } location.reload(); }));
					acts.appendChild(mkLink('Open plain Roam', function () { location.href = 'https://roamresearch.com/?disablejs=true&disablecss=true#/app/' + encodeURIComponent(G); }));
					acts.style.pointerEvents = 'auto'; acts.style.opacity = '1'; L('ladder tier3 @' + t);
				}
			}, 250);
			function ladderDone() {
				clearInterval(hlTimer);
				try { hl.style.width = '100%'; setTimeout(function () { hl.style.opacity = '0'; }, 180); } catch (e) { }
			}

			// ---------- cached stores (lazy readers) ----------
			var PAGES = null, LOPAGES = null, TPLS = null;
			function pagesArr() {
				if (PAGES) return PAGES;
				PAGES = []; LOPAGES = [];
				try {
					var raw = localStorage.getItem(KK('pages'));
					if (raw) { var nl = raw.indexOf('\n'); if (nl > 0) PAGES = raw.slice(nl + 1).split('\n'); }
					for (var i = 0; i < PAGES.length; i++) LOPAGES.push(PAGES[i].toLowerCase());
				} catch (e) { PAGES = []; LOPAGES = []; }
				return PAGES;
			}
			function tplArr() {
				if (TPLS) return TPLS;
				TPLS = [];
				try { var t = JSON.parse(localStorage.getItem(KK('templates')) || '[]'); if (Array.isArray(t)) TPLS = t; } catch (e) { }
				return TPLS;
			}
			function rankPages(q, max) {
				pagesArr();
				q = (q || '').toLowerCase();
				var pre = [], sub = [];
				for (var i = 0; i < PAGES.length; i++) {
					var t = PAGES[i]; if (!t) continue;
					if (!q) { pre.push(t); if (pre.length >= max) break; continue; }
					var ix = LOPAGES[i].indexOf(q);
					if (ix === 0) { pre.push(t); if (pre.length >= max) break; }
					else if (ix > 0 && sub.length < max) sub.push(t);
				}
				return pre.concat(sub).slice(0, max);
			}

			// ---------- ONE mutation primitive (undo-coherent, keyboard-safe) ----------
			var mutating = false, composing = false;
			ta.addEventListener('compositionstart', function () { composing = true; });
			ta.addEventListener('compositionend', function () { composing = false; setTimeout(scanMenu, 0); });
			function replaceSpan(start, end, text, caretOff) {
				mutating = true;
				try {
					ta.focus({ preventScroll: true });
					ta.setSelectionRange(start, end);
					D.execCommand('insertText', false, text);
					if (typeof caretOff === 'number') { var p2 = start + caretOff; ta.setSelectionRange(p2, p2); }
				} catch (e) { L('replaceSpan ERR ' + (e && e.message)); }
				mutating = false;
				try { setBuf(ta.value); } catch (e) { }
			}

			// ---------- autocomplete menu ([[ pages, # tags, : templates) ----------
			var menu = null, menuRows = [], menuKey = '', menuIdx = 0, menuItems = [], menuSeg = null, menuShown = 0;
			var menuLift = 'linear-gradient(rgba(127,127,127,.08),rgba(127,127,127,.08))';
			function menuEl() {
				if (menu) return menu;
				menu = D.createElement('div'); menu.id = 'IR_menu'; menu.className = 'dont-unfocus-block';
				menu.style.cssText = 'position:fixed;left:10px;right:10px;z-index:2147483610;background:' + menuLift + ',' + bg + ';border:1px solid ' + dimOf(fg, .14) + ';border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.35);overflow:hidden;display:none;font-size:16px';
				menu.addEventListener('mousedown', function (e) { e.preventDefault(); });
				ov.appendChild(menu);
				return menu;
			}
			function menuOpen() { return !!(menu && menu.style.display !== 'none'); }
			function hideMenu() { if (menu) menu.style.display = 'none'; menuSeg = null; menuKey = ''; }
			function findSeg() {
				try {
					if (composing) return null;
					var posn = ta.selectionStart; if (posn !== ta.selectionEnd) return null;
					var v = ta.value, l0 = v.lastIndexOf('\n', posn - 1) + 1, seg = v.slice(l0, posn);
					var b = seg.lastIndexOf('[[');
					if (b >= 0) { var part = seg.slice(b + 2); if (part.indexOf(']]') < 0 && part.length <= 60) return { t: '[[', s: l0 + b, q: part }; }
					var m = /(^|[\s([{])#([^\s#\[\]]{1,40})$/.exec(seg);
					if (m) return { t: '#', s: l0 + seg.length - m[2].length - 1, q: m[2] };
					if (tplArr().length) {
						var c = /(^|[\s([{>]):([^\s:`]{1,40})$/.exec(seg);
						if (c) return { t: ':', s: l0 + seg.length - c[2].length - 1, q: c[2] };
					}
					return null;
				} catch (e) { return null; }
			}
			function placeMenu() {
				if (!menuOpen() || !menuSeg) return;
				try {
					var r = ta.getBoundingClientRect();
					var lineIdx = (ta.value.slice(0, menuSeg.s).match(/\n/g) || []).length;
					var lh = parseFloat(getComputedStyle(ta).lineHeight) || 31.5;
					var caretBot = r.top + 4 + (lineIdx + 1) * lh - ta.scrollTop;
					var vvB = W.visualViewport, kbTop = vvB ? (vvB.offsetTop + vvB.height) : W.innerHeight;
					var barH = dock ? 64 : 10;
					var limit = kbTop - barH - 8, rowH = 44;
					var n = menuItems.length;
					var fit = Math.floor((limit - (caretBot + 6)) / rowH);
					if (fit >= Math.min(n, 3)) {
						menuShown = Math.min(n, Math.max(3, fit), 6);
						menu.style.top = Math.round(caretBot + 6) + 'px'; menu.style.bottom = 'auto';
					} else {
						menuShown = Math.min(n, 6);
						var caretTop = caretBot - lh;
						menu.style.bottom = Math.round(W.innerHeight - caretTop + 6) + 'px'; menu.style.top = 'auto';
					}
					if (menuIdx >= menuShown) menuIdx = Math.max(0, menuShown - 1);
					for (var i = 0; i < menuRows.length; i++) menuRows[i].style.display = i < menuShown ? '' : 'none';
				} catch (e) { }
			}
			function paintActive() {
				for (var j = 0; j < menuRows.length; j++) menuRows[j].style.background = j === menuIdx ? 'rgba(76,154,255,.16)' : 'transparent';
			}
			function renderMenu() {
				var el = menuEl();
				var key = menuSeg.t + '|' + menuItems.map(function (it) { return it.label; }).join('\x01');
				if (key !== menuKey) {   // rebuild ONLY when the item set changes (never under a pointer needlessly)
					menuKey = key; menuRows = []; el.textContent = ''; menuIdx = 0;
					for (var i = 0; i < menuItems.length; i++) {
						(function (i) {
							var row = D.createElement('div');
							row.style.cssText = 'padding:0 14px;height:44px;line-height:44px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:' + fg;
							var main = D.createElement('span'); main.textContent = menuItems[i].label; row.appendChild(main);
							if (menuItems[i].hint) { var h = D.createElement('span'); h.textContent = '  ' + menuItems[i].hint; h.style.cssText = 'color:' + dimOf(fg, .4) + ';font-size:13px'; row.appendChild(h); }
							row.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); commitIdx(i); });
							el.appendChild(row); menuRows.push(row);
						})(i);
					}
				}
				el.style.display = 'block';
				paintActive();
				placeMenu();
			}
			function scanMenu() {
				try {
					if (mutating) return;
					if (composing || CAP.hydrated || CAP.done || CAP.dismissed || D.activeElement !== ta) { hideMenu(); return; }
					var seg = findSeg();
					if (!seg) { hideMenu(); return; }
					var items = [];
					if (seg.t === ':') {
						var q = seg.q.toLowerCase(), tp = tplArr();
						for (var i = 0; i < tp.length && items.length < 6; i++) {
							if (tp[i] && tp[i].n && tp[i].n.toLowerCase().indexOf(q) === 0) items.push({ label: ':' + tp[i].n, v: tp[i].t, hint: (tp[i].t || '').split('\n')[0].slice(0, 30) });
						}
					} else {
						var list = rankPages(seg.q, 6);
						for (var j = 0; j < list.length; j++) items.push({ label: list[j], v: list[j] });
					}
					if (!items.length) { hideMenu(); return; }
					menuSeg = seg; menuItems = items;
					renderMenu();
				} catch (e) { hideMenu(); }
			}
			function commitIdx(i) {
				var it = menuItems[i], seg = menuSeg;
				if (!it || !seg || CAP.hydrated || CAP.done || CAP.dismissed) { hideMenu(); return; }
				hideMenu();
				var posn = ta.selectionStart, v = ta.value, end = posn;
				if (seg.t === '[[') {
					if (v.substr(posn, 2) === ']]') end = posn + 2;
					replaceSpan(seg.s, end, '[[' + it.v + ']]');
				} else if (seg.t === '#') {
					var tok = /[\s\[\]#'"`]/.test(it.v) ? '#[[' + it.v + ']]' : '#' + it.v;
					replaceSpan(seg.s, end, tok);
				} else {
					var txt = String(it.v || ''), ci = txt.indexOf('$cursor');
					if (ci >= 0) txt = txt.replace('$cursor', '');
					replaceSpan(seg.s, end, txt, ci >= 0 ? ci : undefined);
				}
				engage('menu-commit');
				setTimeout(scanMenu, 0);
			}
			var selScanQ = false;
			D.addEventListener('selectionchange', function () {
				if (D.activeElement !== ta || selScanQ) return;
				selScanQ = true;
				requestAnimationFrame(function () { selScanQ = false; scanMenu(); });
			});

			// ---------- capture cmdbar (touch only) + image queue + SB2 keyboard pin ----------
			var dock = null, fileIn = null, chipRow = null, IMGQ = [], pickerOpen = false, undoable = false, btnU = null, btnR = null;
			function svg(p) { return '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + p + '</svg>'; }
			var ICON = {
				todo: svg('<rect x="4" y="4" width="16" height="16" rx="4"/><path d="m8.5 12.5 2.5 2.5 5-5.5"/>'),
				media: svg('<rect x="3.5" y="5" width="17" height="14" rx="3"/><circle cx="9" cy="10" r="1.6" fill="currentColor" stroke="none"/><path d="m6 17 4.2-4.2a1.5 1.5 0 0 1 2.1 0L18 18"/>'),
				undo: svg('<path d="M8 6 3.8 10 8 14"/><path d="M3.8 10H14a6 6 0 0 1 0 12h-3"/>'),
				redo: svg('<path d="M16 6l4.2 4L16 14"/><path d="M20.2 10H10a6 6 0 0 0 0 12h3"/>')
			};
			function frozen() { return CAP.hydrated || CAP.done || CAP.dismissed; }
			function mkBtn(html, aria, fn) {
				var b = D.createElement('button'); b.className = 'IRb dont-unfocus-block'; b.setAttribute('aria-label', aria);
				b.innerHTML = html;
				b.style.cssText = 'height:44px;min-width:46px;border:none;border-radius:10px;background:transparent;color:' + dimOf(fg, .75) + ';font:600 17px -apple-system,BlinkMacSystemFont,sans-serif;display:flex;align-items:center;justify-content:center;padding:0';
				var lastTouch = 0;
				b.addEventListener('mousedown', function (e) { e.preventDefault(); });   // never steal focus → keyboard survives
				b.addEventListener('touchstart', function (e) { e.preventDefault(); b.classList.add('IRp'); }, { passive: false });
				b.addEventListener('touchend', function (e) { e.preventDefault(); b.classList.remove('IRp'); lastTouch = Date.now(); if (!frozen()) fn(); }, { passive: false });
				b.addEventListener('touchcancel', function () { b.classList.remove('IRp'); });
				b.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); if (Date.now() - lastTouch > 500 && !frozen()) fn(); });
				return b;
			}
			function lineSpan(v, posn) {
				var s = v.lastIndexOf('\n', posn - 1) + 1;
				var e = v.indexOf('\n', posn); if (e < 0) e = v.length;
				return { s: s, e: e };
			}
			function actWikilink() {
				var posn = ta.selectionStart;
				replaceSpan(posn, ta.selectionEnd, '[[]]', 2);
				engage('bar-wikilink');
				setTimeout(scanMenu, 0);
			}
			function actTodo() {
				var v = ta.value, posn = ta.selectionStart, ln = lineSpan(v, posn), line = v.slice(ln.s, ln.e);
				var TD = '{{[[TODO]]}} ', DN = '{{[[DONE]]}} ';
				var delta;
				if (line.indexOf(TD) === 0) { replaceSpan(ln.s, ln.s + TD.length, DN); delta = 0; }
				else if (line.indexOf(DN) === 0) { replaceSpan(ln.s, ln.s + DN.length, ''); delta = -DN.length; }
				else { replaceSpan(ln.s, ln.s, TD); delta = TD.length; }
				// caret stays where the user was typing, shifted by the prefix change
				try { var np = Math.max(ln.s, Math.min(posn + delta, ta.value.length)); ta.setSelectionRange(np, np); } catch (e) { }
				engage('bar-todo');
			}
			function renderChips() {
				if (!chipRow) return;
				chipRow.textContent = '';
				chipRow.style.display = IMGQ.length ? 'flex' : 'none';
				for (var i = 0; i < IMGQ.length; i++) {
					(function (i) {
						var c = D.createElement('div');
						c.style.cssText = 'position:relative;width:38px;height:38px;border-radius:8px;overflow:hidden;flex:none;border:1px solid ' + dimOf(fg, .2);
						var im = D.createElement('img'); im.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block';
						try { im.src = IMGQ[i].url; } catch (e) { }
						var x = D.createElement('div'); x.textContent = '✕';
						x.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:12px;color:#fff;background:rgba(0,0,0,.35);opacity:.9';
						c.appendChild(im); c.appendChild(x);
						c.addEventListener('mousedown', function (e) { e.preventDefault(); });
						c.addEventListener('click', function (e) {
							e.preventDefault(); e.stopPropagation();
							try { URL.revokeObjectURL(IMGQ[i].url); } catch (er) { }
							IMGQ.splice(i, 1); renderChips();
						});
						chipRow.appendChild(c);
					})(i);
				}
			}
			function actImage() {
				if (!fileIn) return;
				pickerOpen = true;
				var pickAt = Date.now();
				L('image picker open');
				try { fileIn.click(); } catch (e) { pickerOpen = false; return; }
				// iOS fires no event on sheet-cancel: release the hydrate gate via focus/visibility heartbeat
				var relT = setInterval(function () {
					if (!pickerOpen) { clearInterval(relT); return; }
					if (D.visibilityState === 'visible' && D.hasFocus && D.hasFocus() && Date.now() - pickAt > 1200) { pickerOpen = false; clearInterval(relT); L('picker released (heartbeat)'); }
				}, 500);
			}
			function actUndo() { try { D.execCommand('undo'); } catch (e) { } }
			function actRedo() { try { D.execCommand('redo'); } catch (e) { } }
			if (TOUCH) {
				dock = D.createElement('div'); dock.id = 'IR_dock'; dock.className = 'dont-unfocus-block';
				dock.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483615;will-change:transform;background:' + bgA(.85) + ';-webkit-backdrop-filter:saturate(1.6) blur(18px);backdrop-filter:saturate(1.6) blur(18px);border-top:0.5px solid ' + dimOf(fg, .18) + ';box-shadow:0 -1px 14px rgba(0,0,0,.25)';
				chipRow = D.createElement('div');
				chipRow.style.cssText = 'display:none;gap:8px;padding:8px 12px 0;align-items:center';
				var row = D.createElement('div');
				row.style.cssText = 'display:flex;gap:2px;align-items:center;height:48px;padding:0 max(8px, env(safe-area-inset-left))';
				var bW = mkBtn('[[', 'link a page', actWikilink);
				var bT = mkBtn(ICON.todo, 'checkbox', actTodo);
				var bM = mkBtn(ICON.media, 'add photo', actImage);
				btnU = mkBtn(ICON.undo, 'undo', actUndo);
				btnR = mkBtn(ICON.redo, 'redo', actRedo);
				btnU.style.visibility = 'hidden'; btnR.style.visibility = 'hidden';   // pre-mounted: zero layout shift on reveal
				var gap = D.createElement('div'); gap.style.cssText = 'flex:1';
				row.appendChild(bW); row.appendChild(bT); row.appendChild(bM); row.appendChild(gap); row.appendChild(btnU); row.appendChild(btnR);
				var pad = D.createElement('div'); pad.style.cssText = 'height:env(safe-area-inset-bottom,0px)';
				dock.appendChild(chipRow); dock.appendChild(row); dock.appendChild(pad);
				fileIn = D.createElement('input'); fileIn.type = 'file'; fileIn.accept = 'image/*';
				fileIn.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0';
				fileIn.addEventListener('change', function () {
					pickerOpen = false;
					try {
						var fs = fileIn.files || [];
						for (var i = 0; i < fs.length; i++) {
							var u = ''; try { u = URL.createObjectURL(fs[i]); } catch (e) { }
							IMGQ.push({ file: fs[i], url: u });
						}
						fileIn.value = '';
					} catch (e) { }
					renderChips();
					if (IMGQ.length) engage('image');
					try { ta.focus({ preventScroll: true }); } catch (e) { }   // caret custody back (keyboard needs the next tap — iOS rule)
					L('image queued n=' + IMGQ.length);
				});
				dock.appendChild(fileIn);
				ov.appendChild(dock);
				CAP._img = function (f, u) { IMGQ.push({ file: f, url: u || '' }); renderChips(); engage('image'); };   // test/debug hook
			}

			// SB2 pin + shared placement pass (bar + menu + textarea bottom inset)
			var SCREEN_H = W.innerHeight || 800, rideUntil = 0, lastPad = -1, lastTy = 1e9;
			function place() {
				try {
					var vvB = W.visualViewport, ty = 0, kbInset = 0;
					if (vvB) {
						ty = Math.round(vvB.height + vvB.offsetTop - SCREEN_H); if (ty > -2) ty = 0;
						kbInset = Math.max(0, SCREEN_H - vvB.height - vvB.offsetTop);
					}
					if (dock && ty !== lastTy) { lastTy = ty; dock.style.transform = 'translateY(' + ty + 'px)'; }
					if (TOUCH) {
						var padB = kbInset + (dock ? 64 : 10) + 18;
						if (padB !== lastPad) { lastPad = padB; ta.style.paddingBottom = padB + 'px'; }
					}
					placeMenu();
				} catch (e) { }
			}
			function ride() { if (Date.now() < rideUntil) { place(); requestAnimationFrame(ride); } }
			function kickRide(ms) { var was = rideUntil > Date.now(); rideUntil = Date.now() + (ms || 900); if (!was) requestAnimationFrame(ride); }
			try {
				if (W.visualViewport) {
					W.visualViewport.addEventListener('resize', function () { place(); kickRide(); });
					W.visualViewport.addEventListener('scroll', function () { place(); kickRide(); });
				}
				W.addEventListener('orientationchange', function () { setTimeout(function () { SCREEN_H = W.innerHeight || SCREEN_H; lastTy = 1e9; lastPad = -1; place(); }, 250); });
				ta.addEventListener('focus', function () { kickRide(1400); });
				ta.addEventListener('blur', function () { kickRide(1400); });
			} catch (e) { }
			place();

			(D.body || D.documentElement).appendChild(ov);

			function focusBox() { try { ta.focus(); var n = ta.value.length; ta.setSelectionRange(n, n); } catch (e) { } }
			focusBox();

			// Baton guard (active only during the no-nav handoff) — see v0.5.4 notes. Muted while the
			// iOS photo sheet is up (focus legitimately leaves; reclaiming would fight the sheet).
			var batonOn = false;
			ta.addEventListener('focusout', function (e) {
				if (!batonOn || CAP.done || pickerOpen) return;
				if (roamEditable(e.relatedTarget)) { L('baton release -> ' + cls(e.relatedTarget)); return; }
				L('baton reclaim (rt=' + cls(e.relatedTarget) + ') vv=' + vvh());
				try { ta.focus({ preventScroll: true }); } catch (e2) { }
			});
			ta.addEventListener('input', function (e) {
				if (CAP.sealed) { L('input IGNORED (sealed) len=' + ta.value.length); return; }
				engage('input');
				L('input len=' + ta.value.length + ' vv=' + vvh());
				setBuf(ta.value);
				if (!undoable && btnU) { undoable = true; btnU.style.visibility = 'visible'; btnR.style.visibility = 'visible'; }
				// auto-close ]] right after a literal '[[' is typed (caret stays between) — DEFERRED one
				// task: Chrome blocks re-entrant execCommand while the input event of the first command
				// is still dispatching. Context is re-verified inside the timeout.
				if (!composing && !mutating && e && e.inputType === 'insertText' && e.data === '[') {
					var p = ta.selectionStart, v = ta.value;
					if (v.slice(p - 2, p) === '[[' && v.charAt(p - 3) !== '[' && v.substr(p, 2) !== ']]' && (p >= v.length || /[\s\n)\].,;:!?]/.test(v.charAt(p)))) {
						setTimeout(function () {
							try {
								if (composing || mutating || CAP.sealed || CAP.hydrated || CAP.done || CAP.dismissed) return;
								if (ta.selectionStart !== p || ta.value.slice(p - 2, p) !== '[[') return;   // context moved on
								mutating = true; ta.focus({ preventScroll: true }); D.execCommand('insertText', false, ']]'); ta.setSelectionRange(p, p); mutating = false;
								setBuf(ta.value);
								scanMenu();
							} catch (er) { mutating = false; }
						}, 0);
					}
				}
				scanMenu();
			});
			ta.addEventListener('keydown', function (e) {
				engage('keydown');
				if (menuOpen()) {
					if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
						e.preventDefault();
						if (menuShown > 0) { menuIdx = (menuIdx + (e.key === 'ArrowDown' ? 1 : menuShown - 1)) % menuShown; paintActive(); }
						return;
					}
					if (e.key === 'Enter' || e.key === 'Tab') {
						if (menuSeg && menuSeg.t === ':' && menuSeg.q.length < 2 && e.key === 'Enter') { hideMenu(); return; }   // Return stays the newline key
						e.preventDefault(); commitIdx(menuIdx); return;
					}
					if (e.key === 'Escape') { e.preventDefault(); hideMenu(); return; }
				}
				if (e.key === 'Escape') { e.preventDefault(); dismiss(); }
			});
			ta.addEventListener('pointerdown', function () { engage('tap-ta'); });
			ov.addEventListener('pointerdown', function (e) {
				if (dock && dock.contains(e.target)) return;
				if (menu && menu.contains(e.target)) return;
				if (esc.contains(e.target)) return;
				engage('tap-ov'); focusBox();
			});

			// Conservative mid-boot route-exit: instant dismiss only on known-terminal routes or a
			// DIFFERENT graph; anything else re-checks after 400ms (Roam rewrites the hash during boot).
			W.addEventListener('hashchange', function () {
				if (CAP.done || CAP.dismissed) return;
				var c = classify(W.location.hash);
				if (c.k === 'graph' && c.g === G) return;
				var terminal = (c.k === 'graph' && c.g !== G) || c.r === '/signin' || c.r === '/signup' || c.r === '/mobile-graph-too-large';
				if (terminal) { L('route-exit ' + W.location.hash); dismiss(); return; }
				setTimeout(function () {
					if (CAP.done || CAP.dismissed) return;
					var c2 = classify(W.location.hash);
					if (!(c2.k === 'graph' && c2.g === G)) { L('route-exit(recheck) ' + W.location.hash); dismiss(); }
				}, 400);
			});

			// triple-tap the header label -> re-arm the auto-LAB for the next boot
			var tapN = 0, tapAt = 0;
			label.addEventListener('pointerdown', function () {
				var now = Date.now(); if (now - tapAt > 900) tapN = 0; tapAt = now;
				if (++tapN >= 3) { tapN = 0; try { localStorage.setItem('IR_lab', '1'); localStorage.removeItem(labKey); } catch (e) { } label.textContent = 'lab re-armed — kill app & reopen'; L('lab re-armed by triple-tap'); }
			});

			// AUTO-LAB (opt-in, unchanged from v0.5.4)
			var labT = null;
			function scheduleLab() { if (!LAB || labT) return; labT = setTimeout(runLab, 3000); }
			function labStep(ms, f) { setTimeout(function () { if (CAP.done || CAP.dismissed) { L('LAB aborted (overlay gone)'); labFinished = true; return; } f(); }, ms); }
			function runLab() {
				if (CAP.done || CAP.dismissed || CAP.hydrated || labFinished) { L('LAB skipped'); labFinished = true; return; }
				var base = vvh();
				L('LAB start base-vv=' + base + ' active=' + cls(D.activeElement));
				var tb = D.createElement('textarea'); tb.id = 'IR_lab_b'; tb.placeholder = 'LAB B';
				tb.setAttribute('autocapitalize', 'sentences'); tb.setAttribute('autocorrect', 'on');
				tb.style.cssText = 'flex:none;height:44px;margin:0 18px 8px;box-sizing:border-box;background:rgba(127,127,127,.12);color:inherit;border:1px dashed rgba(127,127,127,.5);border-radius:6px;outline:none;resize:none;font-size:16px;padding:10px;font-family:inherit';
				ov.appendChild(tb);
				labStep(700, function () {
					L('LAB A->B (async focus, no gesture) vv=' + vvh());
					try { tb.focus({ preventScroll: true }); } catch (e) { try { tb.focus(); } catch (e2) { } }
					labStep(700, function () {
						var v1 = vvh(), a1 = cls(D.activeElement);
						L('LAB after A->B active=' + a1 + ' vv=' + v1 + ' => ' + (Math.abs(v1 - base) < 60 && a1 === 'IR_lab_b' ? 'KEPT' : 'PROBLEM'));
						L('LAB B->A vv=' + vvh());
						try { ta.focus({ preventScroll: true }); } catch (e) { try { ta.focus(); } catch (e2) { } }
						try { var n = ta.value.length; ta.setSelectionRange(n, n); } catch (e) { }
						labStep(700, function () {
							var v2 = vvh(), a2 = cls(D.activeElement);
							var pass = Math.abs(v2 - base) < 60 && a2 === 'IR_input';
							L('LAB VERDICT ' + (pass ? 'PASS — keyboard survives async editable->editable' : 'FAIL') + ' active=' + a2 + ' vv=' + v2 + ' base=' + base);
							try { tb.remove(); } catch (e) { }
							L('LAB B removed active=' + cls(D.activeElement) + ' vv=' + vvh());
							try { localStorage.setItem(labKey, '1'); } catch (e) { }
							labFinished = true;
						});
					});
				});
			}

			function fadeRemove() {
				CAP.done = true;
				L('overlay-fade active=' + cls(D.activeElement) + ' vv=' + vvh());
				try {
					ov.style.pointerEvents = 'none';   // a tap in the fade window must reach Roam, not us
					if (dock) dock.style.pointerEvents = 'none';
					if (menu) menu.style.display = 'none';
					ov.style.opacity = '0';
				} catch (e) { }
				setTimeout(function () { try { ov.remove(); } catch (e) { } L('overlay-removed active=' + cls(D.activeElement) + ' vv=' + vvh()); }, 210);
			}
			function dismiss() { CAP.dismissed = true; L('dismiss'); ladderDone(); fadeRemove(); }
			function clearBuf() { try { localStorage.removeItem(LS); } catch (e) { } }
			function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

			function roamEditable(el) {
				if (!el || el === ta || el.id === 'IR_lab_b') return false;
				var tag = (el.tagName || '').toLowerCase();
				return tag === 'textarea' || tag === 'input' || el.isContentEditable === true;
			}
			function endsWithUid(el, uid) {
				return !!(el && el.id && el.id.indexOf('block-input-') === 0 && el.id.slice(-(uid.length + 1)) === '-' + uid);
			}
			function focusTarget(a, uid, caretPos) {
				return new Promise(function (resolve) {
					var wins = ['log-outline', 'main-window'], wi = 0;
					function attempt() {
						var win = wins[wi];
						L('focusTarget try win=' + win + ' uid=' + uid + ' active=' + cls(D.activeElement));
						try { a.ui.setBlockFocusAndSelection({ location: { 'block-uid': uid, 'window-id': win }, selection: { start: caretPos } }); } catch (e) { L('focusTarget api ERR ' + (e && e.message)); }
						var n = 0;
						(function poll() {
							if (endsWithUid(D.activeElement, uid)) { L('focusTarget LANDED win=' + win + ' ' + cls(D.activeElement) + ' vv=' + vvh()); return resolve(true); }
							if (++n < 4) return setTimeout(poll, 50);
							if (++wi < wins.length) return attempt();
							domFallback();
						})();
					}
					function domFallback() {
						L('focusTarget DOM fallback uid=' + uid + ' active=' + cls(D.activeElement));
						var node = D.querySelector('[id$="-' + uid + '"]');
						if (node) { ['mousedown', 'mouseup', 'click'].forEach(function (t) { try { node.dispatchEvent(new MouseEvent(t, { bubbles: true })); } catch (e) { } }); }
						var n = 0;
						(function poll() {
							if (endsWithUid(D.activeElement, uid)) { L('focusTarget DOM landed ' + cls(D.activeElement)); return resolve(true); }
							var t2 = D.querySelector('textarea[id$="-' + uid + '"]');
							if (t2 && t2 !== D.activeElement) { try { t2.focus({ preventScroll: true }); t2.setSelectionRange(caretPos, caretPos); } catch (e) { } }
							if (++n < 6) return setTimeout(poll, 60);
							L('focusTarget FAILED uid=' + uid + ' active=' + cls(D.activeElement));
							resolve(false);
						})();
					}
					attempt();
				});
			}

			function hydrate(a) {
				if (CAP.hydrated || CAP.dismissed) return; CAP.hydrated = true;
				batonOn = true;
				hideMenu();   // freeze the extras: frozen() gates bar actions + menu commits from here
				L('hydrate start (NO-NAV) vv=' + vvh() + ' active=' + cls(D.activeElement));
				(async function () {
					try {
						// GRAPH GUARD: never write into a graph other than the one classified at T=0
						var liveG = null; try { liveG = a.graph && a.graph.name; } catch (eg) { }
						if (liveG !== G) { L('GRAPH GUARD tripped live=' + liveG + ' expected=' + G + ' — buffer kept, no write'); batonOn = false; ladderDone(); fadeRemove(); return; }
						var dnp = a.util.dateToPageUid(new Date());
						if (!a.pull('[:db/id]', [':block/uid', dnp])) { try { await a.createPage({ page: { title: a.util.dateToPageTitle(new Date()), uid: dnp } }); } catch (e) { } }
						// NO openPage — stay on the Daily Notes LOG. Text stored VERBATIM (keep trailing space).
						var text = (ta.value || ''), has = text.trim().length > 0;
						var p = a.pull('[{:block/children [:block/string :block/uid :block/order]}]', [':block/uid', dnp]);
						var kids = ((p && p[':block/children']) || []).slice();
						kids.sort(function (m, n) { return (m[':block/order'] || 0) - (n[':block/order'] || 0); });
						var top = kids[0], topUid = top ? top[':block/uid'] : null, topEmpty = top ? !((top[':block/string'] || '').trim()) : false;
						var target, wrote = has ? text : '';
						if (topUid && topEmpty) { target = topUid; if (has) { try { await a.updateBlock({ block: { uid: topUid, string: wrote } }); } catch (e) { } } }
						else if (topUid && has && (top[':block/string'] || '') === wrote) { target = topUid; L('top block already holds the text (stale-buffer replay) — no write'); }
						else { target = a.util.generateUID(); try { await a.createBlock({ location: { 'parent-uid': dnp, order: 0 }, block: { uid: target, string: wrote } }); } catch (e) { } }
						L('target uid=' + target + ' (' + (topUid && topEmpty ? 'reused-top' : 'new-block') + ') len=' + wrote.length);
						// reconcile keystrokes typed during the awaits (verbatim)
						var latest = (ta.value || '');
						if (latest !== wrote && (latest.trim() || wrote)) { L('reconcile len ' + wrote.length + '->' + latest.length); try { await a.updateBlock({ block: { uid: target, string: latest } }); } catch (e) { } wrote = latest; }
						// live caret (templates/$cursor + mid-line edits keep their position through handoff)
						var caretPos = wrote.length;
						try { var ss = ta.selectionStart; if (typeof ss === 'number') caretPos = Math.min(ss, wrote.length); } catch (e) { }
						var ok = await focusTarget(a, target, caretPos);
						// FINAL reconcile AFTER focus left IR_input (iOS blur-commits pending autocorrect)
						var fin = (ta.value || '');
						if (fin !== wrote && (fin.trim() || wrote)) { L('post-blur reconcile len ' + wrote.length + '->' + fin.length); try { await a.updateBlock({ block: { uid: target, string: fin } }); } catch (e) { } wrote = fin; if (endsWithUid(D.activeElement, target)) { try { D.activeElement.setSelectionRange(wrote.length, wrote.length); } catch (e) { } } }
						CAP.sealed = true;   // mirror is dead from here — no late input event can repopulate the buffer
						try {
							var chk = a.pull('[:block/string]', [':block/uid', target]);
							if (!(chk && chk[':block/string'] === wrote)) { await sleep(150); chk = a.pull('[:block/string]', [':block/uid', target]); }
							if (chk && chk[':block/string'] === wrote) { clearBuf(); ta.value = ''; } else L('buffer kept (read-back mismatch)');
						} catch (e) { }
						// IMAGES: only AFTER the text chain is sealed + cleared. Each image = its OWN sibling
						// block (never the focused text block → no write-write conflict, no seal interference).
						if (IMGQ.length) {
							var q = IMGQ.slice(); IMGQ = [];
							(async function () {
								for (var qi = 0; qi < q.length; qi++) {
									var iu = null;
									try {
										iu = a.util.generateUID();
										await a.createBlock({ location: { 'parent-uid': dnp, order: 1 + qi }, block: { uid: iu, string: 'Uploading image…' } });
										var md = await a.file.upload({ file: q[qi].file });
										await a.updateBlock({ block: { uid: iu, string: String(md) } });
										L('image ' + qi + ' uploaded');
									} catch (e) {
										L('image ' + qi + ' ERR ' + (e && e.message));
										try { if (iu) await a.updateBlock({ block: { uid: iu, string: 'Image upload failed' } }); } catch (e2) { }
									}
									try { URL.revokeObjectURL(q[qi].url); } catch (e3) { }
								}
							})();
						}
						if (ok) await new Promise(function (r) { requestAnimationFrame(function () { r(); }); });
						var confirmed = ok && endsWithUid(D.activeElement, target);
						L('handoff ' + (confirmed ? 'CONFIRMED' : 'NOT-confirmed') + ' active=' + cls(D.activeElement) + ' vv=' + vvh());
						batonOn = false;
						fadeRemove();
					} catch (e) { L('hydrate ERROR ' + (e && e.message)); batonOn = false; fadeRemove(); }
				})();
			}

			function painted() {
				var app = D.getElementById('app');
				if (!(app && app.children.length > 0)) return false;
				var spin = D.querySelector('[class*="astrolabe"],img[src*="astrolabe"],.loading-astrolabe');
				var spinnerVisible = spin && spin.getClientRects().length > 0;
				return !spinnerVisible;
			}
			function recordBoot(ms) {
				if (!(ms > 0) || ms > 60000) return;   // failed/wedged boots must not poison the median
				try {
					var s = []; try { s = JSON.parse(localStorage.getItem(KK('boot')) || '[]') || []; } catch (e) { }
					s.push(Math.round(ms));
					localStorage.setItem(KK('boot'), JSON.stringify(s.slice(-7)));
				} catch (e) { }
			}

			var tries = 0;
			var poll = setInterval(function () {
				tries++;
				var a = W.roamAlphaAPI;
				var ready = a && a.util && a.createBlock && a.ui && a.ui.mainWindow;
				if (ready && !CAP.readyAt) { CAP.readyAt = Date.now() - T0; L('roam-ready at ' + CAP.readyAt + 'ms engaged=' + CAP.engaged); recordBoot(CAP.readyAt); ladderDone(); }
				if (CAP.done || CAP.dismissed) { clearInterval(poll); return; }
				if (ready && CAP.engaged && !pickerOpen && (!labT || labFinished)) { clearInterval(poll); hydrate(a); }
				else if (ready && !CAP.engaged && painted()) { clearInterval(poll); L('painted -> melt (not engaged)'); fadeRemove(); }
				else if (tries > 1500) { clearInterval(poll); L('hard-timeout melt'); fadeRemove(); }
			}, 100);
		} catch (e) { }
	}

	var CAPTURE_SRC = '(' + __IR_capture.toString() + ')();';
	function hashStr(s) { var h = 5381, i = s.length; while (i) h = (h * 33) ^ s.charCodeAt(--i); return (h >>> 0).toString(36); }
	var VERSION = SALT + '-' + hashStr(CAPTURE_SRC);

	// ---------- module-side helpers ----------
	function gname() { try { return (window.roamAlphaAPI && window.roamAlphaAPI.graph && window.roamAlphaAPI.graph.name) || null; } catch (e) { return null; } }
	function xopts() { var o = {}; try { o = window.ViktorRoamOpts || {}; } catch (e) { } try { if (window.ViktorOpts) { for (var k in window.ViktorOpts) o[k] = window.ViktorOpts[k]; } } catch (e2) { } return o; }
	function lastGraph() { try { return localStorage.getItem('IR2:lastGraph'); } catch (e) { return null; } }

	// enable the CURRENT graph (installing this module in a graph IS the opt-in); returns whether
	// ANY graph is enabled (drives poison vs unpoison)
	function ensureGraph() {
		var g = gname(); if (!g) return { g: null, any: false };
		var en = {}; try { en = JSON.parse(localStorage.getItem('IR2:graphs') || '{}') || {}; } catch (e) { en = {}; }
		var on = (xopts().instantRoam === false) ? 0 : 1;
		if (!en[g] || en[g].on !== on) { en[g] = { on: on, ts: Date.now() }; try { localStorage.setItem('IR2:graphs', JSON.stringify(en)); } catch (e) { } }
		try { localStorage.setItem('IR2:lastGraph', g); } catch (e) { }
		var any = false; for (var k in en) { if (en[k] && en[k].on) any = true; }
		return { g: g, any: any };
	}

	// one-time migration of the pre-0.6 global keys into the current graph's namespace.
	// The BUFFER migrates only once the old shell's capture has settled (sealed/done/dismissed) —
	// copying it mid-capture would resurrect the note after hydrate cleared the old key.
	function migrate(g) {
		if (!g) return;
		try { var c = localStorage.getItem('IR_colors'); if (c) { if (!localStorage.getItem('IR2:' + g + ':colors')) localStorage.setItem('IR2:' + g + ':colors', c); localStorage.removeItem('IR_colors'); } } catch (e) { }
		try { var p = localStorage.getItem('IR_pos'); if (p) { if (!localStorage.getItem('IR2:' + g + ':pos')) localStorage.setItem('IR2:' + g + ':pos', p); localStorage.removeItem('IR_pos'); } } catch (e) { }
		function tryBuf() {
			try {
				var b = localStorage.getItem('IR_buffer'); if (b == null) return true;
				var cap = window.__IR_CAPTURE;
				if (cap && !(cap.sealed || cap.done || cap.dismissed)) return false;   // old capture still live
				b = localStorage.getItem('IR_buffer'); if (b == null) return true;      // re-read: hydrate may have cleared it
				if (b && !localStorage.getItem('IR2:' + g + ':buffer')) localStorage.setItem('IR2:' + g + ':buffer', b);
				localStorage.removeItem('IR_buffer');
				return true;
			} catch (e) { return true; }
		}
		if (!tryBuf()) { var n = 0, iv = setInterval(function () { if (tryBuf() || ++n > 60) clearInterval(iv); }, 2000); timers.push(iv); }
	}

	// ---------- page-name store writer (idempotent across tabs: content-hash compare-and-swap) ----------
	var DNP_RE = /^(January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}(st|nd|rd|th), \d{4}$/;
	function writePages() {
		try {
			var a = window.roamAlphaAPI; if (!(a && a.data && a.data.fast && a.data.fast.q)) return;
			var g = gname(); if (!g) return;
			var rows = a.data.fast.q('[:find ?t ?tm :where [?e :node/title ?t] [?e :edit/time ?tm]]');
			rows.sort(function (x, y) { return (y[1] || 0) - (x[1] || 0); });
			var main = [], dnp = [], seen = {};
			for (var i = 0; i < rows.length; i++) {
				var t = String(rows[i][0]);
				if (!t || /[\n\r]/.test(t) || seen[t]) continue;   // \n titles would corrupt row boundaries (one exists in the wild!)
				seen[t] = 1;
				(DNP_RE.test(t) ? dnp : main).push(t);             // date pages demoted: recency rows shouldn't be a DNP wall
			}
			var titles = main.concat(dnp);
			var body = titles.join('\n');
			var h = hashStr(body);
			var key = 'IR2:' + g + ':pages';
			var cur = null; try { cur = localStorage.getItem(key); } catch (e) { }
			if (cur) { var nl = cur.indexOf('\n'); var curH = (nl > 0 ? cur.slice(0, nl) : '').split('|')[0]; if (curH === h) return; }   // CAS skip: another tab (or we) already wrote these bytes
			localStorage.setItem(key, h + '|' + titles.length + '|' + Date.now() + '\n' + body);
			if (doLog) console.log('** instant-roam: pages cache -> ' + titles.length + ' titles **');
		} catch (e) { }
	}

	// ---------- template cache writer (static-safe one-liners/short outlines only) ----------
	var TPL_UNSAFE = /```|\bjs\s*\(|\bjavascript\b|jsvar|\$clipboard|\{\{?\s*rand|prompt\s*\(|fetch\s*\(|import\s*\(|!\{\{embed|!\(\(/i;
	function writeTemplates() {
		try {
			var a = window.roamAlphaAPI; if (!(a && a.data && a.data.fast && a.data.fast.q && a.pull)) return;
			var g = gname(); if (!g) return;
			var key = 'IR2:' + g + ':templates';
			var o = xopts();
			if (o.colonMenu === false) { try { if (localStorage.getItem(key) !== '[]') localStorage.setItem(key, '[]'); } catch (e) { } return; }
			var sp = (Array.isArray(o.searchPages) && o.searchPages.length) ? o.searchPages : ['template', '[[template]]'];
			var rows = a.data.fast.q('[:find ?t ?u :where [?e :node/title ?t] [?e :block/uid ?u]]');
			var out = [], seen = {};
			for (var s = 0; s < sp.length; s++) {
				var pref = String(sp[s]) + '/';
				for (var i = 0; i < rows.length; i++) {
					var t = String(rows[i][0]);
					if (t.slice(0, pref.length) !== pref) continue;
					var name = t.slice(pref.length);
					if (!name || name.indexOf('/') >= 0) continue;                 // nested template folders are skipped (colonmenu convention)
					var lo = name.toLowerCase(); if (seen[lo]) continue; seen[lo] = 1;
					var tree = null;
					try { tree = a.pull('[{:block/children [:block/string :block/order {:block/children ...}]}]', [':block/uid', String(rows[i][1])]); } catch (e) { }
					var lines = [];
					(function walk(node, depth) {
						if (!node) return;
						var kids = (node[':block/children'] || []).slice();
						kids.sort(function (m, n) { return (m[':block/order'] || 0) - (n[':block/order'] || 0); });
						for (var ki = 0; ki < kids.length; ki++) {
							var str = String(kids[ki][':block/string'] || '');
							lines.push((depth ? new Array(depth + 1).join('  ') : '') + str);
							if (lines.length > 20) return;
							walk(kids[ki], depth + 1);
						}
					})(tree, 0);
					if (!lines.length || lines.length > 20) continue;
					var bodyT = lines.join('\n');
					if (bodyT.length > 2000 || TPL_UNSAFE.test(bodyT)) continue;   // dynamic/JS templates need Roam booted — skip for T=0
					out.push({ n: name, t: bodyT });
				}
			}
			var json = JSON.stringify(out);
			try { if (localStorage.getItem(key) !== json) localStorage.setItem(key, json); } catch (e) { }
			if (doLog) console.log('** instant-roam: template cache -> ' + out.length + ' **');
		} catch (e) { }
	}

	var timers = [], boundVis = null, boundHide = null;
	function ric(f) { try { (window.requestIdleCallback || function (x) { setTimeout(x, 250); })(f, { timeout: 4000 }); } catch (e) { setTimeout(f, 250); } }
	function armCacheWriters() {
		// post-boot idle refresh (pages + templates)
		timers.push(setTimeout(function () { ric(function () { writePages(); writeTemplates(); }); }, 8000));
		// end-of-life refresh MUST be synchronous — iOS freezes timers/idle callbacks immediately on hide
		boundVis = function () { if (document.visibilityState === 'hidden') writePages(); };
		boundHide = function () { writePages(); };
		document.addEventListener('visibilitychange', boundVis);
		window.addEventListener('pagehide', boundHide);
		// multi-window desktop: a visible window keeps the store fresh for a sibling cold-boot
		timers.push(setInterval(function () { if (document.visibilityState === 'visible') ric(function () { writePages(); writeTemplates(); }); }, 300000));
	}

	// ---------- installer ----------
	function strip(html) {
		return html
			.replace(/<style id="IR_style"[\s\S]*?<\/style>\s*/g, '')
			.replace(/<script id="IR_boot"[\s\S]*?<\/script>\s*/g, '')
			.replace(/<script\s+type="text\/x-ir-deferred"\s+data-ir-src="([^"]+)"([^>]*)>/g, '<script src="$1"$2>');
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
			var darkBg = DARK, lightBg = '#ffffff';
			var lg = lastGraph();
			try { var ccp = JSON.parse(localStorage.getItem('IR2:' + lg + ':colors') || '{}'); if (ccp.dark && ccp.dark.bg) darkBg = ccp.dark.bg; if (ccp.light && ccp.light.bg) lightBg = ccp.light.bg; } catch (_) { }
			var irv = VERSION + '.' + hashStr(darkBg + '|' + lightBg);
			var isP = html.indexOf('id="IR_style"') !== -1;
			if (isP && html.indexOf('data-irv="' + irv + '"') !== -1) return;     // already current
			var orig = isP ? strip(html) : html;
			// a CLEAN shell is by definition the freshest original — keep the backup current so an
			// eventual uninstall never restores a months-stale shell (Roam updates index.html)
			try { if (!isP) localStorage.setItem(LSO, orig); else if (!localStorage.getItem(LSO)) localStorage.setItem(LSO, orig); } catch (_) { }
			var styleTag = '<style id="IR_style" data-irv="' + irv + '">html,body{background:' + darkBg + ' !important;}@media (prefers-color-scheme: light){html,body{background:' + lightBg + ' !important;}}</style>';
			var scriptTag = '<script id="IR_boot" data-irv="' + irv + '">' + CAPTURE_SRC + '<\/script>';
			var poisoned = orig.replace('</head>', styleTag + '</head>').replace(/<body[^>]*>/, function (m) { return m + scriptTag; });
			if (DEFER_BOOT) poisoned = poisoned.replace(/<script\s+src="(js\/compiled\/(?:shared|main)\.js)"([^>]*)>/g, function (m, src, rest) {
				return '<script type="text/x-ir-deferred" data-ir-src="' + src + '"' + rest + '>';
			});
			if (poisoned.indexOf('IR_boot') === -1 || poisoned.indexOf('IR_style') === -1) return;   // never write a broken shell
			await e.cache.put(e.req, htmlResp(poisoned));
			if (doLog) console.log('** instant-roam: index poisoned (v' + VERSION + ') **');
		} catch (_) { }
	}

	// Manifest: dark iOS splash + start_url pinned to the last-used graph. NOTE (2026-07-03): Roam's
	// precache no longer contains manifest.webmanifest (only manifest.edn) → this is currently a
	// silent no-op and the browser fetches the manifest from network. Kept for the day it returns;
	// the /#/pwa problem is solved at T=0 instead (shell retargets the hash pre-router, see capture).
	async function poisonManifest() {
		try {
			var e = await cacheEntry(isManifest); if (!e) return;
			var txt = await (await e.cache.match(e.req)).text();
			var m; try { m = JSON.parse(txt); } catch (_) { return; }
			var lg = lastGraph();
			var su = lg ? ('/#/app/' + encodeURIComponent(lg)) : null;
			if (m.background_color === DARK && (!su || m.start_url === su)) return;
			try { if (!localStorage.getItem(LSM)) localStorage.setItem(LSM, txt); } catch (_) { }
			m.background_color = DARK;
			if (su) m.start_url = su;
			await e.cache.put(e.req, new Response(JSON.stringify(m), { status: 200, headers: { 'Content-Type': 'application/manifest+json' } }));
			if (doLog) console.log('** instant-roam: manifest poisoned (splash + start_url) **');
		} catch (_) { }
	}

	async function unpoison() {
		try {
			var e = await cacheEntry(isIndex);
			if (e) {
				var html = await (await e.cache.match(e.req)).text();
				if (html.indexOf('id="IR_style"') !== -1 || html.indexOf('id="IR_boot"') !== -1) {
					// strip(current) beats the backup: the backup can be months stale after Roam updates
					var stripped = strip(html);
					var clean = stripped.indexOf('IR_style') === -1 && stripped.indexOf('IR_boot') === -1;
					var orig = null; try { orig = localStorage.getItem(LSO); } catch (_) { }
					await e.cache.put(e.req, htmlResp(clean ? stripped : (orig || stripped)));
				}
			}
			var mraw = null; try { mraw = localStorage.getItem(LSM); } catch (_) { }
			if (mraw) { var me = await cacheEntry(isManifest); if (me) await me.cache.put(me.req, new Response(mraw, { status: 200, headers: { 'Content-Type': 'application/manifest+json' } })); }
			if (doLog) console.log('** instant-roam: restored Roam shell + manifest **');
		} catch (_) { }
	}

	// ---------- capture the user's live theme colors + first-block Y (per graph) ----------
	function opaque(c) { return !!c && c !== 'transparent' && !/rgba\([^)]*,\s*0\s*\)/.test(c); }
	function cacheEnv() {
		var tries = 0;
		var iv = setInterval(function () {
			tries++;
			try {
				var g = gname(); if (!g) { if (tries > 30) clearInterval(iv); return; }
				var blk = document.querySelector('.rm-block-text') || document.querySelector('textarea.rm-block-input') || document.querySelector('.roam-block');
				if (!blk) { if (tries > 30) clearInterval(iv); return; }
				var light = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
				var scheme = light ? 'light' : 'dark';
				var bgEl = document.querySelector('.roam-app') || document.querySelector('.roam-body') || document.body;
				var bgc = getComputedStyle(bgEl).backgroundColor;
				if (!opaque(bgc)) bgc = getComputedStyle(document.body).backgroundColor;
				var txt = getComputedStyle(blk).color;
				if (opaque(bgc) && txt) {
					var cc = {}; try { cc = JSON.parse(localStorage.getItem('IR2:' + g + ':colors') || '{}'); } catch (e) { }
					if (!cc[scheme] || cc[scheme].bg !== bgc || cc[scheme].text !== txt) {
						cc[scheme] = { bg: bgc, text: txt };
						try { localStorage.setItem('IR2:' + g + ':colors', JSON.stringify(cc)); } catch (e) { }
					}
				}
				var top = Math.round(blk.getBoundingClientRect().top);
				var vh = window.innerHeight || 800;
				var form = (window.matchMedia && window.matchMedia('(max-width: 767px)').matches) ? 'm' : 'd';
				if (top > 60 && top < vh * 0.6) {
					var pp = {}; try { pp = JSON.parse(localStorage.getItem('IR2:' + g + ':pos') || '{}'); } catch (e) { }
					if (pp[form] !== top) { pp[form] = top; try { localStorage.setItem('IR2:' + g + ':pos', JSON.stringify(pp)); } catch (e) { } }
				}
				clearInterval(iv);
				poison();   // colors may have changed → re-bake the T=0 shell bg
			} catch (e) { clearInterval(iv); }
		}, 500);
		timers.push(iv);
	}

	var doLog = false, added = false;
	function start() {
		if (added) return; added = true;
		var res = ensureGraph();
		migrate(res.g);
		if (res.any) { poison(); poisonManifest(); } else { unpoison(); }
		cacheEnv();
		armCacheWriters();
	}
	function stop() {
		added = false;
		unpoison();
		for (var i = 0; i < timers.length; i++) { clearTimeout(timers[i]); clearInterval(timers[i]); }
		timers = [];
		if (boundVis) { document.removeEventListener('visibilitychange', boundVis); boundVis = null; }
		if (boundHide) { window.removeEventListener('pagehide', boundHide); boundHide = null; }
		var ids = ['IR_overlay', 'IR_dbgbtn', 'IR_menu', 'IR_dock'];
		for (var j = 0; j < ids.length; j++) { var el = document.getElementById(ids[j]); if (el) el.remove(); }
		try { delete window.__IR_CAPTURE; } catch (_) { window.__IR_CAPTURE = undefined; }
	}

	start();
	return { start: start, stop: stop, poison: poison, poisonManifest: poisonManifest, unpoison: unpoison, writePages: writePages, writeTemplates: writeTemplates, version: VERSION, src: CAPTURE_SRC };
})();
