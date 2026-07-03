/*
 * Viktor's Roam plugin: AlwaysOne — always a free node at the top and bottom of the page.
 * version: 0.5.1  (2026-07-03)
 * v0.5.1 — GHOST TAKEOVER (touch only): Roam's empty-page placeholder ("Click here to start
 * writing…", .rm-block--ghost) is a NON-editable focusable DIV; Roam mounts the block textarea
 * ~30ms AFTER the gesture. On the user's real iPhone (PWA) that tap dies (report 2026-07-03:
 * block never focuses); desktop CDP + iOS-sim Safari work, so the failing detail is device-
 * specific — instead of chasing it, touch taps on the ghost now take the SAME proven path as the
 * phantom rows: cancel the pointerdown (no mousedown → Roam's div-focus path never starts),
 * focus the hidden textarea IN-gesture (iOS keyboard opens by construction), create the first
 * block ourselves (parent = log-day title→uid / getOpenPageOrBlockUid), focusBlock textarea→
 * textarea handoff keeps the keyboard, clickShield swallows the retargeted click, and the
 * abandoned-empty reap applies as usual. Desktop/mouse keeps Roam's native path.
 * version: 0.5.0  (2026-07-02)
 * v0.5 — (1) phantoms ALWAYS VISIBLE on a non-empty outline (no hide-when-edge-empty logic;
 * hidden only on a completely empty page = no uid-bearing root block, just Roam's ghost
 * placeholder). Tapping / arrowing into the phantom while the edge block is already empty still
 * focuses that block (idempotent, no duplicate empties). (2) Arrows COOPERATE with typeahead
 * menus: Roam's own up/down keymap lives ON the textarea (target phase, last in line) and gets
 * swapped out via React state while its autocomplete is open; plugins like colonmenu win by
 * claiming the key at document-capture. We mirror that: listen capture on #app (any document-
 * level menu plugin preempts us load-order-free; we still beat Roam's textarea keymap), skip
 * when e.defaultPrevented, and skip while any typeahead is VISIBLE (.rm-autocomplete__results —
 * Roam's [[ (( / ;; # :: menus AND colonmenu all use it — plus ARIA listbox/menu for foreign
 * plugins; checkVisibility, since colonmenu parks its menu mounted with display:none).
 * (3) The v0.4 lift/hotUntil zero-CLS machinery is DELETED:
 * with rows always visible there is no phantom↔block swap — an add is legitimate one-line
 * growth (same as Enter), a reap is legitimate one-line removal. The clickShield still covers
 * the bottom-row slide-under-pointer retarget (exemption tightened to .rm-block-main so the
 * zoomed-view structural ancestor no longer slips through), and gesture-end moved to the
 * document-level pointerup hook (the row can slide out from under the pointer, so row-local
 * pointerup may never fire).
 * v0.4.1 — click-out reap is INSTANT: release the noReap guard on
 * pointerup + timeout(0) (post click-dispatch) instead of waiting out the fixed 450ms timer;
 * the timer stays only as a fallback for gestures that end off-window.
 * v0.4 — ZERO-CLS entry. v0.3 held the row IN FLOW until pointerup →
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
 * empty, tapping just focuses it (the empty block IS the free node — no duplicate empties).
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
	var started = false, observer = null, raf = 0, late = 0, busy = false, keyHost = null;
	var pending = null;      // {uid, focused} — block WE created; deleted again if abandoned empty
	var shieldUntil = 0;     // swallow structural clicks right after an add (see clickShield)
	var noReapUntil = 0;     // reap debounce floor; see deferReaps
	var pointerHeld = false; // never reap while a pointer is down: the shift retargets the in-flight click
	// (v0.4's hotUntil sync-ensure + lift/unlift zero-CLS machinery is GONE in v0.5: rows never
	// swap with blocks anymore, so there is no double-height state to keep out of the paint)
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
	// REAL blocks only: a completely empty page/day renders a ghost placeholder that is a
	// .roam-block-container WITHOUT data-block-uid ("Click here to start writing…") — it is not
	// a block we can flank or edge off, so uid-less containers don't count anywhere.
	function blocksOf(o) {
		return Array.from(o.children).filter(function (c) {
			return c.classList.contains('roam-block-container') && c.getAttribute('data-block-uid');
		});
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
		hint.textContent = 'new line';
		row.appendChild(ta); row.appendChild(dot); row.appendChild(hint);
		row.addEventListener('mousedown', function (e) { e.preventDefault(); e.stopPropagation(); });
		row.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); });
		row.addEventListener('pointerdown', function (e) {
			e.preventDefault(); e.stopPropagation();
			// a bottom add slides this row down mid-gesture → mouseup retargets → the click lands
			// on a class-less ancestor → Roam's document click handler would unfocus what we just
			// focused. Freeze the row's styling until the gesture ends + shield the click.
			row._gesture = true;
			shieldUntil = performance.now() + 600;
			// touch only: the in-gesture hop that opens the iOS keyboard; on desktop it just
			// steals focus for a beat and adds churn
			if ((navigator.maxTouchPoints || 0) > 0 && e.pointerType !== 'mouse') {
				try { ta.focus({ preventScroll: true }); } catch (err) { }
			}
			add(row, kind === TOP);
		});
		// no row-local gesture-end listeners: a bottom add slides the row out from under the
		// pointer, so its own pointerup may never fire — the document-level releaseReaps hook
		// (fires on ANY pointerup) clears _gesture instead.
		return row;
	}
	// Roam registers its unfocus handler on document CLICK (bubble; route-app.js $APP.JNb):
	// editing + target chain without dont-unfocus-block → blur. A click retargeted off our row
	// (layout changed mid-gesture) hits structural divs and triggers it — swallow exactly those.
	// Exemption = .rm-block-main (real click INTO a block: content, bullet, caret, checkbox all
	// live inside it) + .rm-multibar (thread collapse line — sits directly in .rm-block-children,
	// live-verified), NOT .roam-block-container: in zoomed view the retargeted click's common
	// ancestor is an .rm-block-children INSIDE the zoomed container, which the broader match
	// would exempt → Roam blur → reap eats the fresh block ("requires multiple tries" again).
	function clickShield(e) {
		if (performance.now() > shieldUntil) return;
		if (e.target && e.target.closest && e.target.closest('.rm-block-main,.rm-multibar,.rm-title-display,.' + ROW)) return;
		e.stopPropagation();
	}
	// Row height = one real block pitch, MEASURED (themes vary) — the phantom reads as exactly
	// one line slot and add/reap growth is exactly one pitch: rowH = single + outlineGap − hostGap.
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
	// freshly clicked block. Defer the reap for as long as the pointer is actually HELD (v0.5:
	// the reap shrink is no longer layout-neutral, so a fixed 450ms window is not enough — a
	// drag-select held longer than that would get the layout yanked from under it). The 450ms
	// floor stays as a same-paint debounce; pointerHeld carries gestures of any length.
	function deferReaps() { pointerHeld = true; noReapUntil = performance.now() + 450; }
	// Gesture is over at pointerup; timeout(0) runs after the click (if any) has dispatched —
	// mouseup+click are one synchronous input sequence. Also the ONLY place row._gesture is
	// cleared (rows can slide out from under the pointer → row-local pointerup is unreliable).
	// Reap immediately instead of riding out a timer (that wait was a visible half-second lag
	// on every click-out before the empty block swapped back to the dashed phantom). NOT
	// hookable on 'click': clicking a view-mode block swaps span→textarea between mousedown and
	// mouseup → mousedown target leaves the DOM → Chrome suppresses the click entirely
	// (event-log verified). Off-window releases fire NO pointerup — recoverPointer (any
	// pointermove with no buttons down) releases those the moment the pointer returns.
	function releaseReaps() {
		setTimeout(function () {
			pointerHeld = false;
			noReapUntil = 0;
			var dirty = pending && pending.focused;
			Array.from(document.querySelectorAll('.' + ROW)).forEach(function (row) {
				if (row._gesture) { row._gesture = false; dirty = true; }
			});
			if (dirty) ensure();
		}, 0);
	}
	function recoverPointer(e) { if (pointerHeld && e.buttons === 0) releaseReaps(); }
	function reap() {
		if (!pending || !pending.focused) return;
		if (pointerHeld || performance.now() < noReapUntil) { setTimeout(schedule, 500); return; }
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
				if (r && (r[':block/string'] || '') === '' && !r[':block/children']) api.deleteBlock({ block: { uid: uid } });
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
			if (!blocks.length) {                              // completely empty page: only Roam's
				top.style.display = 'none';                    // ghost placeholder — it is the free
				bot.style.display = 'none';                    // node, phantoms would be noise
				return;
			}
			// v0.5: rows are ALWAYS visible on a non-empty outline — no edge-empty hiding, no
			// lift: the add is legitimate one-line growth (like Enter). The bottom row sliding
			// down under a pressed pointer is safe: the retargeted click hits a structural
			// common ancestor and the clickShield swallows it.
			var h = neutralHeight(o, host, blocks[0]);
			[top, bot].forEach(function (row) {
				if (row._gesture) return;                 // never restyle a row mid-gesture
				if (row.style.display !== '') row.style.display = '';
				var hpx = (h || 26) + 'px';
				if (row.style.height !== hpx) row.style.height = hpx;
			});
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
	// ---- v0.5.1 ghost takeover (touch): see header. One hidden textarea for the in-gesture
	// keyboard hop; lives on <body> so it exists before any ghost renders.
	var ghostTa = document.createElement('textarea');
	ghostTa.className = 'vt-a1-ta';
	ghostTa.tabIndex = -1; ghostTa.setAttribute('aria-hidden', 'true');
	function onGhostDown(e) {
		if (e.pointerType === 'mouse' || (navigator.maxTouchPoints || 0) === 0) return;   // touch/pen only
		var g = e.target && e.target.closest && e.target.closest('.rm-block--ghost');
		if (!g || !g.closest('.roam-article')) return;
		if (g.closest('.rm-reference-main,.rm-reference-container,.rm-embed-container,#right-sidebar')) return;
		// cancel: suppresses the compatibility mousedown → Roam's ghost div never gets focus, its
		// async create-and-focus path never starts (we replace it). The click still fires → shield.
		e.preventDefault(); e.stopPropagation();
		shieldUntil = performance.now() + 600;
		try { ghostTa.focus({ preventScroll: true }); } catch (err) { }   // in-gesture editable focus → iOS keyboard
		ghostAdd(g);
	}
	function ghostAdd(g) {
		if (busy) return; busy = true;
		setTimeout(function () { busy = false; }, 600);
		(async function () {
			var day = g.closest('.roam-log-page');
			var parent, winId;
			if (day) {
				var h = day.querySelector('.rm-title-display');
				var title = h && h.textContent;
				parent = title && api.data.q('[:find ?u . :in $ ?t :where [?e :node/title ?t] [?e :block/uid ?u]]', title);
				winId = 'log-outline';
			} else {
				var open = await api.ui.mainWindow.getOpenPageOrBlockUid();   // page OR zoomed-block uid
				parent = open;
				winId = api.user.uid() + '-body-outline-' + (pageUidOf(open) || open);
			}
			if (!parent) return;
			var uid = api.util.generateUID();
			await api.createBlock({ location: { 'parent-uid': parent, order: 0 }, block: { string: '', uid: uid } });
			pending = { uid: uid, focused: false };
			focusBlock(uid, winId);
		})().catch(function (e) { console.warn('alwaysone ghost add failed', e); });
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
			var edgeUid = edge.getAttribute('data-block-uid');   // never null: blocksOf filters uid-less
			var winId = o.closest('.roam-log-page')
				? 'log-outline'
				: api.user.uid() + '-body-outline-' + pageUidOf(edgeUid);
			if (isEmptyBlock(edge) && (isTop || !hasKids(edge))) {
				// edge may be OUR still-pending block (re-tap on the phantom above it): the touch
				// hidden-ta hop just stole DOM focus, so reap would see "not editing" and delete
				// the very block we are refocusing — disarm until focusBlock re-arms on landing.
				if (pending && pending.uid === edgeUid) pending.focused = false;
				focusBlock(edgeUid, winId); return;
			}
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
	// An open typeahead owns the arrows. Roam's [[ (( / ;; # :: menus all render
	// .rm-autocomplete__results (direct child of <body>, live-verified 2026-07-02; no ARIA
	// roles) and unmount it on close; colonmenu reuses the class but parks its menu MOUNTED
	// with display:none — so presence alone is not enough, visibility is the signal.
	// [role=listbox]/[role=menu] catches ARIA-correct foreign plugins (and Blueprint context
	// menus, where arrows belong to the menu too). checkVisibility also sees visibility:hidden
	// /opacity:0 parking (getClientRects only catches display:none).
	function menuOwnsArrows() {
		var els = document.querySelectorAll('.rm-autocomplete__results,[role=listbox],[role=menu]');
		for (var i = 0; i < els.length; i++) {
			var el = els[i];
			if (el.checkVisibility ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
				: el.getClientRects().length) return true;
		}
		return false;
	}
	function onKey(e) {
		if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
		if (e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
		if (e.defaultPrevented) return;      // an earlier handler (menu plugin) claimed the key
		if (menuOwnsArrows()) return;        // typeahead open → arrows navigate the menu, not blocks
		var ta = e.target;
		if (!ta || ta.tagName !== 'TEXTAREA' || ta.id.indexOf('block-input') !== 0) return;
		var isTop = e.key === 'ArrowUp';
		var edgeTop = caretTop(ta, isTop ? 0 : ta.value.length);
		if (caretTop(ta, ta.selectionEnd) !== edgeTop) return;   // caret not on the edge visual line → native
		var cont = ta.closest('.roam-block-container');
		if (!cont) return;
		// climb to the root container whose parent is a phantom-flanked outline
		var node = cont, outline = null;
		while (node) {
			var p = node.parentElement;
			if (p && p.classList.contains('rm-block-children')) {
				var sib = isTop ? p.previousElementSibling : p.nextElementSibling;
				if (sib && sib.classList && sib.classList.contains(ROW)) { outline = p; break; }
			}
			node = p ? p.closest('.roam-block-container') : null;
		}
		if (!outline) return;
		var blocks = blocksOf(outline);
		if (!blocks.length) return;
		var last = blocks[blocks.length - 1];
		if (isTop ? cont !== blocks[0] : cont !== lastVisible(last)) return;
		var row = isTop ? outline.previousElementSibling : outline.nextElementSibling;
		if (!row || row.style.display === 'none') return;   // row hidden (transient) → nothing to enter
		// edge block already empty (same condition add() focus-existing uses) → the caret is
		// already IN the free node; consuming the key would make it dead. Native handles it.
		if (isTop ? isEmptyBlock(blocks[0]) : (isEmptyBlock(last) && !hasKids(last))) return;
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
				schedule();
				return;
			}
		});
		observer.observe(document.body, { childList: true, subtree: true });
		document.addEventListener('focusout', schedule, true);   // blur alone mutates nothing → reap needs this
		// keydown capture on #app, NOT document: menu plugins (colonmenu etc.) claim arrows at
		// document-capture with stopPropagation → they preempt us regardless of load order, exactly
		// as they preempt Roam. We still run before Roam's own leave-block keymap (React synthetic
		// handler = root-container BUBBLE) — which preventDefaults even at page edges, so we cannot
		// sit after it; capture-at-#app is the one slot that is both cooperative and effective.
		keyHost = document.getElementById('app') || document;
		keyHost.addEventListener('keydown', onKey, true);
		document.body.appendChild(ghostTa);
		document.addEventListener('pointerdown', onGhostDown, true);   // ghost takeover (touch) — before deferReaps is fine, both capture
		document.addEventListener('click', clickShield, true);   // capture: beat Roam's unfocus click handler
		document.addEventListener('pointerdown', deferReaps, true);
		document.addEventListener('pointerup', releaseReaps, true);      // reap right after the gesture
		document.addEventListener('pointercancel', releaseReaps, true);
		document.addEventListener('pointermove', recoverPointer, true);  // off-window release recovery
		return true;
	}
	function stop() {
		if (!started) return; started = false;
		if (observer) { observer.disconnect(); observer = null; }
		document.removeEventListener('focusout', schedule, true);
		if (keyHost) { keyHost.removeEventListener('keydown', onKey, true); keyHost = null; }
		document.removeEventListener('pointerdown', onGhostDown, true);
		if (ghostTa.parentNode) ghostTa.parentNode.removeChild(ghostTa);
		document.removeEventListener('click', clickShield, true);
		document.removeEventListener('pointerdown', deferReaps, true);
		document.removeEventListener('pointerup', releaseReaps, true);
		document.removeEventListener('pointercancel', releaseReaps, true);
		document.removeEventListener('pointermove', recoverPointer, true);
		if (raf) { cancelAnimationFrame(raf); raf = 0; }
		if (late) { clearTimeout(late); late = 0; }
		Array.from(document.querySelectorAll('.' + ROW)).forEach(function (el) { el.remove(); });
		if (css.parentNode) css.parentNode.removeChild(css);
		return true;
	}

	start();
	return { start: start, stop: stop, _state: function () { return { started: started, busy: busy, pending: pending }; } };
})();
