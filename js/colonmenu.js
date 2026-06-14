/*
 * ViktorColonmenu (v0.1) — unified colon-autosuggest dropdown for Roam.
 *
 * Type `:` in a block and get a live menu (like Roam's native `[[` / `((`) of:
 *   • TEMPLATES   — every page under searchPages folders (template/…, [[template]]/…)
 *   • DATES       — natural-language date suggestion (honest; reuses the datelib engine)
 *   • COMMANDS    — :?: / :help: cheat-sheet, :rand: / :random:
 * ↑/↓ to move, Enter/Tab/`:` to pick, Esc to dismiss, click to pick.
 *
 * Architecture (planning/06 + board): this module is the OWNER of the open-`:segment` surface; it
 * forks datepreview's overlay rig (body-level fixed bubble, rAF reposition from the active textarea
 * rect, openSegment trigger, AbortController teardown) and FOLDS datepreview in — calls
 * ViktorDatepreview.stop() on start and renders the resolved date as one selectable row. The legacy
 * commit-on-close `resolveTemplate` (template-roam.js) still fires on a CLOSED `:name:`, but an OPEN
 * menu is AUTHORITATIVE: typing the closing `:` while the menu is up picks the highlighted row and
 * suppresses the legacy commit (we preventDefault the `:` keystroke), so the two never collide.
 *
 * SAFETY (planning/07, board on the real corpus — templates eval js()/jsvar() on insert):
 *  - A template is NEVER resolved for a preview row (resolving = exportNode = eval = prompt() dialogs,
 *    authenticated fetch with personal keys, remote import, clipboard reads). Rows show NAME + a static
 *    capability marker classified by STRING-SCANNING the body (not eval). Eval happens only on commit.
 *  - Capability tiers (dialog/network/remote-import/clipboard/dom); js present but unclassifiable =>
 *    "unknown JS" (fail loud, never silent-safe). Shown as a row badge — passive disclosure only.
 *  - NO trust-confirm modal (owner decision 2026-06-14): the user authors their own js templates and the
 *    row already badges the JS capability, so a per-pick confirm is pure friction. js runs on pick.
 *  - On commit of a js template: tear down the menu + refocus the textarea BEFORE resolving, so a
 *    modal/prompt the template opens can't orphan the menu DOM or lose clipboard user-activation.
 *
 * Insertion replicates resolveTemplate PATH A (one-liner: nativeSetter span-replace + synthetic input)
 * and PATH B (multiline: getClipboardFormat -> synthetic paste of the roam/data tree) BY POSITION
 * (overwrite the `:partial` span), never by re-typing a closing colon (resolveTemplate's text.replace
 * hits the FIRST occurrence = wrong-instance bug).
 *
 * Toggle: window.ViktorRoamOpts.colonMenu !== false (default ON). Needs ViktorDateLib + ViktorRoamLib.
 */
