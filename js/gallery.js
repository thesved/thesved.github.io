/*
 * Viktor's Roam gallery v1.2 — PhotoSwipe 5
 * author: @ViktorTabori
 *
 * v1.2 (2026-06-13): snappier motion + glass backdrop + Esc layering.
 *  - Tuned durations: open 200ms / close 180ms (showAnimationDuration/hideAnimationDuration),
 *    double-tap+pinch 200ms (zoomAnimationDuration; default was 333). Live-tunable from the
 *    console: ViktorGallery.dur(open,hide,zoom) — open/hide apply on next open, zoom applies
 *    live to the open modal too.
 *  - Apple-ish frosted glass backdrop: a body-level .vg-glass layer (sibling of .pswp) carries
 *    blur(24px) saturate(180%) + rgba(0,0,0,.5) tint, ramped 0→full in sync with the open zoom.
 *    MUST be a .pswp SIBLING: .pswp is a "backdrop root" (transform+contain+will-change), so a
 *    backdrop-filter on .pswp or its .pswp__bg child samples nothing. The sibling's backdrop is
 *    the page. pswp bgOpacity:0 (tint moved to the glass layer). z = pswp z - 1 (image stays crisp).
 *  - Esc layering: when the copy sheet is open, Esc closes the SHEET first (modal stays); a
 *    capture-phase keydown handler beats PhotoSwipe's own Esc→close. destroy() also closes the
 *    sheet as a safety net so closing the modal never orphans it.
 *
 * v1.1 (2026-06-12): iPhone-feedback fixes.
 *  - Long-press sheet no longer vanishes on finger release in the iOS PWA: the release fires
 *    a GHOST CLICK (iOS compatibility click after touchend, even though touchend was
 *    preventDefault'd) that landed on the fresh backdrop and closed it. The sheet now only
 *    honors clicks that were preceded by a pointerdown ON the sheet after it opened —
 *    ghost clicks never are.
 *  - Zoom open/close animation is back (v4 feel): showHideAnimationType 'zoom' + thumbEl
 *    filter pointing at the in-page img, so the thumbnail flies up instead of a blank wait.
 *  - Zoom button hidden in the modal top bar (zoom: false); pinch/double-tap still zoom.
 *
 * v1.0 (2026-06-12): PhotoSwipe 4.1.3 (custom SVG fork) → 5.4.4 stock ESM from cdnjs.
 *  - SVG (mermaid) needs no fork anymore: serialized to a blob: URL, revoked on close.
 *  - Copy-on-mobile: iOS long-press is a TEXT-SELECTION gesture (see longtap v0.5) and the
 *    theme sets -webkit-touch-callout:none on rendered blocks, so the NATIVE image callout
 *    never fires in Roam. We own the gesture instead: 500ms touch timer on an image (in a
 *    block OR inside the open PhotoSwipe modal) opens our action sheet:
 *    Copy image / Copy image URL / Share… / Open in new tab.
 *    The modal top bar also gets a copy button (desktop + mobile affordance).
 *
 * How to install it:
 *  - go to page [[roam/js]]
 *  - create a node with: {{[[roam/js]]}}
 *  - create a code block under it, and change its type from clojure to javascript
 *  - allow the running of the javascript on the {{[[roam/js]]}} node
 *  - reload Roam
 *  - click/tap an image: gallery; long-press an image: copy sheet
 *  - edit image url on mobile: tap top right corner of image (44x44px, gallery won't fire)
 */
