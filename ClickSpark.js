/* ════════════════════════════════════════════════════════════
   ClickSpark — click burst (vanilla JS port of the React component)
   Usage: ClickSpark.init({ sparkColor: [...], shape: 'line', sparkCount: 8, ... })
   Listens on the whole page; returns { spark(x, y), destroy() } (null on reduced motion off-switch not needed).
   ════════════════════════════════════════════════════════════ */
(function () {
  const EASINGS = {
    linear: (t) => t,
    'ease-in': (t) => t * t,
    'ease-out': (t) => 1 - Math.pow(1 - t, 3),
    'ease-in-out': (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    spring: (t) => 1 + 2.4 * Math.pow(t - 1, 3) + 1.4 * Math.pow(t - 1, 2),
  };
  const SHAPES = ['line', 'streak', 'dot', 'star'];
  const MAX_BURSTS = 32, GRAVITY = 500, REDUCED_MS = 320;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  const starPath = (ctx, x, y, radius, rotation) => {
    const pinch = radius * 0.16;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(rotation) * radius, y + Math.sin(rotation) * radius);
    for (let i = 1; i <= 4; i++) {
      const a = rotation + (i * Math.PI) / 2, mid = a - Math.PI / 4;
      ctx.quadraticCurveTo(x + Math.cos(mid) * pinch, y + Math.sin(mid) * pinch, x + Math.cos(a) * radius, y + Math.sin(a) * radius);
    }
    ctx.closePath();
  };

  const channels = (ctx, color) => {
    ctx.fillStyle = color;
    const normal = String(ctx.fillStyle);
    const hex = /^#([0-9a-f]{6})$/i.exec(normal);
    if (hex) { const v = parseInt(hex[1], 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; }
    const rgb = /^rgba?\(([^)]+)\)$/i.exec(normal);
    if (rgb) return rgb[1].split(',').slice(0, 3).map(parseFloat);
    return [0, 0, 0];
  };

  function init(options = {}) {
    const o = Object.assign({
      sparkColor: '#fff', sparkSize: 14, sparkRadius: 30, sparkCount: 8, sparkWidth: 2, duration: 500,
      easing: 'ease-out', extraScale: 1, shape: 'line', randomness: 0.2, gravity: 0, spread: 360,
      direction: 0, glow: 0, ring: false, zIndex: 160, disabled: false,
    }, options);

    const colors = (Array.isArray(o.sparkColor) ? o.sparkColor : [o.sparkColor]).filter(Boolean);
    const s = {
      colors: colors.length ? colors : ['#ffffff'],
      size: Math.max(0, o.sparkSize),
      radius: Math.max(0, o.sparkRadius) * Math.max(0, o.extraScale),
      count: clamp(Math.round(o.sparkCount), 1, 64),
      width: Math.max(0.5, o.sparkWidth),
      duration: Math.max(60, o.duration),
      ease: EASINGS[o.easing] || EASINGS['ease-out'],
      shape: SHAPES.includes(o.shape) ? o.shape : 'line',
      randomness: clamp(o.randomness, 0, 1),
      gravity: Math.max(0, o.gravity),
      spread: clamp(o.spread, 0, 360),
      direction: o.direction,
      glow: clamp(o.glow, 0, 1),
      ring: o.ring,
    };

    const layer = document.createElement('div');
    layer.className = 'click-spark';
    layer.setAttribute('aria-hidden', 'true');
    layer.style.zIndex = o.zIndex;
    document.body.appendChild(layer);

    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const bursts = [];
    let raf = 0;
    let lastPress = { time: -1e9, x: 0, y: 0 };

    const drop = (st, sec) => 0.5 * st.gravity * GRAVITY * sec * sec;
    const position = (b, sp, dist, sec) => [b.x + Math.cos(sp.angle) * dist, b.y + Math.sin(sp.angle) * dist + drop(b.settings, sec)];

    const drawSpark = (ctx, burst, sp, elapsed) => {
      const st = burst.settings;
      const life = reduced ? REDUCED_MS : st.duration * sp.life;
      const p = elapsed / life;
      if (p >= 1) return false;
      const e = reduced ? 0.55 : st.ease(clamp(p, 0, 1));
      const sec = reduced ? 0 : elapsed / 1000;
      const distance = st.radius * sp.reach * e;
      const width = st.width * sp.scale;
      const fade = reduced ? 1 - p : 1 - smoothstep(st.shape === 'line' ? 0.55 : 0.7, 1, p);
      if (fade <= 0) return true;
      ctx.strokeStyle = sp.color;
      ctx.fillStyle = sp.color;

      if (st.shape === 'line') {
        const length = st.size * sp.scale * (reduced ? 0.5 : Math.pow(1 - p, 1.6));
        const [x1, y1] = position(burst, sp, distance, sec);
        const [x2, y2] = position(burst, sp, distance + Math.max(0.01, length), sec);
        ctx.lineCap = 'round';
        if (sp.glow > 0) {
          ctx.globalAlpha = fade * 0.14 * sp.glow; ctx.lineWidth = width * 4.5;
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        }
        ctx.globalAlpha = fade; ctx.lineWidth = width;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        return true;
      }
      if (st.shape === 'streak') {
        const lag = reduced ? 0 : Math.min(elapsed, 70 + st.size * 4 * sp.scale);
        const back = reduced ? 0.4 : st.ease(clamp((elapsed - lag) / life, 0, 1));
        const [hx, hy] = position(burst, sp, distance, sec);
        const [tx, ty] = position(burst, sp, st.radius * sp.reach * back, Math.max(0, sec - lag / 1000));
        const dx = hx - tx, dy = hy - ty, len = Math.hypot(dx, dy) || 1;
        const nx = (-dy / len) * width * 0.5, ny = (dx / len) * width * 0.5;
        const paint = (w, alpha) => {
          const g = ctx.createLinearGradient(tx, ty, hx, hy);
          g.addColorStop(0, sp.clear); g.addColorStop(1, sp.color);
          ctx.globalAlpha = alpha; ctx.fillStyle = g;
          ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(hx + nx * w, hy + ny * w); ctx.lineTo(hx - nx * w, hy - ny * w); ctx.closePath(); ctx.fill();
          ctx.fillStyle = sp.color; ctx.beginPath(); ctx.arc(hx, hy, width * 0.5 * w, 0, Math.PI * 2); ctx.fill();
        };
        if (sp.glow > 0) paint(3.2, fade * 0.16 * sp.glow);
        paint(1, fade);
        return true;
      }
      if (st.shape === 'dot') {
        const [x, y] = position(burst, sp, distance, sec);
        const r = width * 1.25 * (1 - 0.5 * e);
        if (sp.glow > 0) { ctx.globalAlpha = fade * 0.18 * sp.glow; ctx.beginPath(); ctx.arc(x, y, r * 2.6, 0, Math.PI * 2); ctx.fill(); }
        ctx.globalAlpha = fade; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        return true;
      }
      const [x, y] = position(burst, sp, distance, sec);
      const twinkle = reduced ? 1 - p : Math.pow(Math.sin(Math.PI * clamp(p * 1.1, 0, 1)), 0.7);
      const r = st.size * 0.6 * sp.scale * twinkle;
      const rot = sp.angle + sp.spin * p * Math.PI * 0.5;
      if (r <= 0.05) return true;
      if (sp.glow > 0) { ctx.globalAlpha = fade * 0.2 * sp.glow; ctx.beginPath(); ctx.arc(x, y, r * 1.1, 0, Math.PI * 2); ctx.fill(); }
      ctx.globalAlpha = fade; starPath(ctx, x, y, r, rot); ctx.fill();
      return true;
    };

    const drawRing = (ctx, burst, elapsed) => {
      const st = burst.settings;
      const life = reduced ? REDUCED_MS : st.duration * 0.8;
      const p = elapsed / life;
      if (p >= 1) return false;
      const radius = 2 + st.radius * 0.6 * (reduced ? 0.6 : EASINGS['ease-out'](p));
      ctx.globalAlpha = Math.pow(1 - p, 2) * 0.7;
      ctx.strokeStyle = (burst.sparks[0] && burst.sparks[0].color) || st.colors[0];
      ctx.lineWidth = Math.max(0.5, st.width * (1 - p) * 0.9);
      ctx.beginPath(); ctx.arc(burst.x, burst.y, radius, 0, Math.PI * 2); ctx.stroke();
      return true;
    };

    const remove = (burst) => { burst.canvas.remove(); const i = bursts.indexOf(burst); if (i >= 0) bursts.splice(i, 1); };

    const frame = (now) => {
      raf = 0;
      for (const burst of [...bursts]) {
        const elapsed = now - burst.start, ctx = burst.ctx;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, burst.canvas.width, burst.canvas.height);
        ctx.setTransform(burst.ratio, 0, 0, burst.ratio, -burst.left * burst.ratio, -burst.top * burst.ratio);
        let alive = false;
        if (burst.settings.ring && drawRing(ctx, burst, elapsed)) alive = true;
        for (const sp of burst.sparks) if (drawSpark(ctx, burst, sp, elapsed)) alive = true;
        ctx.globalAlpha = 1;
        if (!alive) remove(burst);
      }
      if (bursts.length) raf = requestAnimationFrame(frame);
    };

    const spawn = (cx, cy) => {
      if (o.disabled) return;
      const offset = Math.floor(Math.random() * s.colors.length);
      const full = s.spread >= 359.5;
      const arc = (s.spread * Math.PI) / 180;
      const heading = ((s.direction - 90) * Math.PI) / 180;
      const step = full ? (Math.PI * 2) / s.count : s.count > 1 ? arc / (s.count - 1) : 0;
      const sparks = Array.from({ length: s.count }, (_, i) => {
        const base = full ? heading + step * i : s.count > 1 ? heading - arc / 2 + step * i : heading;
        const jitter = (Math.random() - 0.5) * s.randomness;
        return {
          angle: base + jitter * (step || arc || 1) * 0.9,
          reach: 1 + (Math.random() - 0.5) * 0.7 * s.randomness,
          scale: 1 + (Math.random() - 0.5) * 0.8 * s.randomness,
          life: 1 + (Math.random() - 0.5) * 0.5 * s.randomness,
          spin: Math.random() - 0.5,
          color: s.colors[(i + offset) % s.colors.length], clear: '', glow: 0,
        };
      });
      const longest = s.duration * (1 + 0.25 * s.randomness);
      const fall = drop(s, longest / 1000);
      const reach = s.radius * (1 + 0.35 * s.randomness) * (s.ease === EASINGS.spring ? 1.15 : 1) + s.size * (1 + 0.4 * s.randomness) + s.width * (s.glow > 0 ? 6 : 2) + 6;
      const box = {
        left: Math.max(cx - reach, 0), top: Math.max(cy - reach, 0),
        right: Math.min(cx + reach, window.innerWidth), bottom: Math.min(cy + reach + fall, window.innerHeight),
      };
      if (box.right - box.left < 1 || box.bottom - box.top < 1) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil((box.right - box.left) * ratio);
      canvas.height = Math.ceil((box.bottom - box.top) * ratio);
      Object.assign(canvas.style, { position: 'fixed', left: box.left + 'px', top: box.top + 'px', width: (box.right - box.left) + 'px', height: (box.bottom - box.top) + 'px', display: 'block', pointerEvents: 'none' });
      layer.appendChild(canvas);
      const ctx = canvas.getContext('2d');
      if (!ctx) { canvas.remove(); return; }
      for (const sp of sparks) {
        const [r, g, b] = channels(ctx, sp.color);
        sp.clear = `rgba(${r}, ${g}, ${b}, 0)`;
        sp.glow = s.glow * (0.35 + 0.65 * ((0.2126 * r + 0.7152 * g + 0.0722 * b) / 255));
      }
      bursts.push({ x: cx, y: cy, start: performance.now(), sparks, settings: Object.assign({}, s), canvas, ctx, ratio, left: box.left, top: box.top });
      while (bursts.length > MAX_BURSTS) remove(bursts[0]);
      if (!raf) raf = requestAnimationFrame(frame);
    };

    /* Taps: iOS Safari never fires "click" on the document for taps on non-interactive elements
       (Android does), so touch is handled with pointer/touch events instead. A tap = finger down and up
       close together in space and time; a drag/scroll does not spark. */
    let lastSpawn = { time: -1e9, x: 0, y: 0 };
    const fire = (x, y) => {
      lastSpawn = { time: performance.now(), x, y };
      spawn(x, y);
    };
    const recentNear = (x, y) => performance.now() - lastSpawn.time < 700 && Math.hypot(x - lastSpawn.x, y - lastSpawn.y) < 24;
    let tap = null;
    const TAP_MOVE = 12, TAP_MS = 600;
    const begin = (x, y, id) => { tap = { x, y, id, t: performance.now() }; };
    const finish = (x, y, id) => {
      const t = tap; tap = null;
      if (!t || t.id !== id) return;
      if (performance.now() - t.t > TAP_MS || Math.hypot(x - t.x, y - t.y) > TAP_MOVE) return;
      fire(x, y);
    };

    const onPointerDown = (e) => {
      if (e.pointerType === 'mouse') { if (e.button === 0) fire(e.clientX, e.clientY); return; }
      begin(e.clientX, e.clientY, e.pointerId);
    };
    const onPointerUp = (e) => { if (e.pointerType !== 'mouse') finish(e.clientX, e.clientY, e.pointerId); };
    const onPointerCancel = () => { tap = null; };
    // very old iOS without Pointer Events
    const onTouchStart = (e) => { const t = e.changedTouches[0]; if (t && e.touches.length === 1) begin(t.clientX, t.clientY, 'touch'); };
    const onTouchEnd = (e) => { const t = e.changedTouches[0]; if (t) finish(t.clientX, t.clientY, 'touch'); };
    const onTouchMove = (e) => {
      const t = e.changedTouches[0];
      if (tap && t && Math.hypot(t.clientX - tap.x, t.clientY - tap.y) > TAP_MOVE) tap = null;
    };
    // keyboard-activated "clicks" and anything the pointer path missed
    const onClick = (e) => {
      if (e.detail === 0) {
        const t = e.target instanceof Element ? e.target : document.body;
        const r = t.getBoundingClientRect();
        fire(r.left + r.width / 2, r.top + r.height / 2);
        return;
      }
      if (!recentNear(e.clientX, e.clientY)) fire(e.clientX, e.clientY);
    };

    const opt = { passive: true };
    const hasPointer = 'PointerEvent' in window;
    if (hasPointer) {
      document.addEventListener('pointerdown', onPointerDown, opt);
      document.addEventListener('pointerup', onPointerUp, opt);
      document.addEventListener('pointercancel', onPointerCancel, opt);
    } else {
      document.addEventListener('touchstart', onTouchStart, opt);
      document.addEventListener('touchmove', onTouchMove, opt);
      document.addEventListener('touchend', onTouchEnd, opt);
      document.addEventListener('mousedown', (e) => { if (e.button === 0 && !recentNear(e.clientX, e.clientY)) fire(e.clientX, e.clientY); }, opt);
    }
    document.addEventListener('click', onClick, opt);

    return {
      setColors(list) { const c = list.filter(Boolean); if (c.length) s.colors = c; },
      spark: (x, y) => spawn(x == null ? innerWidth / 2 : x, y == null ? innerHeight / 2 : y),
      destroy() {
        cancelAnimationFrame(raf);
        document.removeEventListener('pointerdown', onPointerDown);
        document.removeEventListener('pointerup', onPointerUp);
        document.removeEventListener('pointercancel', onPointerCancel);
        document.removeEventListener('touchstart', onTouchStart);
        document.removeEventListener('touchmove', onTouchMove);
        document.removeEventListener('touchend', onTouchEnd);
        document.removeEventListener('click', onClick);
        layer.remove();
      },
    };
  }

  window.ClickSpark = { init };
})();
