/*!
 * Plan — script.js
 * Fake "daily planner" landing page that turns into a jumpscare on the first
 * click / tap / keypress. Vanilla JS, no dependencies, no build step.
 */
(() => {
  'use strict';

  /* =========================================================================
   * CONFIG — everything you'd normally tweak lives here.
   *
   * Sources are tried top to bottom; the first one that loads wins. Put a
   * remote URL first and keep the local path as its fallback, or use local
   * files only. If nothing loads, a built-in creature and a synthesized
   * scream are used, so the scare always fires.
   *
   *  - Video (.webm / .mp4) animates more smoothly than a GIF. Keep a GIF
   *    listed after it: iOS in Low Power Mode won't preload video.
   *  - Remote audio needs CORS headers for the low-latency Web Audio path;
   *    without CORS it still plays through a plain <audio> element.
   * ========================================================================= */
  const CONFIG = {
    visualSources: [
      // 'https://cdn.example.com/your-jumpscare.webm',
      'assets/foxy.mp4',
      'assets/foxy.gif', // fallback if the video can't preload (e.g. iPhone Low Power Mode)
    ],
    audioSources: [
      // 'https://cdn.example.com/your-scream.mp3',
      'assets/scare.mp3',
      // 'assets/scare.wav',
    ],
    fit: 'cover', // 'cover' fills the screen (may crop), 'contain' shows the whole frame

    timing: {
      loaderMinMs: 2400,    // minimum time the fake loader stays up
      loaderMaxMs: 9000,    // stop waiting for slow assets after this
      armDelayMs: 450,      // grace period after the dashboard appears
      impactMs: 600,        // when the clip's leap lands; flash, strobe and pulse sync to it
      scareMs: 2000,        // length of the scare before the reveal (scream is ~1.7 s)
      assetTimeoutMs: 7000, // per-source load timeout
    },

    audio: {
      boost: 1.4,           // gain into a limiter on the Web Audio path: louder without clipping
      startOffsetSec: 0.08, // skip the silence at the start of the file so it hits instantly
    },

    effects: {
      cssLunge: false,            // the clip already leaps at the viewer; true adds a CSS zoom-in
      shake: true,
      strobe: true,
      strobeHz: 3,                // 3 Hz is the WCAG 2.3.1 ceiling; faster can trigger seizures
      vibrate: true,              // Android only
      fullscreen: false,          // go fullscreen on trigger (adds a brief browser transition)
      respectReducedMotion: true, // skip shake + strobe when the OS asks for reduced motion
    },

    reveal: {
      enabled: true,
      text: 'gotcha.',
      button: 'Reset',
    },
  };

  /* ------------------------------------------------------------------ DOM */
  const $ = (id) => document.getElementById(id);
  const root = document.documentElement;
  const app = $('app');
  const loaderStatus = $('loaderStatus');
  const progressBar = $('progressBar');
  const scare = $('scare');
  const scareMedia = $('scareMedia');
  const reveal = $('reveal');

  const state = {
    visual: null,    // { kind: 'video' | 'image' | 'fallback', ... }
    armed: false,
    triggered: false,
    audioOk: false,
  };

  /* -------------------------------------------------------------- helpers */
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const isVideoUrl = (url) => /\.(webm|mp4|m4v|mov|ogv)(?:[?#]|$)/i.test(url);

  function withTimeout(promise, ms, label) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label}: timed out`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  async function fetchAs(url, ms, type) {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), ms) : null;
    try {
      const res = await fetch(url, ctrl ? { signal: ctrl.signal } : undefined);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res[type]();
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /* ================================================================ VISUAL */

  function loadImageElement(src, ms) {
    return withTimeout(new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('image failed to load'));
      img.src = src;
    }), ms, src);
  }

  async function loadImage(src, ms) {
    // Preferred: keep the bytes as a Blob. Each scare then gets a fresh object
    // URL, which guarantees an animated GIF starts from its first frame.
    try {
      const blob = await fetchAs(src, ms, 'blob');
      const probe = URL.createObjectURL(blob);
      try { await loadImageElement(probe, ms); } finally { URL.revokeObjectURL(probe); }
      return { kind: 'image', src, blob };
    } catch (_) {
      // Cross-origin without CORS, or file:// — use the URL directly.
      await loadImageElement(src, ms);
      return { kind: 'image', src, blob: null };
    }
  }

  function loadVideo(src, ms) {
    return withTimeout(new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.muted = true;
      video.defaultMuted = true;
      video.playsInline = true;
      video.loop = false;
      video.preload = 'auto';
      video.disablePictureInPicture = true;
      video.setAttribute('muted', '');
      video.setAttribute('playsinline', '');
      video.setAttribute('webkit-playsinline', '');

      const cleanup = () => {
        video.removeEventListener('loadeddata', onReady);
        video.removeEventListener('error', onError);
      };
      const onReady = () => { cleanup(); resolve({ kind: 'video', src, el: video }); };
      const onError = () => { cleanup(); reject(new Error('video failed to load')); };

      video.addEventListener('loadeddata', onReady);
      video.addEventListener('error', onError);
      video.src = src;
      video.load();
    }), ms, src);
  }

  async function resolveVisual(sources, ms) {
    for (const src of sources) {
      try {
        return isVideoUrl(src) ? await loadVideo(src, ms) : await loadImage(src, ms);
      } catch (err) {
        console.info('[plan] visual source skipped:', src, err.message);
      }
    }
    return { kind: 'fallback' };
  }

  // Videos are mounted ahead of time so play() starts instantly.
  function mountVisual(visual) {
    if (state.triggered || visual.kind !== 'video') return;
    visual.el.className = 'scare-el';
    scareMedia.appendChild(visual.el);
  }

  // Original built-in creature, used when no visual asset loads.
  const FALLBACK_SVG = `
<svg viewBox="0 0 400 400" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <radialGradient id="pf-skin" cx="50%" cy="40%" r="60%">
      <stop offset="0" stop-color="#4a3a36"/><stop offset=".6" stop-color="#1f1614"/><stop offset="1" stop-color="#050303"/>
    </radialGradient>
    <radialGradient id="pf-eye" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#fff"/><stop offset=".25" stop-color="#ffe9a8"/>
      <stop offset=".55" stop-color="#ff3b1f" stop-opacity=".8"/><stop offset="1" stop-color="#ff3b1f" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="pf-mouth" cx="50%" cy="30%" r="70%">
      <stop offset="0" stop-color="#5a0508"/><stop offset="1" stop-color="#0a0000"/>
    </radialGradient>
  </defs>
  <rect width="400" height="400" fill="#000"/>
  <path d="M200 20C300 20 360 110 355 210C350 300 290 385 200 390C110 385 50 300 45 210C40 110 100 20 200 20Z" fill="url(#pf-skin)"/>
  <ellipse cx="140" cy="165" rx="48" ry="40" fill="#000"/>
  <ellipse cx="260" cy="165" rx="48" ry="40" fill="#000"/>
  <circle cx="145" cy="168" r="30" fill="url(#pf-eye)"/>
  <circle cx="255" cy="168" r="30" fill="url(#pf-eye)"/>
  <circle cx="145" cy="168" r="6" fill="#fff"/>
  <circle cx="255" cy="168" r="6" fill="#fff"/>
  <path d="M95 250Q200 225 305 250Q300 360 200 375Q100 360 95 250Z" fill="url(#pf-mouth)"/>
  <path d="M100 252L115 290L128 252L142 296L156 252L170 300L184 252L200 304L216 252L230 300L244 252L258 296L272 252L285 290L300 252Z" fill="#e9e2d2"/>
  <path d="M120 350L132 318L146 356L160 314L174 362L188 312L200 366L212 312L226 362L240 314L254 356L268 318L280 350Q200 380 120 350Z" fill="#d8cfbd"/>
</svg>`;

  function showVisual() {
    const visual = state.visual || (state.visual = { kind: 'fallback' });

    if (visual.kind === 'video') {
      const v = visual.el;
      try { v.currentTime = 0; } catch (_) { /* not seekable yet */ }
      const p = v.play();
      if (p && p.catch) p.catch(() => {});
      return;
    }

    if (visual.kind === 'image') {
      const img = new Image();
      img.className = 'scare-el';
      img.alt = '';
      img.decoding = 'sync';
      img.src = visual.blob ? URL.createObjectURL(visual.blob) : visual.src;
      scareMedia.appendChild(img);
      return;
    }

    scareMedia.innerHTML = FALLBACK_SVG;
  }

  /* ================================================================= AUDIO */

  const AudioEngine = (() => {
    const AC = window.AudioContext || window.webkitAudioContext;
    let ctx = null;
    let buffer = null;
    let element = null;
    let mode = 'synth'; // 'buffer' (Web Audio) | 'element' (<audio>) | 'synth'

    function setPlaybackSession() {
      // iOS 17+: let Web Audio play even with the ring/silent switch on.
      if (navigator.audioSession) {
        try { navigator.audioSession.type = 'playback'; } catch (_) { /* ignore */ }
      }
    }

    function context() {
      if (!ctx && AC) {
        try { ctx = new AC({ latencyHint: 'interactive' }); } catch (_) {
          try { ctx = new AC(); } catch (__) { ctx = null; }
        }
      }
      return ctx;
    }

    function decode(c, data) {
      return new Promise((resolve, reject) => {
        const p = c.decodeAudioData(data, resolve, reject); // callback form for old Safari
        if (p && typeof p.then === 'function') p.then(resolve, reject);
      });
    }

    function loadElement(src, ms) {
      return new Promise((resolve, reject) => {
        const a = new Audio();
        a.preload = 'auto';
        let settled = false;
        const finish = (fn, arg) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          a.removeEventListener('canplaythrough', onReady);
          a.removeEventListener('error', onError);
          fn(arg);
        };
        const onReady = () => finish(resolve, a);
        const onError = () => finish(reject, new Error('audio failed to load'));
        // iOS won't preload <audio> before a gesture. If nothing has errored
        // by the timeout, assume the file is fine and let play() fetch it.
        const timer = setTimeout(() => {
          if (a.error || a.networkState === a.NETWORK_NO_SOURCE) onError();
          else finish(resolve, a);
        }, ms);
        a.addEventListener('canplaythrough', onReady);
        a.addEventListener('error', onError);
        a.src = src;
        a.load();
      });
    }

    async function preload(sources, ms) {
      setPlaybackSession();
      for (const src of sources) {
        try {
          const data = await fetchAs(src, ms, 'arrayBuffer');
          const c = context();
          if (!c) throw new Error('Web Audio unavailable');
          buffer = await decode(c, data);
          mode = 'buffer';
          return mode;
        } catch (_) { /* fall through to <audio> */ }

        try {
          element = await loadElement(src, ms);
          mode = 'element';
          return mode;
        } catch (err) {
          console.info('[plan] audio source skipped:', src, err.message);
        }
      }
      mode = 'synth';
      return mode;
    }

    function output(c) {
      const gain = c.createGain();
      gain.gain.value = CONFIG.audio.boost;
      const limiter = c.createDynamicsCompressor();
      limiter.threshold.value = -3;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.001;
      limiter.release.value = 0.08;
      gain.connect(limiter);
      limiter.connect(c.destination);
      return gain;
    }

    function distortionCurve(amount) {
      const n = 2048;
      const curve = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const x = (i * 2) / n - 1;
        curve[i] = ((Math.PI + amount) * x) / (Math.PI + amount * Math.abs(x));
      }
      return curve;
    }

    // Original synthesized scream: detuned saw screech + filtered noise + low thud.
    function synthScream(c, out) {
      const t = c.currentTime + 0.005;
      const dur = 1.9;
      const end = t + dur + 0.05;

      const shaper = c.createWaveShaper();
      shaper.curve = distortionCurve(60);
      shaper.oversample = '2x';
      const env = c.createGain();
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(1, t + 0.012);
      env.gain.setValueAtTime(1, t + dur * 0.55);
      env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      shaper.connect(env);
      env.connect(out);

      const vib = c.createOscillator();
      vib.frequency.value = 38;
      const vibDepth = c.createGain();
      vibDepth.gain.value = 90;
      vib.connect(vibDepth);
      vib.start(t);
      vib.stop(end);

      [520, 780, 1170].forEach((f, i) => {
        const osc = c.createOscillator();
        osc.type = 'sawtooth';
        osc.detune.value = (i - 1) * 14;
        osc.frequency.setValueAtTime(f * 0.6, t);
        osc.frequency.exponentialRampToValueAtTime(f * 1.25, t + 0.25);
        osc.frequency.exponentialRampToValueAtTime(f * 0.7, t + dur);
        vibDepth.connect(osc.frequency);
        const g = c.createGain();
        g.gain.value = 0.18;
        osc.connect(g);
        g.connect(shaper);
        osc.start(t);
        osc.stop(end);
      });

      const noiseBuf = c.createBuffer(1, Math.ceil(c.sampleRate * (dur + 0.1)), c.sampleRate);
      const ch = noiseBuf.getChannelData(0);
      for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
      const noise = c.createBufferSource();
      noise.buffer = noiseBuf;
      const band = c.createBiquadFilter();
      band.type = 'bandpass';
      band.Q.value = 1.2;
      band.frequency.setValueAtTime(1800, t);
      band.frequency.exponentialRampToValueAtTime(3200, t + 0.3);
      band.frequency.exponentialRampToValueAtTime(900, t + dur);
      const ng = c.createGain();
      ng.gain.value = 0.5;
      noise.connect(band);
      band.connect(ng);
      ng.connect(shaper);
      noise.start(t);
      noise.stop(end);

      const thud = c.createOscillator();
      thud.type = 'sine';
      thud.frequency.setValueAtTime(90, t);
      thud.frequency.exponentialRampToValueAtTime(35, t + 0.35);
      const tg = c.createGain();
      tg.gain.setValueAtTime(1, t);
      tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
      thud.connect(tg);
      tg.connect(out);
      thud.start(t);
      thud.stop(t + 0.5);
    }

    // MUST be called synchronously inside a trusted user gesture.
    // Resolves true once sound is confirmed playing.
    function play() {
      setPlaybackSession();

      if (mode === 'element' && element) {
        try { element.currentTime = CONFIG.audio.startOffsetSec || 0; } catch (_) { /* not loaded yet */ }
        element.volume = 1;
        return element.play().then(() => true, () => false);
      }

      const c = context();
      if (!c) return Promise.resolve(false);
      const resumed = c.state === 'running' ? Promise.resolve() : Promise.resolve(c.resume());
      const out = output(c);

      if (mode === 'buffer' && buffer) {
        const src = c.createBufferSource();
        src.buffer = buffer;
        src.connect(out);
        src.start(0, Math.min(CONFIG.audio.startOffsetSec || 0, buffer.duration));
      } else {
        synthScream(c, out);
      }

      // If the context stays suspended, the scheduled sound starts on resume.
      return Promise.race([resumed.then(() => true, () => false), sleep(400).then(() => false)])
        .then((ok) => ok || c.state === 'running');
    }

    // Called on follow-up gestures if the first attempt was blocked.
    function retry() {
      if (mode === 'element' && element) {
        return element.paused ? element.play().then(() => true, () => false) : Promise.resolve(true);
      }
      if (ctx && ctx.state !== 'running') {
        return Promise.resolve(ctx.resume()).then(() => ctx.state === 'running', () => false);
      }
      return Promise.resolve(true);
    }

    return { preload, play, retry };
  })();

  /* ================================================================ LOADER */

  function setupDecoy() {
    const now = new Date();
    const h = now.getHours();
    $('greeting').textContent =
      h < 5 ? 'Working late?' : h < 12 ? 'Good morning.' : h < 18 ? 'Good afternoon.' : 'Good evening.';
    $('today').textContent = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) {
      $('gateHint').textContent = 'or tap anywhere to continue';
    }
    $('revealTitle').textContent = CONFIG.reveal.text;
    $('resetBtn').textContent = CONFIG.reveal.button;
  }

  function applyConfig() {
    const fx = CONFIG.effects;
    const hz = Number(fx.strobeHz) || 0;
    const reduce = fx.respectReducedMotion &&
      window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    root.style.setProperty('--scare-fit', CONFIG.fit === 'contain' ? 'contain' : 'cover');
    if (!fx.shake || reduce) scare.classList.add('no-shake');
    if (!fx.strobe || hz <= 0 || reduce) scare.classList.add('no-strobe');
    else root.style.setProperty('--strobe-ms', `${Math.round(1000 / hz)}ms`);
  }

  async function runLoader(assetsReady) {
    const { loaderMinMs, loaderMaxMs } = CONFIG.timing;
    const messages = ['Syncing calendar', 'Restoring your tasks', 'Arranging today’s time blocks', 'Almost ready'];
    let ready = false;
    assetsReady.then(() => { ready = true; });

    let i = 0;
    const msgTimer = setInterval(() => {
      i = Math.min(i + 1, messages.length - 1);
      loaderStatus.textContent = messages[i];
    }, Math.max(450, loaderMinMs / messages.length));

    const start = performance.now();
    await new Promise((resolve) => {
      const tick = (now) => {
        const elapsed = now - start;
        const x = Math.min(elapsed / loaderMinMs, ready ? 1 : 0.9);
        progressBar.style.transform = `scaleX(${1 - Math.pow(1 - x, 2)})`;
        if ((ready && elapsed >= loaderMinMs) || elapsed >= loaderMaxMs) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    clearInterval(msgTimer);
    progressBar.style.transform = 'scaleX(1)';
    await sleep(160);
  }

  /* ================================================================= SCARE */

  function requestFullscreen() {
    const el = root;
    const fn = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!fn) return;
    try {
      const p = fn.call(el, { navigationUI: 'hide' });
      if (p && p.catch) p.catch(() => {});
    } catch (_) { /* ignore */ }
  }

  function trigger() {
    if (state.triggered) return;
    state.triggered = true;

    // 1) Sound first — this call must stay synchronous inside the gesture.
    AudioEngine.play().then((ok) => { if (ok) state.audioOk = true; });

    // 2) Haptics (Android)
    if (CONFIG.effects.vibrate && navigator.vibrate) {
      try { navigator.vibrate([400, 60, 250, 60, 500]); } catch (_) { /* ignore */ }
    }

    // 3) Visuals — one class flip starts every animation on the compositor.
    showVisual();
    const lunge = CONFIG.effects.cssLunge || state.visual.kind === 'fallback';
    if (lunge) scare.classList.add('with-lunge');
    root.style.setProperty('--impact-ms', `${lunge ? 230 : CONFIG.timing.impactMs}ms`);
    scare.classList.add('is-active');
    scare.setAttribute('aria-hidden', 'false');
    root.classList.add('is-scaring');
    app.dataset.state = 'scared';
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', '#000000'));

    if (CONFIG.effects.fullscreen) requestFullscreen();
    setTimeout(endScare, CONFIG.timing.scareMs);
  }

  function endScare() {
    scare.classList.add('is-ending');
    if (!CONFIG.reveal.enabled) return;
    setTimeout(() => {
      reveal.classList.add('is-visible');
      reveal.setAttribute('aria-hidden', 'false');
    }, 500);
  }

  function onGesture() {
    if (!state.armed) return;
    if (!state.triggered) {
      trigger();
      return;
    }
    // A browser may only count a later event in the same tap as a user
    // gesture (e.g. touchend after pointerup), so retry until sound runs.
    if (!state.audioOk) AudioEngine.retry().then((ok) => { if (ok) state.audioOk = true; });
  }

  function arm() {
    state.armed = true;
    const opts = { capture: true, passive: true };

    // Earliest event each browser treats as a user activation:
    // mouse → pointerdown, touch/pen → pointerup / touchend, keyboard → keydown.
    window.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse') onGesture(); }, opts);
    window.addEventListener('pointerup', (e) => { if (e.pointerType !== 'mouse') onGesture(); }, opts);
    ['mousedown', 'touchend', 'click'].forEach((type) => window.addEventListener(type, onGesture, opts));
    window.addEventListener('keydown', (e) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if (['Escape', 'Tab', 'Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(e.key)) return;
      onGesture();
    }, opts);
  }

  /* ================================================================== MAIN */

  async function main() {
    setupDecoy();
    applyConfig();
    $('resetBtn').addEventListener('click', () => window.location.reload());
    // Coming back via the back button would restore the scared state.
    window.addEventListener('pageshow', (e) => { if (e.persisted) window.location.reload(); });

    const ms = CONFIG.timing.assetTimeoutMs;
    const visualReady = resolveVisual(CONFIG.visualSources, ms).then((v) => {
      if (state.triggered) return;
      state.visual = v;
      try { mountVisual(v); } catch (_) { state.visual = { kind: 'fallback' }; }
    });
    const audioReady = AudioEngine.preload(CONFIG.audioSources, ms);

    await runLoader(Promise.all([visualReady, audioReady]));
    app.dataset.state = 'ready';
    await sleep(CONFIG.timing.armDelayMs);
    arm();
  }

  main();
})();
