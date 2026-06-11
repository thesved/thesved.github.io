/*
 * Viktor's Instant Roam — instant, dark, cursor-ready capture on every open.
 * version: 0.4.1  (2026-06-11)
 * author: @ViktorTabori
 *
 * v0.4.1 — applied a 4-lens adversarial review (must-fixes):
 *   - Baton guard stays active during the handoff (was muted → up-to-60ms body-focus window killed
 *     the keyboard). It still steps aside for an editable relatedTarget (the real handoff).
 *   - Buffer is cleared ONLY after a read-back confirms the block actually holds the text
 *     (confirmWritten), and never cleared on an error path → no data loss.
 *   - Fallback gates overlay removal on Roam's editor holding DOM focus (pollEditable), not a fixed
 *     timer → no re-run of the v0.3 keyboard drop.
 *   - Dismiss (✕/Esc) mid-handoff no longer falls through to navigate/force-focus; restored drafts
 *     are passive (not auto-committed); watchdog no longer yanks the caret; loop no longer stalls
 *     on a wrong-block focus.
 *
 * THE TRICK (proven on desktop CDP + the dark capture box proven on a real iPhone, 2026-06-11):
 *   Roam boots from a Workbox-precached index.html and its OWN service worker serves that cached
 *   shell for the top-level navigation on every load. We can't register our own SW on
 *   roamresearch.com, but from this in-graph module (runs AFTER boot) we REWRITE the cached
 *   index.html in place. Roam's own SW then serves OUR shell at T=0 on the NEXT load — before any
 *   ClojureScript runs — painting instantly and rendering a focused capture box.
 *
 * v0.4 — keyboard-continuity, rebuilt on the board's (Opus+Fable+Gemini+Codex) unanimous findings:
 *   - The iOS keyboard dies the instant document.activeElement is non-editable for even one
 *     run-loop turn. Gesture is irrelevant once the keyboard is already up (KEEP, not SHOW).
 *   - The handoff is therefore DOM-GATED: we do NOT trust roamAlphaAPI.getFocusedBlock() (it flips
 *     in Roam's React state BEFORE the real editable is in the DOM). We confirm on
 *     document.activeElement being Roam's real editable, then remove the overlay.
 *   - Baton guard: during boot, if our textarea loses focus to <body> (Roam boot churn), we grab it
 *     back synchronously so the keyboard never closes.
 *   - Watchdog: after the swap, if Roam re-mounts/blurs the block, we re-assert focus briefly.
 *   - No navigation (stays on the Daily Notes log). If the DOM handoff can't be confirmed, we FALL
 *     BACK to the proven openPage+focus path so the keyboard is never left broken.
 *   - Buffer is cleared only at the very END (after the text is in the block) so nothing is lost and
 *     the next launch isn't pre-populated.
 *   - Set localStorage.IR_debug='1' (or run the "Instant Roam: toggle debug" command) to log focus
 *     custody + visualViewport height — inspect the installed PWA from macOS Safari's Develop menu.
 *
 * iOS: programmatic focus() won't OPEN the keyboard without a gesture, so the caret blinks but the
 * first TAP opens it. The white launch flash is iOS's native splash from Roam's network-served
 * manifest (#FFF) — not reachable from here.
 */