if (window.ViktorGallery && window.ViktorGallery.stop) window.ViktorGallery.stop();
window.ViktorGallery = (function(){
	var PSWP_JS  = 'https://cdnjs.cloudflare.com/ajax/libs/photoswipe/5.4.4/photoswipe.esm.min.js';
	var PSWP_CSS = 'https://cdnjs.cloudflare.com/ajax/libs/photoswipe/5.4.4/photoswipe.min.css';
	var SVG_ZOOM = 3;     // rasterization scale for svg images
	var LP_MS    = 500;   // long-press duration
	var OPEN_MS  = 200;   // zoom-in duration (small img → fullscreen), ms
	var HIDE_MS  = 180;   // zoom-out duration (fullscreen → small img), ms
	var ZOOM_MS  = 200;   // double-tap / pinch zoom transition, ms (PhotoSwipe default 333)
	var BLUR_PX  = 24;    // glass backdrop blur radius, px (animated 0 → this on open)
	var MOVE_TOL = 12;    // px of touch movement that cancels tap/long-press
	var COPY_ICON = '<svg aria-hidden="true" viewBox="0 0 32 32" width="32" height="32" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%)"><path fill="currentColor" d="M20 5H8a2 2 0 0 0-2 2v14h2V7h12V5zm4 4H12a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V11a2 2 0 0 0-2-2zm0 16H12V11h12v14z"/></svg>';

	var started = false;
	var pswpModulePromise = null;
	var activePswp = null;
	var touch = null; // in-block long-press state: {img, x, y, timer, fired}
	var sheetKeydown = null; // Escape handler active while the copy sheet is open

	start();

	return {
		isStarted:()=>started,
		start: start,
		stop: stop,
		// live zoom-speed tuning, ms — [open, hide] apply on NEXT gallery open;
		// zoom (double-tap/pinch) applies LIVE to the open modal too:
		//   ViktorGallery.dur()              → [open, hide, zoom] current
		//   ViktorGallery.dur(200,180,220)   → set all three
		dur: function(open, hide, zoom){
			if (open!=null) OPEN_MS=open;
			if (hide!=null) HIDE_MS=hide;
			if (zoom!=null) { ZOOM_MS=zoom; if (activePswp) activePswp.options.zoomAnimationDuration=zoom; }
			return [OPEN_MS, HIDE_MS, ZOOM_MS];
		},
	};

	function start() {
		if (started) return;
		started = true;
		document.addEventListener('click', onClick, true);
		document.addEventListener('touchstart', onTouchStart, true);
		document.addEventListener('touchmove', onTouchMove, true);
		document.addEventListener('touchend', onTouchEnd, true);
		document.addEventListener('touchcancel', onTouchCancel, true);
		addFile('link', 'href', PSWP_CSS, {rel:'stylesheet'});
		addStyle();
		console.log('Gallery plugin (PhotoSwipe 5) loaded & listening');
		return true;
	}

	function stop() {
		if (!started) return;
		started = false;
		document.removeEventListener('click', onClick, true);
		document.removeEventListener('touchstart', onTouchStart, true);
		document.removeEventListener('touchmove', onTouchMove, true);
		document.removeEventListener('touchend', onTouchEnd, true);
		document.removeEventListener('touchcancel', onTouchCancel, true);
		cancelTouch();
		closeSheet();
		if (activePswp) { try { activePswp.destroy(); } catch(_){} activePswp = null; }
		var style = document.getElementById('vg-style');
		if (style) style.remove();
		console.log('Gallery plugin stopped');
		return true;
	}

	// ---- target picking -------------------------------------------------

	// returns the gallery-able element under `target`: an inline img, or a mermaid svg
	function pickImage(target) {
		if (!target || !target.closest) return null;
		if (target.nodeName == 'IMG' && target.classList.contains('rm-inline-img')) return target;
		var mermaid = target.closest('.rm-mermaid');
		if (mermaid) return target.closest('svg') || mermaid.querySelector('svg');
		return null;
	}

	// 44x44px top right corner on mobile = Roam's edit-the-url affordance, leave it alone
	function inEditCorner(x, y, img) {
		if (window.innerWidth >= 500) return false;
		var rect = img.getBoundingClientRect();
		return (x - rect.left) > (rect.width - 44) && (y - rect.top) < 44;
	}

	// ---- in-block events -------------------------------------------------

	function onClick(e) {
		// trusted desktop click (touch taps are handled+consumed in onTouchEnd)
		var img = pickImage(e.target);
		if (!img) return;
		if (inEditCorner(e.clientX, e.clientY, img)) return;
		e.preventDefault();
		e.stopPropagation();
		openGallery(img);
	}

	function onTouchStart(e) {
		var img = pickImage(e.target);
		if (!img) return;
		var t = e.touches[0];
		cancelTouch();
		touch = {img: img, x: t.clientX, y: t.clientY, fired: false, timer: setTimeout(function(){
			if (!touch) return;
			touch.fired = true;
			showSheet(itemFromDom(touch.img));
		}, LP_MS)};
	}

	function onTouchMove(e) {
		if (!touch) return;
		var t = e.touches[0];
		if (Math.hypot(t.clientX - touch.x, t.clientY - touch.y) > MOVE_TOL) cancelTouch();
	}

	function onTouchEnd(e) {
		if (!touch) return;
		clearTimeout(touch.timer);
		var st = touch;
		touch = null;
		if (st.fired) { // long-press already opened the sheet — swallow the tap
			e.preventDefault();
			e.stopPropagation();
			return;
		}
		var t = e.changedTouches[0];
		if (inEditCorner(t.clientX, t.clientY, st.img)) return; // let Roam edit the url
		e.preventDefault(); // also suppresses the synthetic click
		e.stopPropagation();
		openGallery(st.img);
	}

	function onTouchCancel() { cancelTouch(); }

	function cancelTouch() {
		if (!touch) return;
		clearTimeout(touch.timer);
		touch = null;
	}

	// ---- gallery ---------------------------------------------------------

	function loadPswp() {
		if (!pswpModulePromise) pswpModulePromise = import(PSWP_JS).then(m => m.default);
		return pswpModulePromise;
	}

	function collectItems() {
		return Array.from(document.querySelectorAll('img.rm-inline-img, .rm-mermaid svg')).map(function(v){
			var ret = {_dom: v};
			if (v.nodeName.match(/^svg$/i)) {
				v.style.backgroundColor = '#eee';
				ret.src = URL.createObjectURL(new Blob([v.outerHTML.replace(/<br>/g,'<br/>')], {type:'image/svg+xml;charset=utf-8'}));
				ret.width = v.viewBox.baseVal.width * SVG_ZOOM;
				ret.height = v.viewBox.baseVal.height * SVG_ZOOM;
				ret._blob = true;
			} else {
				ret.src = v.src;
				ret.width = v.naturalWidth;
				ret.height = v.naturalHeight;
			}
			ret.msrc = ret.src;
			return ret;
		});
	}

	function itemFromDom(dom) {
		if (dom.nodeName == 'IMG') return {src: dom.src};
		return collectItems().filter(function(i){ return i._dom == dom; })[0];
	}

	function openGallery(target) {
		loadPswp().then(function(PhotoSwipe){
			var items = collectItems();
			var index = Math.max(0, items.findIndex(function(i){ return i._dom == target; }));
			var pswp = new PhotoSwipe({
				dataSource: items,
				index: index,
				showHideAnimationType: 'zoom',
				showAnimationDuration: OPEN_MS,
				hideAnimationDuration: HIDE_MS,
				zoomAnimationDuration: ZOOM_MS, // double-tap / pinch
				bgOpacity: 0,                   // tint lives on the .vg-glass layer (Tier 2 masked)
				zoom: false, // no zoom button (pinch/double-tap still work)
				wheelToZoom: true,
			});
			// zoom animation needs the thumbnail element; our items aren't in a pswp-markup
			// gallery, so hand it the in-page img/svg directly
			pswp.addFilter('thumbEl', function(thumbEl, data){ return data._dom || thumbEl; });
			pswp.on('uiRegister', function(){
				pswp.ui.registerElement({
					name: 'copy-image',
					title: 'Copy image',
					order: 9, // between counter (5) and zoom (10)
					isButton: true,
					html: COPY_ICON,
					onClick: function(){ showSheet(pswp.currSlide && pswp.currSlide.data); },
				});
			});
			// Tier-2 glass layer, behind the modal. Ramp blur+opacity in/out so it tracks the zoom.
			var glass = document.createElement('div');
			glass.className = 'vg-glass';
			glass.style.opacity = '0';
			document.body.appendChild(glass);
			function setGlass(blur, ms, op){
				glass.style.transition = 'backdrop-filter '+ms+'ms ease,-webkit-backdrop-filter '+ms+'ms ease,opacity '+ms+'ms ease';
				glass.style.webkitBackdropFilter = glass.style.backdropFilter = 'blur('+blur+'px) saturate(1.8)';
				glass.style.opacity = op;
			}
			pswp.on('openingAnimationStart', function(){
				var pe = pswp.element;
				if (pe) glass.style.zIndex = ((parseInt(getComputedStyle(pe).zIndex) || 100000) - 1);
				setGlass(BLUR_PX, OPEN_MS, '1');
			});
			pswp.on('closingAnimationStart', function(){ setGlass(0, HIDE_MS, '0'); });
			pswp.on('destroy', function(){
				glass.remove();
				closeSheet(); // Esc closes the modal — don't leave the copy sheet orphaned
				items.forEach(function(i){ if (i._blob) URL.revokeObjectURL(i.src); });
				if (activePswp == pswp) activePswp = null;
			});
			pswp.init();
			activePswp = pswp;
		}).catch(function(err){ console.error('gallery: PhotoSwipe load failed', err); });
	}

	// NOTE: no in-modal long-press sheet (removed 2026-06-14). Inside the open PhotoSwipe modal the image
	// is a plain <img> (not a -webkit-touch-callout:none rendered block), so iOS Safari's NATIVE long-press
	// callout (Save to Photos / Copy / Share…) fires on its own — our sheet would double up over it. The
	// top-bar copy button still covers desktop. (In-block long-press sheet stays — Roam blocks suppress the
	// native callout, so we still own that gesture; see onTouchStart.)

	// ---- copy sheet --------------------------------------------------------

	function showSheet(item) {
		if (!item || !item.src) return;
		closeSheet();
		var src = item.src;
		var isBlob = /^(blob|data):/i.test(src);
		var backdrop = document.createElement('div');
		backdrop.className = 'vg-backdrop';
		var sheet = document.createElement('div');
		sheet.className = 'vg-sheet';
		button('Copy image', function(){ copyImage(src); });
		if (!isBlob) button('Copy image URL', function(){
			navigator.clipboard.writeText(src).then(function(){ toast('URL copied'); }, function(){ toast('Copy failed'); });
		});
		if (navigator.share) button('Share…', function(){ shareImage(src); });
		if (!isBlob) button('Open in new tab', function(){ window.open(src, '_blank'); });
		var cancel = button('Cancel', function(){});
		cancel.classList.add('vg-cancel');
		backdrop.appendChild(sheet);
		// iOS PWA: releasing the long-press fires a GHOST CLICK (compatibility click after
		// touchend, despite preventDefault) at the touch point — which is now this backdrop —
		// and would instantly close/activate the sheet. Real taps always begin with a
		// pointerdown ON the open sheet; ghost clicks never do. Swallow the unarmed ones.
		var armed = false;
		backdrop.addEventListener('pointerdown', function(){ armed = true; }, true);
		backdrop.addEventListener('click', function(e){
			if (!armed) { e.preventDefault(); e.stopPropagation(); return; }
			if (e.target == backdrop) closeSheet();
		}, true);
		document.body.appendChild(backdrop);
		// Esc closes the sheet FIRST (one layer at a time). Capture-phase + stopPropagation
		// beats PhotoSwipe's own Escape→close, so the modal stays open behind the sheet.
		sheetKeydown = function(e){
			if (e.key == 'Escape' || e.keyCode == 27) {
				e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
				closeSheet();
			}
		};
		document.addEventListener('keydown', sheetKeydown, true);

		function button(label, fn) {
			var b = document.createElement('button');
			b.className = 'vg-btn';
			b.textContent = label;
			b.addEventListener('click', function(e){
				e.preventDefault();
				e.stopPropagation();
				closeSheet();
				fn();
			});
			sheet.appendChild(b);
			return b;
		}
	}

	function closeSheet() {
		if (sheetKeydown) { document.removeEventListener('keydown', sheetKeydown, true); sheetKeydown = null; }
		var b = document.querySelector('.vg-backdrop');
		if (b) b.remove();
	}

	function copyImage(src) {
		if (!navigator.clipboard || !window.ClipboardItem) {
			navigator.clipboard && navigator.clipboard.writeText(src).then(function(){ toast('Image copy unsupported — URL copied'); });
			return;
		}
		// Safari demands the ClipboardItem (with a Promise payload) be created synchronously
		// inside the user gesture — resolve the png blob lazily inside it.
		navigator.clipboard.write([new ClipboardItem({'image/png': pngBlob(src)})]).then(function(){
			toast('Image copied');
		}, function(err){
			console.warn('gallery: image copy failed', err);
			navigator.clipboard.writeText(src).then(function(){ toast('Image copy failed — URL copied'); }, function(){ toast('Copy failed'); });
		});
	}

	function pngBlob(src) {
		return new Promise(function(resolve, reject){
			var img = new Image();
			if (!/^(blob|data):/i.test(src)) img.crossOrigin = 'anonymous';
			img.onload = function(){
				try {
					var c = document.createElement('canvas');
					c.width = img.naturalWidth || img.width;
					c.height = img.naturalHeight || img.height;
					c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
					c.toBlob(function(b){ b ? resolve(b) : reject(new Error('toBlob failed')); }, 'image/png');
				} catch (err) { reject(err); }
			};
			img.onerror = function(){ reject(new Error('image load failed (CORS?)')); };
			img.src = src;
		});
	}

	function shareImage(src) {
		fetch(src).then(function(r){ return r.blob(); }).then(function(blob){
			var ext = (blob.type.split('/')[1] || 'png').replace('jpeg','jpg').replace(/\+.*/,'');
			var file = new File([blob], 'image.' + ext, {type: blob.type});
			if (navigator.canShare && navigator.canShare({files:[file]})) return navigator.share({files:[file]});
			return navigator.share({url: src});
		}).catch(function(err){
			if (err && err.name == 'AbortError') return; // user dismissed the share sheet
			console.warn('gallery: share failed', err);
			navigator.share({url: src}).catch(function(){ toast('Share failed'); });
		});
	}

	function toast(msg) {
		var t = document.createElement('div');
		t.className = 'vg-toast';
		t.textContent = msg;
		document.body.appendChild(t);
		setTimeout(function(){ t.remove(); }, 1800);
	}

	// ---- statics -------------------------------------------------------------

	function addStyle() {
		if (document.getElementById('vg-style')) return;
		var s = document.createElement('style');
		s.id = 'vg-style';
		s.textContent = [
			// TIER 1 frosted glass on the modal backdrop: a body-level layer (sibling of .pswp, so
			// its backdrop IS the page — .pswp itself is a "backdrop root" via transform+contain+
			// will-change and would sample nothing). Carries the blur + dark tint, full-screen and
			// uniform. Sits just under .pswp so the image stays crisp.
			'.pswp{-webkit-backdrop-filter:none;backdrop-filter:none}',
			'.vg-glass{position:fixed;inset:0;pointer-events:none;background:rgba(0,0,0,.5);' +
				'-webkit-backdrop-filter:blur(0px) saturate(1);backdrop-filter:blur(0px) saturate(1)}',
			'.vg-backdrop{position:fixed;inset:0;z-index:2000000;background:rgba(0,0,0,.35);display:flex;align-items:flex-end;justify-content:center}',
			'.vg-sheet{width:min(420px,calc(100% - 16px));margin-bottom:max(8px,env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:1px;border-radius:14px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,.35)}',
			'.vg-btn{appearance:none;border:0;margin:0;padding:15px 16px;font-size:16px;line-height:1.2;text-align:center;cursor:pointer;background:rgba(40,42,46,.96);color:#eaeaea}',
			'.vg-btn:active{background:rgba(70,72,78,.96)}',
			'.vg-btn.vg-cancel{margin-top:7px;border-radius:14px;font-weight:600}',
			'.vg-toast{position:fixed;left:50%;bottom:64px;transform:translateX(-50%);z-index:2000001;padding:9px 16px;border-radius:999px;background:rgba(30,32,36,.94);color:#fff;font-size:14px;pointer-events:none}',
		].join('\n');
		document.head.appendChild(s);
	}

	// inject code to head
	function addFile(type, srcName, src, opt){
		if (Array.from(document.head.getElementsByTagName(type)).filter(function(s){ return s[srcName] == src; }).length) return;
		var file = document.createElement(type);
		file[srcName] = src;
		file.async = false;
		if (typeof opt == 'object') for (var i in opt) file[i] = opt[i];
		document.head.appendChild(file);
		return true;
	}
})();
