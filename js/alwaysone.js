/*
 * Viktor's Roam plugin: AlwaysOne — always a free node at the top and bottom of the page.
 * version: 0.2  (2026-07-02)  — desktop fixes: dont-unfocus-block (Roam's global mousedown
 * unfocuses clicks outside blocks — the class opts out, same one the virtual placeholder uses);
 * ArrowUp on the first root block / ArrowDown on the last visible block enters the free node
 * (keyboard parity: the phantom behaves like a real line); hidden-textarea hop = touch only.
 *
 * PAIN: adding a line at the very top (or bottom) of a page = tap the first block, drag the caret
 * to position 0, hit Enter, cursor gymnastics. On mobile it's worse.
 * FIX: render a phantom "free node" row above the first and below the last top-level block of every
 * page outline (single page, each DNP-log day, zoomed block). One tap on it creates an empty block
 * there (order 0 / last) and focuses it — keyboard up, caret ready. If the edge block is ALREADY
 * empty, the phantom hides (the empty block itself is the free node) and tapping just focuses it.
 * Phantoms are virtual: nothing is written to the graph until you tap, so no empty-block litter.
 *
 * Mechanics (see CLAUDE.md cheat-sheet):
 *  - outlines = .roam-article .rm-block-children.rm-level-0, excluding reference/embed renders.
 *  - parent uid for create = reverse pull [:block/_children] of the edge block (works for pages,
 *    log days AND zoomed blocks — data-page-title would be wrong when zoomed).
 *  - window-id: log day = 'log-outline'; else userUid+'-body-outline-'+getOpenPageOrBlockUid().
 *  - iOS keyboard: focus a hidden textarea INSIDE the tap gesture, then textarea→textarea handoff
 *    to the real block input keeps the keyboard (async programmatic focus alone would not open it).
 *  - Gate focus success on document.activeElement.id.endsWith(uid), NOT getFocusedBlock().
 *  - MutationObserver + rAF-debounced idempotent ensure() re-injects after React re-renders.
 * Loader: registered as `alwaysone` in alphaChannel → global ViktorAlwaysone {start,stop}.
 */