if (window.ViktorInstantroam && window.ViktorInstantroam.stop) window.ViktorInstantroam.stop();
window.ViktorInstantroam = (function () {
	var SALT = '4';                 // bump only if you change the injected <style> (capture-app changes auto-bump)
	var DARK = '#182026';
	var LSO = 'IR_orig_shell', LSM = 'IR_orig_manifest', LST = 'IR_theme', LSD = 'IR_disabled', LSDBG = 'IR_debug';

	// ---------- the instant-capture app (serialized into the shell; must be self-contained) ----------
	function __IR_capture() {
		try {
			if (window.__IR_CAPTURE) return;
			var W = window, D = document, LS = 'IR_buffer';
			var CAP = { ts: Date.now(), done: false, engaged: false, hydrated: false, dismissed: false };
			W.__IR_CAPTURE = CAP;

			var DBG = false; try { DBG = localStorage.getItem('IR_debug') === '1'; } catch (e) { }
			function log() { if (!DBG) return; try { var a = D.activeElement, vh = W.visualViewport ? Math.round(W.visualViewport.height) : -1; console.log('[IR ' + (Date.now() - CAP.ts) + 'ms]', Array.prototype.slice.call(arguments).join(' '), '| active=' + (a && (a.id || a.tagName)), 'vvH=' + vh); } catch (e) { } }
			if (DBG) {
				D.addEventListener('focusin', function (e) { log('focusin →', e.target && (e.target.id || e.target.tagName)); }, true);
				D.addEventListener('focusout', function (e) { log('focusout ←', e.target && (e.target.id || e.target.tagName), 'rel=' + (e.relatedTarget && (e.relatedTarget.id || e.relatedTarget.tagName))); }, true);
				if (W.visualViewport) W.visualViewport.addEventListener('resize', function () { log('viewport resize'); });
			}

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
			ta.placeholder = 'Type your idea…'; ta.setAttribute('autocapitalize', 'sentences'); ta.setAttribute('autocorrect', 'on'); ta.setAttribute('autocomplete', 'off'); ta.setAttribute('inputmode', 'text');
			// font-size MUST be >=16px or iOS auto-zooms on focus (jolt). 21px is safe.
			ta.style.cssText = 'flex:1;width:100%;box-sizing:border-box;background:transparent;color:inherit;border:none;outline:none;resize:none;font-size:21px;line-height:1.5;padding:8px 18px calc(18px + env(safe-area-inset-bottom));caret-color:' + caret + ';font-family:inherit';
			try { var prev = localStorage.getItem(LS); if (prev) { ta.value = prev; } } catch (e) { }   // restore is PASSIVE — only real input sets CAP.engaged (don't auto-commit a dismissed draft)

			ov.appendChild(head); ov.appendChild(ta);
			(D.body || D.documentElement).appendChild(ov);

			function focusTA() { try { ta.focus({ preventScroll: true }); var n = ta.value.length; ta.setSelectionRange(n, n); } catch (e) { } }
			focusTA();
			ta.addEventListener('input', function () { CAP.engaged = true; try { localStorage.setItem(LS, ta.value); } catch (e) { } });
			ta.addEventListener('keydown', function (e) { CAP.engaged = true; if (e.key === 'Escape') { e.preventDefault(); dismiss(); } });
			ta.addEventListener('pointerdown', function () { CAP.engaged = true; });
			ov.addEventListener('pointerdown', function (e) { if (e.target === x) return; CAP.engaged = true; focusTA(); });
			x.addEventListener('click', function (e) { e.stopPropagation(); dismiss(); });

			function isEditable(el) { return !!(el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.isContentEditable)); }
			function roamEditable(el) {
				if (!el || el.id === 'IR_input' || !isEditable(el)) return false;
				if (el.classList && el.classList.contains('rm-block-input')) return true;
				try { if (el.closest('.roam-block-container, .rm-block, .roam-article, .cm-editor')) return true; } catch (e) { }
				return true; // any editable that isn't our overlay
			}

			// BATON GUARD: during boot (before the intentional handoff), if our textarea loses focus to a
			// NON-editable (Roam's boot churn knocking focus to <body>), grab it back SYNCHRONOUSLY so the
			// keyboard never closes. If focus is going to an editable (Roam's editor — the handoff), allow it.
			ta.addEventListener('focusout', function (e) {
				if (CAP.done || CAP.dismissed) return;   // stays active through the handoff: editable relatedTarget (Roam) passes; a drop to <body> is reclaimed in the SAME turn
				if (!isEditable(e.relatedTarget)) { try { ta.focus({ preventScroll: true }); } catch (_) { } log('baton-guard refocus'); }
			});

			function fadeRemove() { CAP.done = true; try { ov.style.opacity = '0'; } catch (e) { } setTimeout(function () { try { ov.remove(); } catch (e) { } }, 210); }
			function dismiss() { CAP.dismissed = true; fadeRemove(); }     // keep buffer; never force focus
			function clearBuf() { try { localStorage.removeItem(LS); } catch (e) { } }
			function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
			function curText() { return (ta.value || '').replace(/\s+$/, ''); }

			var written = '';
			function syncBlock(a, target) { var c = curText(); if (c !== written) { try { a.updateBlock({ block: { uid: target, string: c } }); } catch (e) { } written = c; } return c; }

			// Clear the buffer ONLY after reading back that the block actually holds the captured text
			// (the block may have GROWN if the user kept typing into Roam, so startsWith is enough). On any
			// failure the buffer is kept so the next launch restores the draft — never loses data.
			async function confirmWritten(a, target) {
				try {
					await sleep(120);   // let the last updateBlock flush to the datom store
					var p = a.pull('[:block/string]', [':block/uid', target]);
					var s = (p && p[':block/string']) || '';
					var want = ''; try { want = localStorage.getItem(LS) || ''; } catch (e) { }
					if (want === '' || s === want || s.indexOf(want) === 0) { clearBuf(); return true; }
				} catch (e) { }
				return false;
			}

			async function ensureTarget(a) {
				var dnp = a.util.dateToPageUid(new Date());
				if (!a.pull('[:db/id]', [':block/uid', dnp])) { try { await a.createPage({ page: { title: a.util.dateToPageTitle(new Date()), uid: dnp } }); } catch (e) { } }
				var text = curText();
				var p = a.pull('[{:block/children [:block/string :block/uid :block/order]}]', [':block/uid', dnp]);
				var kids = (p && p[':block/children']) || [];
				kids.sort(function (m, n) { return (m[':block/order'] || 0) - (n[':block/order'] || 0); });
				var top = kids[0], topUid = top ? top[':block/uid'] : null, topEmpty = top ? !((top[':block/string'] || '').trim()) : false;
				var target;
				if (topUid && topEmpty) { target = topUid; if (text) { try { await a.updateBlock({ block: { uid: topUid, string: text } }); } catch (e) { } } }
				else { target = a.util.generateUID(); try { await a.createBlock({ location: { 'parent-uid': dnp, order: 0 }, block: { uid: target, string: text } }); } catch (e) { } }
				// NOTE: do NOT preset `written` here — leave it '' so the loop's syncBlock re-writes the text
				// (covers a swallowed/failed write above), and confirmWritten gates the buffer clear on read-back.
				return { dnp: dnp, target: target };
			}

			function focusBlock(a, uid, caretPos, tries) {
				try { a.ui.setBlockFocusAndSelection({ location: { 'block-uid': uid, 'window-id': 'main-window' }, selection: { start: caretPos } }); } catch (e) { }
				if (tries > 0) setTimeout(function () { var f = null; try { f = a.ui.getFocusedBlock(); } catch (e) { } if (!f || f['block-uid'] !== uid) focusBlock(a, uid, caretPos, tries - 1); }, 130);
			}

			// Resolve once Roam's real editable holds DOM focus (or cap out ~ticks*250ms). While waiting we
			// keep OUR textarea focused so the keyboard never drops on a slow log view — this gates overlay
			// removal in the fallback the same way the happy path is DOM-gated (no fixed timer = no v0.3 bug).
			function pollEditable(ticks) {
				return new Promise(function (res) {
					var n = 0, iv = setInterval(function () {
						n++;
						if (roamEditable(D.activeElement)) { clearInterval(iv); return res(true); }
						if (D.activeElement !== ta) focusTA();
						if (n >= ticks) { clearInterval(iv); return res(false); }
					}, 250);
				});
			}

			// After a confirmed swap: if Roam re-mounts/blurs the block and focus falls to <body>, re-assert
			// briefly so the keyboard survives the remount (board's top risk). No `selection` → keep Roam's caret.
			function watchdog(a, target) {
				var n = 0, iv = setInterval(function () {
					n++;
					if (!roamEditable(D.activeElement)) {
						log('watchdog re-assert');
						try { a.ui.setBlockFocusAndSelection({ location: { 'block-uid': target, 'window-id': 'main-window' } }); } catch (e) { }
						var node = null; try { node = D.querySelector('textarea.rm-block-input[id*="' + target + '"]') || D.querySelector('textarea.rm-block-input'); } catch (e) { }
						if (node) { try { node.focus({ preventScroll: true }); } catch (e) { } }
					}
					if (n >= 12) clearInterval(iv);   // ~720ms
				}, 60);
			}

			// DOM-gated, no-navigation handoff. Confirm on document.activeElement (the board's key fix); the
			// baton guard keeps the keyboard alive (reclaims any body-drop in the same run-loop turn); remove
			// the overlay only once Roam's real editor holds focus. Fall back to the proven openPage path —
			// gated the same DOM way — if it can't be confirmed.
			function hydrate(a) {
				if (CAP.hydrated || CAP.dismissed) return; CAP.hydrated = true;
				(async function () {
					try {
						var t = await ensureTarget(a); var target = t.target;
						var lastReq = 0, confirmed = 0, ok = false;
						for (var i = 0; i < 50 && !CAP.dismissed; i++) {
							var ae = D.activeElement;
							if (ae === ta) syncBlock(a, target);     // only mirror while OUR field still owns focus (don't clobber what's typed into Roam)
							var f = null; try { f = a.ui.getFocusedBlock(); } catch (e) { }
							var domOk = roamEditable(ae), apiOk = !!(f && f['block-uid'] === target);
							if (domOk && apiOk) { if (++confirmed >= 2) { ok = true; break; } }
							else {
								confirmed = 0;
								if (!domOk && ae !== ta) { focusTA(); log('recover keyboard (focus fell to body)'); }      // body/non-editable → reclaim, keep keyboard
								else if (Date.now() - lastReq > 250) { try { a.ui.setBlockFocusAndSelection({ location: { 'block-uid': target, 'window-id': 'main-window' }, selection: { start: written.length } }); } catch (e) { } lastReq = Date.now(); log('request focus'); }   // IR_input OR wrong editable → steer to target
							}
							await sleep(60);
						}
						if (ok) { log('HANDOFF OK (no-nav)'); confirmWritten(a, target); fadeRemove(); watchdog(a, target); return; }
						if (CAP.dismissed) { log('dismissed mid-handoff — keep buffer, no nav'); return; }   // ✕/Esc: don't fall through to navigate/force-focus/clear
						// FALLBACK: proven openPage path, but gate overlay removal on DOM focus (no fixed timer).
						log('handoff fallback → openPage');
						try { await a.ui.mainWindow.openPage({ page: { uid: t.dnp } }); } catch (e) { }
						await sleep(60); syncBlock(a, target);
						focusBlock(a, target, written.length, 6);
						await pollEditable(6);   // hold overlay (keeping IR_input focused) until Roam's editable holds focus, or ~1.5s
						confirmWritten(a, target); fadeRemove(); watchdog(a, target);
					} catch (e) { log('hydrate error — keeping buffer'); fadeRemove(); }
				})();
			}

			function painted() {
				var app = D.getElementById('app');
				if (!(app && app.children.length > 0)) return false;
				var spin = D.querySelector('[class*="astrolabe"],img[src*="astrolabe"],.loading-astrolabe');
				return !(spin && spin.getClientRects().length > 0);   // a HIDDEN astrolabe lingers post-boot — ignore it
			}

			// Engaged → seamless handoff. Not engaged → wait until Roam painted, then melt (no white reveal).
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
	var VERSION = SALT + '-' + hashStr(CAPTURE_SRC);   // auto-bumps whenever the capture app changes → forces a re-poison

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

	// ---------- enable / disable / debug (Command Palette) ----------
	var CMD_OFF = 'Instant Roam: disable (instant dark capture)';
	var CMD_ON = 'Instant Roam: enable (instant dark capture)';
	var CMD_DBG = 'Instant Roam: toggle debug logging';
	function toast(msg) {
		try { var d = document.createElement('div'); d.textContent = msg; d.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#182026;color:#fff;padding:10px 16px;border-radius:8px;font:14px Inter,system-ui,sans-serif;z-index:2147483647;box-shadow:0 4px 16px rgba(0,0,0,.4)'; document.body.appendChild(d); setTimeout(function () { try { d.remove(); } catch (e) { } }, 2400); } catch (e) { }
	}
	function isDisabled() { try { return localStorage.getItem(LSD) === '1'; } catch (e) { return false; } }
	function disable() { try { localStorage.setItem(LSD, '1'); } catch (e) { } unpoison(); var o = document.getElementById('IR_overlay'); if (o) o.remove(); toast('Instant Roam disabled — back to normal Roam on next open.'); }
	function enable() { try { localStorage.removeItem(LSD); } catch (e) { } poison(); captureTheme(); toast('Instant Roam enabled — reopen Roam to see it.'); }
	function toggleDebug() { var on = false; try { on = localStorage.getItem(LSDBG) !== '1'; localStorage.setItem(LSDBG, on ? '1' : '0'); } catch (e) { } toast('Instant Roam debug ' + (on ? 'ON' : 'off') + ' — reopen Roam; inspect via Safari Develop menu.'); }
	function addCommands() { try { var cp = window.roamAlphaAPI.ui.commandPalette; cp.addCommand({ label: CMD_OFF, callback: disable }); cp.addCommand({ label: CMD_ON, callback: enable }); cp.addCommand({ label: CMD_DBG, callback: toggleDebug }); } catch (e) { } }
	function removeCommands() { try { var cp = window.roamAlphaAPI.ui.commandPalette; cp.removeCommand({ label: CMD_OFF }); cp.removeCommand({ label: CMD_ON }); cp.removeCommand({ label: CMD_DBG }); } catch (e) { } }

	var doLog = false, added = false;
	function start() {
		if (added) return; added = true;
		addCommands();
		if (isDisabled()) { unpoison(); return; }
		poison(); captureTheme();
	}
	function stop() {
		added = false;
		removeCommands();
		unpoison();
		var o = document.getElementById('IR_overlay'); if (o) o.remove();
		try { delete window.__IR_CAPTURE; } catch (_) { window.__IR_CAPTURE = undefined; }
	}

	start();
	return { start: start, stop: stop, poison: poison, unpoison: unpoison, captureTheme: captureTheme, enable: enable, disable: disable, version: VERSION };
})();
