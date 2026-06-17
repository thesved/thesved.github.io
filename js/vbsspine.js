// vbsspine — gated loader that injects the VBS measurement spine into LIVE Roam on ANY
// surface (desktop, Android, iOS, real device). OFF by default; activates only when
// localStorage.VBS_spine is set, so it's inert for normal use.
//
// Enable on a surface:
//   localStorage.VBS_spine = '{"base":"http://localhost:8779","session":"deskRoam"}'   // sim/desktop
//   localStorage.VBS_spine = '{"base":"https://xxx.trycloudflare.com","session":"devRoam"}' // real device
//   (shorthand also accepted: localStorage.VBS_spine = 'http://localhost:8779|deskRoam')
// then reload Roam. base must serve /spine.js and be a trustworthy origin (localhost or https),
// or the HTTPS Roam page will block it (mixed content).
//
// Global: window.ViktorVbsspine = { start, stop, _cfg }  (loader contract: .stop()).
(function () {
  function readCfg() {
    try {
      var raw = localStorage.getItem('VBS_spine');
      if (!raw) return null;
      if (raw.charAt(0) === '{') return JSON.parse(raw);
      var p = raw.split('|');
      return { base: p[0], session: p[1] || 'roam' };
    } catch (e) { return null; }
  }
  function start(cfg) {
    cfg = cfg || readCfg();
    if (!cfg || !cfg.base) { console.log('[vbsspine] no config'); return; }
    if (window.__VBS_SPINE__) { console.log('[vbsspine] spine already running'); return; }
    window.__VBS_BASE = cfg.base;
    window.__VBS_SESSION = cfg.session || 'roam';
    var old = document.getElementById('vbs-spine-script'); if (old) old.remove();
    var s = document.createElement('script');
    s.id = 'vbs-spine-script';
    s.src = cfg.base + '/spine.js?session=' + encodeURIComponent(cfg.session || 'roam') + '&cb=' + Date.now();
    s.onerror = function () { console.warn('[vbsspine] spine load failed from ' + cfg.base + ' (reachable? trustworthy origin?)'); };
    document.head.appendChild(s);
    console.log('[vbsspine] activating -> ' + cfg.base + ' /' + (cfg.session || 'roam'));
  }
  var cfg = readCfg();
  if (cfg && cfg.base) start(cfg);
  else console.log('[vbsspine] idle (set localStorage.VBS_spine + reload to enable)');
  window.ViktorVbsspine = {
    start: start,
    stop: function () { var el = document.getElementById('vbs-spine-script'); if (el) el.remove(); console.log('[vbsspine] stopped (reload to fully reset spine)'); },
    _cfg: cfg
  };
})();