if (window.ViktorAlwaysone && window.ViktorAlwaysone.stop) window.ViktorAlwaysone.stop();
window.ViktorAlwaysone = (function () {
	var ROW = 'vt-a1-row', TOP = 'vt-a1-top', BOT = 'vt-a1-bot';
	var started = false, observer = null, raf = 0, late = 0, busy = false;
	var pending = null;   // {uid, focused} — block WE created; deleted again if abandoned empty
	var api = window.roamAlphaAPI;
	var css = document.createElement('style');
	css.id = 'CSSViktorAlwaysone';
	css.innerHTML = [
		'.' + ROW + '{display:flex;align-items:center;height:26px;cursor:text;position:relative;',
		'  touch-action:manipulation;-webkit-tap-highlight-color:transparent;user-select:none;-webkit-user-select:none;}',
		'.' + ROW + ' .vt-a1-dot{width:8px;height:8px;margin-left:23px;border-radius:50%;flex:0 0 auto;',
		'  border:1.5px dashed currentColor;opacity:.28;}',
		'.' + ROW + ' .vt-a1-hint{margin-left:9px;font-size:12px;opacity:0;transition:opacity .15s;}',
		'@media(hover:hover){.' + ROW + ':hover .vt-a1-dot{opacity:.6}.' + ROW + ':hover .vt-a1-hint{opacity:.45}}',
		'.' + ROW + ':active .vt-a1-dot{opacity:.75}',
		'.' + ROW + ' .vt-a1-ta{position:absolute;left:0;top:0;width:1px;height:1px;opacity:.01;',
		'  border:0;padding:0;resize:none;caret-color:transparent;background:transparent;}'
	].join('\n');

	function outlines() {
		// ROOT level only: page outlines (rm-level-0) — nested blocks never get phantoms.
		var out = Array.from(document.querySelectorAll('.roam-article .rm-block-children.rm-level-0'));
		if (!out.length) {
			// zoomed-block view has no rm-level-0; the VISIBLE root there = the zoomed block's children
			var blk = document.querySelector('.roam-article .rm-zoom ~ div > .roam-block-container');
			var kids = blk && blk.querySelector(':scope > .rm-block-children');
			if (kids) out.push(kids);
		}
		return out.filter(function (o) {
			return !o.closest('.rm-reference-main,.rm-reference-container,.rm-embed-container,#right-sidebar');
		});
	}
	function blocksOf(o) {
		return Array.from(o.children).filter(function (c) { return c.classList.contains('roam-block-container'); });
	}
	function parentUidOf(uid) {
		try {
			var r = api.pull('[{:block/_children [:block/uid]}]', [':block/uid', uid]);
			return r && r[':block/_children'] && r[':block/_children'][0] && r[':block/_children'][0][':block/uid'] || null;
		} catch (e) { return null; }
	}
	function pageUidOf(uid) {   // window-id wants the PAGE uid even in zoomed-block view
		try {
			var r = api.pull('[{:block/page [:block/uid]}]', [':block/uid', uid]);
			return r && r[':block/page'] && r[':block/page'][':block/uid'] || null;
		} catch (e) { return null; }
	}
	function hasKids(container) {
		return !!container.querySelector(':scope > .rm-block-children > .roam-block-container');
	}
	// DOM-based emptiness: live textarea value while editing, rendered span otherwise.
	// (Datascript pull LAGS the render — an ensure() fired by the commit-render mutation still
	// pulls the OLD string, and no later mutation comes → stale phantom. DOM never lags.)
	function isEmptyBlock(container) {
		// virtual placeholder (fresh empty day/page): data-block-uid=null, shows "Click here to
		// start writing" ghost text — it IS the free node, so: empty
		if (!container.getAttribute('data-block-uid')) return true;
		var main = container.querySelector(':scope > .rm-block-main');
		if (!main) return false;
		var ta = main.querySelector('textarea');
		if (ta) return ta.value === '';
		var inp = main.querySelector('.rm-block__input');
		if (!inp) return false;
		// view-mode empty block renders "<span></span>" → element count lies; probe for real content
		return inp.textContent.trim() === ''
			&& !inp.querySelector('img,iframe,video,audio,canvas,svg,input,button,embed,object');
	}

	function makeRow(kind) {
		var row = document.createElement('div');
		// dont-unfocus-block: Roam's document-level mousedown blurs the editor on any click
		// OUTSIDE a block unless the target chain carries this class → without it the block we
		// just focused loses focus the moment the click lands (desktop "requires multiple tries")
		row.className = ROW + ' ' + kind + ' dont-unfocus-block';
		var ta = document.createElement('textarea');       // focused in-gesture → iOS keyboard opens,
		ta.className = 'vt-a1-ta';                          // then textarea→textarea handoff keeps it
		ta.tabIndex = -1; ta.setAttribute('aria-hidden', 'true');
		var dot = document.createElement('div'); dot.className = 'vt-a1-dot';
		var hint = document.createElement('span'); hint.className = 'vt-a1-hint';
		hint.textContent = kind === TOP ? 'new line at top' : 'new line at bottom';
		row.appendChild(ta); row.appendChild(dot); row.appendChild(hint);
		row.addEventListener('mousedown', function (e) { e.preventDefault(); e.stopPropagation(); });
		row.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); });
		row.addEventListener('pointerdown', function (e) {
			e.preventDefault(); e.stopPropagation();
			// touch only: the in-gesture hop that opens the iOS keyboard; on desktop it just
			// steals focus for a beat and adds churn
			if ((navigator.maxTouchPoints || 0) > 0 && e.pointerType !== 'mouse') {
				try { ta.focus({ preventScroll: true }); } catch (err) { }
			}
			add(row, kind === TOP);
		});
		return row;
	}
	function rowFor(host, outline, kind) {
		var row = null;
		for (var el = host.firstElementChild; el; el = el.nextElementSibling)
			if (el.classList && el.classList.contains(kind)) { row = el; break; }
		if (!row) row = makeRow(kind);
		var want = kind === TOP ? outline : outline.nextElementSibling;   // before outline / right after it
		if (kind === TOP ? row.nextElementSibling !== outline : outline.nextElementSibling !== row)
			host.insertBefore(row, want);
		return row;
	}

	// A tap that never got typed into must not litter the graph: once OUR block was focused and
	// then left while still empty, delete it — the page returns to exactly its pre-tap state.
	function reap() {
		if (!pending || !pending.focused) return;
		var uid = pending.uid;
		var ae = document.activeElement;
		if (ae && ae.id && ae.id.slice(-uid.length) === uid) return;   // still editing it
		pending = null;
		try {
			// DOM first — pull LAGS a fresh blur-commit and would delete a block the user just typed into
			var el = document.querySelector('.roam-block-container[data-block-uid="' + uid + '"]');
			if (el) {
				if (isEmptyBlock(el) && !hasKids(el)) api.deleteBlock({ block: { uid: uid } });
			} else {
				var r = api.pull('[:block/string :block/children]', [':block/uid', uid]);
				if (r && (r[':block/string'] || '') === '' && !r[':block/children'])
					api.deleteBlock({ block: { uid: uid } });
			}
		} catch (e) { }
	}
	function ensure() {
		if (!started) return;
		reap();
		outlines().forEach(function (o) {
			var host = o.parentElement; if (!host) return;
			var blocks = blocksOf(o);
			var top = rowFor(host, o, TOP), bot = rowFor(host, o, BOT);
			if (!blocks.length) {                              // empty page: Roam's own virtual
				top.style.display = 'none';                    // empty block is the free node
				bot.style.display = 'none';
				return;
			}
			var last = blocks[blocks.length - 1];
			var topShow = !isEmptyBlock(blocks[0]);
			var botShow = !isEmptyBlock(last) || hasKids(last);
			var topDisp = topShow ? '' : 'none', botDisp = botShow ? '' : 'none';
			if (top.style.display !== topDisp) top.style.display = topDisp;
			if (bot.style.display !== botDisp) bot.style.display = botDisp;
			// align our dot's center with the outline's real bullets — MEASURED, not assumed: themes
			// pad the host and Roam pulls the outline back out with negative margins (can go negative)
			var bullet = blocks[0].querySelector('.rm-bullet');
			if (bullet) {
				var bx = bullet.getBoundingClientRect();
				[top, bot].forEach(function (row) {
					if (row.style.display === 'none' || !bx.width) return;
					var d = row.querySelector('.vt-a1-dot');
					var want = Math.round(bx.left + bx.width / 2 - 4 - row.getBoundingClientRect().left) + 'px';
					if (d && d.style.marginLeft !== want) d.style.marginLeft = want;
				});
			}
		});
		// orphan rows (their outline re-rendered away)
		Array.from(document.querySelectorAll('.' + ROW)).forEach(function (row) {
			var sib = row.classList.contains(TOP) ? row.nextElementSibling : row.previousElementSibling;
			if (!sib || !sib.classList || !sib.classList.contains('rm-block-children')) row.remove();
		});
	}
	function schedule() {
		if (!raf) raf = requestAnimationFrame(function () { raf = 0; ensure(); });
		if (late) clearTimeout(late);                       // late pass: catch post-commit state
		late = setTimeout(function () { late = 0; ensure(); }, 600);
	}

	function focusBlock(uid, winId) {
		var tries = 0;
		function attempt() {
			api.ui.setBlockFocusAndSelection({ location: { 'block-uid': uid, 'window-id': winId } });
		}
		function loop() {
			var ae = document.activeElement;
			if (ae && ae.id && ae.id.slice(-uid.length) === uid) {         // success gate: activeElement, not getFocusedBlock
				if (pending && pending.uid === uid) pending.focused = true;
				return;
			}
			if (++tries > 25) {                                            // focus never landed:
				if (pending && pending.uid === uid) pending.focused = true; // let reap() collect the stray
				schedule();
				return;
			}
			attempt();                                                     // idempotent — hammer until it lands
			setTimeout(loop, 80);
		}
		attempt();
		setTimeout(loop, 60);
	}
	function add(row, isTop) {
		if (busy) return; busy = true;
		setTimeout(function () { busy = false; }, 600);
		(async function () {
			var o = row.classList.contains(TOP) ? row.nextElementSibling : row.previousElementSibling;
			if (!o) return;
			var blocks = blocksOf(o);
			if (!blocks.length) return;
			var edge = isTop ? blocks[0] : blocks[blocks.length - 1];
			var edgeUid = edge.getAttribute('data-block-uid');
			if (!edgeUid) return;   // virtual placeholder — tap IT, not us
			var winId = o.closest('.roam-log-page')
				? 'log-outline'
				: api.user.uid() + '-body-outline-' + pageUidOf(edgeUid);
			if (isEmptyBlock(edge) && (isTop || !hasKids(edge))) { focusBlock(edgeUid, winId); return; }
			var parent = parentUidOf(edgeUid);
			if (!parent) return;
			var uid = api.util.generateUID();
			await api.createBlock({ location: { 'parent-uid': parent, order: isTop ? 0 : 'last' }, block: { string: '', uid: uid } });
			pending = { uid: uid, focused: false };
			focusBlock(uid, winId);
		})().catch(function (e) { console.warn('alwaysone add failed', e); });
	}

	// Keyboard parity: the free node must be reachable like a real line. ArrowUp with the caret
	// at 0 in the FIRST root block → top free node; ArrowDown with the caret at the end of the
	// LAST VISIBLE block (deepest expanded descendant of the last root block) → bottom free node.
	// Only when that phantom is shown (edge non-empty) — otherwise native behavior stands.
	function lastVisible(container) {
		var kid = container.querySelector(':scope > .rm-block-children > .roam-block-container:last-of-type');
		return kid ? lastVisible(kid) : container;
	}
	function onKey(e) {
		if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
		if (e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
		var ta = e.target;
		if (!ta || ta.tagName !== 'TEXTAREA' || ta.id.indexOf('block-input') !== 0) return;
		if (ta.selectionStart !== ta.selectionEnd) return;
		var isTop = e.key === 'ArrowUp';
		if (isTop ? ta.selectionStart !== 0 : ta.selectionEnd !== ta.value.length) return;
		var cont = ta.closest('.roam-block-container');
		if (!cont) return;
		// climb to the root container whose parent is a phantom-flanked outline
		var node = cont, outline = null, rootCont = null;
		while (node) {
			var p = node.parentElement;
			if (p && p.classList.contains('rm-block-children')) {
				var sib = isTop ? p.previousElementSibling : p.nextElementSibling;
				if (sib && sib.classList && sib.classList.contains(ROW)) { outline = p; rootCont = node; break; }
			}
			node = p ? p.closest('.roam-block-container') : null;
		}
		if (!outline) return;
		var blocks = blocksOf(outline);
		if (!blocks.length) return;
		if (isTop ? cont !== blocks[0] : cont !== lastVisible(blocks[blocks.length - 1])) return;
		var row = isTop ? outline.previousElementSibling : outline.nextElementSibling;
		if (!row || row.style.display === 'none') return;   // edge already empty → native handles it
		e.preventDefault(); e.stopPropagation();
		add(row, isTop);
	}
	function start() {
		if (started) return; started = true;
		document.head.appendChild(css);
		ensure();
		observer = new MutationObserver(function (muts) {
			for (var i = 0; i < muts.length; i++) {
				var t = muts[i].target;
				if (t && t.closest && t.closest('.' + ROW)) continue;   // ignore our own rows
				schedule(); return;
			}
		});
		observer.observe(document.body, { childList: true, subtree: true });
		document.addEventListener('focusout', schedule, true);   // blur alone mutates nothing → reap needs this
		document.addEventListener('keydown', onKey, true);       // capture: beat Roam's own arrow handling
		return true;
	}
	function stop() {
		if (!started) return; started = false;
		if (observer) { observer.disconnect(); observer = null; }
		document.removeEventListener('focusout', schedule, true);
		document.removeEventListener('keydown', onKey, true);
		if (raf) { cancelAnimationFrame(raf); raf = 0; }
		if (late) { clearTimeout(late); late = 0; }
		Array.from(document.querySelectorAll('.' + ROW)).forEach(function (el) { el.remove(); });
		if (css.parentNode) css.parentNode.removeChild(css);
		return true;
	}

	start();
	return { start: start, stop: stop, _state: function () { return { started: started, busy: busy, pending: pending }; } };
})();
