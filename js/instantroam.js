/*
 * Viktor's Instant Roam — instant, dark, cursor-ready capture on every open.
 * version: 0.5.1  (2026-06-11) — + desktop horizontal alignment: the input now matches the real
 *                                  block's left edge + column width (cached per form factor); mobile
 *                                  stays full-width. (0.5.0 below.)
 * version: 0.5.0  (2026-06-11) — themed to the user's real skin + balanced layout. Captures the live
 *                                  theme colors (per scheme) and the real first-block Y (per form factor)
 *                                  on each boot → the T=0 capture screen matches the skin and lands the
 *                                  input where the real block sits (no jump on handoff). Whole screen is a
 *                                  tap-to-focus target (mobile keyboard); desktop autofocuses. Removed the
 *                                  close ✕ and turned the debug ⧉ copy layer OFF by default (IR_debug='1').
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
 * DEBUG BUILD (v0.2.1-dbg): logging ON by default (off: localStorage.IR_debug='0'). Traces focus
 * custody + visualViewport (keyboard oracle) with ms timestamps into window.__IR_LOG, mirrored to
 * localStorage.IR_log (prev boot rotated to IR_log_prev). The ⧉ button (bottom-right, survives the
 * overlay teardown) copies the trace to the clipboard. Once per poisoned version an auto-LAB runs
 * ~3s after the first real engagement: mounts a second textarea in the overlay and does an ASYNC
 * editable→editable focus transfer (no gesture) — "LAB VERDICT PASS" in the trace = iOS keeps the
 * keyboard across the transfer (the crux fact of the no-nav handoff). Re-arm: triple-tap the header.
 *
 * UNINSTALL: window.ViktorInstantroam.stop() (restores Roam's shell + manifest), then remove the
 * `instantroam` key from the roam/js loader's alphaChannel and reload.
 */
