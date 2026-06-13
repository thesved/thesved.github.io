/*
 * Viktor's Roam Template V2 beta
 * version: 2.0.1b
 * author: @ViktorTabori
 *
 * How to install it:
 *  - go to page [[roam/js]]
 *  - create a node with: { {[[roam/js]]}}
 *  - create a clode block under it, and change its type from clojure to javascript
 *  - allow the running of the javascript on the {{[[roam/js]]}} node
 *  - create a template page with some content: [[template]]/test
 *  - reload roam
 *  - write :test: to you daily page and see what happens
 */
window.ViktorRoamOpts = window.ViktorRoamOpts || {
	searchPages: ['template','[[template]]'], // search for template in `template/name`, `[[template]]/name` in this order
	resolveDateTyping: true, // resolve `:dates:` while you type
	resolveDateTemplate: true, // resolve template dates like easter: `{next Sunday {fullmoon {March 22 this year}}}`
	onelinerExtraSpace: true, // for one line templates should it add an extra whitespace to make typing easier?
	pasteRoamData: true, // the RoamData copy-paste data structure may change in the future, if it is broken set this to false
	ignoreNodes: [/#ignore|\[\[ignore\]\]/i]	// ignore these nodes when resolving templates
};

// :?: / :help: date-syntax cheat-sheet (one-liner, inserted in place)
window.ViktorDateCheatsheet = window.ViktorDateCheatsheet ||
	'date syntax: :next fri: :tomorrow: · :3: (+3d) :-1: (yesterday) · :06-11: :0611: · ' +
	':last week of month: :first month of q3: :3rd sunday of q2: · :eom:/:eow:/:eoq:/:eoy: (end-of) · ' +
	':friday in 2 weeks: · :fullmoon: · append `YYYY.MM.DD EEE` for a custom format';

// lib to manipulate inputs and keyboard
if (window.ViktorInputLib && typeof window.ViktorInputLib.stop === 'function') window.ViktorInputLib.stop();
window.ViktorInputLib = (function(){
	// nativeValueSetter to bypass React setter for textarea input change, see: https://hustle.bizongo.in/simulate-react-on-change-on-controlled-components-baa336920e04
	var nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,"value").set,
		started = false;

	start();

	// export functions
	return {
		start: start,
		stop: stop,
		resolveTemplate: resolveTemplate,
		sleep: sleep,
		simulateSequence: simulateSequence,
		changeHeading: changeHeading,
		pressEsc: pressEsc,
		pressBackspace: pressBackspace,
		leftClick: leftClick,
		nativeSetter: nativeSetter,
		simulateInputEvent: simulateInputEvent,
		addFile: addFile,
	};

	function start() {
		if (started) return;
		started = !started;

		// add event listener for input events
		document.addEventListener('input', resolveTemplate);

		console.log('** input lib listening added **');
	}

	function stop() {
		if (!started) return;
		started = !started;

		// add event listener for input events
		document.removeEventListener('input', resolveTemplate);

		console.log('** input lib listening stopped **');
	}

	// sleep
	function sleep(millis) {
	    return new Promise(function(resolve){setTimeout(resolve, Number.isInteger(millis)?millis:20)});
	}

	// simulate heading change: needed for one line templates
	async function simulateSequence(events, delayOverride) {
    	;events.forEach(function(e){
			return document.activeElement.dispatchEvent(new KeyboardEvent(e.name, {
		        bubbles: true,
		        cancelable: true,
		        keyCode: e.code,
		        ...e.opt,
		    }));
		});
		return sleep(delayOverride);
    };

    // change heading to 0 - normal, 1 - H1, 2 - H2, 3 - H3
	async function changeHeading(heading, delayOverride) {
	    return simulateSequence(
	    	[
	    		{name:'keydown', code:18, opt:{altKey:true}},
				{name:'keydown', code:91, opt:{metaKey:true}},
				{name:'keydown', code:48+heading, opt:{altKey:true, metaKey:true}},
				{name:'keyup', code:91, opt:{altKey:true}},
				{name:'keyup', code:18, opt:{}}
			],
	    	delayOverride);
	};

	async function pressEsc(delayOverride) {
	    return simulateSequence(
	    	[
	    		{name:'keydown', code:27, opt:{}},
				{name:'keyup', code:27, opt:{}}
			],
	    	delayOverride);
	};

	async function pressBackspace(delayOverride) {
	    return simulateSequence(
	    	[
	    		{name:'keydown', code:8, opt:{}},
				{name:'keyup', code:8, opt:{}}
			],
	    	delayOverride);
	};

	async function leftClick(element, opts, delayOverride) {
		['mousedown', 'click', 'mouseup'].forEach(function(type){
			element.dispatchEvent(new MouseEvent(type, {
		        view: window,
		        bubbles: true,
		        cancelable: true,
		        buttons: 1,
		        ...opts,
		    }))
		});
		return sleep(delayOverride||20);
	}

	// simulate input event
	function simulateInputEvent(elem) {
		elem.dispatchEvent(new Event('input', {bubbles: true, cancelable: true }));
	}

	// inject code to head
	//  addFile('script','src','https://cdnjs.cloudflare.com/ajax/libs/photoswipe/4.1.3/photoswipe-ui-default.min.js');
	//  addFile('link', 'href', 'https://cdnjs.cloudflare.com/ajax/libs/photoswipe/4.1.3/photoswipe.css', {rel:'stylesheet'});
	function addFile(type,srcName,src,opt){
		return new Promise((resolve)=>{
			if (Array.from(document.head.getElementsByTagName(type)).filter(s=>s[srcName]==src).length) {
				console.log('already loaded', src);
				resolve('already loaded');
				return;
			}
			var file = document.createElement(type);
			file[srcName] = src;
			file.async = false;
			file.onload = ()=>resolve('loaded');
			file.onerror = ()=>resolve('error');
			if (typeof opt == 'object') {
				for (var i in opt) {
					file[i] = opt[i];
				}
			}
			document.head.append(file);
			console.log('added', src);
			return;
		});
		
	}

	// resolve a template from event
	async function resolveTemplate(e) {
		// exit if not target or not semicolon
		var elem = e.target
		if (elem.nodeName != 'TEXTAREA' || !(e.data||'').match(/[:;]/i)) return;

		// select all textarea: on mobile it is easier to delete
		if (elem.value.match(/;;;/) && e.data == ';') {
			setTimeout(async function(){
				await ViktorInputLib.pressEsc(50);
				await ViktorInputLib.pressBackspace(50);
			},50);
			/*elem.selectionStart = 0;
			elem.selectionEnd = elem.value.length;*/
			return;
		}

		// :?: cheat-sheet — parseTxt's exclude regex filters a leading "?", so intercept it directly here
		if (e.data == ':' && /:\?:$/.test(elem.value.substring(0, elem.selectionEnd))) {
			var _end = elem.selectionEnd, _start = _end - 3; // ":?:"
			var _ins = window.ViktorDateCheatsheet + (ViktorRoamOpts.onelinerExtraSpace ? ' ' : '');
			ViktorInputLib.nativeSetter.call(elem, elem.value.slice(0, _start) + _ins + elem.value.slice(_end));
			elem.selectionStart = elem.selectionEnd = _start + _ins.length;
			ViktorInputLib.simulateInputEvent(elem);
			return;
		}

		// resolve templates when user types `:template name:`
		var text = elem.value;
		var commands = ViktorRoamLib.parseTxt(text.substr(0,elem.selectionEnd), ':', ':', '::""`'+'`', 2, /^:[^a-z0-9\-\+]|\s:$/i);
		commands.forEach(function(_){
			text.replace(_, async function(v, position){
				var tmp;
				
				v = v.replace(/^:|:$/g,'');
				// handle arguments
				var args = v.replace(/\s*;\s*/g,';').split(';');
				v = args.shift();

				// :?: / :help: -> date-syntax cheat-sheet (one-liner, replaces the trigger in place)
				if (!tmp && /^(\?|help)$/i.test(v)) {
					tmp = {'text/plain': window.ViktorDateCheatsheet};
				}

				// lookup random node
				if (!tmp && v.match(/^rand(om)?\W/i)) {
					tmp = {'text/plain':ViktorRoamLib.getRandomNode( (_.match(/^:rand(?:om)?(\W.*):$/i)||['',''])[1] )};
				}


				// lookup template
				if (!tmp) {
					tmp = ViktorRoamLib.findPageId(v, ViktorRoamOpts.searchPages);
					if (tmp) {
						tmp = await ViktorRoamLib.getClipboardFormat(tmp, args);
					}
				}

				// if no results, try to parse it as a fuzzy date
				if (!tmp && ViktorRoamOpts.resolveDateTyping && typeof ViktorFuzzyDate !== 'undefined') {
					tmp = ViktorFuzzyDate.parseFormatDate([v, ...args].join(';'));
					if (tmp) {
						tmp = {'text/plain':tmp};
					}
				}

				// skip if no template nor date was found
				if (!tmp) {
					return _;
				}

				console.log('template:',v,"\n",tmp);

				// if the template is one row, we set the value directly
				var _replace = '';
				var pos = 0;
				if ((/(<li)[\s>]/ig.exec(tmp['text/html'])||[]).length == 1 || !/\n/.test(tmp['text/plain'].trim())) {
					// remove the bullet point
					_replace = tmp['text/plain'].trim().replace(/^\s*- /i, '');

					// heading check
					var match = _replace.match(/^(#+) /i);
					if (match) {
						await ViktorInputLib.changeHeading(0); // first change to normal text
						await ViktorInputLib.changeHeading(match[1].length); // change heading
						elem = document.activeElement;
						_replace = _replace.replace(/^#+ /, ''); // remove heading markup 
					}

					// add an extra whitespace for better typing experience, except when $cursor is defined or already has a whitespace at the end
					if (ViktorRoamOpts.onelinerExtraSpace && !_replace.match(/\s$/) && !_replace.match(/\$cursor/i)) {
						_replace += ' ';
					}

					// cursor position
					pos += _replace.length;

					// replace cursor position by $cursor
					_replace = _replace.replace(/\$cursor/gi,function(_m, _p, _all){
						pos = _all.substr(0,_p).replace(/\$cursor/gi, '').length;
						return '';
					});
				}
				pos += position;

				// remove template alias in textarea
				text = text.replace(_, _replace);
				// set input text, selection, and fire change event
				ViktorInputLib.nativeSetter.call(elem, text);
				elem.selectionStart = pos;
				elem.selectionEnd = pos;
				ViktorInputLib.simulateInputEvent(elem);
				
				// trigger paste event for multiline templates
				if (_replace == '') {
					// handle $cursor
					var pos = null;
					var line = null;
					if (tmp['text/html']) tmp['text/html'] = tmp['text/html'].replace(/\$cursor/gi, '');
					if (tmp['roam/data']) tmp['roam/data'] = tmp['roam/data'].replace(/\$cursor/gi, '');
					if (tmp['text/plain']) tmp['text/plain'] = tmp['text/plain'].replace(/\$cursor/gi, '');

					var _event = new CustomEvent("paste", {cancelable: true, bubbles: true});
					_event.clipboardData = {
						files: {length:0},
						getData: function(type){
							return tmp[type]||'';
						}
					};
					document.activeElement.dispatchEvent(_event);

					// jump to cursor
					if (tmp.cursor && tmp.cursor.line !== null && tmp.cursor.position !== null) {
						setTimeout(function(){
							var inps = Array.from(document.querySelectorAll("[id^='block-input-']"));
							inps = inps.slice(inps.findIndex(function(v){return v == document.activeElement}));
							leftClick(inps[tmp.cursor.line-1]);
							setTimeout(function(){
								document.activeElement.selectionStart = tmp.cursor.position;
								document.activeElement.selectionEnd = tmp.cursor.position;
							}, 100);
						}, 100);
					}
				}

			});
		});
	}
})();


/* 
 * ViktorFuzzyDate Proof-of-Concept v0.0.2alpha
 * author: @ViktorTabori
 *
 * eg: today, yesterday, tomorrow, next Monday, first fri of January, 2021 February 4, 2 weeks from now, 5 months ago
 */
window.ViktorFuzzyDate = (function(){
	// --- config (ViktorRoamOpts): localizable names, week-start, custom aliases ---
	var O = (typeof window !== 'undefined' && window.ViktorRoamOpts) || {},
		_conflicts = [], // alias-conflict log, surfaced via ViktorFuzzyDate.aliasConflicts
		// canonical English (Monday-first days) — maps user aliases to an index regardless of active locale
		_enMonths = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
		_enDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
		// localizable names (override via ViktorRoamOpts.nameMonths / nameDays / ...); default English
		months = O.nameMonths || _enMonths.slice(),
		monthsShort = O.nameMonthsShort || ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
		days = O.nameDays || _enDays.slice(),
		daysShort = O.nameDaysShort || ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
		// week-start as an internal index (0=Monday .. 6=Sunday); 'auto' => Roam native / Intl / ISO-Monday
		weekStartIdx = resolveWeekStart(O.weekStart),
		regexSubdate = /\b(prev[iou]*s*|ago|past|last|this|cur+ent|next|f[ro]+m|after)\s*([-\+]?\s*\d+)?\s*(st|nd|rd|th)?\s*(d(ays*)?|w([ea]+ks*)?|m(o*n[th]+s*)?|y([ae]+rs*)?)\b/gi,
		regexSubdateNeg = /(last|first)\s*(d(ays*)?|w([ea]+ks*)?)/i, // don't sub-resolve `last day` and `last week`
		regexYear = /(?:^|[\b\s\W])(\d{4})(?:[\b\s\W]|$)/,
		regexNumber = /[-\+]?\s*(\d+)/i,
		// built from names+aliases when localization config is present; else the original English prefix matchers (golden-safe)
		regexMonth = buildMatchers('month', months, monthsShort, _enMonths, [/\bjan\w*/i, /\bfeb\w*/i, /\bmar\w*/i, /\bapr\w*/i, /\bmay\w*/i, /\bjun\w*/i, /\bjul\w*/i, /\baug\w*/i, /\bsep\w*/i, /\bo[ck]t\w*/i, /\bnov\w*/i, /\bdec\w*/i]),
		regexDay = buildMatchers('day', days, daysShort, _enDays, [/\bmon\w*/i, /\btue\w*/i, /\bwed\w*/i, /\bthu\w*/i, /\bfri\w*/i, /\bsat\w*/i, /\bsun\w*/i]),
		regexUnitClean = /\b(of|now|the)\b/i, // remove filler
		regexUnit = {
			regex: [/([-\+]?\s*\d+)\s*(st|nd|rd|th)?\s*d(ays*)?\b/i, /(?:^|[\b\d\s])d(ays*)?\b/i, /([-\+]?\s*\d+)\s*(st|nd|rd|th)?\s*w([ea]+ks*)?\b/i, /(?:^|[\b\d\s])w([ea]+ks*)?\b/i, /([-\+]?\s*\d+)\s*(st|nd|rd|th)?\s*m(o*n[th]+s*)?\b/i, /(?:^|[\b\d\s])m(o*n[th]+s*)?\b/i, /([-\+]?\s*\d+)\s*(st|nd|rd|th)?\s*y([ae]+rs*)?\b/i, /(?:^|[\b\d\s])y([ae]+rs*)?\b/i],
			value: ['Day','Day','Week','Week','Month','Month','Year','Year'],
		},
		regexFullMoon = /\bful*\s*mo*n\b/i,
		regexStatic = {
			regex: [/\byesterday\b/i, /\btoday\b/i, /\btomorrow\b/i],
			value: [-1, 0, 1],
		},
		regexDirection = {
			regex: [/\b(prev[iou]*s*|ago|past)\b/i, /\b(this|cur+ent)\b/i, /\b(next|f[ro]+m|after)\b/i],
			value: [-1, 0, 1],
		},
		regexFirstLast = {
			regex: [/\bfirst\w*/i, /\blast\w*/i],
			value: ['first','last'],
		};

	// --- Epic Roam v2 engine swap: delegate the 4 public methods to ViktorDateLib when it's loaded and
	// enabled (ViktorRoamOpts.fuzzyDateV2 !== false, default ON). Lazy per-call so load order doesn't
	// matter; falls back to THIS engine if the lib is absent or the flag is off (instant rollback).
	var _v2 = null;
	function v2() {
		if (_v2) return _v2;
		try { if (typeof window !== 'undefined' && window.ViktorDateLib && (window.ViktorRoamOpts || {}).fuzzyDateV2 !== false) _v2 = window.ViktorDateLib.create(window.ViktorRoamOpts || {}); } catch (e) {}
		return _v2;
	}

	return {
		parse: function (t, d) { var L = v2(); return L ? L.parse(t, d) : parse(t, d); },
		parseFormatDate: function (t, d) { var L = v2(); return L ? L.parseFormatDate(t, d) : parseFormatDate(t, d); },
		addDay: addDay,
		addWeek: addWeek,
		addMonth: addMonth,
		addYear: addYear,
		getDayOfWeek: getDayOfWeek,
		getWeekOfMonth: getWeekOfMonth,
		getDateForWeekOfMonth: getDateForWeekOfMonth,
		getMaxWeekOfMonth: getMaxWeekOfMonth,
		getWeekOfYear: getWeekOfYear,
		getDateForWeekOfYear: getDateForWeekOfYear,
		getMaxWeekOfYear: getMaxWeekOfYear,
		getNewDate: getNewDate,
		dateFormat: function (d, f) { var L = v2(); return L ? L.dateFormat(d, f) : dateFormat(d, f); },
		compareDates: compareDates,
		parseEmbed: function (t) { var L = v2(); return L ? L.parseEmbed(t) : parseEmbed(t); },
		nextFullMoon: nextFullMoon,
		startOfWeek: startOfWeek,
		weekOffset: weekOffset,
		getWeekStart: function(){ return weekStartIdx; },
		aliasConflicts: _conflicts,
	};

	/*
	 * parsing embedded dates, where each date is relative to the previous one: {date3 {date2 {date1}}}
	 * use-case: calculate the date for 
	 *  - Easter this year, `{next sun {fullmoon {March 22 this year}}}`
	 *  - whitsun: `{+49 day {next sun {fullmoon {March 22 this year}}}}`
	 */
	function parseEmbed(text) {
		// parse
		var subs = ViktorRoamLib.parseTxt(text, '{', '{', '{}""`'+'`', 2, /^{{.*}}$|^{\s+/);
		subs.forEach(function(origi){
			var sub = origi;
			var date = null;

			// default Roam data format
			var format = '[[Month Dth, YYYY]]';
			// get format from text eg `#[[Wth week YYYY]]` for `#[[12th week 2020]]`
			if (sub.match(/`([^`]+)`/)) {
				format = sub.match(/`([^`]+)`/)[1];
				sub = sub.replace(/`([^`]+)`/g,'');
			}

			var queue = [];
			while (sub.indexOf('{')>-1) {
				sub = sub.substr(1,sub.length-2); // remove the outer braces
				var match = sub.match(/([^\{\}]*)\s*(\{.*\})\s*([^\{\}]*)/);
				if (match) {
					queue.push(match[1]+match[3]);
					sub = match[2];
				} else {
					queue.push(sub);
				}
			}
			queue.reverse(); // process in reverse order
			queue.forEach(function(part){
				//var tmp = parse(part, date);
				var tmp = part.split(';').reduce(function(ret, val){ return parse(val, ret) }, date);
				if (tmp) date = tmp;
			});

			// if no date was found
			if (!date) {
				return;
			}

			// format date and replace text
			var dateTxt = dateFormat(date, format);
			text = text.replace(origi, dateTxt);
		});
		return text;
	}

	/*
	 * Parsing fuzzy `text` relative to `date`. Returns false if couldn't resolve it.
	 *
	 * static: today, yesterday, tomorrow
	 * unit: day, week, month, year
	 * direction: 
	 *  - past: force the date to be in the past, eg. last, prev(ious), ago
	 *  - future: force the date to be in the future, eg. next, from now
	 *  - present: future date except today, eg. this, current
	 *  - days of week: monday, tuesday, wednesday, thursday, friday, saturday, sunday
	 *  - months: january, february, ...
	 *  - days of month: 1st (day) of January, January 2nd day, first day of January, last day of January
	 *  - weekdays of month: 1st Monday of January
	 *  - weekdays of year: 1st Monday of year
	 */
	function parse(text, date){
		 var ret = {static:'', fullmoon:'', direction:'', unit:'', shadowUnit:'', number:'', day:'', month:'', year:'', firstlast:''};

		 // convert inputs
		 var origi = text;
		 var shadowSubtxt = '';
		 var text = (''+text).toLowerCase();
		 date = getNewDate(date);

		 // bare number = day offset, like `Nd`: `:3:` = 3 days from now, `:0:` = today, `:-1:` = yesterday
		 // (was: fell through to new Date('3') -> March 1st, 2001)
		 var mNum = /^\s*([-\+]?\d{1,3})\s*$/.exec(text);
		 if (mNum) {
		 	return addDay(parseInt(mNum[1], 10), date);
		 }

		 // numeric month-day: `06-01`, `06 11`, `06/11`, `06.11`, `0611` -> this year, or next year if already past
		 // (same semantics as the named-month path: `jul 2` / `may 5`)
		 var mMD = /^\s*(\d{1,2})\s*[-\/\. ]\s*(\d{1,2})\s*$/.exec(text) || /^\s*(\d{2})(\d{2})\s*$/.exec(text);
		 if (mMD) {
		 	var _mo = parseInt(mMD[1], 10), _dy = parseInt(mMD[2], 10);
		 	if (_mo >= 1 && _mo <= 12 && _dy >= 1 && _dy <= 31) {
		 		var mdDate = new Date(date.getFullYear(), _mo-1, _dy);
		 		if (compareDates(mdDate, date) < 0) mdDate = new Date(date.getFullYear()+1, _mo-1, _dy);
		 		return mdDate;
		 	}
		 }

		 // year
		 if (regexYear.exec(text)) {
		 	ret['year'] = parseInt(regexYear.exec(text)[1]);
		 	date.setFullYear(ret['year']);
		 	text = text.replace(new RegExp(regexYear,"gi"),'');
		 }

		 // subdate: next year, prev 2 month, this month, this week, this year, ...
		 if (text.match(regexSubdate) && text.replace(regexSubdate,'') != '') {
		 	var subdates = text.match(regexSubdate);
		 	subdates.reverse(); // resolve subdates backward
		 	subdates.forEach(function(t){
		 		if (regexSubdateNeg.exec(t)) return;

		 		var match = (new RegExp(regexSubdate,'i')).exec(t);
		 		var tmpDate = parse(match[0], date);
			 	if (tmpDate) {
			 		date = tmpDate;
			 		shadowSubtxt = match[0];
			 	}

		 		text = text.replace(t,'');
		 	});
		 }

		 // firstlast: first / last
		 regexFirstLast.regex.forEach(function(r, i){
		 	if (r.exec(text)) {
		 		ret['firstlast'] = regexFirstLast.value[i];
		 		//text = text.replace(new RegExp(r,"gi"),'');
		 	}
		 });

		 // static: yesterday, today, tomorrow
		 regexStatic.regex.forEach(function(r, i){
		 	if (r.exec(text)) {
		 		ret['static'] = addDay(regexStatic.value[i], date);
		 	}
		 });
		 if (ret['static']) {
		 	return ret['static'];
		 }

		 // directionality: forward (default) or backwards
		 regexDirection.regex.forEach(function(r, i){
		 	if (r.exec(text)) {
		 		ret['direction'] = regexDirection.value[i];
		 		text = text.replace(new RegExp(r,"gi"),'');
		 	}
		 });

		 // unit
		 text = text.replace(new RegExp(regexUnitClean, "gi"),'');
		 regexUnit.regex.forEach(function(r, i){
		 	var match = r.exec(text);
		 	if (match) {
		 		ret['unit'] = regexUnit.value[i];
		 		if (match.length > 2) {
		 			ret['number'] = parseInt(match[1].replace(/\s+/g,''));
		 			if (match[2]) {
		 				ret['number']--; // 1st week becomes +0 week, 3rd day beocomes +2 day
		 				if (ret['direction'] === '') ret['direction'] = 1;
		 			}
		 		}
		 		text = text.replace(new RegExp(r,"gi"),'');
		 	}

		 	// check unit for shadowsubtext if set
		 	if (shadowSubtxt && r.exec(shadowSubtxt)) { 
			 	ret['shadowUnit'] = regexUnit.value[i];
		 	}
		 });

		 // number
		 if (regexNumber.exec(text)) {
		 	ret['number'] = parseInt(regexNumber.exec(text)[1].replace(/\s+/g,''));
	 		text = text.replace(new RegExp(regexNumber,"gi"),'');
		 }

		 // full moon
		 if (regexFullMoon.exec(text)) {
		 	ret['fullmoon'] = 'yes';
	 		text = text.replace(new RegExp(regexFullMoon,"gi"),'');
		 }

		 // month
		 regexMonth.forEach(function(r, i){
		 	if (r.exec(text)) {
		 		ret['month'] = i;
		 		text = text.replace(reGlobal(r),'');
		 	}
		 });

		 // day
		 regexDay.forEach(function(r, i){
		 	if (r.exec(text)) {
		 		ret['day'] = i;
		 		text = text.replace(reGlobal(r),'');
		 	}
		 });

		 // add some extra debug info
		 ret['set'] = (Object.keys(ret).map(function(i){return ret[i]!==''?1:0})).reduce(function(a,v){return a+v});
		 ret['txt'] = text;

		 // weekday and month, eg: 1st Monday January
		 if (ret['day'] !== '' && (ret['month'] !== '' || ret['shadowUnit'] == 'Month')) {
		 	var week = (ret['number']||1);
		 	if (ret['firstlast']=='last') week = 10;

		 	var newDate = new Date(date.getFullYear(), ret['month']!==''?ret['month']:date.getMonth(), 1);
		 	newDate = addDay((7-getDayOfWeek(newDate)+ret['day'])%7, newDate);

		 	var monthEnd = new Date(newDate.getFullYear(), (ret['month']!==''?ret['month']:date.getMonth())+1, 0);
		 	var maxWeek = (monthEnd.getTime()-newDate.getTime())/(60*60*24*7*1000);
		 	if (maxWeek%1 == 0) maxWeek++;
		 	maxWeek = Math.min(Math.ceil(maxWeek), week)-1;
		 	newDate = addWeek(maxWeek, newDate);
		 	
		 	if (compareDates(newDate,date)<0 && ret['year'] === '') { // recalculate if the date is in the past
		 		newDate = new Date(date.getFullYear()+1, ret['month']!==''?ret['month']:date.getMonth(), 1);
			 	newDate = addDay((7-getDayOfWeek(newDate)+ret['day'])%7, newDate);

			 	monthEnd = new Date(newDate.getFullYear(), (ret['month']!==''?ret['month']:date.getMonth())+1, 0);
			 	maxWeek = (monthEnd.getTime()-newDate.getTime())/(60*60*24*7*1000);
			 	if (maxWeek%1 == 0) maxWeek++;
			 	maxWeek = Math.min(Math.ceil(maxWeek), week)-1;

			 	newDate = addWeek(maxWeek, newDate);
		 	}

		 	date = newDate;
		 }
		 // week-relative weekday, eg: Friday in 2 weeks, 2 weeks Friday, Friday 2 weeks ago
		 // (week-relative: jump N week-boundaries by the configured week-start, then take that
		 //  week's named weekday — so it CAN land <14 days out. gated on an explicit week unit so
		 //  `3rd Monday` (ordinal of year) and `next 2 monday` (no unit) are untouched.)
		 else if (ret['day'] !== '' && ret['unit'] === 'Week' && ret['number'] !== '') {
		 	var _wrN = ret['number'] * (ret['direction'] === '' ? 1 : ret['direction']);
		 	var _wrTarget = addDay(_wrN * 7, startOfWeek(date));
		 	date = addDay((ret['day'] - weekStartIdx + 7) % 7, _wrTarget);
		 }
		 // day of month eg: jan 2, feb 4, 4th of May
		 else if (!ret['direction'] && ret['number'] !== '' && (ret['month'] !== ''/* || ret['shadowUnit'] == 'Month'*/)) {
		 	var newDate = new Date(date.getFullYear(), ret['month']!==''?ret['month']:date.getMonth(), ret['number']);
		 	if (compareDates(newDate,date)<0 && ret['year'] === '') {
		 		newDate = addYear(1, newDate);
		 	}
		 	date = newDate;
		 }
		 // month and number and direction, eg: 2 last jan, feb, ...
		 else if (ret['direction'] && ret['number'] !== '' && ret['month'] !== '') {
		 	var diff = (12-date.getMonth()+ret['month'])%12+ret['direction']*12*ret['number'];
		 	if (ret['direction'] == 1) diff -= 12;
		 	if (ret['direction'] == 1 && date.getMonth() == ret['month']) diff += 12;
		 	date = addMonth(diff, date);
		 }
		 // number and weekdays with direction, eg: prev/next 2 monday, tuesday, ...
		 else if (ret['number'] !== '' && ret['day'] !== '' && ret['direction']) {
		 	var diff = (7-getDayOfWeek(date)+ret['day'])%7+ret['direction']*7*ret['number'];
		 	if (ret['direction'] == 1) diff -= 7;
		 	if (ret['direction'] == 1 && getDayOfWeek(date) == ret['day']) diff += 7;
		 	date = addDay(diff, date);
		 }
		 // weekdays and year, eg: 4rd Monday, first Tuesday, last Friday
		 else if (ret['day'] !== '' && (ret['number'] !== '' || ret['firstlast'] !== '') ) {
		 	var week = (ret['number']||1);
		 	if (ret['firstlast']=='last') week = 60;

		 	var newDate = new Date(date.getFullYear(), 0, 1);
		 	newDate = addDay((7-getDayOfWeek(newDate)+ret['day'])%7, newDate);

		 	var yearEnd = new Date(newDate.getFullYear()+1, 0, 0);
		 	var maxWeek = (yearEnd.getTime()-newDate.getTime())/(60*60*24*7*1000);
		 	if (maxWeek%1 == 0) maxWeek++;
		 	maxWeek = Math.min(Math.ceil(maxWeek), week)-1;
		 	newDate = addWeek(maxWeek, newDate);
		 	
		 	if (compareDates(newDate,date)<0 && ret['year'] === '') { // recalculate if the date is in the past
		 		newDate = new Date(date.getFullYear()+1, 0, 1);
			 	newDate = addDay((7-getDayOfWeek(newDate)+ret['day'])%7, newDate);

			 	yearEnd = new Date(newDate.getFullYear()+1, 0, 0);
			 	maxWeek = (yearEnd.getTime()-newDate.getTime())/(60*60*24*7*1000);
			 	if (maxWeek%1 == 0) maxWeek++;
			 	maxWeek = Math.min(Math.ceil(maxWeek), week)-1;
			 	newDate = addWeek(maxWeek, newDate);
			}

			date = newDate;
		 }
		 // weekdays, eg: last/this/next monday, tuesday, ...
		 else if (ret['day'] !== '') {
		 	var diff = (7-getDayOfWeek(date)+ret['day']+ret['direction']*7)%7;
		 	if (diff == 0) diff = 7*ret['direction'];
		 	date = addDay(diff, date);
		 }
		 // month and day, eg: jan, last day of feb, first day of March 2024
		 else if (ret['month'] !== ''/* || ret['shadowUnit'] == 'Month'*/) {
		 	var month = ret['month']!==''?ret['month']:date.getMonth();
		 	var day = 1;
		 	if (ret['firstlast'] == 'last') {
		 		month++;
		 		day = 0;
		 	}
		 	var newDate = new Date(date.getFullYear(), month, day);
		 	if (compareDates(newDate,date)<0 && ret['year'] === '') {
		 		newDate = new Date(date.getFullYear()+1, month, day);
		 	}
		 	date = newDate;
		 } 
		 // unit, eg: prev/next X day/week/month/year
		 else if (ret['unit'] !== '') {
		 	var direction = (ret['direction']===''?1:ret['direction']);
		 	var num = ret['number']==='' && ret['firstlast']!=='' ? 0 : (ret['number']==='' ? 1 : ret['number']);
		 	date = eval('add'+ret['unit']+'('+(direction*num)+', "'+date.toISOString()+'")');
		 	// correct day if direction is set
		 	if (ret['direction'] !== '' && ret['firstlast']==='') {
		 		if (ret['unit'] === 'Week') date = addDay((ret['firstlast']==='last'?6:0)-weekOffset(date), date);
		 		if (ret['unit'] === 'Month') date = new Date(date.getFullYear(), date.getMonth()+(ret['firstlast']==='last'?1:0), (ret['firstlast']==='last'?0:1));
		 		if (ret['unit'] === 'Year') date = new Date(date.getFullYear()+(ret['firstlast']==='last'?1:0), 0, (ret['firstlast']==='last'?0:1));
		 	}
		 	// correct day if first/last is set
		 	else if (ret['firstlast']!=='') {
		 		if (ret['unit'] === 'Day') {
		 			if (ret['shadowUnit'] === 'Week')
		 				date = addDay((ret['firstlast']==='last'?6:0)-weekOffset(date), date);
		 			else if (ret['shadowUnit'] == 'Year') 
		 				date = new Date(date.getFullYear()+(ret['firstlast']==='last'?1:0), 0, (ret['firstlast']==='last'?0:1));
		 			else // month is default
		 				date = new Date(date.getFullYear(), date.getMonth()+(ret['firstlast']==='last'?1:0), (ret['firstlast']==='last'?0:1));
		 		} else if (ret['unit'] === 'Week') {
	 				if (ret['shadowUnit'] == 'Year') 
	 					date = getDateForWeekOfYear(date, ret['firstlast']==='last'?getMaxWeekOfYear(date):1);
	 				else // month is default
	 					date = getDateForWeekOfMonth(date, ret['firstlast']==='last'?getMaxWeekOfMonth(date):1);
		 		} else if (ret['unit'] === 'Month') {
		 			date = new Date(date.getFullYear(), date.getMonth()+(ret['firstlast']==='last'?1:0), 0, ret['firstlast']==='last'?0:1);
				}
			}
			// fix week
		 	if (ret['direction'] !== '' && ret['unit'] === 'Week') date = addDay(-weekOffset(date), date);
		 }
		 // check next full moon
		 else if (ret['fullmoon'] !== '') {
		 	date = nextFullMoon(date);
		 	//var direction = ret['direction']||1;
		 }
		 // fallback try to parse text
		 else if (compareDates(date, getNewDate(origi.trim())) != 0) {
		 	date = getNewDate(origi.trim());
		 }
		 // return original if no lookup was possible
		 else {
		 	return false;
		 }

		return date;
	}

	// parse and format date
	function parseFormatDate(text, date) {
		// default Roam data format
		var format = '[[Month Dth, YYYY]]';
		// get format from text eg `#[[Wth week YYYY]]` for `#[[12th week 2020]]`
		if (text.match(/`([^`]+)`/)) {
			format = text.match(/`([^`]+)`/)[1];
			text = text.replace(/`([^`]+)`/g,'');
		}

		// parse for date
		var d = text.split(';').reduce(function(ret, val){ return parse(val, ret) }, date)
		//var d = parse(text, date);
		if (d) {
			return dateFormat(d, format);
		} else {
			return false;
		}
	}

	// add `days` days to date
	function addDay(days, date) {
		date = getNewDate(date);

		date.setDate(date.getDate()+days);
		return date;
	}

	// add `weeks` weeks to date
	function addWeek(weeks, date) {
		return addDay(weeks*7, date);
	}

	// add `months` months to date
	function addMonth(months, date) {
		date = getNewDate(date);

		date.setMonth(date.getMonth()+months);
		return date;
	}

	// add `years` years to date
	function addYear(years, date) {
		date = getNewDate(date);

		date.setFullYear(date.getFullYear()+years);
		return date;
	}

	// get day of week: 0 - Monday, 6 - Sunday
	function getDayOfWeek(date) {
		date = getNewDate(date);
		return (date.getDay()+6)%7;	// week begins with monday
	}

	// return Ceil + 1 for integers, otherwise the Ceil
	function upperCeil(num) {
		return Math.ceil(num%1 === 0 ? num+1 : num);
	}

	// get week for the month of `date`, first week is 1
	function getWeekOfMonth(date) {
		date = getNewDate(date);
		// get first Monday of the month
		var week1 = new Date(date.getFullYear(), date.getMonth(), 1);
		week1 = addDay(-getDayOfWeek(week1), week1);
		// calculate difference in weeks
		var diff = (date.getTime()-week1.getTime())/(60*60*24*7*1000);
		return upperCeil(diff);
	}

	// get `week`th week for the month of `date`, 1st week is 1, returns Monday
	function getDateForWeekOfMonth(date, week) {
		date = getNewDate(date);
		week = Math.min(getMaxWeekOfMonth(date), week);
		// get first Monday of the month
		var week1 = new Date(date.getFullYear(), date.getMonth(), 1);
		week1 = addDay(-getDayOfWeek(week1), week1);
		// add `week - 1` weeks, since for 1st week we don't add week
		week1 = addWeek(week-1, week1);
		return week1;
	}

	// get the maximum number of weeks in the given month
	function getMaxWeekOfMonth(date) {
		date = getNewDate(date);
		// last day of month
		var lastDay = new Date(date.getFullYear(), date.getMonth()+1, 0);
		return getWeekOfMonth(lastDay);
	}

	// week number of the year: https://en.wikipedia.org/wiki/ISO_week_date
	function getWeekOfYear(date) {
		date = getNewDate(date);

		// if last Monday of year is >= 12-29 and date is after that then dates belong to next year's first week
		var lastMonday = new Date(date.getFullYear()+1, 0, 1, 12, 0);
		lastMonday = addDay(-getDayOfWeek(lastMonday), lastMonday);
		if (compareDates(lastMonday, new Date(date.getFullYear(), 11, 29, 12, 0)) >= 0 && compareDates(date, lastMonday) >= 0)
			return 1;

		// first week of year: this Monday till Thursday, otherwise next monday
		var week1 = new Date(date.getFullYear(), 0, 1, 12, 0);
		if (getDayOfWeek(week1) <= 3)
			week1 = addDay(-getDayOfWeek(week1), week1);
		else
			week1 = addDay(7-getDayOfWeek(week1), week1);

		// calculate the difference in weeks
		var diff = (date.getTime()-week1.getTime())/(60*60*24*7*1000);
		if (diff < 0) // if diff is negative it means we have to return last year's week number
			return getWeekOfYear(new Date(date.getFullYear(), 0, 0, 12, 0));
		else
			return upperCeil(diff);
	}

	// get `week`th week for the year of `date`, 1st week is 1, returns Monday
	function getDateForWeekOfYear(date, week) {
		date = getNewDate(date);
		week = Math.min(getMaxWeekOfYear(date), week);
		
		// first week of year: this Monday till Thursday, otherwise next monday
		var week1 = new Date(date.getFullYear(), 0, 1, 12, 0);
		if (getDayOfWeek(week1) <= 3)
			week1 = addDay(-getDayOfWeek(week1), week1);
		else
			week1 = addDay(7-getDayOfWeek(week1), week1);
		
		// add `week - 1` weeks, since for 1st week we don't add week
		week1 = addWeek(week-1, week1);
		return week1;
	}

	// get biggest week number in year
	function getMaxWeekOfYear(date) {
		date = getNewDate(date);
		var lastDay = new Date(date.getFullYear()+1, 0, 0);
		return getWeekOfYear(lastDay);
	}

	// parse new date, falls back to today
	function getNewDate(date) {
		var date = date || undefined; // needed because of null creates a valid date
		
		date = new Date(date);
		
		// check if the date is invalid
		if (isNaN(date.valueOf())) {
			date = new Date();
		}
		
		return date;
	}

	// formats dates
	/*
	 * dY - delta years between date and today
	 * dM - delta month between date and today
	 * dW - delta week between date and today
	 * dD - delta day between date and today
	 * YYYY - year, 2020
	 * YY - year, 20
	 * Month - month, January
	 * Mon - month, Jan
	 * MM - month, 01
	 * M - month 1
	 * DD - day, 07
	 * D - day, 7
	 * th - after any number: 5th
	 * (s) - plural form decoder: day(s)
	 * WW - week of year, 09
	 * W - week of year, 9
	 * EEE - day of week, Tuesday
	 * EE - day of week, Tue
	 * E - day of week 1-7
	*/
	function dateFormat(date, format){
		var text = format || '[[Month Dth, YYYY]]'; // default format
		var date = getNewDate(date);
			date.setHours(12,0,0,0);
		var today = getNewDate();
			today.setHours(12,0,0,0);

		// dD
		text = text.replace(/dD/g, function(){
			return Math.floor(Math.abs(date.getTime()-today.getTime())/1000/60/60/24);
		});

		// dW
		text = text.replace(/dW/g, function(){
			return Math.floor(Math.abs(date.getTime()-today.getTime())/1000/60/60/24/7);
		});

		// dM
		text = text.replace(/dM/g, function(){
			var d1 = getNewDate(compareDates(date, today) > 0 ? date : today);
			var d2 = getNewDate(compareDates(date, today) > 0 ? today : date);
			return (d1.getFullYear()-d2.getFullYear())*12+d1.getMonth()-d2.getMonth()+(d1.getDate()>=d2.getDate()?1:0)-1;
		});

		// dY
		text = text.replace(/dY/g, function(){
			var d1 = getNewDate(compareDates(date, today) > 0 ? date : today);
			var d2 = getNewDate(compareDates(date, today) > 0 ? today : date);
			var ret = (d1.getFullYear()-d2.getFullYear())-1;
			d2.setFullYear(d1.getFullYear());
			return ret + (compareDates(d1,d2) >= 0 ? 1 : 0);
			//return Math.floor(Math.abs(date.getTime()-today.getTime())/1000/60/60/24/365);
		});

		// YYYY
		text = text.replace(/YYYY/g, function(){
			return date.getFullYear();
		});

		// YY
		text = text.replace(/YY/g, function(){
			return date.getFullYear().toString().substr(-2);
		});

		// Month
		text = text.replace(/Month/g, function(){
			return months[ date.getMonth() ];
		});

		// Mon
		text = text.replace(/Mon/g, function(){
			return monthsShort[ date.getMonth() ];
		});

		// MM
		text = text.replace(/MM/g, function(){
			var month = date.getMonth() + 1;
			return month < 10 ? '0'+month : month;
		});

		// M
		text = text.replace(/M(?![ao])/g, function(){
			return date.getMonth() + 1;
		});

		// DD
		text = text.replace(/DD/g, function(){
			var day = date.getDate();
			return day < 10 ? '0'+day : day;
		});

		// D
		text = text.replace(/D(?!e)/g, function(){
			return date.getDate();
		});

		// WW
		text = text.replace(/WW/g, function(){
			var week = getWeekOfYear(date);
			return week < 10 ? '0'+week : week;
		});

		// W
		text = text.replace(/W(?!e)/g, function(){
			return getWeekOfYear(date);
		});

		// EEE
		text = text.replace(/EEE/g, function(){
			return days[getDayOfWeek(date)];
		});

		// EE
		text = text.replace(/EE/g, function(){
			return daysShort[getDayOfWeek(date)];
		});

		// E
		text = text.replace(/E/g, function(){
			return getDayOfWeek(date)+1;
		});

		// th
		text = text.replace(/(\d+)\s*(th|st|nd|rd)/g, function(_,number){
			var str = number.substr(-2);
			var suffix;
			switch (str.substr(-1)) {
				case '1':
					suffix = 'st';
					break;
				case '2':
					suffix = 'nd';
					break;
				case '3':
					suffix = 'rd';
					break;
				default:
					suffix = 'th';
			}
			// th for all `1X` numbers
			if (str.length > 1 && str[0] == 1) {
				suffix = 'th';
			}
			return number+suffix;
		});

		// (s)
		text = text.replace(/([\s\d\.\,]+)([\w\s]+\(s\))/g, function(_, _n, _w){
			_w = parseFloat(_n.replace(/[\s,]/g,'')) > 1 ? _w.replace('(s)','s') : _w.replace('(s)','');
			return _n+_w;
		});

		return text;

		//return '[['+months[date.getMonth()]+' '+date.getDate()+suffix+', '+date.getFullYear()+']]';
	}

	// based on is fullmoon, h/t: https://gist.github.com/endel/dfe6bb2fbe679781948c
	function nextFullMoon(date) {
		var date = getNewDate(date);
		var year = date.getFullYear();
		var month = date.getMonth()+1;
		var day = date.getDate();

	    var c = e = jd = b = 0;

	    if (month < 3) {
	        year--;
	        month += 12;
	    }

	    ++month;
	    c = 365.25 * year;
	    e = 30.6 * month;
	    jd = c + e + day - 694039.09; //jd is total days elapsed
	    jd /= 29.5305882; //divide by the moon cycle
	    jd += 0.5; // align to full moon
	    jd %= 1; //subtract integer part to leave fractional part of original jd
	    jd = (1-jd)*29.5305882+1; // date needed for next full moon

	    return new Date(date.getTime()+jd*24*60*60*1000);
	}

	// compares two dates
	function compareDates(date1,date2) {
		date1 = getNewDate(date1).toISOString().substr(0,10);
		date2 = getNewDate(date2).toISOString().substr(0,10);

		if (date1 < date2) return -1;
		if (date1 > date2) return 1;
		return 0;
	}

	// --- localization + week-start helpers (added for Epic Roam) ---

	// strip diacritics + lowercase so `hétfő` / `Hetfo` / `HÉTFŐ` all match
	function normToken(s){ return ('' + s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
	// both forms of a token: lowercased-with-accents AND diacritic-stripped (so the matcher hits
	// `péntek` typed with accents AND `pentek` typed without)
	function tokenVariants(s){ var lo = ('' + s).toLowerCase(), st = normToken(s); return st === lo ? [lo] : [lo, st]; }
	// a global-flag clone that PRESERVES the regex's own flags (esp. 'u' for \p{L} matchers) — unlike
	// `new RegExp(r,"gi")`, which silently drops 'u' and turns \p{L} into a literal.
	function reGlobal(r){ return new RegExp(r.source, r.flags.indexOf('g') >= 0 ? r.flags : r.flags + 'g'); }

	// resolve a week-start setting to an internal index: 0=Monday .. 6=Sunday.
	// 'auto'/unset => Intl locale firstDay, else ISO Monday. Accepts a number (0=Mon) or a day name.
	function resolveWeekStart(ws){
		if (ws == null || ws === '') return 0; // default: stable ISO Monday (NOT locale-dependent)
		if (ws === 'auto') {
			try {
				if (typeof Intl !== 'undefined' && Intl.Locale && typeof navigator !== 'undefined') {
					var loc = new Intl.Locale(navigator.language || 'en');
					var wi = typeof loc.getWeekInfo === 'function' ? loc.getWeekInfo() : loc.weekInfo;
					if (wi && wi.firstDay) return (wi.firstDay - 1) % 7; // Intl 1=Mon..7=Sun -> 0=Mon..6=Sun
				}
			} catch (e) {}
			return 0; // fall back to ISO Monday
		}
		if (typeof ws === 'number') return ((Math.round(ws) % 7) + 7) % 7; // 0=Monday
		var map = {monday:0,mon:0,tuesday:1,tue:1,wednesday:2,wed:2,thursday:3,thu:3,friday:4,fri:4,saturday:5,sat:5,sunday:6,sun:6};
		var k = normToken(ws);
		return map[k] != null ? map[k] : 0;
	}

	// position of `date` within its week relative to the configured week-start (0..6)
	function weekOffset(date){ return (getDayOfWeek(date) - weekStartIdx + 7) % 7; }
	// the configured week-start day on or before `date`
	function startOfWeek(date){ return addDay(-weekOffset(date), date); }

	// Build per-index matcher regexes from localized names (+short) (+user aliases), detecting conflicts
	// at registration time. Returns the supplied English prefix matchers UNCHANGED when no localization
	// config is present (so default-English behavior is byte-for-byte identical / golden-safe).
	function buildMatchers(kind, names, shortNames, enNames, defaults){
		var aliases = O.dateAliases || O.dateAliasMap || null;
		var hasL10n = O.nameMonths || O.nameMonthsShort || O.nameDays || O.nameDaysShort || aliases;
		if (!hasL10n) return defaults;

		var idxOf = {};
		enNames.forEach(function(n, i){ idxOf[normToken(n)] = i; });

		// localized full + short names per index (both accented + diacritic-stripped forms)
		var toks = enNames.map(function(_, i){
			var t = [];
			[names[i], shortNames[i]].filter(Boolean).forEach(function(n){ t.push.apply(t, tokenVariants(n)); });
			return Array.from(new Set(t));
		});

		// fold in user aliases, flagging conflicts (precedence: built-in tokens > aliases; longest-match wins)
		if (aliases) Object.keys(aliases).forEach(function(rawAlias){
			var a = normToken(rawAlias);
			var targetIdx = idxOf[normToken(aliases[rawAlias])];
			if (targetIdx == null || !a) return; // alias targets the OTHER kind (day vs month) -> skip silently
			if (a.length < 2 && !O.aliasAllowSingleChar) {
				_conflicts.push({ kind: kind, alias: rawAlias, reason: 'single-char alias ignored (set ViktorRoamOpts.aliasAllowSingleChar=true to allow)' });
				return;
			}
			for (var i = 0; i < toks.length; i++) if (i !== targetIdx && toks[i].indexOf(a) >= 0)
				_conflicts.push({ kind: kind, alias: rawAlias, reason: 'collides with built-in "' + enNames[i] + '"' });
			tokenVariants(rawAlias).forEach(function(v){ toks[targetIdx].push(v); });
		});

		// one regex per index: longest token first; >=3 chars match as a prefix, shorter match exactly.
		// Unicode-letter boundaries (not \b) so accent-initial words like `április` match; 'u' flag required.
		return toks.map(function(list){
			var parts = Array.from(new Set(list)).sort(function(a, b){ return b.length - a.length; }).map(function(t){
				var esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
				return t.length >= 3 ? esc + '[\\p{L}\\p{N}_]*' : esc;
			});
			return new RegExp('(?<![\\p{L}\\p{N}_])(?:' + parts.join('|') + ')(?![\\p{L}\\p{N}_])', 'iu');
		});
	}

	if (_conflicts.length && typeof console !== 'undefined') console.warn('ViktorFuzzyDate alias conflicts:', _conflicts);
})();


/* 
 * ViktorRoamLib: finding and exporting data using roamAlphaAPI
 * author: @ViktorTabori
 */
window.ViktorRoamLib = /*window.ViktorRoamLib ||*/ (function(){
	var clipboard;

	return {
		findPageId: findPageId,
		exportNode: exportNode,
		getCursor: getCursor,
		toRoamData: toRoamData,
		toHTML: toHTML,
		toText: toText,
		getClipboardFormat: getClipboardFormat,
		getRandomNode: getRandomNode,
		parseTxt: parseTxt,
	};

	/** 
	 * parse embedded structure in plain text
	 * eg. parseTxt(text, '{', '{', '{}""`'+'`', 2, /^{{.*}}$|^{\s+/)
	 *
	 * @param	{string}	txt			input string we parse
	 * @param	{string}	start		looking for this string as a start for a new structure, eg `{` for structures like `{name}`
	 * @param	{string}	queue		characters which are opened, eg `{`
	 * @param	{string}	chrs		opening-closing characters
	 * @param	{int}		maxdepth	how long the queue can be
	 * @param	{RegExp}	exclude		matching results get excluded
	 * @param	{string}	before		string we want to match before the current structure (eg. white spaces): "\\s*"
	 * @param	{string}	after		string we want to match after the current structure (eg. white spaces): "\\s*"
	 *
	 * @return	{array}		non-overlapping strings parsed left to right
	*/
	function parseTxt(txt, start, queue, chrs, maxdepth, exclude, before, after) {
		var start = start && typeof start == 'string' && new RegExp(start,"i") || typeof start == 'object' && start instanceof RegExp  && start || null;
		if (!start) return;

		var exclude = exclude && typeof exclude == 'string' && new RegExp(exclude,"i") || typeof exclude == 'object' && exclude instanceof RegExp  && exclude || null;
		var open = {}, close = {};
		var chrs = (chrs||'').split('');
		chrs.forEach(function(_, j){
			if (j%2 == 0 && j!==chrs.length-1) {
				open[chrs[j]] = chrs[j+1];
				close[chrs[j+1]] = chrs[j];
			}
		});
		var maxdepth = Number.isInteger(maxdepth) && maxdepth >= 0 && maxdepth || 2;
		var queue = queue || '';

		var i = 0;
		var ret = [];

		while (i<txt.length && start.test(txt.substr(i))) {
			var m = start.exec(txt.substr(i));
			var q = queue;
			if (!q && open[m[0][0]]) q+= m[0][0];
			else if (!q && open[m[0].substr(-1)]) q+= m[0].substr(-1);
			i += m.index;
			for (var j=i+m[0].length; j<txt.length; j++) {
				// backspace is a skip character
				if (txt[j] == '\\') {
					j++;
					continue;
				}
				// if character is closing we close down
				if (q.length && close[txt[j]] == q.substr(-1)) {
					q = q.substr(0, q.length-1);
					if (q.length == 0) break;
					continue;
				}
				// if we open up
				if (open[txt[j]] && (q.indexOf(txt[j])==-1 || q.substr(-1) == txt[j]) && [...new Set((q+txt[j]).split(''))].length <= maxdepth) {
					q += txt[j];
					continue;
				}
			}

			// if we found one
			if (q == '' && (!exclude || !exclude.test(txt.substr(i,j+1-i)))) {
				if (before) {
					var m = (new RegExp(before+"$","i")).exec(txt.substr(0,i));
					if (m) i -= m[0].length;
				}
				if (after) {
					var m = (new RegExp("^"+after,"i")).exec(txt.substr(j+1));
					if (m) j += m[0].length;
				}
				ret.push(txt.substr(i,j+1-i));
				i = j+1;
			} else {
				i++;
			}
		}

		return ret;
	}

	async function getClipboardFormat(id, args) {
		clipboard = null; // nullify clipboard
		var node = await exportNode(id, args);

		var ret =  {
			'text/plain': toText(node),
			'text/html': toHTML(node),
			'roam/data': toRoamData(node),
			'cursor': getCursor(node),
		}
		//console.log(JSON.stringify(JSON.parse(ret['roam/data']), null, 4));
		if (typeof ViktorRoamOpts !== 'undefined' && !ViktorRoamOpts.pasteRoamData) {
			delete ret['roam/data'];
		}
		return ret;
	}

	// find id for a page, search within folders, eg: "day", ["template","[[template]]",""] looks for `template/day`, `[[template]]/day`, and `day` pages
	function findPageId(name, folders) {
		if (!window.roamAlphaAPI || !window.roamAlphaAPI.q || !window.roamAlphaAPI.pull) return; // no api endpoint


		if (typeof folders == 'string') {
			folders = [].concat(folders);
		} else if (!Array.isArray(folders) || folders.length == 0) {
			folders = [''];
		}


		// make sure folders ends with / and doesn't start with /
		folders = folders.map(function(v){return v.replace(/\/+$/g,'').concat('/').replace(/^\/+/,'')});

		for (var i=0; i<folders.length; i++) {
			var id = window.roamAlphaAPI.q("[:find ?e :in $ ?a :where [?e :node/title ?a]]", folders[i]+name);
			if (id.length > 0) {
				return id[0][0];
			}
		}

		return; // not found
	}

	// get random node which is not a daily node
	// match: /^Note:/i, "^E:", `test`i
	// don't match: !/^Note:/i
	function getRandomNode() {
		var ret;
		if (arguments.length > 0) {
			var arg = arguments[0];
			var args = parseTxt(arg, /["\/`]/, '', '""//`'+'`', 1, null, '!', '\\w+').map(function(v){
				arg = arg.replace(v,'');
				var m = v.match(/(!?)(["\/`])(.*)(?:["\/`])(\w*)$/);
				if (m) {
					if (!m[3].replace(/\s+/g,'')) return;
					return {poz: !m[1], regexp: new RegExp(m[3].trim().replace(/\\/g,'\\\\'), m[4]?m[4]:(m[2]=='"'?'':'i'))}; // for everything except " we add case insensitivity
				}
			}).filter(function(v){ return v });
			arg = arg.replace(/(\s*;\s*)+/g,';').replace(/^;|;$/g,'').split(';').forEach(function(v){
				if (!v.replace(/\s+/g,'')) return;
				args.push({poz:true, regexp:new RegExp(v.trim().replace(/\\/g,'\\\\'),"i")});
			});

			console.log(args);

			ret = roamAlphaAPI.q('[:find (rand 1 ?title) :in $ ?a :where [?e :node/title ?title] [(?a ?title)]]',function(title){ 
				return args.reduce(function(ret,val){
					var ok = val.regexp.test(title);
					if (!val.poz) ok = !ok;
					return ret && ok;
				}, true);
			});
		} else {
			ret = roamAlphaAPI.q('[:find (rand 1 ?title) :where [?e :node/title ?title] (not [?e :log/id _])]');
		}
		if (ret.length > 0 && ret[0].length > 0) {
			return '[['+ ret[0][0] +']]';
		} else {
			return '';
		}
	}

	// return node id for block id
	function findNodeIdByBlockUid(blockUid) {
		if (!window.roamAlphaAPI || !window.roamAlphaAPI.q || !window.roamAlphaAPI.pull) return; // no api endpoint

		var id = window.roamAlphaAPI.q("[:find ?e :in $ ?a :where [?e :block/uid ?a]]", blockUid);
		if (id.length > 0) {
			return id[0][0];
		}

		return; // not found
	}

	async function exportNode(id, args, path, stop) {
		if (!window.roamAlphaAPI || !window.roamAlphaAPI.q || !window.roamAlphaAPI.pull) return; // no api endpoint

		var args = Object.assign({}, args);
		var data = window.roamAlphaAPI.pull("[* {:block/children [:db/id :block/order]}]",id);
		if (Array.isArray(data[':block/children'])) data[':block/children'].sort(sortByBlockOrder);
		var path = path || [];
		var newPath = path.concat(id);

		// if resolving marked embeds and block references, and this node was already resolved, we quit the loop
		var resolve = inArray(path, 'resolve');
		if (resolve && inArray(path, id)) {
			data[':block/string'] = 'LOOP: '.concat(data[':block/string'] || '');
			return {':db/id':id, ':block/uid':data[':block/uid'], ':block/string':data[':block/string'], 'stopped':true};
		}

		// resolve text features
		if (':block/string' in data) {
			// resolve marked block embeds and references: !{{embed: ((block uid))}} and !((block uid))
			var regexEmbed = resolve ? /!?{{[\[\s]*embed[\]\s]*:\s*[\(\[]{2}([^\)\]]+)[\)\]]{2}\s*}}/ig : /!{{[\[\s]*embed[\]\s]*:\s*[\(\[]{2}([^\)\]]+)[\)\]]{2}\s*}}/ig;
			data[':block/string'] = await replaceAsync(data[':block/string'], regexEmbed, async function(_, v){ 
				var uid = v.trim();
				var nid = findNodeIdByBlockUid(uid) || findPageId(uid);
				if (typeof nid == 'undefined') {
					return _;
				}
				if (!resolve) {
					resolve = 'resolve';
					newPath = newPath.concat('resolve');	
				}
				// stop=true, we don't resolve the children yet
				var block = await exportNode(nid, args, newPath, true);	

				// append its children to the data we have
				if (block[':block/children'] && block[':block/children'].length > 0) { 
					data[':block/children'] = (data[':block/children'] || []).concat(block[':block/children']);
				}
				// replace by either the node title or block text
				return block[':block/string'] || block[':node/title'] || '';
			});

			// resolve marked references: !((block uid))
			var regexReference = resolve ? /!?\({2}([^\)]+)\){2}/ig : /!\({2}([^\)]+)\){2}/ig;
			data[':block/string'] = await replaceAsync(data[':block/string'], regexReference, async function(_, v){ 
				var uid = v.trim();
				var nid = findNodeIdByBlockUid(uid);
				if (typeof nid == 'undefined') {
					return _;
				}
				if (!resolve) {
					resolve = 'resolve';
					newPath = newPath.concat('resolve');	
				}
				// stop=true, we don't query the children
				var block = await exportNode(nid, args, newPath, true);	

				return block[':block/string'] || block[':node/title'] || '';
			});

			// if arg is not set get default values, eg. $1=`today`
			data[':block/string'] = data[':block/string'].replace(/\s*\$(\d+)\s*=\s*`([^`]*)`/g, function(_, i, arg){
				i = parseInt(i)-1;
				args[i] = args[i] || arg;
				return '';
			});
			// resolve parameters: $1 is the first parameter, $2 is the second, ...
			for (i in args) {
				data[':block/string'] = data[':block/string'].replace(new RegExp('\\$'+(parseInt(i)+1)+'\\b','g'), args[i]);
			}
			// remove unspecified parameters, eg. $43
			data[':block/string'] = data[':block/string'].replace(/\$\d+/g, '');

			// replace $clipboard with clipboard content
			if (/\$clipboard/i.test(data[':block/string'])) {
				if (typeof clipboard !== 'string') {
					try {
						clipboard = await navigator.clipboard.readText();
					} catch (e) {
						clipboard = '';
					}
				}
				var clipboardUrl = /^http/i.test(clipboard) && clipboard || '';
				var clipboardUrlDomain = (/^https?:\/\/([^\/]+)/i.exec(clipboardUrl)||['',''])[1].replace(/^www\./i,'');
				var clipboardTxt = clipboardUrl != '' ? '' : clipboard;
				data[':block/string'] = data[':block/string']
											.replace(/\$clipboardUrlDomain/gi, clipboardUrlDomain)
											.replace(/\$clipboardUrl/gi, clipboardUrl)
											.replace(/\$clipboardTxt/gi, clipboardTxt)
											.replace(/\$clipboard/gi, clipboard);
			}

			// get random node {random; regexp1; regexp2; ...}
			var rands = parseTxt(data[':block/string'], '{rand(om)?\\W', '{', '{}""`'+'`//', 2, /^{{.*}}$/);
			rands.forEach(function(rand){
				data[':block/string'] = data[':block/string'].replace(rand, function(_, args){ 
					return getRandomNode((rand.match(/^{rand(?:om)?\b(.*)}$/i)||['',''])[1]);
				});
			});

			// resolve dates after embeds are resolved
			if (typeof ViktorFuzzyDate != 'undefined' && ViktorRoamOpts.resolveDateTemplate && !stop) {
				data[':block/string'] = ViktorFuzzyDate.parseEmbed(data[':block/string']);
			}

			// resolve javascript(), js(), and javascript blocks
			var jss = 
				parseTxt(data[':block/string'], /\b(javascript|js)\(/i, '(', '()""\'\'`'+'`', 2) // js() form
				.concat( data[':block/string'].match(/`{3}javascript[\s\S]*?`{3}/ig) )	// javascript block form
				.filter( e => e );
			for (var i=0; i<jss.length; i++) {
				var replace;
				try {
					replace = jss[i] // parse js
						.replace(/^`{3}\s*javascript\s*|\s*`{3}$/gi, '')
						.replace(/(?:javascript|js)\(([\s\S]*)\)$/i, '$1');
					replace = (!replace.match(/return/i) && !replace.match(/\n/i) ? 'return ' : '')+replace; // add return if single line and didn't have return
					replace = '(async()=>{ '+replace+' })()'; // wrap in async function
					replace = await eval(replace);
				} catch (e) {
					replace = '`JS ERROR: '+e+'`';
				} finally {
					data[':block/string'] = data[':block/string'].replace(jss[i], replace);
				}
			}

			// resolve jsvar() which gives back a js variable if exists
			var jss = 
				parseTxt(data[':block/string'], /\b(javascript|js)var\(/i, '(', '()""\'\'`'+'`', 2) // js() form
				.filter( e => e );
			for (var i=0; i<jss.length; i++) {
				var replace;
				try {
					replace = jss[i] // parse js
						.replace(/(?:javascript|js)var\(([\s\S]*)\)$/i, '$1');
					replace = await eval(replace);
				} catch (e) {
					replace = '';
				} finally {
					data[':block/string'] = data[':block/string'].replace(jss[i], replace);
				}
			}

			
		}

		// for stop don't query the children and version control
		if (!stop) {
			// version control original node block is not marked: use API to see whether it is version controled
			if (!data[':vc/blocks']) {
				var _id = window.roamAlphaAPI.q("[:find ?e :in $ ?a :where [?e :vc/blocks ?a]]", id);
				if (_id.length && !inArray(path,_id[0][0])) {  // for this node id if already resolved we we don't resolve hidden version nodes again
					data[':vc/_blocks'] = [ await exportNode(_id[0][0], args, newPath) ];
				}
			}

			// process explicite version control blocks
			data[':vc/blocks'] = await processChildProperty(data[':vc/blocks']);

			// process children
			data[':block/children'] = await processChildProperty(data[':block/children']);
		}


		// should we ignore the node?
		if (':block/string' in data && 'ignoreNodes' in ViktorRoamOpts && Array.isArray(ViktorRoamOpts['ignoreNodes'])) {
			for (var i=0; i<ViktorRoamOpts['ignoreNodes'].length; i++) {
				if (data[':block/string'].match(ViktorRoamOpts['ignoreNodes'][i])) {
					return {':db/id':id, ':block/uid':data[':block/uid'], 'remove':true};
				}
			}
		}

		// return
		return data;

		/* helper functions */
		// async replace
		async function replaceAsync(str, regex, asyncFn) {
		    const promises = [];
		    str.replace(regex, (match, ...args) => {
		        const promise = asyncFn(match, ...args);
		        promises.push(promise);
		    });
		    const data = await Promise.all(promises);
		    return str.replace(regex, () => data.shift());
		}

		// process child containing properties
		async function processChildProperty(node) {
			if (!Array.isArray(node)) return;

			// process children
			for (var i=0; i<node.length; i++) {
				node[i] = await exportNode(node[i][':db/id'], args, newPath);
			}
			// delete nodes which should be removed
			node = node.filter(function(v){return !v['remove']});

			/// sort children added at the query level
			//node.sort(sortByBlockOrder);

			// return
			return node;
		}

		// sort function by block order property
		function sortByBlockOrder(a, b) {
			return a[':block/order'] - b[':block/order']
		}

		// find v value in a array
		function inArray(a, v) {
			return a.find(function(i){return i==v})
		}
	}

	// get cursor position for template
	function getCursor(node, line) {
		var line = line || 0;
		var ret = {line: null, position: null, counter: line};

		// look for $cursor
		if (/\$cursor/i.test(node[':block/string'])) {
			node[':block/string'].replace(/\$cursor/gi, function(_m, _p, _all){
				var sub = _all.substr(0,_p).replace(/\$cursor/gi,'');
				ret.line = line;
				ret.position = sub.length;
				return '';
			});
		}

		// check children
		if (Array.isArray(node[':block/children'])) {
			node[':block/children'].forEach(e=>{
				var res = getCursor(e, line+1);
				if (res.position !== null) ret = res;
				if (res.counter !== null) line = res.counter;
			});
		}

		// counting lines in counter
		ret.counter = line;
		return ret;
	}

	// format nodes to `roam/data` format
	function toRoamData(nodes) {
		var keys = [':db-id', ':type', ':copied-data', ':block/string', ':children/view-type', ':create/email', ':create/time', ':block/heading', ':block/children', ':block/uid', ':block/open', ':edit/time', ':edit/email', ':block/order', ':block/text-align', ':vc/_blocks', ':vc/blocks'];
		var escChars = /[\^~`]/; // these chars have to be escaped as starting :block/string characters
		var cache = {};
		var cacheCode = 48; // start caching from 0 character
		var dbName = (document.location.hash.match(/#\/app\/([^\/]+)/)||['',''])[1];

		return JSON.stringify(parse({":db-id":dbName, ":type":":copy", ":copied-data":typeof nodes[':block/string']!='undefined' ? nodes : nodes[':block/children']}));

		// parse node structure to roam/data
		function parse(node) {
			// how deep we are
			var ret = [];
			var last = '';

			// start
			ret.push("^ ");

			keys.forEach(function(key){
				if (typeof node[key] == 'undefined') return;

				// push key
				ret.push(GetCache(key));

				// push single value
				if (!Array.isArray(node[key])) {
					ret.push( GetCache(node[key]) );
				} else {
				// process children
					ret.push( node[key].map(function(v){ return parse(v) }) );
				}
			});

			return ret;

			// cache helper
			function GetCache(str) {
				var ret;
				if (typeof str != 'string' || !str.match(/^[:`]/) || last == cache[":block/string"] || last == "~:block/string") {
					ret = str;
					if ((last == cache[":block/string"] || last == "~:block/string") && str[0] && str[0].match(escChars)) ret = '~'+ret; // for block strings starting with `^` need `~`
				} else if (cache[str]) {
					ret = cache[str];
				} else {
					cache[str] = '^'+String.fromCharCode(cacheCode++);
					ret = '~'+str;
				}
				last = ret;
				return ret;
			}
		}
	}

	// export nodes data to HTML
	function toHTML(nodes) {
		return parse(typeof nodes[':block/string']!='undefined'? {':block/children':[nodes]} : nodes).join('');

		function parse(node) {
			var ret = [];

			// process node text
			if (typeof node[':block/string'] != 'undefined') {
				var tmp = node[':block/string'];
				// code block
				tmp = tmp.replace(/`{3}([\S\s]*?)`{3}/g,function(_, v){return '<pre><code>'+v+'</code></pre>'});
				// strong
				tmp = tmp.replace(/\*\*(.*?)\*\*/g,function(_, v){return '<strong>'+v+'</strong>'});
				// italic
				tmp = tmp.replace(/__(.*?)__/g,function(_, v){return '<em>'+v+'</em>'});
				// strikethrough
				tmp = tmp.replace(/~~(.*?)~~/g,function(_, v){return '<del>'+v+'</del>'});
				// inline code
				tmp = tmp.replace(/`(.*?)`/g,function(_, v){return '<code>'+v+'</code>'});

				// text align
				var align = typeof node[':block/text-align']!='undefined'? node[':block/text-align'] : 'inherit';

				// add li
				ret.push('<li style="text-align:'+align+';">')

				// handle text/headers
				ret.push('<'+(node[':block/heading']>0?'h1':'span')+' style="text-align:'+align+';">');
				ret.push('<span>'+tmp+'</span>');
				ret.push('</'+(node[':block/heading']>0?'h1':'span')+'>');
			}

			// process children
			if (Array.isArray(node[':block/children']) && node[':block/children'].length > 0) {
				ret.push(node[':children/view-type']==':numbered'? '<ol>' : '<ul>');

				// parse children
				for (var i=0; i<node[':block/children'].length; i++) {
					ret = ret.concat( parse(node[':block/children'][i]) );
				}

				ret.push(node[':children/view-type']==':numbered'? '</ol>' : '</ul>');
			}

			// close li
			if (typeof node[':block/string'] != 'undefined') {
				ret.push('</li>')
			}

			return ret;
		}
	}

	// export nodes data to Text
	function toText(nodes) {
		// get value
		var ret =  parse(typeof nodes[':block/string']!='undefined'? {':block/children':[nodes]} : nodes, 0);

		// fix for no value
		ret = ret.replace(/^-\s*$/, '');

		// return
		return ret;


		function parse(node, level) {
			var ret = '';

			// process node text
			if (typeof node[':block/string'] != 'undefined') {
				ret += ' '.repeat(level>1?(level-1)*2:0)+'- ';
				ret += node[':block/heading']?'#'.repeat(node[':block/heading'])+' ' : '';
				ret += node[':block/string'];
				ret += "\n";
			}

			// process children
			if (Array.isArray(node[':block/children']) && node[':block/children'].length > 0) {

				// parse children
				for (var i=0; i<node[':block/children'].length; i++) {
					ret += parse(node[':block/children'][i], level+1);
				}
			}

			return ret;
		}
	}
})();