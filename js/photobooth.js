/* =============================================================
   AWS SCD South Summit 2026 - Photobooth Logic (v2)
   ============================================================= */

(function () {
  'use strict';

  const STICKER_MAP = {"rocket": "🚀", "cloud": "☁️", "lightning": "⚡", "fire": "🔥", "bulb": "💡", "robot": "🤖", "target": "🎯", "laptop": "💻", "star": "🌟", "trophy": "🏆", "party": "🎉", "brain": "🧠", "satellite": "📡", "crystal": "🔮", "gear": "⚙️", "globe": "🌐"};

  // ── State ─────────────────────────────────────────────────
  let stream = null;
  let facingMode = 'user';
  let mode = 'strip';
  let selectedFrame = 'none';
  let captionColor = '#ffffff';
  let stickers = [];
  let gallery = [];
  let isCapturing = false;
  let stripShots = [];
  let draggingSticker = null;
  let dragOffset = { x: 0, y: 0 };
  let stickerIdCounter = 0;

  // ── Elements ──────────────────────────────────────────────
  const $ = id => document.getElementById(id);
  const video            = $('cameraFeed');
  const canvas           = $('photoCanvas');
  const ctx              = canvas.getContext('2d');
  const camError         = $('camError');
  const camErrorMsg      = $('camErrorMsg');
  const viewfinder       = $('viewfinder');
  const frameOverlay     = $('frameOverlay');
  const stickerLayer     = $('stickerLayer');
  const captionOverlay   = $('captionOverlay');
  const countdownOverlay = $('countdownOverlay');
  const countdownNum     = $('countdownNum');
  const flashOverlay     = $('flashOverlay');
  const framePicker      = $('framePicker');
  const stickerGrid      = $('stickerGrid');
  const captionInput     = $('captionInput');
  const galleryList      = $('galleryList');
  const btnCapture       = $('btnCapture');
  const btnDownload      = $('btnDownload');
  const btnRetake        = $('btnRetake');
  const btnFlip          = $('btnFlip');
  const btnRetryCamera   = $('btnRetryCamera');
  const btnClearStickers = $('btnClearStickers');
  const btnClearGallery  = $('btnClearGallery');
  const btnSingle        = $('btnSingle');
  const btnStrip         = $('btnStrip');
  const captureLabel     = $('captureLabel');
  const themeToggle      = $('themeToggle');

  // ── Theme ─────────────────────────────────────────────────
  themeToggle.addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('pb-theme', next); } catch (e) {}
  });
  try {
    const t = localStorage.getItem('pb-theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch (e) {}

  // ── Camera ────────────────────────────────────────────────
  function showCameraError(msg) {
    camError.hidden = false;
    video.hidden = true;
    if (camErrorMsg) camErrorMsg.textContent = msg || 'Camera access denied or unavailable.';
  }

  async function startCamera() {
    camError.hidden = true;

    // Check if getUserMedia is available at all
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showCameraError(
        window.location.protocol === 'file:'
          ? 'Camera requires HTTP/HTTPS. Open this page via a local server (e.g. VS Code Live Server).'
          : 'Your browser does not support camera access.'
      );
      return;
    }

    try {
      if (stream) stream.getTracks().forEach(t => t.stop());
      stream = null;

      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode, width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false
      });

      video.srcObject = stream;
      await video.play().catch(() => {});

      video.hidden = false;
      canvas.hidden = true;
      camError.hidden = true;
      btnRetake.hidden = true;
      btnDownload.hidden = true;
      btnCapture.hidden = false;
      btnCapture.disabled = false;
      stripShots = [];
    } catch (err) {
      console.error('Camera error:', err);
      let msg = 'Camera access denied or unavailable.';
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        msg = 'Camera permission denied. Click the camera icon in your browser address bar to allow access.';
      } else if (err.name === 'NotFoundError') {
        msg = 'No camera found on this device.';
      } else if (window.location.protocol === 'file:') {
        msg = 'Camera requires HTTP. Open via VS Code Live Server or python -m http.server.';
      }
      showCameraError(msg);
    }
  }

  function hasLiveStream() {
    return !!(stream && stream.active && !video.hidden && !video.paused);
  }

  btnFlip.addEventListener('click', () => {
    facingMode = facingMode === 'user' ? 'environment' : 'user';
    startCamera();
  });

  btnRetryCamera.addEventListener('click', startCamera);

  btnRetake.addEventListener('click', () => {
    canvas.hidden = true;
    video.hidden = false;
    btnRetake.hidden = true;
    btnDownload.hidden = true;
    btnCapture.hidden = false;
    btnCapture.disabled = false;
    stripShots = [];
    updateCaptureLabel();
  });

  // ── Mode ──────────────────────────────────────────────────
  btnSingle.addEventListener('click', () => setMode('single'));
  btnStrip.addEventListener('click',  () => setMode('strip'));

  function setMode(m) {
    mode = m;
    btnSingle.classList.toggle('active', m === 'single');
    btnStrip.classList.toggle('active',  m === 'strip');
    stripShots = [];
    updateCaptureLabel();
  }

  function updateCaptureLabel() {
    captureLabel.textContent = mode === 'strip' ? 'Snap Strip \u00d73' : 'Snap Photo';
  }

  setMode('strip');

  // ── Frame picker ──────────────────────────────────────────
  framePicker.addEventListener('click', e => {
    const opt = e.target.closest('.frame-opt');
    if (!opt) return;
    framePicker.querySelectorAll('.frame-opt').forEach(b => b.classList.remove('active'));
    opt.classList.add('active');
    selectedFrame = opt.dataset.frame;
    frameOverlay.setAttribute('data-frame', selectedFrame);
  });

  // ── Stickers ──────────────────────────────────────────────
  stickerGrid.addEventListener('click', e => {
    const btn = e.target.closest('.sticker-btn');
    if (!btn) return;
    addSticker(btn.dataset.sticker);
  });

  function addSticker(key) {
    const emoji = STICKER_MAP[key] || key;
    const id = ++stickerIdCounter;
    const vf = viewfinder.getBoundingClientRect();
    const x = 30 + Math.random() * Math.max(10, vf.width - 100);
    const y = 30 + Math.random() * Math.max(10, vf.height - 100);
    const s = { id, emoji, x, y, size: 44 };
    stickers.push(s);
    renderSticker(s);
  }

  function renderSticker(s) {
    const el = document.createElement('span');
    el.className = 'sticker-item';
    el.dataset.id = s.id;
    el.textContent = s.emoji;
    el.style.left = s.x + 'px';
    el.style.top  = s.y + 'px';
    el.style.fontSize = s.size + 'px';
    el.addEventListener('pointerdown', onStickerDragStart);
    el.addEventListener('dblclick', () => {
      stickers = stickers.filter(st => st.id !== s.id);
      el.remove();
    });
    stickerLayer.appendChild(el);
  }

  function onStickerDragStart(e) {
    e.preventDefault();
    e.stopPropagation();
    draggingSticker = e.currentTarget;
    const rect = draggingSticker.getBoundingClientRect();
    dragOffset.x = e.clientX - rect.left;
    dragOffset.y = e.clientY - rect.top;
    draggingSticker.setPointerCapture(e.pointerId);
    draggingSticker.classList.add('selected');
    document.addEventListener('pointermove', onStickerDragMove);
    document.addEventListener('pointerup', onStickerDragEnd);
  }

  function onStickerDragMove(e) {
    if (!draggingSticker) return;
    const vfRect = viewfinder.getBoundingClientRect();
    const x = e.clientX - vfRect.left - dragOffset.x;
    const y = e.clientY - vfRect.top  - dragOffset.y;
    draggingSticker.style.left = x + 'px';
    draggingSticker.style.top  = y + 'px';
    const id = parseInt(draggingSticker.dataset.id);
    const st = stickers.find(s => s.id === id);
    if (st) { st.x = x; st.y = y; }
  }

  function onStickerDragEnd() {
    if (draggingSticker) draggingSticker.classList.remove('selected');
    draggingSticker = null;
    document.removeEventListener('pointermove', onStickerDragMove);
    document.removeEventListener('pointerup', onStickerDragEnd);
  }

  btnClearStickers.addEventListener('click', () => {
    stickers = [];
    stickerLayer.innerHTML = '';
  });

  // ── Caption ───────────────────────────────────────────────
  captionInput.addEventListener('input', () => {
    captionOverlay.textContent = captionInput.value;
    captionOverlay.style.color = captionColor;
  });

  document.querySelectorAll('.cc-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.cc-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      captionColor = btn.dataset.color;
      captionOverlay.style.color = captionColor;
    });
  });

  // ── Capture ───────────────────────────────────────────────
  btnCapture.addEventListener('click', () => {
    if (isCapturing) return;
    // Guard: don't capture without a live camera
    if (!hasLiveStream()) {
      showCameraError('Please allow camera access first, then click "Try Again".');
      return;
    }
    if (mode === 'single') captureWithCountdown();
    else captureStrip();
  });

  function abortCapture() {
    isCapturing = false;
    btnCapture.disabled = false;
    countdownOverlay.hidden = true;  // always clear countdown
    updateCaptureLabel();
  }

  async function captureWithCountdown() {
    isCapturing = true;
    btnCapture.disabled = true;
    try {
      await countdown(3);
      await takePhoto();
    } catch (err) {
      console.error('Capture error:', err);
    } finally {
      abortCapture();
    }
  }

  async function captureStrip() {
    isCapturing = true;
    btnCapture.disabled = true;
    captureLabel.textContent = 'Snapping\u2026';
    stripShots = [];
    try {
      for (let i = 0; i < 3; i++) {
        await countdown(3);
        const dataUrl = await captureFrame();
        stripShots.push(dataUrl);
        if (i < 2) await sleep(500);
      }
      const stripDataUrl = await composeStrip(stripShots);
      showResult(stripDataUrl);
      addToGallery(stripDataUrl);
    } catch (err) {
      console.error('Strip capture error:', err);
    } finally {
      isCapturing = false;
      btnCapture.disabled = false;
      countdownOverlay.hidden = true;
      updateCaptureLabel();
    }
  }

  function countdown(n) {
    return new Promise((resolve, reject) => {
      // Safety: abort if stream died during countdown
      if (!hasLiveStream()) { reject(new Error('No stream')); return; }

      countdownOverlay.hidden = false;
      let count = n;
      countdownNum.textContent = count;
      restartAnim(countdownNum);

      const iv = setInterval(() => {
        count--;
        if (count <= 0) {
          clearInterval(iv);
          countdownOverlay.hidden = true;
          resolve();
        } else {
          countdownNum.textContent = count;
          restartAnim(countdownNum);
        }
      }, 1000);
    });
  }

  function restartAnim(el) {
    el.style.animation = 'none';
    void el.offsetHeight;
    el.style.animation = '';
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  async function takePhoto() {
    const dataUrl = await captureFrame();
    showResult(dataUrl);
    addToGallery(dataUrl);
  }

  function captureFrame() {
    return new Promise((resolve, reject) => {
      if (!hasLiveStream()) { reject(new Error('No live stream')); return; }

      // Flash effect
      flashOverlay.classList.add('active');
      setTimeout(() => flashOverlay.classList.remove('active'), 120);

      const w = viewfinder.offsetWidth;
      const h = viewfinder.offsetHeight;
      const scale = 2;

      canvas.width  = w * scale;
      canvas.height = h * scale;
      ctx.save();
      ctx.scale(scale, scale);

      // Mirror front-facing camera
      if (facingMode === 'user') {
        ctx.translate(w, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(video, 0, 0, w, h);
        ctx.setTransform(scale, 0, 0, scale, 0, 0);
      } else {
        ctx.drawImage(video, 0, 0, w, h);
      }

      // Draw stickers
      stickers.forEach(s => {
        ctx.font = s.size + 'px serif';
        ctx.fillText(s.emoji, s.x, s.y + s.size * 0.9);
      });

      // Draw caption
      const caption = captionInput.value.trim();
      if (caption) {
        ctx.font = 'bold 18px "IBM Plex Mono", monospace';
        ctx.fillStyle = captionColor;
        ctx.textAlign = 'center';
        ctx.shadowColor = 'rgba(0,0,0,0.9)';
        ctx.shadowBlur = 10;
        ctx.fillText(caption, w / 2, h - 24);
        ctx.shadowBlur = 0;
      }

      // Draw frame
      drawFrame(ctx, selectedFrame, w, h);
      ctx.restore();

      resolve(canvas.toDataURL('image/png'));
    });
  }

  function drawFrame(ctx, frame, w, h) {
    const colors = {
      blue: '#44b3fe', orange: '#fc9907', pink: '#fe57ea',
      green: '#07e383', purple: '#a759ff'
    };
    if (frame === 'none') return;
    if (colors[frame]) {
      ctx.strokeStyle = colors[frame];
      ctx.lineWidth = 18;
      ctx.strokeRect(9, 9, w - 18, h - 18);
    } else if (frame === 'summit') {
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, '#44b3fe');
      g.addColorStop(0.5, '#a759ff');
      g.addColorStop(1, '#fc9907');
      ctx.strokeStyle = g;
      ctx.lineWidth = 18;
      ctx.strokeRect(9, 9, w - 18, h - 18);
      ctx.fillStyle = '#161c24';
      ctx.fillRect(0, h - 40, w, 40);
      ctx.font = 'bold 11px "IBM Plex Mono", monospace';
      ctx.fillStyle = '#44b3fe';
      ctx.textAlign = 'center';
      ctx.fillText('AWS SCD \u00b7 SOUTH SUMMIT 2026', w / 2, h - 14);
    } else if (frame === 'pixel') {
      ctx.strokeStyle = '#161c24';
      ctx.lineWidth = 14;
      ctx.strokeRect(7, 7, w - 14, h - 14);
      ctx.strokeStyle = '#44b3fe';
      ctx.lineWidth = 3;
      ctx.strokeRect(3, 3, w - 6, h - 6);

    } else if (frame === 'blueprint') {
      // Drafting sheet: grid, ink rail, tick marks, title block
      ctx.save();
      const kl   = Math.max(3, Math.round(Math.min(w, h) * 0.006));
      const b    = Math.max(10, Math.min(22 - kl, Math.round(Math.min(w, h) * 0.032))); // capped clear of the caption line
      const cell = Math.round(Math.min(w, h) / 12);
      const cyan = '#42b2fe';

      // Faint grid
      ctx.globalAlpha = 0.10;
      ctx.strokeStyle = cyan;
      ctx.lineWidth = Math.max(1, Math.round(kl / 3));
      ctx.beginPath();
      for (let x = cell; x < w; x += cell) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
      for (let y = cell; y < h; y += cell) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Ink rail, shadowed inward
      ctx.shadowColor = 'rgba(0,0,0,.55)';
      ctx.shadowBlur = Math.round(b * 1.2);
      ctx.strokeStyle = '#0e1420';
      ctx.lineWidth = b;
      ctx.strokeRect(b / 2, b / 2, w - b, h - b);
      ctx.shadowBlur = 0;

      // Keyline
      ctx.strokeStyle = cyan;
      ctx.lineWidth = kl;
      ctx.strokeRect(b + kl / 2, b + kl / 2, w - (b + kl) , h - (b + kl));

      // Edge ticks
      const tk   = Math.min(9, Math.round(b * 0.5));
      const step = cell / 2;
      ctx.globalAlpha = 0.65;
      ctx.strokeStyle = cyan;
      ctx.lineWidth = kl;
      ctx.beginPath();
      for (let x = step; x < w - step; x += step) {
        const len = (Math.round(x / step) % 2 === 0) ? tk : tk * 0.55;
        ctx.moveTo(x, 0); ctx.lineTo(x, len);
      }
      ctx.stroke();
      ctx.beginPath();
      for (let x = step; x < w - step; x += step) {
        const len = (Math.round(x / step) % 2 === 0) ? tk : tk * 0.55;
        ctx.moveTo(x, h); ctx.lineTo(x, h - len);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Corner marks
      const cm = Math.round(Math.min(w, h) * 0.055);
      const q  = b + kl + 6;
      const bracket = (bx, by, dx, dy) => {
        ctx.beginPath();
        ctx.moveTo(bx, by + dy * cm);
        ctx.lineTo(bx, by);
        ctx.lineTo(bx + dx * cm, by);
        ctx.stroke();
      };
      ctx.strokeStyle = cyan;
      ctx.lineWidth = kl;
      bracket(q, q, 1, 1);
      bracket(w - q, q, -1, 1);
      bracket(q, h - q, 1, -1);
      bracket(w - q, h - q, -1, -1);

      // Title block, only when it fits above the face area
      const bfs = Math.max(11, Math.round(Math.min(w, h) * 0.027));
      const bph = Math.round(bfs * 1.9);
      const bpy = b + kl + 4;
      if (bpy + bph <= h * 0.10) {
        ctx.font = 'bold ' + bfs + 'px "IBM Plex Mono", monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        const tag   = 'SCD · SS 2026';
        const sheet = 'SHEET 01';
        const tw    = ctx.measureText(tag).width;
        const sw    = ctx.measureText(sheet).width;
        const pad   = Math.round(bfs * 0.8);
        const tbase = bpy + Math.round(bph * 0.68);
        ctx.fillStyle = 'rgba(14,20,32,.92)';
        ctx.fillRect(b + kl + 4, bpy, tw + pad * 2, bph);
        ctx.fillRect(w - b - kl - 4 - (sw + pad * 2), bpy, sw + pad * 2, bph);
        ctx.fillStyle = cyan;
        ctx.fillText(tag, b + kl + 4 + pad, tbase);
        ctx.fillStyle = '#fc9907';
        ctx.fillText(sheet, w - b - kl - 4 - sw - pad, tbase);
      }
      ctx.restore();

    } else if (frame === 'badge') {
      // Conference badge: header block, tier stripes, lanyard slot
      ctx.save();
      const kl   = Math.max(3, Math.round(Math.min(w, h) * 0.006));
      const b    = Math.max(8, Math.min(22 - kl, Math.round(Math.min(w, h) * 0.022)));
      const hb   = Math.round(h * 0.095);
      const fs   = Math.max(10, Math.round(hb * 0.34));
      const base = Math.round(hb / 2 + fs * 0.35);
      const st   = Math.min(9, Math.max(4, Math.round(h * 0.0125)));
      const ink  = '#161c24';
      const cols = ['#44b3fe', '#07e383', '#a759ff', '#fc9907', '#fe57ea'];
      const seg  = w / cols.length;

      // Scrim: lifts the caption instead of covering it
      const sc = ctx.createLinearGradient(0, h - h * 0.22, 0, h);
      sc.addColorStop(0, 'rgba(11,21,38,0)');
      sc.addColorStop(1, 'rgba(11,21,38,.45)');
      ctx.fillStyle = sc;
      ctx.fillRect(0, h - h * 0.22, w, h * 0.22);

      // Card edge
      ctx.shadowColor = 'rgba(0,0,0,.5)';
      ctx.shadowBlur = Math.round(b * 1.6);
      ctx.strokeStyle = ink;
      ctx.lineWidth = b;
      ctx.strokeRect(b / 2, b / 2, w - b, h - b);
      ctx.shadowBlur = 0;

      // Header block
      ctx.fillStyle = ink;
      ctx.fillRect(0, 0, w, hb);

      // Tier stripes
      for (let i = 0; i < cols.length; i++) {
        ctx.fillStyle = cols[i];
        ctx.fillRect(i * seg, 0, seg, st);
        ctx.fillRect(i * seg, h - st, seg, st);
      }

      // Lanyard slot
      const slotW = Math.round(w * 0.13);
      const slotH = Math.max(6, Math.round(hb * 0.2));
      const sx    = (w - slotW) / 2;
      const sy    = Math.round(hb * 0.44);
      ctx.fillStyle = '#0d111a';
      ctx.fillRect(sx, sy, slotW, slotH);
      ctx.strokeStyle = 'rgba(255,255,255,.22)';
      ctx.lineWidth = kl;
      ctx.strokeRect(sx, sy, slotW, slotH);

      // Header text
      ctx.font = 'bold ' + fs + 'px "IBM Plex Mono", monospace';
      ctx.textBaseline = 'alphabetic';
      ctx.textAlign = 'left';
      ctx.fillStyle = '#44b3fe';
      ctx.fillText('ATTENDEE', b + fs * 0.7, base);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#f5f7fb';
      ctx.fillText('SCD · SS 2026', w - b - fs * 0.7, base);

      // Accent line
      ctx.strokeStyle = '#44b3fe';
      ctx.lineWidth = kl;
      ctx.beginPath();
      ctx.moveTo(b, hb);
      ctx.lineTo(w - b, hb);
      ctx.stroke();
      ctx.restore();

    } else if (frame === 'gridbox') {
      // Brand boxes on the 52px grid, edges only
      ctx.save();
      const s    = Math.round(Math.min(w, h) / 9.2);
      const half = Math.round(s / 2);
      const rail = Math.max(6, Math.min(14, Math.round(Math.min(w, h) * 0.017)));

      // Module grid
      ctx.globalAlpha = 0.09;
      ctx.strokeStyle = '#8b96b3';
      ctx.lineWidth = Math.max(1, Math.round(rail / 8));
      ctx.beginPath();
      for (let x = s; x < w; x += s) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
      for (let y = s; y < h; y += s) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Ink rail
      ctx.strokeStyle = '#161c24';
      ctx.lineWidth = rail;
      ctx.strokeRect(rail / 2, rail / 2, w - rail, h - rail);

      // Boxes
      const boxes = [
        [0, 0, s, '#fe57ea'],
        [s, 0, half, '#44b3fe'],
        [0, s, half, '#fc9907'],
        [w - s, 0, s, '#44b3fe'],
        [w - s - half, 0, half, '#07e383'],
        [0, h - s, s, '#a759ff'],
        [s, h - half, half, '#fc9907'],
        [w - s, h - s, s, '#07e383'],
        [w - s - half, h - half, half, '#fe57ea'],
        [0, Math.round(h * 0.45), half, '#07e383'],
        [w - half, Math.round(h * 0.38), half, '#a759ff']
      ];
      ctx.shadowColor = 'rgba(0,0,0,.45)';
      ctx.shadowBlur = Math.round(s * 0.23);
      for (let i = 0; i < boxes.length; i++) {
        ctx.fillStyle = boxes[i][3];
        ctx.fillRect(boxes[i][0], boxes[i][1], boxes[i][2], boxes[i][2]);
      }
      ctx.shadowBlur = 0;
      ctx.restore();

    } else if (frame === 'aurora') {
      // Hero gradient aperture
      ctx.save();
      const kl = Math.max(3, Math.round(Math.min(w, h) * 0.006));
      const b  = Math.max(12, Math.min(22 - kl, Math.round(Math.min(w, h) * 0.038)));
      const hero = () => {
        const g = ctx.createLinearGradient(0, 0, w * 0.94, h * 0.34);
        g.addColorStop(0,    '#fe55eb');
        g.addColorStop(0.25, '#ad5cfd');
        g.addColorStop(0.5,  '#42b2fe');
        g.addColorStop(0.75, '#00e681');
        g.addColorStop(1,    '#fe55eb');
        return g;
      };

      // Outer glow
      ctx.shadowColor = 'rgba(66,178,254,.75)';
      ctx.shadowBlur = Math.round(b * 1.8);
      ctx.strokeStyle = hero();
      ctx.lineWidth = b;
      ctx.strokeRect(b / 2, b / 2, w - b, h - b);
      ctx.shadowBlur = 0;

      // Gradient rail
      ctx.strokeStyle = hero();
      ctx.lineWidth = b;
      ctx.strokeRect(b / 2, b / 2, w - b, h - b);

      // Ink keyline so the edge still reads on a bright background
      ctx.strokeStyle = 'rgba(11,21,38,.85)';
      ctx.lineWidth = kl;
      ctx.strokeRect(b + kl / 2, b + kl / 2, w - (b + kl), h - (b + kl));

      // Vignette
      const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.34,
                                          w / 2, h / 2, Math.max(w, h) * 0.62);
      vg.addColorStop(0, 'rgba(11,21,38,0)');
      vg.addColorStop(1, 'rgba(11,21,38,.38)');
      ctx.fillStyle = vg;
      ctx.fillRect(b, b, w - b * 2, h - b * 2);

      // Corner accents
      const a = Math.round(Math.min(w, h) * 0.045);
      const o = b + kl + 6;
      const tick = (tx, ty, dx, dy) => {
        ctx.beginPath();
        ctx.moveTo(tx, ty + dy * a);
        ctx.lineTo(tx, ty);
        ctx.lineTo(tx + dx * a, ty);
        ctx.stroke();
      };
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = '#f5f7fb';
      ctx.lineWidth = kl;
      tick(o, o, 1, 1);
      tick(w - o, o, -1, 1);
      tick(o, h - o, 1, -1);
      tick(w - o, h - o, -1, -1);
      ctx.globalAlpha = 1;
      ctx.restore();

    } else if (frame === 'terminal') {
      // Console HUD: status rail with a prompt
      ctx.save();
      const kl   = Math.max(3, Math.round(Math.min(w, h) * 0.006));
      const b    = Math.max(8, Math.min(22 - kl, Math.round(Math.min(w, h) * 0.022)));
      const hb   = Math.round(h * 0.095);
      const fs   = Math.max(10, Math.round(hb * 0.34));
      const base = Math.round(hb / 2 + fs * 0.35);
      const ink  = '#0d111a';

      // Scrim
      const sc = ctx.createLinearGradient(0, h - h * 0.2, 0, h);
      sc.addColorStop(0, 'rgba(13,17,26,0)');
      sc.addColorStop(1, 'rgba(13,17,26,.45)');
      ctx.fillStyle = sc;
      ctx.fillRect(0, h - h * 0.2, w, h * 0.2);

      // Frame
      ctx.shadowColor = 'rgba(0,0,0,.55)';
      ctx.shadowBlur = Math.round(b * 1.6);
      ctx.strokeStyle = ink;
      ctx.lineWidth = b;
      ctx.strokeRect(b / 2, b / 2, w - b, h - b);
      ctx.shadowBlur = 0;

      // Status rail
      ctx.fillStyle = ink;
      ctx.fillRect(0, 0, w, hb);
      ctx.strokeStyle = '#07e383';
      ctx.lineWidth = kl;
      ctx.beginPath();
      ctx.moveTo(0, hb);
      ctx.lineTo(w, hb);
      ctx.stroke();

      // Prompt + cursor
      ctx.font = 'bold ' + fs + 'px "IBM Plex Mono", monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      const prompt = '> build.power.lead';
      ctx.fillStyle = '#07e383';
      ctx.fillText(prompt, b + fs * 0.7, base);
      ctx.fillRect(b + fs * 1.0 + ctx.measureText(prompt).width,
                   base - fs * 0.78, fs * 0.6, fs);

      // Event id + dot
      ctx.textAlign = 'right';
      ctx.fillStyle = '#f5f7fb';
      ctx.fillText('SCD · SS 2026', w - b - fs * 1.9, base);
      ctx.fillStyle = '#fe57ea';
      ctx.beginPath();
      ctx.arc(w - b - fs * 0.85, base - fs * 0.32, fs * 0.32, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

    } else if (frame === 'chipdie') {
      // Chip die: notched bezel built from the event chip mark
      ctx.save();
      const kl   = Math.max(3, Math.round(Math.min(w, h) * 0.006));
      const b    = Math.max(12, Math.min(20 - kl, Math.round(Math.min(w, h) * 0.040)));
      const t    = Math.max(5, Math.round(b * 0.5));
      const blue = '#44b3fe';

      // Die body
      ctx.shadowColor = 'rgba(0,0,0,.5)';
      ctx.shadowBlur = Math.round(b * 1.3);
      ctx.strokeStyle = '#161c24';
      ctx.lineWidth = b;
      ctx.strokeRect(b / 2, b / 2, w - b, h - b);
      ctx.shadowBlur = 0;

      // Teeth
      const stepT = t * 3;
      ctx.fillStyle = blue;
      for (let x = stepT; x < w - stepT; x += stepT) {
        ctx.fillRect(x, b - t, t, t);
        ctx.fillRect(x, h - b, t, t);
      }
      for (let y = stepT; y < h - stepT; y += stepT) {
        ctx.fillRect(b - t, y, t, t);
        ctx.fillRect(w - b, y, t, t);
      }

      // Corner pads
      const p = Math.round(t * 1.4);
      ctx.fillRect(b - t, b - t, p, p);
      ctx.fillRect(w - b + t - p, b - t, p, p);
      ctx.fillRect(b - t, h - b + t - p, p, p);
      ctx.fillRect(w - b + t - p, h - b + t - p, p, p);

      // Keyline
      ctx.strokeStyle = blue;
      ctx.lineWidth = kl;
      ctx.strokeRect(b + kl / 2, b + kl / 2, w - (b + kl), h - (b + kl));

      // Inner glow
      ctx.globalAlpha = 0.5;
      ctx.shadowColor = 'rgba(68,179,254,.9)';
      ctx.shadowBlur = Math.round(b * 0.8);
      ctx.strokeStyle = 'rgba(68,179,254,.45)';
      ctx.lineWidth = kl;
      ctx.strokeRect(b + kl * 1.5, b + kl * 1.5, w - (b + kl * 1.5) * 2, h - (b + kl * 1.5) * 2);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
      ctx.restore();
    }
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to load image for strip'));
      img.src = src;
    });
  }

  async function composeStrip(shots) {
    const stripW = 340;
    const thumbH = 255;
    const pad = 12;
    const labelH = 52;
    const totalH = shots.length * (thumbH + pad) + pad + labelH;

    const sc = document.createElement('canvas');
    sc.width  = stripW;
    sc.height = totalH;
    const sctx = sc.getContext('2d');

    sctx.fillStyle = '#0d111a';
    sctx.fillRect(0, 0, stripW, totalH);

    // Grid lines bg
    sctx.strokeStyle = 'rgba(68,179,254,0.07)';
    sctx.lineWidth = 1;
    for (let y = 0; y < totalH; y += 26) {
      sctx.beginPath(); sctx.moveTo(0, y); sctx.lineTo(stripW, y); sctx.stroke();
    }
    for (let x = 0; x < stripW; x += 26) {
      sctx.beginPath(); sctx.moveTo(x, 0); sctx.lineTo(x, totalH); sctx.stroke();
    }

    const loadedImgs = await Promise.all(shots.map(url => loadImage(url)));

    loadedImgs.forEach((img, i) => {
      const y = pad + i * (thumbH + pad);
      sctx.drawImage(img, pad, y, stripW - pad * 2, thumbH);
      // Mini brand label
      sctx.fillStyle = 'rgba(22,28,36,0.85)';
      sctx.fillRect(pad, y, 92, 20);
      sctx.font = 'bold 9px "IBM Plex Mono", monospace';
      sctx.fillStyle = '#44b3fe';
      sctx.textAlign = 'left';
      sctx.fillText('SCD SS 2026', pad + 8, y + 14);
    });

    // Footer bar
    const fy = totalH - labelH;
    sctx.fillStyle = '#161c24';
    sctx.fillRect(0, fy, stripW, labelH);
    const cols = ['#44b3fe','#07e383','#a759ff','#fc9907','#fe57ea'];
    cols.forEach((c, i) => {
      sctx.fillStyle = c;
      sctx.fillRect(i * (stripW / cols.length), fy, stripW / cols.length, 4);
    });
    sctx.font = 'bold 10px "IBM Plex Mono", monospace';
    sctx.fillStyle = '#44b3fe';
    sctx.textAlign = 'center';
    sctx.fillText('AWS SCD \u00b7 SOUTH SUMMIT 2026', stripW / 2, fy + 24);
    sctx.font = '9px "IBM Plex Mono", monospace';
    sctx.fillStyle = '#5b6584';
    sctx.fillText('Cloud \u00d7 AI: Build. Power. Lead.', stripW / 2, fy + 40);

    return sc.toDataURL('image/png');
  }

  function showResult(dataUrl) {
    const img = new Image();
    img.onload = () => {
      canvas.width  = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      canvas.hidden  = false;
      video.hidden   = true;
      btnRetake.hidden   = false;
      btnDownload.hidden = false;
      btnCapture.hidden  = true;
      btnCapture.disabled = false;
      btnDownload.dataset.url = dataUrl;
    };
    img.src = dataUrl;
  }

  function dataURItoBlob(dataURI) {
    const byteString = atob(dataURI.split(',')[1]);
    const mimeString = (dataURI.split(',')[0].split(':')[1] || '').split(';')[0] || 'image/png';
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) {
      ia[i] = byteString.charCodeAt(i);
    }
    return new Blob([ab], { type: mimeString });
  }

  function downloadPhoto(dataUrl, name) {
    if (!dataUrl) return;
    const filename = (name || ('aws_scd_photo_' + Date.now())).replace(/(\.png)?$/i, '.png');
    try {
      const blob = dataURItoBlob(dataUrl);
      const blobUrl = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = blobUrl;
      a.download = filename;

      document.body.appendChild(a);
      a.click();

      setTimeout(() => {
        if (a.parentNode) a.parentNode.removeChild(a);
        URL.revokeObjectURL(blobUrl);
      }, 4000);
    } catch (e) {
      console.error('Download error:', e);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = dataUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  }

  btnDownload.addEventListener('click', () => {
    const url = btnDownload.dataset.url;
    downloadPhoto(url, 'aws_scd_photo_' + Date.now() + '.png');
  });

  // ── Gallery ───────────────────────────────────────────────
  function addToGallery(dataUrl) {
    gallery.unshift(dataUrl);
    renderGallery();
  }

  function renderGallery() {
    if (gallery.length === 0) {
      galleryList.innerHTML = '<div class="gallery-empty"><span>📷</span><p>Your photos appear here</p></div>';
      return;
    }
    galleryList.innerHTML = '';
    gallery.forEach((url, i) => {
      const item = document.createElement('div');
      item.className = 'gallery-item';

      const img = document.createElement('img');
      img.src = url;
      img.alt = 'Photo ' + (i + 1);
      item.appendChild(img);

      const actions = document.createElement('div');
      actions.className = 'gallery-item-actions';

      const dlBtn = document.createElement('button');
      dlBtn.className = 'gallery-action-btn dl';
      dlBtn.textContent = 'Save';
      dlBtn.addEventListener('click', e => {
        e.stopPropagation();
        downloadPhoto(url, 'aws_scd_gallery_' + (i + 1) + '_' + Date.now() + '.png');
      });

      const rmBtn = document.createElement('button');
      rmBtn.className = 'gallery-action-btn rm';
      rmBtn.textContent = 'Del';
      rmBtn.addEventListener('click', e => {
        e.stopPropagation();
        gallery.splice(i, 1);
        renderGallery();
      });

      actions.appendChild(dlBtn);
      actions.appendChild(rmBtn);
      item.appendChild(actions);
      item.addEventListener('click', () => showResult(url));
      galleryList.appendChild(item);
    });
  }

  btnClearGallery.addEventListener('click', () => { gallery = []; renderGallery(); });

  // ── Init ──────────────────────────────────────────────────
  // Ensure download is hidden on load
  btnDownload.hidden = true;
  btnRetake.hidden = true;

  startCamera();
  renderGallery();

})();
