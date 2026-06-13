/*
 * ViktorDateLib — clean, self-contained natural-language date engine for Epic Roam.
 * Replaces the ViktorFuzzyDate if/else cascade with: tokenizer -> normalized slots -> declarative
 * rule table -> evaluator(referenceDate, weekStart). Config (locale names, aliases, week-start) and
 * the reference date are PARAMETERS, never globals.
 *
 *   const lib = ViktorDateLib.create({ weekStart, nameMonths, nameDays, dateAliases, ... });
 *   lib.parse('Friday in 2 weeks', refDate)      -> Date | false
 *   lib.parseFormatDate('next sun', refDate)     -> '[[June 14th, 2026]]'
 *   lib.parseEmbed('{next sun {fullmoon {March 22}}}')  -> text with embeds resolved
 *   lib.dateFormat(date, 'YYYY.MM.DD EEE')       -> formatted string
 *
 * Built as a faithful, parity-tested re-architecture of ViktorFuzzyDate (the live engine is the
 * oracle); adds quarter/half-year periods and fixes "last <weekday>" = previous (see RULES).
 */
(function (root) {
	'use strict';

	const EN_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
	const EN_MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
	const EN_DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];     // Monday-first (internal index)
	const EN_DAYS_SHORT = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

	function create(opts) {
		const O = opts || {};

		// ----- config: localizable names + week-start + aliases -----
		const months = O.nameMonths || EN_MONTHS.slice();
		const monthsShort = O.nameMonthsShort || EN_MONTHS_SHORT.slice();
		const days = O.nameDays || EN_DAYS.slice();
		const daysShort = O.nameDaysShort || EN_DAYS_SHORT.slice();
		const weekStartIdx = resolveWeekStart(O.weekStart);
		const conflicts = [];

		// ----- locale-insensitive token helpers -----
		function normToken(s) { return ('' + s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
		function tokenVariants(s) { const lo = ('' + s).toLowerCase(), st = normToken(s); return st === lo ? [lo] : [lo, st]; }

		// Build per-index matcher regexes from localized names (+short) (+aliases). Returns the English
		// prefix matchers unchanged when no localization config is present (so default-English is identical).
		function buildMatchers(kind, names_, shortNames, enNames, defaults) {
			const aliases = O.dateAliases || O.dateAliasMap || null;
			const hasL10n = O.nameMonths || O.nameMonthsShort || O.nameDays || O.nameDaysShort || aliases;
			if (!hasL10n) return defaults;
			const idxOf = {}; enNames.forEach((n, i) => { idxOf[normToken(n)] = i; });
			const toks = enNames.map((_, i) => {
				const t = []; [names_[i], shortNames[i]].filter(Boolean).forEach(n => t.push.apply(t, tokenVariants(n)));
				return Array.from(new Set(t));
			});
			if (aliases) Object.keys(aliases).forEach(rawAlias => {
				const a = normToken(rawAlias), targetIdx = idxOf[normToken(aliases[rawAlias])];
				if (targetIdx == null || !a) return;
				if (a.length < 2 && !O.aliasAllowSingleChar) { conflicts.push({ kind, alias: rawAlias, reason: 'single-char alias ignored (set aliasAllowSingleChar=true to allow)' }); return; }
				for (let i = 0; i < toks.length; i++) if (i !== targetIdx && toks[i].indexOf(a) >= 0) conflicts.push({ kind, alias: rawAlias, reason: 'collides with built-in "' + enNames[i] + '"' });
				tokenVariants(rawAlias).forEach(v => toks[targetIdx].push(v));
			});
			return toks.map(list => {
				const parts = Array.from(new Set(list)).sort((a, b) => b.length - a.length).map(t => {
					const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
					return t.length >= 3 ? esc + '[\\p{L}\\p{N}_]*' : esc;
				});
				return new RegExp('(?<![\\p{L}\\p{N}_])(?:' + parts.join('|') + ')(?![\\p{L}\\p{N}_])', 'iu');
			});
		}
		function reGlobal(r) { return new RegExp(r.source, r.flags.indexOf('g') >= 0 ? r.flags : r.flags + 'g'); }

		const regexMonth = buildMatchers('month', months, monthsShort, EN_MONTHS, [/\bjan\w*/i,/\bfeb\w*/i,/\bmar\w*/i,/\bapr\w*/i,/\bmay\w*/i,/\bjun\w*/i,/\bjul\w*/i,/\baug\w*/i,/\bsep\w*/i,/\bo[ck]t\w*/i,/\bnov\w*/i,/\bdec\w*/i]);
		const regexDay = buildMatchers('day', days, daysShort, EN_DAYS, [/\bmon\w*/i,/\btue\w*/i,/\bwed\w*/i,/\bthu\w*/i,/\bfri\w*/i,/\bsat\w*/i,/\bsun\w*/i]);

		// ===================================================================== math library (ported verbatim;
		// these are small pure functions, golden-tested — NOT the maintainability problem, so kept as-is)
		function getNewDate(date) { let d = date || undefined; d = new Date(d); if (isNaN(d.valueOf())) d = new Date(); return d; }
		function addDay(n, date) { date = getNewDate(date); date.setDate(date.getDate() + n); return date; }
		function addWeek(n, date) { return addDay(n * 7, date); }
		function addMonth(n, date) { date = getNewDate(date); date.setMonth(date.getMonth() + n); return date; }
		function addYear(n, date) { date = getNewDate(date); date.setFullYear(date.getFullYear() + n); return date; }
		function getDayOfWeek(date) { date = getNewDate(date); return (date.getDay() + 6) % 7; } // 0=Monday
		function weekOffset(date) { return (getDayOfWeek(date) - weekStartIdx + 7) % 7; }         // position within configured week
		function startOfWeek(date) { return addDay(-weekOffset(date), date); }
		function upperCeil(num) { return Math.ceil(num % 1 === 0 ? num + 1 : num); }
		function getWeekOfMonth(date) { date = getNewDate(date); let w1 = new Date(date.getFullYear(), date.getMonth(), 1); w1 = addDay(-getDayOfWeek(w1), w1); return upperCeil((date.getTime() - w1.getTime()) / (60 * 60 * 24 * 7 * 1000)); }
		function getDateForWeekOfMonth(date, week) { date = getNewDate(date); week = Math.min(getMaxWeekOfMonth(date), week); let w1 = new Date(date.getFullYear(), date.getMonth(), 1); w1 = addDay(-getDayOfWeek(w1), w1); return addWeek(week - 1, w1); }
		function getMaxWeekOfMonth(date) { date = getNewDate(date); return getWeekOfMonth(new Date(date.getFullYear(), date.getMonth() + 1, 0)); }
		function getWeekOfYear(date) {
			date = getNewDate(date);
			let lastMonday = new Date(date.getFullYear() + 1, 0, 1, 12, 0); lastMonday = addDay(-getDayOfWeek(lastMonday), lastMonday);
			if (compareDates(lastMonday, new Date(date.getFullYear(), 11, 29, 12, 0)) >= 0 && compareDates(date, lastMonday) >= 0) return 1;
			let week1 = new Date(date.getFullYear(), 0, 1, 12, 0);
			week1 = getDayOfWeek(week1) <= 3 ? addDay(-getDayOfWeek(week1), week1) : addDay(7 - getDayOfWeek(week1), week1);
			const diff = (date.getTime() - week1.getTime()) / (60 * 60 * 24 * 7 * 1000);
			return diff < 0 ? getWeekOfYear(new Date(date.getFullYear(), 0, 0, 12, 0)) : upperCeil(diff);
		}
		function getDateForWeekOfYear(date, week) {
			date = getNewDate(date); week = Math.min(getMaxWeekOfYear(date), week);
			let week1 = new Date(date.getFullYear(), 0, 1, 12, 0);
			week1 = getDayOfWeek(week1) <= 3 ? addDay(-getDayOfWeek(week1), week1) : addDay(7 - getDayOfWeek(week1), week1);
			return addWeek(week - 1, week1);
		}
		function getMaxWeekOfYear(date) { date = getNewDate(date); return getWeekOfYear(new Date(date.getFullYear() + 1, 0, 0)); }
		function nextFullMoon(date) {
			date = getNewDate(date); let year = date.getFullYear(), month = date.getMonth() + 1; const day = date.getDate();
			let c, e, jd; if (month < 3) { year--; month += 12; } ++month;
			c = 365.25 * year; e = 30.6 * month; jd = c + e + day - 694039.09; jd /= 29.5305882; jd += 0.5; jd %= 1; jd = (1 - jd) * 29.5305882 + 1;
			return new Date(date.getTime() + jd * 24 * 60 * 60 * 1000);
		}
		function compareDates(d1, d2) { d1 = getNewDate(d1).toISOString().substr(0, 10); d2 = getNewDate(d2).toISOString().substr(0, 10); return d1 < d2 ? -1 : d1 > d2 ? 1 : 0; }

		// ===================================================================== formatter (NEW: single
		// longest-token-first pass instead of ~17 sequential global-replaces. Single-letter tokens keep
		// their disambiguation guards so a literal "May"/"Wed"/"December" in a format string is preserved
		// exactly as the old engine did; th-suffix + (s)-plural post-passes are identical.)
		const FMT_TOKENS = [
			['dD', (d, t) => Math.floor(Math.abs(d.getTime() - t.getTime()) / 86400000)],
			['dW', (d, t) => Math.floor(Math.abs(d.getTime() - t.getTime()) / 86400000 / 7)],
			['dM', (d, t) => { const a = compareDates(d, t) > 0 ? d : t, b = compareDates(d, t) > 0 ? t : d; return (a.getFullYear() - b.getFullYear()) * 12 + a.getMonth() - b.getMonth() + (a.getDate() >= b.getDate() ? 1 : 0) - 1; }],
			['dY', (d, t) => { const a = getNewDate(compareDates(d, t) > 0 ? d : t), b = getNewDate(compareDates(d, t) > 0 ? t : d); const r = a.getFullYear() - b.getFullYear() - 1; b.setFullYear(a.getFullYear()); return r + (compareDates(a, b) >= 0 ? 1 : 0); }],
			['YYYY', d => d.getFullYear()],
			['YY', d => ('' + d.getFullYear()).substr(-2)],
			['Month', d => months[d.getMonth()]],
			['Mon', d => monthsShort[d.getMonth()]],
			['MM', d => { const m = d.getMonth() + 1; return m < 10 ? '0' + m : m; }],
			['M(?![ao])', d => d.getMonth() + 1],
			['DD', d => { const x = d.getDate(); return x < 10 ? '0' + x : x; }],
			['D(?!e)', d => d.getDate()],
			['WW', d => { const w = getWeekOfYear(d); return w < 10 ? '0' + w : w; }],
			['W(?!e)', d => getWeekOfYear(d)],
			['EEE', d => days[getDayOfWeek(d)]],
			['EE', d => daysShort[getDayOfWeek(d)]],
			['E', d => getDayOfWeek(d) + 1],
		];
		// one alternation, longest token first; the (?:) keeps each token's own lookahead guard intact
		const FMT_RE = new RegExp(FMT_TOKENS.map(t => '(?:' + t[0] + ')').join('|'), 'g');
		const FMT_FN = (() => { const m = {}; FMT_TOKENS.forEach(t => { m[t[0].replace(/\(.*$/, '')] = t[1]; }); return m; })();

		function dateFormat(date, format) {
			let text = format || '[[Month Dth, YYYY]]';
			const d = getNewDate(date); d.setHours(12, 0, 0, 0);
			const today = getNewDate(); today.setHours(12, 0, 0, 0);
			// token pass: match longest-first; key the handler by the leading token letters
			text = text.replace(FMT_RE, m => {
				const key = m === '' ? '' : (FMT_FN[m] ? m : pickKey(m));
				const fn = FMT_FN[key]; return fn ? String(fn(d, today)) : m;
			});
			// ordinal suffix on any number, with the 11-19 -> "th" exception (verbatim from old engine)
			text = text.replace(/(\d+)\s*(th|st|nd|rd)/g, (_, number) => {
				const str = number.substr(-2); let suffix;
				switch (str.substr(-1)) { case '1': suffix = 'st'; break; case '2': suffix = 'nd'; break; case '3': suffix = 'rd'; break; default: suffix = 'th'; }
				if (str.length > 1 && str[0] === '1') suffix = 'th';
				return number + suffix;
			});
			// (s) pluralization: "5 day(s)" -> "5 days", "1 day(s)" -> "1 day"
			text = text.replace(/([\s\d\.\,]+)([\w\s]+\(s\))/g, (_, _n, _w) => { _w = parseFloat(_n.replace(/[\s,]/g, '')) > 1 ? _w.replace('(s)', 's') : _w.replace('(s)', ''); return _n + _w; });
			return text;
		}
		// map a matched token string back to its handler key (handles the guarded single letters)
		function pickKey(m) {
			if (FMT_FN[m]) return m;
			if (m === 'M') return 'M'; if (m === 'D') return 'D'; if (m === 'W') return 'W';
			return m;
		}

		// ===================================================================== parser
		// structural regexes (English/structural; month/day use the localized matchers above)
		const regexSubdate = /\b(prev[iou]*s*|ago|past|last|this|cur+ent|next|f[ro]+m|after)\s*([-\+]?\s*\d+)?\s*(st|nd|rd|th)?\s*(d(ays*)?|w([ea]+ks*)?|m(o*n[th]+s*)?|y([ae]+rs*)?)\b/gi;
		const regexSubdateNeg = /(last|first)\s*(d(ays*)?|w([ea]+ks*)?)/i;
		const regexYear = /(?:^|[\b\s\W])(\d{4})(?:[\b\s\W]|$)/;
		const regexNumber = /[-\+]?\s*(\d+)/i;
		const regexUnitClean = /\b(of|now|the)\b/i;
		const regexUnit = { regex: [/([-\+]?\s*\d+)\s*(st|nd|rd|th)?\s*d(ays*)?\b/i, /(?:^|[\b\d\s])d(ays*)?\b/i, /([-\+]?\s*\d+)\s*(st|nd|rd|th)?\s*w([ea]+ks*)?\b/i, /(?:^|[\b\d\s])w([ea]+ks*)?\b/i, /([-\+]?\s*\d+)\s*(st|nd|rd|th)?\s*m(o*n[th]+s*)?\b/i, /(?:^|[\b\d\s])m(o*n[th]+s*)?\b/i, /([-\+]?\s*\d+)\s*(st|nd|rd|th)?\s*y([ae]+rs*)?\b/i, /(?:^|[\b\d\s])y([ae]+rs*)?\b/i], value: ['Day','Day','Week','Week','Month','Month','Year','Year'] };
		const regexFullMoon = /\bful*\s*mo*n\b/i;
		const regexStatic = { regex: [/\byesterday\b/i, /\btoday\b/i, /\btomorrow\b/i], value: [-1, 0, 1] };
		const regexDirection = { regex: [/\b(prev[iou]*s*|ago|past)\b/i, /\b(this|cur+ent)\b/i, /\b(next|f[ro]+m|after)\b/i], value: [-1, 0, 1] };
		const regexFirstLast = { regex: [/\bfirst\w*/i, /\blast\w*/i], value: ['first', 'last'] };
		// NEW periods: quarter Q1-Q4 / "quarter", half-year H1-H2 / "half[ year]"
		const regexQuarter = /\bq([1-4])\b/i, regexQuarterWord = /\bquarter\b/i;
		const regexHalf = /\bh([12])\b/i, regexHalfWord = /\bhalf(?:[\s-]*year)?\b/i;

		// ---- period helpers (quarter/half as month ranges within a year) ----
		function periodRange(period, year, refMonth) {
			const span = period.kind === 'quarter' ? 3 : 6;
			const i = period.idx != null ? period.idx : Math.floor(refMonth / span);
			return [year, i * span, i * span + span - 1];
		}
		function periodStartEnd(period, year, refMonth) {
			const r = periodRange(period, year, refMonth);
			return [new Date(r[0], r[1], 1), new Date(r[0], r[2] + 1, 0)];
		}
		// first/last/Nth <weekday> inside [rangeStart..rangeEnd]; isLast overrides n
		function nthWeekdayInRange(dayIdx, n, isLast, rangeStart, rangeEnd) {
			if (isLast) return addDay(-((getDayOfWeek(rangeEnd) - dayIdx + 7) % 7), rangeEnd);
			let cand = addDay((7 - getDayOfWeek(rangeStart) + dayIdx) % 7, rangeStart); // first <weekday> on/after start
			cand = addWeek((n || 1) - 1, cand);
			while (compareDates(cand, rangeEnd) > 0) cand = addWeek(-1, cand);            // clamp Nth-beyond-range to last
			return cand;
		}
		// Nth weekday within a month range, with the legacy past->next-year rollover when year is implicit
		function ordinalWeekdayRolling(dayIdx, n, isLast, ref, hasYear, m0, m1) {
			let d = nthWeekdayInRange(dayIdx, n, isLast, new Date(ref.getFullYear(), m0, 1), new Date(ref.getFullYear(), m1 + 1, 0));
			if (compareDates(d, ref) < 0 && !hasYear) d = nthWeekdayInRange(dayIdx, n, isLast, new Date(ref.getFullYear() + 1, m0, 1), new Date(ref.getFullYear() + 1, m1 + 1, 0));
			return d;
		}

		// slot extraction: text -> {slots, ref} (ref is mutated by year + recursive subdate resolution)
		function collect(rawText, ref) {
			const ret = { static: '', fullmoon: '', direction: '', unit: '', shadowUnit: '', number: '', day: '', month: '', year: '', firstlast: '', period: null };
			let text = ('' + rawText).toLowerCase();
			ref = getNewDate(ref);

			// year
			if (regexYear.exec(text)) { ret.year = parseInt(regexYear.exec(text)[1]); ref.setFullYear(ret.year); text = text.replace(new RegExp(regexYear, 'gi'), ''); }

			// subdate recursion: "next year", "prev 2 month", "this week" ... resolved first, mutating ref
			let shadowSubtxt = '';
			if (text.match(regexSubdate) && text.replace(regexSubdate, '') !== '') {
				const subdates = text.match(regexSubdate); subdates.reverse();
				subdates.forEach(t => {
					if (regexSubdateNeg.exec(t)) return;
					const match = (new RegExp(regexSubdate, 'i')).exec(t);
					const tmp = parseOne(match[0], ref);
					if (tmp) { ref = tmp; shadowSubtxt = match[0]; }
					text = text.replace(t, '');
				});
			}

			// firstlast
			regexFirstLast.regex.forEach((r, i) => { if (r.exec(text)) ret.firstlast = regexFirstLast.value[i]; });

			// static -> resolves immediately
			regexStatic.regex.forEach((r, i) => { if (r.exec(text)) ret.static = addDay(regexStatic.value[i], ref); });
			if (ret.static) return { slots: ret, ref, done: ret.static };

			// direction
			regexDirection.regex.forEach((r, i) => { if (r.exec(text)) { ret.direction = regexDirection.value[i]; text = text.replace(new RegExp(r, 'gi'), ''); } });

			// period (quarter/half) — detect + REMOVE before unit/number so the digit in q2/h1 isn't read as a number
			let m;
			if ((m = regexQuarter.exec(text))) { ret.period = { kind: 'quarter', idx: parseInt(m[1], 10) - 1 }; text = text.replace(regexQuarter, ''); }
			else if (regexQuarterWord.exec(text)) { ret.period = { kind: 'quarter', idx: null }; text = text.replace(regexQuarterWord, ''); }
			else if ((m = regexHalf.exec(text))) { ret.period = { kind: 'half', idx: parseInt(m[1], 10) - 1 }; text = text.replace(regexHalf, ''); }
			else if (regexHalfWord.exec(text)) { ret.period = { kind: 'half', idx: null }; text = text.replace(regexHalfWord, ''); }

			// unit (track every DISTINCT unit word so "last month" [1 unit] can differ from "last week of month" [2])
			text = text.replace(new RegExp(regexUnitClean, 'gi'), '');
			const matchedUnits = new Set();
			regexUnit.regex.forEach((r, i) => {
				const match = r.exec(text);
				if (match) {
					ret.unit = regexUnit.value[i];
					matchedUnits.add(regexUnit.value[i]);
					if (match.length > 2) { ret.number = parseInt(match[1].replace(/\s+/g, '')); if (match[2]) { ret.number--; if (ret.direction === '') ret.direction = 1; } }
					text = text.replace(new RegExp(r, 'gi'), '');
				}
				if (shadowSubtxt && r.exec(shadowSubtxt)) ret.shadowUnit = regexUnit.value[i];
			});
			ret.unitCount = matchedUnits.size;

			// number
			if (regexNumber.exec(text)) { ret.number = parseInt(regexNumber.exec(text)[1].replace(/\s+/g, '')); text = text.replace(new RegExp(regexNumber, 'gi'), ''); }
			// fullmoon
			if (regexFullMoon.exec(text)) { ret.fullmoon = 'yes'; text = text.replace(new RegExp(regexFullMoon, 'gi'), ''); }
			// month / day (localized)
			regexMonth.forEach((r, i) => { if (r.exec(text)) { ret.month = i; text = text.replace(reGlobal(r), ''); } });
			regexDay.forEach((r, i) => { if (r.exec(text)) { ret.day = i; text = text.replace(reGlobal(r), ''); } });

			ret._text = text;
			return { slots: ret, ref, done: null };
		}

		// ---- the rule table: each branch of the old cascade as a named rule, in explicit priority order.
		// `s` = slots, `ref` = (subdate-adjusted) reference date. First matching rule wins.
		const RULES = [
			// ordinal weekday of a quarter/half period: "3rd Sunday of Q1", "last Friday of H2 2027"  [NEW]
			{ id: 'ordinal-weekday-of-period', when: s => s.day !== '' && s.period, build: (s, ref) => {
				const span = s.period.kind === 'quarter' ? 3 : 6;
				let d, y = ref.getFullYear();
				const range = () => periodRange(s.period, y, ref.getMonth());
				let r = range(); d = nthWeekdayInRange(s.day, (s.number || 1), s.firstlast === 'last', new Date(r[0], r[1], 1), new Date(r[0], r[2] + 1, 0));
				if (compareDates(d, ref) < 0 && s.year === '') { y++; r = periodRange(s.period, y, ref.getMonth()); d = nthWeekdayInRange(s.day, (s.number || 1), s.firstlast === 'last', new Date(r[0], r[1], 1), new Date(r[0], r[2] + 1, 0)); }
				return d;
			} },
			// first/last day of a period, or bare/relative period: "last day of Q2", "first day of H1", "q3", "next quarter"  [NEW]
			{ id: 'period', when: s => s.period && s.day === '', build: (s, ref) => {
				const span = s.period.kind === 'quarter' ? 3 : 6;
				// relative: this/next/last [N] quarter|half. "last quarter" uses the word "last" (firstlast),
				// not a direction word, so treat a bare firstlast='last' (no day-unit) as previous (-1).
				const dirWord = s.direction !== '' ? s.direction : (s.firstlast === 'last' && s.unit === '' ? -1 : null);
				if (dirWord !== null && s.period.idx == null) {
					const cur = Math.floor(ref.getMonth() / span);
					const steps = cur + dirWord * (s.number === '' ? 1 : s.number);
					const per = 12 / span;
					const y = ref.getFullYear() + Math.floor(steps / per);
					const idx = ((steps % per) + per) % per;
					return new Date(y, idx * span, 1);
				}
				// first/last day of period
				const se = periodStartEnd(s.period, ref.getFullYear(), ref.getMonth());
				if (s.firstlast === 'last') { let e = se[1]; if (compareDates(e, ref) < 0 && s.year === '') e = periodStartEnd(s.period, ref.getFullYear() + 1, ref.getMonth())[1]; return e; }
				let start = se[0]; if (compareDates(start, ref) < 0 && s.year === '') start = periodStartEnd(s.period, ref.getFullYear() + 1, ref.getMonth())[0]; return start;
			} },
			// ordinal weekday of month: "1st Monday of January", "3rd Sunday of May", "last Friday of June"
			{ id: 'ordinal-weekday-of-month', when: s => s.day !== '' && (s.month !== '' || s.shadowUnit === 'Month'), build: (s, ref) => {
				const mo = s.month !== '' ? s.month : ref.getMonth();
				return ordinalWeekdayRolling(s.day, (s.number || 1), s.firstlast === 'last', ref, s.year !== '', mo, mo);
			} },
			// week-relative weekday: "Friday in 2 weeks", "2 weeks Friday" (week-relative; may be <14 days)
			{ id: 'week-relative-weekday', when: s => s.day !== '' && s.unit === 'Week' && s.number !== '', build: (s, ref) => {
				const n = s.number * (s.direction === '' ? 1 : s.direction);
				return addDay((s.day - weekStartIdx + 7) % 7, addDay(n * 7, startOfWeek(ref)));
			} },
			// day of month: "jan 2", "4th of May", "June 1st"
			{ id: 'day-of-month', when: s => !s.direction && s.number !== '' && s.month !== '', build: (s, ref) => {
				let d = new Date(ref.getFullYear(), s.month, s.number);
				if (compareDates(d, ref) < 0 && s.year === '') d = addYear(1, d);
				return d;
			} },
			// month + number + direction: "2 last jan"
			{ id: 'dir-month', when: s => s.direction && s.number !== '' && s.month !== '', build: (s, ref) => {
				let diff = (12 - ref.getMonth() + s.month) % 12 + s.direction * 12 * s.number;
				if (s.direction === 1) diff -= 12;
				if (s.direction === 1 && ref.getMonth() === s.month) diff += 12;
				return addMonth(diff, ref);
			} },
			// number + weekday + direction: "next 2 monday", "prev 2 tuesday"
			{ id: 'dir-num-weekday', when: s => s.number !== '' && s.day !== '' && s.direction, build: (s, ref) => {
				let diff = (7 - getDayOfWeek(ref) + s.day) % 7 + s.direction * 7 * s.number;
				if (s.direction === 1) diff -= 7;
				if (s.direction === 1 && getDayOfWeek(ref) === s.day) diff += 7;
				return addDay(diff, ref);
			} },
			// "last <weekday>" alone = the PREVIOUS occurrence (FIX of the old "last Tuesday = last Tuesday of the YEAR")  [QUIRK FIX Q1]
			{ id: 'previous-weekday', when: s => s.day !== '' && s.firstlast === 'last' && s.number === '' && s.month === '' && !s.period && s.unit === '', build: (s, ref) => {
				let off = (getDayOfWeek(ref) - s.day + 7) % 7; if (off === 0) off = 7;
				return addDay(-off, ref);
			} },
			// ordinal weekday of year: "3rd Monday", "first Tuesday", "last Friday of year" (unit=Year)
			{ id: 'ordinal-weekday-of-year', when: s => s.day !== '' && (s.number !== '' || s.firstlast !== ''), build: (s, ref) => {
				return ordinalWeekdayRolling(s.day, (s.number || 1), s.firstlast === 'last', ref, s.year !== '', 0, 11);
			} },
			// plain weekday: "monday", "this/next/last monday" (direction-driven)
			{ id: 'plain-weekday', when: s => s.day !== '', build: (s, ref) => {
				let diff = (7 - getDayOfWeek(ref) + s.day + s.direction * 7) % 7;
				if (diff === 0) diff = 7 * s.direction;
				return addDay(diff, ref);
			} },
			// month only: "jan", "last day of feb", "first day of March 2024"
			{ id: 'month-only', when: s => s.month !== '', build: (s, ref) => {
				let month = s.month, day = 1;
				if (s.firstlast === 'last') { month++; day = 0; }
				let d = new Date(ref.getFullYear(), month, day);
				if (compareDates(d, ref) < 0 && s.year === '') d = new Date(ref.getFullYear() + 1, month, day);
				return d;
			} },
			// "last week/month/year" alone = the PREVIOUS one (FIX of old "last month" = last DAY of this month).
			// Only a SINGLE bare period word (unitCount===1) — so "last week of month" (2 units) keeps old behavior.  [QUIRK FIX Q2]
			{ id: 'previous-period', when: s => s.firstlast === 'last' && s.unitCount === 1 && (s.unit === 'Week' || s.unit === 'Month' || s.unit === 'Year') && s.day === '' && !s.period && s.number === '' && s.month === '', build: (s, ref) => {
				if (s.unit === 'Week') return addDay(-weekOffset(addWeek(-1, ref)), addWeek(-1, ref));
				if (s.unit === 'Month') return new Date(ref.getFullYear(), ref.getMonth() - 1, 1);
				return new Date(ref.getFullYear() - 1, 0, 1); // Year
			} },
			// unit offset: "prev/next X day/week/month/year", "first/last day/week/month/year"
			{ id: 'unit-offset', when: s => s.unit !== '', build: (s, ref) => {
				const ADD = { Day: addDay, Week: addWeek, Month: addMonth, Year: addYear };
				const direction = s.direction === '' ? 1 : s.direction;
				const num = s.number === '' && s.firstlast !== '' ? 0 : (s.number === '' ? 1 : s.number);
				let date = ADD[s.unit](direction * num, ref);
				if (s.direction !== '' && s.firstlast === '') {
					if (s.unit === 'Week') date = addDay((s.firstlast === 'last' ? 6 : 0) - weekOffset(date), date);
					if (s.unit === 'Month') date = new Date(date.getFullYear(), date.getMonth() + (s.firstlast === 'last' ? 1 : 0), (s.firstlast === 'last' ? 0 : 1));
					if (s.unit === 'Year') date = new Date(date.getFullYear() + (s.firstlast === 'last' ? 1 : 0), 0, (s.firstlast === 'last' ? 0 : 1));
				} else if (s.firstlast !== '') {
					if (s.unit === 'Day') {
						if (s.shadowUnit === 'Week') date = addDay((s.firstlast === 'last' ? 6 : 0) - weekOffset(date), date);
						else if (s.shadowUnit === 'Year') date = new Date(date.getFullYear() + (s.firstlast === 'last' ? 1 : 0), 0, (s.firstlast === 'last' ? 0 : 1));
						else date = new Date(date.getFullYear(), date.getMonth() + (s.firstlast === 'last' ? 1 : 0), (s.firstlast === 'last' ? 0 : 1));
					} else if (s.unit === 'Week') {
						if (s.shadowUnit === 'Year') date = getDateForWeekOfYear(date, s.firstlast === 'last' ? getMaxWeekOfYear(date) : 1);
						else date = getDateForWeekOfMonth(date, s.firstlast === 'last' ? getMaxWeekOfMonth(date) : 1);
					} else if (s.unit === 'Month') {
						date = new Date(date.getFullYear(), date.getMonth() + (s.firstlast === 'last' ? 1 : 0), 0, s.firstlast === 'last' ? 0 : 1);
					}
				}
				if (s.direction !== '' && s.unit === 'Week') date = addDay(-weekOffset(date), date);
				return date;
			} },
			// next full moon
			{ id: 'fullmoon', when: s => s.fullmoon !== '', build: (s, ref) => nextFullMoon(ref) },
		];

		// parse ONE segment -> Date | false
		function parseOne(text, date) {
			const origi = text;
			// bare number = day offset (:3:=+3d, :0:=today, :-1:=yesterday)
			const mNum = /^\s*([-\+]?\d{1,3})\s*$/.exec(('' + text).toLowerCase());
			if (mNum) return addDay(parseInt(mNum[1], 10), getNewDate(date));
			// numeric month-day: 06-01, 0611, 06/11 -> this year else next
			const low = ('' + text).toLowerCase();
			const mMD = /^\s*(\d{1,2})\s*[-\/\. ]\s*(\d{1,2})\s*$/.exec(low) || /^\s*(\d{2})(\d{2})\s*$/.exec(low);
			if (mMD) {
				const mo = parseInt(mMD[1], 10), dy = parseInt(mMD[2], 10), ref = getNewDate(date);
				if (mo >= 1 && mo <= 12 && dy >= 1 && dy <= 31) { let d = new Date(ref.getFullYear(), mo - 1, dy); if (compareDates(d, ref) < 0) d = new Date(ref.getFullYear() + 1, mo - 1, dy); return d; }
			}
			const { slots, ref, done } = collect(text, date);
			if (done) return done;
			for (const rule of RULES) if (rule.when(slots)) return rule.build(slots, ref);
			// fallback: try native Date parse of the original text
			const nat = getNewDate(origi.trim());
			if (compareDates(ref, nat) !== 0) return nat;
			return false;
		}

		// public: parse ONE segment (same contract as the old engine; ";"-chaining lives in parseFormatDate)
		function parse(text, date) { return parseOne(text, date); }

		function parseFormatDate(text, date) {
			let format = '[[Month Dth, YYYY]]';
			if (text.match(/`([^`]+)`/)) { format = text.match(/`([^`]+)`/)[1]; text = text.replace(/`([^`]+)`/g, ''); }
			const d = ('' + text).split(';').reduce((ref, seg) => { const r = parseOne(seg, ref); return r || ref; }, date == null ? undefined : date);
			return d ? dateFormat(d, format) : false;
		}

		// {date3 {date2 {date1}}} — each level relative to the resolved inner one
		function parseEmbed(text) {
			const subs = parseTxt(text, '{', '{', '{}""``', 2, /^{{.*}}$|^{\s+/);
			subs.forEach(origi => {
				let sub = origi, date = null, format = '[[Month Dth, YYYY]]';
				if (sub.match(/`([^`]+)`/)) { format = sub.match(/`([^`]+)`/)[1]; sub = sub.replace(/`([^`]+)`/g, ''); }
				const queue = [];
				while (sub.indexOf('{') > -1) {
					sub = sub.substr(1, sub.length - 2);
					const match = sub.match(/([^\{\}]*)\s*(\{.*\})\s*([^\{\}]*)/);
					if (match) { queue.push(match[1] + match[3]); sub = match[2]; } else queue.push(sub);
				}
				queue.reverse();
				queue.forEach(part => { const tmp = part.split(';').reduce((ret, val) => parseOne(val, ret), date); if (tmp) date = tmp; });
				if (date) text = text.replace(origi, dateFormat(date, format));
			});
			return text;
		}

		// minimal embedded-structure splitter (ported from ViktorRoamLib.parseTxt; only the modes parseEmbed needs)
		function parseTxt(txt, start, queue, chrs, maxdepth, exclude) {
			const startRe = new RegExp(start, 'i');
			const open = {}, close = {}; const ch = (chrs || '').split('');
			ch.forEach((_, j) => { if (j % 2 === 0 && j !== ch.length - 1) { open[ch[j]] = ch[j + 1]; close[ch[j + 1]] = ch[j]; } });
			let i = 0; const ret = [];
			while (i < txt.length && startRe.test(txt.substr(i))) {
				const mm = startRe.exec(txt.substr(i)); let q = queue || '';
				if (!q && open[mm[0][0]]) q += mm[0][0];
				i += mm.index; let j;
				for (j = i + mm[0].length; j < txt.length; j++) {
					if (txt[j] === '\\') { j++; continue; }
					if (q.length && close[txt[j]] === q.substr(-1)) { q = q.substr(0, q.length - 1); if (q.length === 0) break; continue; }
					if (open[txt[j]] && (q.indexOf(txt[j]) === -1 || q.substr(-1) === txt[j]) && [...new Set((q + txt[j]).split(''))].length <= maxdepth) { q += txt[j]; continue; }
				}
				if (q === '' && (!exclude || !exclude.test(txt.substr(i, j + 1 - i)))) { ret.push(txt.substr(i, j + 1 - i)); i = j + 1; } else i++;
			}
			return ret;
		}

		return {
			parse, parseFormatDate, parseEmbed, dateFormat,
			// helpers exposed for tests/integration
			addDay, addWeek, addMonth, addYear, getDayOfWeek, weekOffset, startOfWeek,
			getWeekOfYear, getWeekOfMonth, getDateForWeekOfYear, getDateForWeekOfMonth,
			getMaxWeekOfYear, getMaxWeekOfMonth, nextFullMoon, compareDates, getNewDate,
			getWeekStart: () => weekStartIdx, aliasConflicts: conflicts, _regexMonth: regexMonth, _regexDay: regexDay,
		};
	}

	// week-start setting -> internal index 0=Monday..6=Sunday; 'auto' = Intl locale, default ISO Monday
	function resolveWeekStart(ws) {
		if (ws == null || ws === '') return 0;
		if (ws === 'auto') {
			try {
				if (typeof Intl !== 'undefined' && Intl.Locale && typeof navigator !== 'undefined') {
					const loc = new Intl.Locale(navigator.language || 'en');
					const wi = typeof loc.getWeekInfo === 'function' ? loc.getWeekInfo() : loc.weekInfo;
					if (wi && wi.firstDay) return (wi.firstDay - 1) % 7;
				}
			} catch (e) {}
			return 0;
		}
		if (typeof ws === 'number') return ((Math.round(ws) % 7) + 7) % 7;
		const map = { monday:0,mon:0,tuesday:1,tue:1,wednesday:2,wed:2,thursday:3,thu:3,friday:4,fri:4,saturday:5,sat:5,sunday:6,sun:6 };
		const k = ('' + ws).toLowerCase();
		return map[k] != null ? map[k] : 0;
	}

	const ViktorDateLib = { create, resolveWeekStart };
	if (typeof module !== 'undefined' && module.exports) module.exports = ViktorDateLib;
	if (root) root.ViktorDateLib = ViktorDateLib;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