if (window.ViktorInstantroam && window.ViktorInstantroam.stop) window.ViktorInstantroam.stop();
window.ViktorInstantroam = (function () {
	var SALT = '2';                 // bump only if you change the injected <style> (capture-app changes auto-bump)
	var DEFER_BOOT = false;         // DISABLED 2026-06-11: deferring + dynamically re-injecting Roam's
	//                                 compiled scripts works on desktop CDP but does NOT boot Roam on the
	//                                 real iOS PWA (user stuck on capture, no roam-ready). Needs a safer
	//                                 smooth-typing technique. Kept gated for future iteration.
	var DARK = '#182026';
	var LSO = 'IR_orig_shell', LSM = 'IR_orig_manifest';

	// ---------- the instant-capture app (serialized into the shell; must be self-contained) ----------
	function __IR_capture() {
		try {
			if (window.__IR_CAPTURE) return;
			var W = window, D = document, LS = 'IR_buffer';
			var CAP = { ts: Date.now(), done: false, engaged: false, hydrated: false, dismissed: false };
			W.__IR_CAPTURE = CAP;
			var DEFER_BOOT = false;   // see module-scope note — deferred boot disabled (breaks iOS Roam boot)

			// ---------- debug layer (default ON in this build; disable: localStorage.IR_debug='0') ----------
			var DBG = false; try { DBG = localStorage.getItem('IR_debug') === '1'; } catch (e) { }   // debug + ⧉ copy button OFF by default (opt-in: IR_debug='1')
			var IRV = ''; try { var bt = D.getElementById('IR_boot'); IRV = (bt && bt.getAttribute('data-irv')) || ''; } catch (e) { }
			var labKey = 'IR_lab_done_' + IRV;
			// Auto-LAB is OPT-IN (keyboard retention already proven on device) — arm via localStorage.IR_lab='1'
			// or triple-tap the header. Keeps the dashed test box out of the way during real captures.
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
			// ---------- deferred Roam boot (keeps typing smooth; see poison() note) ----------
			var booted = false, pauseT = null, capT = null;
			function bootRoam(why) {
				if (booted) return; booted = true;
				if (pauseT) clearTimeout(pauseT); if (capT) clearTimeout(capT);
				L('bootRoam(' + why + ') t=' + (Date.now() - T0) + ' active=' + cls(D.activeElement));
				try {
					var defs = D.querySelectorAll('script[type="text/x-ir-deferred"]');
					L('bootRoam inject ' + defs.length + ' deferred script(s)');
					for (var i = 0; i < defs.length; i++) {
						var old = defs[i], s = D.createElement('script');
						for (var j = 0; j < old.attributes.length; j++) { var at = old.attributes[j]; if (at.name === 'type' || at.name === 'data-ir-src') continue; s.setAttribute(at.name, at.value); }
						s.src = old.getAttribute('data-ir-src'); s.async = false;   // async=false preserves shared.js -> main.js order
						old.parentNode.insertBefore(s, old); old.parentNode.removeChild(old);
					}
				} catch (e) { L('bootRoam ERR ' + (e && e.message)); }
			}
			function armBoot(ta) {   // called AFTER the textarea exists
				try {
					setTimeout(function () { if (!CAP.engaged) bootRoam('idle-no-type'); }, 1500);   // reader (no typing) -> boot soon
					setTimeout(function () { bootRoam('backstop'); }, 4000);                          // fail-safe: boot no matter what
					ta.addEventListener('blur', function () { if (!CAP.done && !CAP.dismissed && !booted) bootRoam('blur'); });
				} catch (e) { bootRoam('arm-failsafe'); }
			}

			function engage(src) {
				if (!CAP.engaged) { L('ENGAGED via ' + src + ' vv=' + vvh()); CAP.engaged = true; if (DEFER_BOOT && !capT) capT = setTimeout(function () { bootRoam('cap'); }, 2500); }   // cap typing window after first engage
				scheduleLab();
			}
			if (DBG) {
				try { var pv = localStorage.getItem('IR_log'); if (pv) localStorage.setItem('IR_log_prev', pv); localStorage.removeItem('IR_log'); } catch (e) { }
				L('boot irv=' + IRV + ' lab=' + (LAB ? 'armed' : 'off') + ' vv=' + vvh() + ' ih=' + W.innerHeight + ' ua=' + (W.navigator && W.navigator.userAgent));
				D.addEventListener('focusin', function (e) { L('focusin  ' + cls(e.target) + '  (from ' + cls(e.relatedTarget) + ') vv=' + vvh()); }, true);
				D.addEventListener('focusout', function (e) { L('focusout ' + cls(e.target) + '  (to ' + cls(e.relatedTarget) + ') vv=' + vvh()); }, true);
				try { if (W.visualViewport) W.visualViewport.addEventListener('resize', function () { L('vv-resize ' + vvh() + ' ot=' + Math.round(W.visualViewport.offsetTop) + ' active=' + cls(D.activeElement)); }); } catch (e) { }
				var lastA = '', lastV = -1;
				setInterval(function () {           // catches SILENT drops: a focused element removed from the DOM fires NO focusout
					var a = cls(D.activeElement), v = vvh();
					if (a !== lastA || Math.abs(v - lastV) > 2) { L('tick active=' + a + ' vv=' + v); lastA = a; lastV = v; }
				}, 200);
				var cb = D.createElement('button'); cb.id = 'IR_dbgbtn'; cb.textContent = '⧉'; cb.setAttribute('aria-label', 'copy IR trace');
				cb.style.cssText = 'position:fixed;right:8px;bottom:calc(8px + env(safe-area-inset-bottom));z-index:2147483647;width:34px;height:34px;border-radius:17px;border:1px solid rgba(127,127,127,.45);background:rgba(32,38,46,.88);color:#9ecbff;font-size:15px;line-height:1;padding:0';
				cb.addEventListener('mousedown', function (e) { e.preventDefault(); });   // never steal focus (keeps the keyboard)
				cb.addEventListener('click', function (e) {
					e.preventDefault(); e.stopPropagation();
					var txt = LOG.join('\n'); try { var pp = localStorage.getItem('IR_log_prev'); if (pp) txt += '\n--- prev boot ---\n' + pp; } catch (e2) { }
					function fb() { try { var t = D.createElement('textarea'); t.value = txt; t.readOnly = true; t.style.cssText = 'position:fixed;left:5%;right:5%;top:10%;height:60%;z-index:2147483647;font-size:11px;background:#fff;color:#000'; (D.body || D.documentElement).appendChild(t); t.onblur = function () { t.remove(); }; t.focus(); t.select(); } catch (e3) { } }
					function ok() { cb.textContent = '✓'; setTimeout(function () { cb.textContent = '⧉'; }, 1200); }
					try { W.navigator.clipboard.writeText(txt).then(ok, fb); } catch (e4) { fb(); }
				});
				(D.body || D.documentElement).appendChild(cb);
			}

			// Zero date-flash: if the user runs Viktor's date-formatter (its config was cached on a prior
			// boot), early-load it NOW at T=0 so its MutationObserver is already watching before Roam
			// paints the daily-note dates → no native-format flash. The normal post-boot loader re-load
			// is a no-op (the plugin is idempotent and keeps this running instance). Gated on the cache so
			// non-dateformatter users never pull it.
			try {
				if (localStorage.getItem('Viktor_dfcfg') && !W.ViktorDateformatter) {
					var dfs = D.createElement('script');
					dfs.src = 'https://thesved.github.io/js/dateformatter.js';   // no cache-bust → browser-cached, fast
					dfs.async = false; dfs.id = 'IR_dateformatter_early';
					(D.head || D.documentElement).appendChild(dfs);
					L('date-formatter early-loaded (T=0)');
				}
			} catch (e) { }

			// Colors + vertical position come from the user's REAL theme, captured on a prior boot
			// (cacheEnv, below) and stashed in localStorage — so the capture screen matches any custom
			// skin (light/dark) and drops the input where the real first block sits (per form factor:
			// desktop 'd' vs mobile 'm'). Roam defaults are used only on the very first boot.
			var light = false; try { light = W.matchMedia && W.matchMedia('(prefers-color-scheme: light)').matches; } catch (e) { }
			var scheme = light ? 'light' : 'dark';
			var form = (W.matchMedia && W.matchMedia('(max-width: 767px)').matches) ? 'm' : 'd';
			var DEFC = { dark: { bg: '#182026', text: '#e8eaed' }, light: { bg: '#ffffff', text: '#1a1a1a' } };
			var DEFP = { d: 230, m: 285 };
			var col = DEFC[scheme], pos = DEFP[form];
			try { var cc = JSON.parse(localStorage.getItem('IR_colors') || '{}'); if (cc[scheme] && cc[scheme].bg && cc[scheme].text) col = cc[scheme]; } catch (e) { }
			try { var pp = JSON.parse(localStorage.getItem('IR_pos') || '{}'); if (typeof pp[form] === 'number') pos = pp[form]; } catch (e) { }
			// captured colors are always computed "rgb(r, g, b)" → derive a 50%-alpha caption color from
			// them (color-mix isn't reliable cross-engine). Hex defaults fall back to a scheme-based dim.
			function dimOf(c) { var m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(c); return m ? 'rgba(' + m[1] + ',' + m[2] + ',' + m[3] + ',.5)' : (light ? 'rgba(0,0,0,.45)' : 'rgba(255,255,255,.45)'); }
			var bg = col.bg, fg = col.text, dim = dimOf(fg);
			try { var vh0 = W.innerHeight || 800; pos = Math.max(72, Math.min(pos, Math.round(vh0 * 0.6))); } catch (e) { }

			// Horizontal column (DESKTOP only): on desktop Roam centers its content, so a full-width
			// left-aligned input looks wrong. Align the caption + input to the real block's left edge +
			// width (cached per form factor). Mobile is already full-width and stays as-is.
			var xLeft = 18, xRight = 18, colMax = '';
			if (form === 'd') {
				try { var xx = JSON.parse(localStorage.getItem('IR_x') || '{}'); if (xx.d && xx.d.left > 0 && xx.d.width > 100) { xLeft = xx.d.left; xRight = 0; colMax = ';max-width:' + (xx.d.left + xx.d.width) + 'px'; } } catch (e) { }
			}

			var ov = D.createElement('div'); ov.id = 'IR_overlay';
			ov.style.cssText = 'position:fixed;inset:0;z-index:2147483600;background:' + bg + ';color:' + fg + ';display:flex;flex-direction:column;font-family:Inter,system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased;opacity:1;transition:opacity .16s ease;cursor:text';

			// spacer pushes the caption + input down so the input's first line lands at the cached block Y
			var spacer = D.createElement('div'); spacer.style.cssText = 'flex:none;height:' + Math.max(0, pos - 30) + 'px';
			var head = D.createElement('div');
			head.style.cssText = 'padding:0 ' + xRight + 'px 0 ' + xLeft + 'px;margin-bottom:8px;font-size:13px;flex:none;line-height:1.5' + colMax;
			var label = D.createElement('span'); label.textContent = 'Jot to today’s Daily Notes';
			label.style.color = dim;   // dim set on the text element itself (survives any inherited-color override)
			head.appendChild(label);   // no close ✕ — there's nothing to close to (less is more)

			var ta = D.createElement('textarea'); ta.id = 'IR_input';
			ta.placeholder = 'Type your idea…'; ta.setAttribute('autocapitalize', 'sentences'); ta.setAttribute('autocorrect', 'on');
			ta.style.cssText = 'flex:1;width:100%;box-sizing:border-box;background:transparent;color:inherit;border:none;outline:none;resize:none;font-size:21px;line-height:1.5;padding:4px ' + xRight + 'px calc(18px + env(safe-area-inset-bottom)) ' + xLeft + 'px;caret-color:#4c9aff;font-family:inherit' + colMax;
			try { var prev = localStorage.getItem(LS); if (prev) { ta.value = prev; if (prev.trim()) CAP.engaged = true; } } catch (e) { }

			ov.appendChild(spacer); ov.appendChild(head); ov.appendChild(ta);
			(D.body || D.documentElement).appendChild(ov);

			function focusBox() { try { ta.focus(); var n = ta.value.length; ta.setSelectionRange(n, n); } catch (e) { } }
			focusBox();
			if (DEFER_BOOT) armBoot(ta);   // arm deferred-boot triggers now that the textarea exists

			// Baton guard (active only during the no-nav handoff): if focus leaves IR_input to a
			// NON-editable while the overlay is still alive, reclaim it in the SAME run-loop turn so
			// activeElement never lands on body (which kills the iOS keyboard). If focus leaves to a
			// Roam editable, that's the legit handoff — let it go.
			var batonOn = false;
			ta.addEventListener('focusout', function (e) {
				if (!batonOn || CAP.done) return;
				if (roamEditable(e.relatedTarget)) { L('baton release -> ' + cls(e.relatedTarget)); return; }
				L('baton reclaim (rt=' + cls(e.relatedTarget) + ') vv=' + vvh());
				try { ta.focus({ preventScroll: true }); } catch (e2) { }
			});
			ta.addEventListener('input', function () { engage('input'); L('input len=' + ta.value.length + ' vv=' + vvh()); try { localStorage.setItem(LS, ta.value); } catch (e) { } if (DEFER_BOOT && !booted) { if (pauseT) clearTimeout(pauseT); pauseT = setTimeout(function () { bootRoam('typing-pause'); }, 700); } });
			ta.addEventListener('keydown', function (e) { engage('keydown'); if (e.key === 'Escape') { e.preventDefault(); dismiss(); } });
			ta.addEventListener('pointerdown', function () { engage('tap-ta'); });
			ov.addEventListener('pointerdown', function () { engage('tap-ov'); focusBox(); });   // whole screen taps to focus (mobile: opens the keyboard)

			// triple-tap the header label -> re-arm the auto-LAB for the next boot
			var tapN = 0, tapAt = 0;
			label.addEventListener('pointerdown', function () {
				var now = Date.now(); if (now - tapAt > 900) tapN = 0; tapAt = now;
				if (++tapN >= 3) { tapN = 0; try { localStorage.setItem('IR_lab', '1'); localStorage.removeItem(labKey); } catch (e) { } label.textContent = 'lab re-armed — kill app & reopen'; L('lab re-armed by triple-tap'); }
			});

			// AUTO-LAB (once per poisoned version, needs a real engagement = keyboard up): proves the
			// crux fact in ISOLATION on this exact device — async editable→editable focus transfer with
			// NO gesture, ~3s after the tap. PASS = keyboard survives (vv flat, focus lands) both ways.
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

			function fadeRemove() { CAP.done = true; L('overlay-fade active=' + cls(D.activeElement) + ' vv=' + vvh()); try { ov.style.opacity = '0'; } catch (e) { } setTimeout(function () { try { ov.remove(); } catch (e) { } L('overlay-removed active=' + cls(D.activeElement) + ' vv=' + vvh()); }, 210); }
			function dismiss() { CAP.dismissed = true; L('dismiss'); fadeRemove(); }     // keep buffer; never force focus
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
			// No-nav focus: try the log window-id ('log-outline' — a Roam constant for the DNP log,
			// route-app.js), then 'main-window', then a DOM fallback (synthetic click to mount edit
			// mode + direct focus). Gate on the REAL DOM editable (document.activeElement), never on
			// getFocusedBlock (React state flips before the textarea is mounted+focused). Resolves
			// true once activeElement is the target's editable. Roam ignores isTrusted on the click.
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
				L('hydrate start (NO-NAV) vv=' + vvh() + ' active=' + cls(D.activeElement));
				(async function () {
					try {
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
						else { target = a.util.generateUID(); try { await a.createBlock({ location: { 'parent-uid': dnp, order: 0 }, block: { uid: target, string: wrote } }); } catch (e) { } }
						L('target uid=' + target + ' (' + (topUid && topEmpty ? 'reused-top' : 'new-block') + ') len=' + wrote.length);
						// reconcile keystrokes typed during the awaits (verbatim)
						var latest = (ta.value || '');
						if (latest !== wrote && (latest.trim() || wrote)) { L('reconcile len ' + wrote.length + '->' + latest.length); try { await a.updateBlock({ block: { uid: target, string: latest } }); } catch (e) { } wrote = latest; }
						// clear the crash-buffer ONLY after a read-back confirms the block holds the text
						try { var chk = a.pull('[:block/string]', [':block/uid', target]); if (chk && chk[':block/string'] === wrote) clearBuf(); else L('buffer kept (read-back mismatch)'); } catch (e) { }
						var caretPos = wrote.length;
						var ok = await focusTarget(a, target, caretPos);
						if (ok) await new Promise(function (r) { requestAnimationFrame(function () { r(); }); });   // hold ≥1 frame before teardown
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
				if (ready && !CAP.readyAt) { CAP.readyAt = Date.now() - T0; L('roam-ready at ' + CAP.readyAt + 'ms engaged=' + CAP.engaged); }
				if (CAP.done || CAP.dismissed) { clearInterval(poll); return; }
				if (ready && CAP.engaged && (!labT || labFinished)) { clearInterval(poll); hydrate(a); }   // lab (if running) finishes first
				else if (ready && !CAP.engaged && painted()) { clearInterval(poll); L('painted -> melt (not engaged)'); fadeRemove(); }
				else if (tries > 1500) { clearInterval(poll); L('hard-timeout melt'); fadeRemove(); }   // ~150s hard safety
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
			.replace(/<script id="IR_boot"[\s\S]*?<\/script>\s*/g, '')
			// self-heal: restore any deferred compiled scripts left by an older deferred-boot build
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
			// T=0 shell background = the user's real theme bg (captured by cacheEnv), so there's no
			// flash of the wrong color before the capture overlay paints. Colors fold into the irv so a
			// skin/scheme change re-poisons the shell.
			var darkBg = DARK, lightBg = '#ffffff';
			try { var ccp = JSON.parse(localStorage.getItem('IR_colors') || '{}'); if (ccp.dark && ccp.dark.bg) darkBg = ccp.dark.bg; if (ccp.light && ccp.light.bg) lightBg = ccp.light.bg; } catch (_) { }
			var irv = VERSION + '.' + hashStr(darkBg + '|' + lightBg);
			var isP = html.indexOf('id="IR_style"') !== -1;
			if (isP && html.indexOf('data-irv="' + irv + '"') !== -1) return;     // already current
			var orig = isP ? strip(html) : html;
			try { if (!localStorage.getItem(LSO)) localStorage.setItem(LSO, orig); } catch (_) { }
			var styleTag = '<style id="IR_style" data-irv="' + irv + '">html,body{background:' + darkBg + ' !important;}@media (prefers-color-scheme: light){html,body{background:' + lightBg + ' !important;}}</style>';
			var scriptTag = '<script id="IR_boot" data-irv="' + irv + '">' + CAPTURE_SRC + '<\/script>';
			var poisoned = orig.replace('</head>', styleTag + '</head>').replace(/<body[^>]*>/, function (m) { return m + scriptTag; });
			// Defer Roam's heavy ClojureScript bundle so the capture textarea stays responsive while the
			// user types (main.js's synchronous eval blocks the main thread → input freezes). We neutralize
			// the <script src> tags (parser ignores type="text/x-ir-deferred"); the capture app re-injects
			// them (async=false → ordered) once typing pauses / on blur / after a cap. Best-effort: if the
			// paths ever change and the regex misses, the scripts load normally (no smoothing, never broken).
			if (DEFER_BOOT) poisoned = poisoned.replace(/<script\s+src="(js\/compiled\/(?:shared|main)\.js)"([^>]*)>/g, function (m, src, rest) {
				return '<script type="text/x-ir-deferred" data-ir-src="' + src + '"' + rest + '>';
			});
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

	// ---------- capture the user's live theme colors + first-block Y (for the T=0 capture screen) ----------
	// Runs post-boot; polls until Roam has painted a block, then records bg/text (per color scheme) and the
	// first-block top (per form factor) so the NEXT instant-capture matches the user's real skin + layout.
	// Self-heals: it re-measures every boot, so changing your skin/CSS updates the capture screen too.
	function opaque(c) { return !!c && c !== 'transparent' && !/rgba\([^)]*,\s*0\s*\)/.test(c); }
	function cacheEnv() {
		var tries = 0;
		var iv = setInterval(function () {
			tries++;
			try {
				var blk = document.querySelector('.rm-block-text') || document.querySelector('textarea.rm-block-input') || document.querySelector('.roam-block');
				if (!blk) { if (tries > 30) clearInterval(iv); return; }   // up to ~15s for Roam to paint
				var light = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
				var scheme = light ? 'light' : 'dark';
				// colors: app/body background + block text color (works with any custom skin)
				var bgEl = document.querySelector('.roam-app') || document.querySelector('.roam-body') || document.body;
				var bgc = getComputedStyle(bgEl).backgroundColor;
				if (!opaque(bgc)) bgc = getComputedStyle(document.body).backgroundColor;
				var txt = getComputedStyle(blk).color;
				if (opaque(bgc) && txt) {
					var cc = {}; try { cc = JSON.parse(localStorage.getItem('IR_colors') || '{}'); } catch (e) { }
					if (!cc[scheme] || cc[scheme].bg !== bgc || cc[scheme].text !== txt) {
						cc[scheme] = { bg: bgc, text: txt };
						try { localStorage.setItem('IR_colors', JSON.stringify(cc)); } catch (e) { }
					}
				}
				// position: first block's text top + left + width (vertical land point + horizontal column).
				// Only when at the top of the page + sane range.
				var rect = blk.getBoundingClientRect();
				var top = Math.round(rect.top);
				var vh = window.innerHeight || 800;
				var form = (window.matchMedia && window.matchMedia('(max-width: 767px)').matches) ? 'm' : 'd';
				if (top > 60 && top < vh * 0.6) {
					var pp = {}; try { pp = JSON.parse(localStorage.getItem('IR_pos') || '{}'); } catch (e) { }
					if (pp[form] !== top) { pp[form] = top; try { localStorage.setItem('IR_pos', JSON.stringify(pp)); } catch (e) { } }
				}
				var left = Math.round(rect.left), width = Math.round(rect.width);
				if (left > 0 && width > 100) {   // horizontal column = where the real block text sits
					var xx = {}; try { xx = JSON.parse(localStorage.getItem('IR_x') || '{}'); } catch (e) { }
					if (!xx[form] || xx[form].left !== left || xx[form].width !== width) {
						xx[form] = { left: left, width: width };
						try { localStorage.setItem('IR_x', JSON.stringify(xx)); } catch (e) { }
					}
				}
				clearInterval(iv);
				poison();   // colors may have changed → re-bake the T=0 shell bg
			} catch (e) { clearInterval(iv); }
		}, 500);
	}

	var doLog = false, added = false;
	function start() { if (added) return; added = true; poison(); poisonManifest(); cacheEnv(); }
	function stop() {
		added = false;
		unpoison();
		var o = document.getElementById('IR_overlay'); if (o) o.remove();
		var b = document.getElementById('IR_dbgbtn'); if (b) b.remove();
		try { delete window.__IR_CAPTURE; } catch (_) { window.__IR_CAPTURE = undefined; }
	}

	start();
	return { start: start, stop: stop, poison: poison, poisonManifest: poisonManifest, unpoison: unpoison, version: VERSION };
})();