if (window.ViktorColonmenu && typeof window.ViktorColonmenu.stop === 'function') window.ViktorColonmenu.stop();
window.ViktorColonmenu = (function () {
	'use strict';

	var menu = null, rowsEl = null, footEl = null, raf = 0, started = false, ac = null;
	var libCache = null, libKey = '';
	var idxCache = null, idxAt = 0, idxKey = '';           // template index cache
	var IDX_TTL = 4000;                                    // ms; re-query templates at most this often
	var cur = null;                                        // {el, start, end, items, active}
	var committing = false;                                // suppress re-rank during our own writes

	// a template-opener ":" = colon after start/space/bracket, then non-space, non-colon, non-backtick.
	var OPENER_RE = /(?:^|[\s([{>])\:(?=[^\s:`\n])/g;
	var MAX_ROWS = 8;
	function keyOf(it) { return it.kind + ':' + (it.name || it.label); }
	// curated date keywords surfaced on PREFIX (board Q3: "suggestable = resolvable today").
	// solstice/equinox/easter intentionally absent — add to datelib first, then list them here.
	var DATE_KEYWORDS = ['today', 'tomorrow', 'yesterday',
		'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
		'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
		'fullmoon', 'newmoon', 'eom', 'eoy', 'eow', 'eoq', 'q1', 'q2', 'q3', 'q4', 'h1', 'h2'];

	function opts() { return window.ViktorRoamOpts || {}; }
	function enabled() { return opts().colonMenu !== false; }
	function searchPages() { var s = opts().searchPages; return (Array.isArray(s) && s.length) ? s : ['template', '[[template]]']; }

	// ============================================================ JS capability classifier (pure, fail-loud)
	// Detect js()/jsvar()/javascript()/```javascript anywhere in a template body, and classify its
	// capabilities by static pattern. Never eval. js present + no recognized capability => unknown (loud).
	var JS_MARKER = /(^|[^a-z0-9_$.])(js|javascript|jsvar|javascriptvar)\s*\(|```\s*javascript/i;
	function classifyBody(body) {
		body = '' + (body || '');
		var runsJS = JS_MARKER.test(body);
		var clip = /navigator\s*\.\s*clipboard|\$clipboard/i.test(body);
		if (!runsJS && !clip) return { runsJS: false, clip: false, caps: [], unknown: false };
		var caps = [];
		if (/\b(prompt|confirm|alert)\s*\(/.test(body)) caps.push('dialog');
		if (/\bfetch\s*\(|XMLHttpRequest|sendBeacon|\.ajax\s*\(/.test(body)) caps.push('network');
		if (/(^|[^a-z0-9_$.])import\s*\(/.test(body)) caps.push('remote-import');
		if (clip) caps.push('clipboard');
		if (/document\s*\.|insertAdjacentHTML|\.innerHTML|appendChild|createElement|\.head\b|\.body\b/.test(body)) caps.push('dom');
		// fail loud: js present but nothing recognized -> unknown (never render as "safe")
		var unknown = runsJS && caps.length === 0;
		return { runsJS: runsJS, clip: clip, caps: caps, unknown: unknown };
	}
	function capLabel(cls) {
		if (!cls.runsJS && !cls.clip) return '';
		if (cls.runsJS && cls.unknown) return '⚡ unknown JS';
		if (cls.runsJS) return '⚡ ' + (cls.caps.join(' · ') || 'JS');
		return '📋 clipboard';                              // clipboard-var only, no js()
	}

	// ============================================================ template index (one query per folder, cached)
	function api() { return window.roamAlphaAPI; }
	// returns [{name, title, uid, folder, body, cls}] merged priority-first across searchPages, deduped by name
	function buildIndex(roam, folders) {
		var seen = {}, out = [];
		folders.forEach(function (f) {
			var pref = ('' + f).replace(/\/+$/g, '').replace(/^\/+/, '') + '/';
			var titles, pairs;
			try { titles = roam.q('[:find ?t ?u :in $ ?p :where [?e :node/title ?t][?e :block/uid ?u][(clojure.string/starts-with? ?t ?p)]]', pref); }
			catch (e) { titles = []; }
			try { pairs = roam.q('[:find ?t ?s :in $ ?p :where [?pg :node/title ?t][(clojure.string/starts-with? ?t ?p)][?d :block/page ?pg][?d :block/string ?s]]', pref); }
			catch (e) { pairs = []; }
			var bodies = {};
			pairs.forEach(function (r) { (bodies[r[0]] = bodies[r[0]] || []).push(r[1]); });
			titles.forEach(function (r) {
				var title = r[0], uid = r[1], name = title.slice(pref.length);
				if (!name || /\//.test(name)) return;       // skip nested (name contains another /)
				var k = name.toLowerCase();
				if (seen[k]) return; seen[k] = 1;
				var body = (bodies[title] || []).join('\n');
				out.push({ name: name, title: title, uid: uid, folder: f, body: body, cls: classifyBody(body) });
			});
		});
		return out;
	}
	function getIndex(now) {
		var key; try { key = JSON.stringify(searchPages()); } catch (e) { key = ''; }
		if (idxCache && key === idxKey && (now - idxAt) < IDX_TTL) return idxCache;
		var roam = api(); if (!roam || !roam.q) return idxCache || [];
		idxCache = buildIndex(roam, searchPages()); idxAt = now; idxKey = key;
		return idxCache;
	}
	function invalidateIndex() { idxCache = null; }

	// ============================================================ date engine (honest preview), from datepreview
	function lib() {
		var o = opts(), key;
		try { key = JSON.stringify({ w: o.weekStart, nd: o.nameDays, nm: o.nameMonths, a: o.dateAliases, dd: o.dateDirection }); } catch (e) { key = ''; }
		if (!libCache || key !== libKey) {
			try { libCache = window.ViktorDateLib.create(Object.assign({}, o, { nativeDateFallback: false })); libKey = key; }
			catch (e) { libCache = null; }
		}
		return libCache;
	}
	function fmt() {
		var df = window.ViktorDateformatter;
		if (df && df.dateformat && (typeof df.isStarted !== 'function' || df.isStarted())) return df.dateformat;
		return '[[Month Dth, YYYY]]';
	}
	// offset operators (board Q2, simplified per owner): a base date phrase + trailing " ±N[dwmy]"
	// applied left-to-right. NO separator char (`;`/comma dropped — clunky): `fullmoon +7m -1d`.
	// Whitespace before each operator is required, so it never collides with hyphenated names.
	var OFFSET_RE = /\s+([+-])(\d+)([dwmy])\b/gi;
	var OFFSET_TAIL_RE = /(?:\s+[+-]\d+[dwmy]\b)+\s*$/i;
	function applyOffsets(date, offStr) {
		var d = new Date(date.getTime()), m; OFFSET_RE.lastIndex = 0;
		while ((m = OFFSET_RE.exec(offStr)) !== null) {
			var n = (m[1] === '-' ? -1 : 1) * parseInt(m[2], 10), u = m[3].toLowerCase();
			if (u === 'd') d.setDate(d.getDate() + n);
			else if (u === 'w') d.setDate(d.getDate() + 7 * n);
			else if (u === 'm') d.setMonth(d.getMonth() + n);
			else if (u === 'y') d.setFullYear(d.getFullYear() + n);
		}
		return d;
	}
	function resolveChain(L, partial) {
		var off = '';
		var base = ('' + partial).replace(OFFSET_TAIL_RE, function (m) { off = m; return ''; }).trim();
		var d; try { d = base ? L.parse(base, undefined) : null; } catch (e) { d = null; }
		if (!d) return null;
		if (off) d = applyOffsets(d, off);
		return (d && !isNaN(d.valueOf())) ? d : null;
	}

	// ============================================================ trigger detection
	function activeTextarea() {
		var el = document.activeElement;
		return (el && el.nodeName === 'TEXTAREA' && /^block-input-/.test(el.id || '')) ? el : null;
	}
	// the OPEN colon-template segment -> {partial, start, end} (start = opener ":" index, end = index after
	// partial). A closing ":" on the line => closed => null (resolveTemplate commits it). Caret-independent.
	function openSegment(val, caret) {
		var le = val.indexOf('\n', caret); if (le === -1) le = val.length;
		var head = val.slice(0, caret);
		OPENER_RE.lastIndex = 0;
		var open = -1, mm;
		while ((mm = OPENER_RE.exec(head)) !== null) open = mm.index + mm[0].length - 1;
		if (open === -1) return null;
		var rest = val.slice(open + 1, le);
		if (rest.indexOf(':') !== -1) return null;
		var seg = rest.replace(/\s+$/, '');
		if (seg.length > 80) return null;
		return { partial: seg, start: open, end: open + 1 + seg.length };
	}

	// ============================================================ candidate generation + ranking
	// match rank: 0 exact, 1 prefix, 2 word-boundary, 3 substring, 99 none
	function matchRank(partial, name) {
		var p = ('' + partial).toLowerCase(), n = ('' + name).toLowerCase();
		if (!p) return 1;                                   // bare ":" -> everything is "prefix-ish"
		if (n === p) return 0;
		if (n.indexOf(p) === 0) return 1;
		if (new RegExp('\\b' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(n)) return 2;
		if (n.indexOf(p) > 0) return 3;
		return 99;
	}
	function candidates(partial, now) {
		var namePart = partial.split(';')[0].trim();
		var args = partial.split(';').slice(1).map(function (s) { return s.trim(); });
		var items = [];
		// TEMPLATES
		getIndex(now).forEach(function (t) {
			var r = matchRank(namePart, t.name);
			if (r === 99) return;
			items.push({ kind: 'template', name: t.name, uid: t.uid, cls: t.cls, args: args, label: t.name, detail: capLabel(t.cls) || 'template', score: r });
		});
		// DATE (honest, whole partial incl. " ±N[dwmy]" offsets) -> <=1 row, score 1.5 (under exact/prefix templates)
		var L = lib();
		if (L && namePart) {
			var d = resolveChain(L, partial);
			if (d) {
				var out = ''; try { out = ('' + L.dateFormat(d, fmt())).replace(/^\[\[|\]\]$/g, ''); } catch (e) { out = ''; }
				if (out) items.push({ kind: 'date', query: partial, label: out, detail: 'date', score: 1.5 });
			}
			// KEYWORD SUGGESTIONS (board Q3): named phrases (fullmoon, eom, q1…) are invisible until fully
			// typed because the engine only resolves complete phrases — surface them on prefix. Single
			// bare word only (no spaces/offsets); exact match is already covered by the resolved date row.
			if (/^[a-z0-9]+$/i.test(namePart)) {
				var pn = namePart.toLowerCase();
				DATE_KEYWORDS.forEach(function (kw) {
					if (kw === pn || kw.indexOf(pn) !== 0) return;
					var dk; try { dk = resolveChain(L, kw); } catch (e) { dk = null; }
					if (!dk) return;
					var pv = ''; try { pv = ('' + L.dateFormat(dk, fmt())).replace(/^\[\[|\]\]$/g, ''); } catch (e) {}
					items.push({ kind: 'date-kw', query: kw, name: kw, label: kw, detail: pv || 'date', score: 2.6 });
				});
			}
		}
		// COMMANDS
		var cmds = [
			{ name: '?', detail: 'date cheat-sheet', kind: 'cmd-help' },
			{ name: 'help', detail: 'date cheat-sheet', kind: 'cmd-help' },
			{ name: 'rand', detail: 'random page', kind: 'cmd-rand' },
			{ name: 'random', detail: 'random page', kind: 'cmd-rand' },
		];
		cmds.forEach(function (c) {
			var r = matchRank(namePart, c.name);
			if (r === 99) return;
			items.push({ kind: c.kind, name: c.name, args: args, label: ':' + c.name + ':', detail: c.detail, score: 4 + r });
		});
		// sort: score asc, then kind (template<date<cmd), then label length, then alpha
		var KIND = { template: 0, date: 1, 'date-kw': 1, 'cmd-help': 2, 'cmd-rand': 2 };
		items.sort(function (a, b) {
			return a.score - b.score || (KIND[a.kind] - KIND[b.kind]) || (a.label.length - b.label.length) || (a.label < b.label ? -1 : 1);
		});
		return items.slice(0, MAX_ROWS);
	}

	// ============================================================ DOM
	function ensureMenu() {
		if (menu) return menu;
		menu = document.createElement('div');
		menu.className = 'vt-colonmenu rm-autocomplete__results';
		menu.style.cssText = 'position:fixed;z-index:2147483600;display:none;flex-direction:column;min-width:220px;max-width:60vw;'
			+ 'background:var(--page-color,rgba(28,30,36,.97));color:var(--text-color,#eee);border-radius:8px;'
			+ 'box-shadow:0 6px 26px rgba(0,0,0,.34),inset 0 0 0 .5px rgba(255,255,255,.10);overflow:hidden;'
			+ 'font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:4px;';
		rowsEl = document.createElement('div'); rowsEl.className = 'vt-colonmenu-rows';
		// rows scroll when the menu is height-capped to fit the band above the block / above the command bar
		rowsEl.style.cssText = 'flex:1 1 auto;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;';
		footEl = document.createElement('div'); footEl.className = 'rm-autocomplete-footer';
		footEl.style.cssText = 'flex:0 0 auto;padding:4px 8px 2px;margin-top:3px;border-top:1px solid rgba(127,127,127,.22);'
			+ 'font-size:11px;opacity:.72;display:flex;justify-content:space-between;gap:8px;white-space:nowrap;';
		menu.appendChild(rowsEl); menu.appendChild(footEl);
		// keep textarea focused on press; pick on click (mousedown so it beats blur)
		menu.addEventListener('mousedown', function (e) { e.preventDefault(); });
		menu.addEventListener('touchstart', function (e) { e.preventDefault(); }, { passive: false });
		document.body.appendChild(menu);
		return menu;
	}
	function rowHTML(it, i, active) {
		var d = document.createElement('div');
		d.className = 'vt-colonmenu-row' + (active ? ' vt-active' : '');
		d.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:12px;'
			+ 'padding:5px 9px;border-radius:5px;cursor:pointer;' + (active ? 'background:rgba(127,150,255,.22);' : '');
		var left = document.createElement('span');
		left.textContent = it.label;
		left.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
		var right = document.createElement('span');
		right.textContent = it.detail || '';
		var danger = it.cls && (it.cls.runsJS || it.cls.unknown);
		right.style.cssText = 'opacity:.66;font-size:11px;flex:0 0 auto;' + (danger ? 'color:#ffb454;opacity:.95;' : '');
		d.appendChild(left); d.appendChild(right);
		d.addEventListener('mouseenter', function () { setActive(i); });
		d.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); pick(i); });
		// mobile: the menu's touchstart is preventDefault'd (keeps the textarea focused, kills scroll) which
		// ALSO suppresses the synthetic click — so tap-to-pick must ride touchend directly.
		d.addEventListener('touchend', function (e) { e.preventDefault(); e.stopPropagation(); pick(i); });
		return d;
	}
	// FULL rebuild — only when the item SET changes (showMenu / re-rank). Never on mere hover/arrow:
	// rebuilding the rows under the pointer cancels the press→release click (bug A) and churns the DOM.
	function render() {
		ensureMenu();
		rowsEl.textContent = '';
		cur.items.forEach(function (it, i) { rowsEl.appendChild(rowHTML(it, i, i === cur.active)); });
		paintFooter();
	}
	function paintFooter() {
		var a = cur.items[cur.active];
		var hint = a && a.cls && (a.cls.runsJS || a.cls.unknown) ? ('runs JS — ' + (a.cls.unknown ? 'unknown capabilities' : a.cls.caps.join(', '))) : '↑↓ move · ⏎ insert · esc';
		footEl.innerHTML = '';
		var l = document.createElement('span'); l.textContent = hint; l.style.cssText = 'overflow:hidden;text-overflow:ellipsis;';
		var r = document.createElement('span'); r.textContent = cur.items.length + (cur.items.length === 1 ? ' result' : ' results');
		footEl.appendChild(l); footEl.appendChild(r);
	}
	// repaint active state on the EXISTING row nodes (no rebuild) so a hover/arrow never disturbs a click.
	function paintActive() {
		var kids = rowsEl.children;
		for (var i = 0; i < kids.length; i++) {
			var on = i === cur.active;
			kids[i].classList.toggle('vt-active', on);
			kids[i].style.background = on ? 'rgba(127,150,255,.22)' : '';
			if (on) { try { kids[i].scrollIntoView({ block: 'nearest' }); } catch (e) { } }
		}
		paintFooter();
	}
	function setActive(i) {
		if (!cur || !cur.items.length) return;
		cur.active = (i + cur.items.length) % cur.items.length;
		cur.activeKey = keyOf(cur.items[cur.active]);
		paintActive();
	}
	// top of the highest bottom command bar on screen (our cmdbar EDITING row, else Roam's native
	// mobile bar) — the menu must never overlap it. null when none is shown.
	function commandBarTop() {
		var tops = [];
		var vt = document.getElementById('vt-cmd-root');           // cmdbar's [Select]…[/] editing row
		if (vt) { var b = vt.querySelector('#vt-bar'); if (b) { var br = b.getBoundingClientRect(); if (br.height && br.top > 0) tops.push(br.top); } }
		var nb = document.getElementById('rm-mobile-bar');         // Roam native bar (when cmdbar is off)
		if (nb && nb.offsetParent !== null) { var nr = nb.getBoundingClientRect(); if (nr.height && nr.top > 0) tops.push(nr.top); }
		return tops.length ? Math.min.apply(null, tops) : null;
	}
	function position() {
		if (!cur || !cur.el) return;
		menu.style.maxHeight = '';                                  // measure natural height first
		var r = cur.el.getBoundingClientRect(), mw = menu.offsetWidth, mh = menu.offsetHeight;
		var GAP = 4, M = 6;
		// safe TOP edge: below the topbar so the menu never covers its icons
		var safeTop = M, tb = document.querySelector('.rm-topbar');
		if (tb) { var tr = tb.getBoundingClientRect(); if (tr.height) safeTop = Math.max(safeTop, tr.bottom + 2); }
		// safe BOTTOM edge: above the soft keyboard (visualViewport) AND above any command bar
		var vv = window.visualViewport;
		var safeBot = (vv ? vv.offsetTop + vv.height : window.innerHeight) - M;
		var barTop = commandBarTop();
		if (barTop != null && barTop - 2 < safeBot) safeBot = barTop - 2;
		// pick the side with room; cap the height to the band so it never overlaps the block or the bar
		var roomBelow = safeBot - (r.bottom + GAP);
		var roomAbove = (r.top - GAP) - safeTop;
		var below = (mh <= roomBelow) || (mh > roomAbove && roomBelow >= roomAbove);
		var maxH = Math.max(80, below ? roomBelow : roomAbove);
		if (mh > maxH) menu.style.maxHeight = maxH + 'px';
		var used = Math.min(mh, maxH);
		var top = below ? (r.bottom + GAP) : ((r.top - GAP) - used);
		top = Math.max(safeTop, Math.min(top, safeBot - used));
		var left = r.left;
		if (left + mw > window.innerWidth - M) left = window.innerWidth - mw - M;
		menu.style.top = top + 'px';
		menu.style.left = Math.max(M, left) + 'px';
	}
	function showMenu() { ensureMenu(); menu.style.display = 'flex'; render(); position(); }
	function hide() {
		cur = null;
		if (menu) menu.style.display = 'none';
	}
	function isOpen() { return !!(cur && menu && menu.style.display !== 'none'); }

	// ============================================================ update loop
	function update() {
		raf = 0;
		if (committing || !enabled()) return;
		var el = activeTextarea(); if (!el) return hide();
		var seg = openSegment(el.value, el.selectionEnd); if (!seg) return hide();
		// Unchanged partial (arrow keyup, selectionchange, scroll re-fire): keep the current selection,
		// just reposition. Re-ranking here is what made arrow-nav snap back to row 0 (bug B).
		if (cur && cur.el === el && cur.partial === seg.partial && cur.start === seg.start) {
			if (isOpen()) position();
			return;
		}
		var items = candidates(seg.partial, Date.now());
		if (!items.length) return hide();
		var prevActive = cur && cur.activeKey;
		cur = { el: el, start: seg.start, end: seg.end, partial: seg.partial, items: items, active: 0 };
		// keep the highlighted item stable across keystrokes if it still exists
		if (prevActive) { var k = items.findIndex(function (it) { return keyOf(it) === prevActive; }); if (k >= 0) cur.active = k; }
		cur.activeKey = keyOf(items[cur.active]);
		showMenu();
	}
	function schedule() { if (!raf) raf = requestAnimationFrame(update); }
	function onScrollResize() { if (isOpen()) { position(); } }

	// ============================================================ keyboard (capture phase, before CM6)
	function onKeydown(e) {
		if (!isOpen()) return;
		var k = e.key;
		if (k === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); setActive(cur.active + 1); return; }
		if (k === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); setActive(cur.active - 1); return; }
		if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); hide(); return; }
		if (k === 'Enter' || k === 'Tab') { e.preventDefault(); e.stopPropagation(); pick(cur.active); return; }
		// Closing ":" behavior is a SETTING (ViktorRoamOpts.colonCommitOnClose):
		//   'partial' (DEFAULT) — commit the top/selected row even on a weak prefix (":s:" -> "src"). One
		//                         ":" to take the top match is less work than arrow/tap.
		//   'exact'             — commit ONLY when the typed partial is a full/exact match (or a date that
		//                         resolved the whole partial); otherwise ":" types literally (":s:" stays).
		// Enter/Tab/click always commit the highlighted row regardless of this setting.
		if (k === ':') {
			var a = cur.items[cur.active];
			var exactOnly = (opts().colonCommitOnClose === 'exact');
			if (a && (!exactOnly || isExactCommit(a, cur.partial))) { e.preventDefault(); e.stopPropagation(); pick(cur.active); }
			else hide();   // exact-mode weak match: do NOT preventDefault -> ":" types literally + menu closes
			return;
		}
		// any other key: let it type; the input event re-ranks
	}
	// in 'exact' mode: did the typed partial fully/exactly resolve to this row?
	function isExactCommit(it, partial) {
		if (it.kind === 'date') return true;        // resolved-date row = the WHOLE partial parsed
		if (it.kind === 'date-kw') return false;    // a mere prefix keyword suggestion
		var name = partial.split(';')[0].trim().toLowerCase();
		return ('' + (it.name || '')).toLowerCase() === name;
	}

	// ============================================================ commit (PATH A / PATH B), eval-safe
	function setter() {
		return (window.ViktorInputLib && window.ViktorInputLib.nativeSetter)
			|| Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
	}
	function fireInput(el) { el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText' })); }
	// REVALIDATE-before-commit: the captured span must still be an OPEN segment with the same partial,
	// else the doc mutated under us (remount/edit) -> abort rather than overwrite the wrong text.
	function revalidate(snap) {
		var el = activeTextarea();
		if (!el || el !== snap.el) return null;
		var seg = openSegment(el.value, el.selectionEnd);
		if (!seg || seg.start !== snap.start || seg.partial !== snap.partial) return null;
		seg.el = el;                                         // carry the live textarea to commit paths (insertOneLine/PATH B read seg.el)
		return seg;
	}
	// PATH A: overwrite [start,end) with a one-line string; caretOffset = caret within the inserted text
	function insertOneLine(el, start, end, text, caretOffset) {
		var v = el.value, nv = v.slice(0, start) + text + v.slice(end);
		var pos = start + (caretOffset == null ? text.length : caretOffset);
		setter().call(el, nv);
		el.selectionStart = el.selectionEnd = pos;
		fireInput(el);
	}
	// process a one-liner payload like resolveTemplate (strip bullet, heading, $cursor, trailing space)
	function oneLinerText(plain, onelinerSpace) {
		var s = ('' + plain).trim().replace(/^\s*- /i, '');
		var heading = 0, m = s.match(/^(#+) /);
		if (m) { heading = m[1].length; s = s.replace(/^#+ /, ''); }
		var pos = null;
		s = s.replace(/\$cursor/gi, function (_m, _p, _all) { pos = _all.slice(0, _p).replace(/\$cursor/gi, '').length; return ''; });
		if (onelinerSpace && pos == null && !/\s$/.test(s) && s) s += ' ';
		return { text: s, caret: pos, heading: heading };
	}

	async function pick(i) {
		if (!cur || !cur.items[i]) return;
		var it = cur.items[i];
		var snap = { el: cur.el, start: cur.start, end: cur.end, partial: cur.partial };
		// TEAR DOWN the menu + refocus BEFORE any resolve/eval (board: avoid orphan DOM + preserve activation)
		committing = true;
		hide();
		try { snap.el.focus(); } catch (e) {}
		try {
			if (it.kind === 'date' || it.kind === 'date-kw') {
				var seg = revalidate(snap); if (!seg) return;
				// resolve through the SAME engine as the preview (offset-aware) so commit == preview;
				// insert the Roam date-page link format regardless of the display format shown in the row.
				var L = lib(), dd = L ? resolveChain(L, it.query) : null;
				var out = (L && dd) ? L.dateFormat(dd, '[[Month Dth, YYYY]]') : null;
				if (out) insertOneLine(seg.el, seg.start, seg.end, out + (opts().onelinerExtraSpace !== false ? ' ' : ''));
				return;
			}
			if (it.kind === 'cmd-help') {
				var seg2 = revalidate(snap); if (!seg2) return;
				insertOneLine(seg2.el, seg2.start, seg2.end, window.ViktorDateCheatsheet + (opts().onelinerExtraSpace !== false ? ' ' : ''));
				return;
			}
			if (it.kind === 'cmd-rand') {
				var seg3 = revalidate(snap); if (!seg3) return;
				var rnd = window.ViktorRoamLib.getRandomNode((it.args && it.args[0]) || '');
				if (rnd) insertOneLine(seg3.el, seg3.start, seg3.end, rnd + (opts().onelinerExtraSpace !== false ? ' ' : ''));
				return;
			}
			if (it.kind === 'template') {
				await commitTemplate(it, snap);
				return;
			}
		} finally {
			committing = false;
		}
	}

	// PURE-PASTE template (body is exactly "$clipboard", e.g. :p:): paste the REAL system clipboard
	// natively — content-agnostic (text, images, rich text) via Roam's own paste handler, which uploads
	// images itself (verified: synthetic ClipboardEvent w/ DataTransfer.files -> firebase upload). We don't
	// inspect or branch on content type; Roam does. Falls back to text-only readText if read() is blocked.
	async function pasteRealClipboard(el) {
		var dt = new DataTransfer(), text = '';
		try {
			var items = await navigator.clipboard.read();
			for (var i = 0; i < items.length; i++) {
				var types = items[i].types || [];
				for (var j = 0; j < types.length; j++) {
					var ty = types[j], blob = await items[i].getType(ty);
					if (/^image\//i.test(ty)) { try { dt.items.add(new File([blob], 'paste.' + ((ty.split('/')[1] || 'png').replace('jpeg', 'jpg')), { type: ty })); } catch (e) {} }
					else if (ty === 'text/plain') text = await blob.text();
					else if (ty === 'text/html') { try { dt.setData('text/html', await blob.text()); } catch (e) {} }
				}
			}
		} catch (e) { try { text = await navigator.clipboard.readText(); } catch (e2) {} }
		if (text) try { dt.setData('text/plain', text); } catch (e) {}
		var ev; try { ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }); }
		catch (e) { ev = new CustomEvent('paste', { bubbles: true, cancelable: true }); try { Object.defineProperty(ev, 'clipboardData', { value: dt }); } catch (e2) { ev.clipboardData = dt; } }
		el.dispatchEvent(ev);
	}

	async function commitTemplate(it, snap) {
		// NO trust-confirm (owner decision 2026-06-14): the user authors their own js templates and the row
		// already shows the JS capability badge (⚡ network/clipboard/…), so a modal is pure friction.
		var entry = (idxCache || []).find(function (t) { return t.uid === it.uid; }) || {};
		if (/^\$clipboard$/i.test(('' + (entry.body || '')).trim())) {
			// pure-paste template: blank the :partial, then native-paste the real clipboard (see above)
			var segp = revalidate(snap); if (!segp) return;
			var elp = segp.el, vp = elp.value;
			setter().call(elp, vp.slice(0, segp.start) + vp.slice(segp.end));
			elp.selectionStart = elp.selectionEnd = segp.start; fireInput(elp);
			await pasteRealClipboard(elp);
			return;
		}
		var id = window.ViktorRoamLib.findPageId(it.name, searchPages());
		if (!id) return;
		var tmp;
		try { tmp = await window.ViktorRoamLib.getClipboardFormat(id, it.args || []); } catch (e) { return; }
		if (!tmp) return;
		var seg = revalidate(snap); if (!seg) return;        // doc may have changed during async resolve/eval
		var el = seg.el, plain = tmp['text/plain'] || '';
		var oneLiner = ((/(<li)[\s>]/ig.exec(tmp['text/html'] || '') || []).length === 1) || !/\n/.test(plain.trim());
		if (oneLiner) {
			var ol = oneLinerText(plain, opts().onelinerExtraSpace !== false);
			if (ol.heading && window.ViktorInputLib && window.ViktorInputLib.changeHeading) {
				try { await window.ViktorInputLib.changeHeading(0); await window.ViktorInputLib.changeHeading(ol.heading); el = document.activeElement; } catch (e) {}
				var rseg = revalidate({ el: el, start: snap.start, partial: snap.partial }); if (!rseg) return; seg = rseg;
			}
			insertOneLine(el, seg.start, seg.end, ol.text, ol.caret);
			return;
		}
		// PATH B (multiline): blank the :partial span, then synthetic-paste the roam/data tree
		var v = el.value, nv = v.slice(0, seg.start) + v.slice(seg.end);
		setter().call(el, nv);
		el.selectionStart = el.selectionEnd = seg.start;
		fireInput(el);
		['text/html', 'text/plain', 'roam/data'].forEach(function (k) { if (tmp[k]) tmp[k] = tmp[k].replace(/\$cursor/gi, ''); });
		var ev = new CustomEvent('paste', { cancelable: true, bubbles: true });
		ev.clipboardData = { files: { length: 0 }, getData: function (type) { return tmp[type] || ''; } };
		document.activeElement.dispatchEvent(ev);
		// $cursor jump (mirror resolveTemplate)
		if (tmp.cursor && tmp.cursor.line != null && tmp.cursor.position != null) {
			setTimeout(function () {
				var inps = Array.from(document.querySelectorAll("[id^='block-input-']"));
				inps = inps.slice(inps.findIndex(function (x) { return x === document.activeElement; }));
				var target = inps[tmp.cursor.line - 1]; if (!target) return;
				if (window.ViktorInputLib && window.ViktorInputLib.leftClick) window.ViktorInputLib.leftClick(target); else target.click();
				setTimeout(function () { if (document.activeElement) { document.activeElement.selectionStart = document.activeElement.selectionEnd = tmp.cursor.position; } }, 100);
			}, 100);
		}
	}

	// ============================================================ lifecycle
	function start() {
		if (started) return window.ViktorColonmenu;
		started = true;
		// FOLD datepreview in: this module owns the open-colon surface (datepreview's date becomes a row)
		if (window.ViktorDatepreview && typeof window.ViktorDatepreview.stop === 'function' && window.ViktorDatepreview.isStarted && window.ViktorDatepreview.isStarted()) window.ViktorDatepreview.stop();
		ac = new AbortController(); var sig = { signal: ac.signal };
		document.addEventListener('input', schedule, sig);
		document.addEventListener('keyup', schedule, sig);
		document.addEventListener('click', schedule, sig);
		document.addEventListener('selectionchange', schedule, sig);
		document.addEventListener('keydown', onKeydown, { capture: true, signal: ac.signal });
		document.addEventListener('blur', function () { if (!committing) hide(); }, { capture: true, signal: ac.signal });
		window.addEventListener('scroll', onScrollResize, { capture: true, passive: true, signal: ac.signal });
		window.addEventListener('resize', onScrollResize, sig);
		return window.ViktorColonmenu;
	}
	function stop() {
		started = false;
		if (ac) { ac.abort(); ac = null; }
		if (raf) { cancelAnimationFrame(raf); raf = 0; }
		if (menu) { menu.remove(); menu = null; rowsEl = null; footEl = null; }
		cur = null; libCache = null; libKey = ''; idxCache = null; committing = false;
	}
	function isStarted() { return started; }

	if (enabled()) start();
	return {
		start: start, stop: stop, isStarted: isStarted, update: update, invalidateIndex: invalidateIndex,
		// exposed for tests
		_classifyBody: classifyBody, _capLabel: capLabel, _matchRank: matchRank, _buildIndex: buildIndex,
		_candidates: candidates, _openSegment: openSegment, _oneLinerText: oneLinerText, _getIndex: getIndex,
		_resolveChain: resolveChain, _isExactCommit: isExactCommit, _lib: lib,
	};
})();
