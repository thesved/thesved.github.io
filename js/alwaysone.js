/*
 * Viktor's Roam plugin: AlwaysOne — always a free node at the top and bottom of the page.
 * version: 0.4  (2026-07-02)  — ZERO-CLS entry. v0.3 held the row IN FLOW until pointerup →
 * for ~100-300ms both the row and the new block occupied space (+56px push, then pop). Now the
 * row LIFTS out of flow (position:absolute + opacity:0) in the same pre-paint ensure() that sees
 * the new block — never painted double, but still in the DOM under the pointer so the in-flight
 * click keeps landing on dont-unfocus-block (no blur retarget). And the row's height is MEASURED
 * per outline so row↔block swap (add AND reap) is layout-neutral: h = blockFootprint + outlineGap
 * − hostGap (the fixed 26px was 4px short of a real block → residual nudge on every entry).
 *
 * v0.3: Roam unfocuses on document CLICK when the target chain lacks dont-unfocus-block (compiled
 * route-app.js $APP.JNb) → row carries the class + capture-phase click shield swallows structural
 * clicks for 600ms after an add. Arrows mirror Roam's own semantics (caret-mirror pixel-top:
 * first/last VISUAL line, wrapped lines count): Up on first root block / Down on last visible
 * block enters the free node. Hidden-textarea hop = touch only.
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
	var pending = null;      // {uid, focused} — block WE created; deleted again if abandoned empty
	var shieldUntil = 0;     // swallow structural clicks right after an add (see clickShield)
	var noReapUntil = 0;     // never reap mid-click: the layout shift retargets the in-flight click
	var hotUntil = 0;        // add/reap in flight: ensure() must run SYNC in the observer microtask
	// (pre-paint even when React commits inside a rAF phase — a rAF-scheduled ensure() lands one
	// frame LATE there and the row+block double-height state gets painted; measured 1-2 frames)
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
		'  border:0;padding:0;resize:none;caret-color:transparent;background:transparent;}',
		// lifted = out of flow the moment the real block renders (zero-CLS swap) but still in the
		// DOM at its static position, invisible yet hit-testable: the in-flight click lands HERE
		// (dont-unfocus-block chain intact) instead of retargeting to a structural div
		'.' + ROW + '.vt-a1-lift{position:absolute;opacity:0;z-index:1;}'
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
			// the add re-renders + HIDES this row mid-gesture → mouseup retargets → the click
			// lands on a class-less ancestor → Roam's document click handler unfocuses what we
			// just focused. Hold the row visible until the gesture ends + shield the click.
			row._gesture = true;
			shieldUntil = performance.now() + 600;
			// touch only: the in-gesture hop that opens the iOS keyboard; on desktop it just
			// steals focus for a beat and adds churn
			if ((navigator.maxTouchPoints || 0) > 0 && e.pointerType !== 'mouse') {
				try { ta.focus({ preventScroll: true }); } catch (err) { }
			}
			add(row, kind === TOP);
		});
		['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) {
			row.addEventListener(ev, function () {
				if (!row._gesture) return;
				setTimeout(function () { row._gesture = false; schedule(); }, 0);   // after the click dispatch
			});
		});
		return row;
	}
	// Roam registers its unfocus handler on document CLICK (bubble; route-app.js $APP.JNb):
	// editing + target chain without dont-unfocus-block → blur. A click retargeted off our row
	// (layout changed mid-gesture) hits structural divs and triggers it — swallow exactly those.
	function clickShield(e) {
		if (performance.now() > shieldUntil) return;
		if (e.target && e.target.closest && e.target.closest('.roam-block-container,.rm-title-display,.' + ROW)) return;
		e.stopPropagation();
	}
	// Row height that makes phantom↔block swap layout-NEUTRAL, measured (themes vary):
	// inserting a block into the outline costs singleLineBlockHeight + outline row-gap; removing
	// the row from the host frees rowHeight + host row-gap → rowH = single + og − hg.
	// single from the edge block, wrap-proof: mainH minus the extra wrapped lines (lines from
	// inputH/lineH; VERIFIED single mainH == real block pitch, wrapped mainH == single + n·lineH).
	// Falls back to 26px when the measure is implausible.
	function gapOf(el) { var g = parseFloat(getComputedStyle(el).rowGap); return isNaN(g) ? 0 : g; }
	function neutralHeight(outline, host, edge) {
		var main = edge.querySelector(':scope > .rm-block-main');
		var inp = main && main.querySelector('.rm-block__input, textarea');
		if (!main || !inp) return 0;
		var mh = main.getBoundingClientRect().height, ih = inp.getBoundingClientRect().height;
		var lh = parseFloat(getComputedStyle(inp).lineHeight);
		if (!lh || isNaN(lh)) lh = ih;
		var lines = Math.max(1, Math.round(ih / lh));
		var cs = getComputedStyle(edge);
		var h = Math.round(mh - (lines - 1) * lh
			+ (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0)
			+ (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0)
			+ gapOf(outline) - gapOf(host));
		return (h > 8 && h < 120) ? h : 0;
	}
	// Out of flow, same paint as the block render — the pointer may still be down on the row, so
	// it must stay in the DOM (hit-testable, class chain intact), just not occupy height.
	function lift(row) {
		if (row._lifted) return; row._lifted = true;
		row.style.width = row.offsetWidth + 'px';   // abs would shrink-wrap; keep the hit area
		row.classList.add('vt-a1-lift');
	}
	function unlift(row) {
		if (!row._lifted) return; row._lifted = false;
		row.classList.remove('vt-a1-lift');
		row.style.width = '';
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
	// A pointer gesture is in flight anywhere on the page: deleting a block NOW shifts the layout
	// between mousedown and mouseup → the click retargets to a structural div → Roam blurs the
	// freshly clicked block. Defer the reap until the gesture is over.
	function deferReaps() { noReapUntil = performance.now() + 450; }
	function reap() {
		if (!pending || !pending.focused) return;
		if (performance.now() < noReapUntil) { setTimeout(schedule, 500); return; }
		var uid = pending.uid;
		var ae = document.activeElement;
		if (ae && ae.id && ae.id.slice(-uid.length) === uid) return;   // still editing it
		pending = null;
		try {
			// DOM first — pull LAGS a fresh blur-commit and would delete a block the user just typed into
			var el = document.querySelector('.roam-block-container[data-block-uid="' + uid + '"]');
			if (el) {
				if (isEmptyBlock(el) && !hasKids(el)) { hotUntil = performance.now() + 1500; api.deleteBlock({ block: { uid: uid } }); }
			} else {
				var r = api.pull('[:block/string :block/children]', [':block/uid', uid]);
				if (r && (r[':block/string'] || '') === '' && !r[':block/children']) {
					hotUntil = performance.now() + 1500;
					api.deleteBlock({ block: { uid: uid } });
				}
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
			var h = neutralHeight(o, host, blocks[0]);
			[[top, topDisp], [bot, botDisp]].forEach(function (rd) {
				var row = rd[0], disp = rd[1];
				if (row._gesture) {                       // pointer may still be down on the row:
					if (disp === 'none') lift(row);       // leave flow NOW (pre-paint, zero-CLS) but
					return;                               // stay in the DOM under the pointer
				}
				unlift(row);
				if (row.style.display !== disp) row.style.display = disp;
				var hpx = (h || 26) + 'px';
				if (row.style.height !== hpx) row.style.height = hpx;
			});
			// align our dot's center with the outline's real bullets — MEASURED, not assumed: themes
			// pad the host and Roam pulls the outline back out with negative margins (can go negative)
			var bullet = blocks[0].querySelector('.rm-bullet');
			if (bullet) {
				var bx = bullet.getBoundingClientRect();
				[top, bot].forEach(function (row) {
					if (row.style.display === 'none' || row._lifted || !bx.width) return;
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
		hotUntil = performance.now() + 1500;
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

	// Keyboard parity: the free node must be reachable like a real line. Mirrors Roam's OWN
	// arrow semantics (route-app.js textarea "up"/"down" handlers): leave the block upward when
	// the caret sits on the FIRST VISUAL LINE (caret pixel-top == pos-0 top), downward when on
	// the LAST VISUAL LINE (== value-end top) — NOT selectionStart 0/end, wrapped lines count.
	// Then: first root block + Up → top free node; last visible block + Down → bottom free node.
	function lastVisible(container) {
		var kid = container.querySelector(':scope > .rm-block-children > .roam-block-container:last-of-type');
		return kid ? lastVisible(kid) : container;
	}
	var MIRROR_PROPS = ['boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
		'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
		'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontSize', 'fontFamily', 'lineHeight',
		'letterSpacing', 'wordSpacing', 'textIndent', 'textTransform', 'tabSize'];
	function caretTop(ta, pos) {   // caret-coordinates mirror, top only (same trick as Roam's cS)
		var d = document.createElement('div'), s = getComputedStyle(ta);
		for (var i = 0; i < MIRROR_PROPS.length; i++) d.style[MIRROR_PROPS[i]] = s[MIRROR_PROPS[i]];
		d.style.position = 'absolute'; d.style.visibility = 'hidden'; d.style.top = '0'; d.style.left = '-9999px';
		d.style.whiteSpace = 'pre-wrap'; d.style.wordWrap = 'break-word';
		d.textContent = ta.value.substring(0, pos);
		var sp = document.createElement('span');
		sp.textContent = ta.value.substring(pos) || '.';
		d.appendChild(sp);
		document.body.appendChild(d);
		var top = sp.offsetTop;
		d.remove();
		return top;
	}
	function onKey(e) {
		if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
		if (e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
		var ta = e.target;
		if (!ta || ta.tagName !== 'TEXTAREA' || ta.id.indexOf('block-input') !== 0) return;
		var isTop = e.key === 'ArrowUp';
		var edgeTop = caretTop(ta, isTop ? 0 : ta.value.length);
		if (caretTop(ta, ta.selectionEnd) !== edgeTop) return;   // caret not on the edge visual line → native
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
				if (performance.now() < hotUntil) ensure();   // sync = pre-paint: zero-CLS swap
				else schedule();
				return;
			}
		});
		observer.observe(document.body, { childList: true, subtree: true });
		document.addEventListener('focusout', schedule, true);   // blur alone mutates nothing → reap needs this
		document.addEventListener('keydown', onKey, true);       // capture: beat Roam's own arrow handling
		document.addEventListener('click', clickShield, true);   // capture: beat Roam's unfocus click handler
		document.addEventListener('pointerdown', deferReaps, true);
		return true;
	}
	function stop() {
		if (!started) return; started = false;
		if (observer) { observer.disconnect(); observer = null; }
		document.removeEventListener('focusout', schedule, true);
		document.removeEventListener('keydown', onKey, true);
		document.removeEventListener('click', clickShield, true);
		document.removeEventListener('pointerdown', deferReaps, true);
		if (raf) { cancelAnimationFrame(raf); raf = 0; }
		if (late) { clearTimeout(late); late = 0; }
		Array.from(document.querySelectorAll('.' + ROW)).forEach(function (el) { el.remove(); });
		if (css.parentNode) css.parentNode.removeChild(css);
		return true;
	}

	start();
	return { start: start, stop: stop, _state: function () { return { started: started, busy: busy, pending: pending }; } };
})();
