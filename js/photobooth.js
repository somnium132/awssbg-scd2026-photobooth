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
