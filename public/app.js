const video = document.getElementById('video');
const canvas = document.getElementById('viewfinder');
const ctx = canvas.getContext('2d');
const filterBtns = document.querySelectorAll('.filter-btn');
const filterLabel = document.getElementById('filter-label');
const shutterBtn = document.getElementById('shutter');
const flipBtn = document.getElementById('flip-btn');
const previewOverlay = document.getElementById('preview-overlay');
const successOverlay = document.getElementById('success-overlay');
const previewImg = document.getElementById('preview-img');

let currentFilter = 'grain';
let facingMode = 'environment'; // rear camera by default
let stream = null;
let animFrame = null;
let capturedDataURL = null;

const filterNames = { grain: 'Film Grain', warm: 'Warm Golden', bw: 'Black & White', disposable: 'Disposable' };

async function startCamera() {
  if (stream) stream.getTracks().forEach(t => t.stop());
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false
    });
    video.srcObject = stream;
    video.onloadedmetadata = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = window.innerWidth + 'px';
      canvas.style.height = window.innerHeight + 'px';
      ctx.scale(dpr, dpr);
      drawFrame();
    };
  } catch (e) {
    alert('Camera access denied. Please allow camera permission and reload.');
  }
}

function drawFrame() {
  const vw = video.videoWidth, vh = video.videoHeight;
  const cw = canvas.width, ch = canvas.height;
  // Cover-fit: scale video to fill the canvas without distortion
  const scale = Math.max(cw / vw, ch / vh);
  const sw = vw * scale, sh = vh * scale;
  ctx.drawImage(video, (cw - sw) / 2, (ch - sh) / 2, sw, sh);
  applyFilter(ctx, cw, ch, currentFilter);
  animFrame = requestAnimationFrame(drawFrame);
}

function applyFilter(ctx, w, h, filter) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;

  if (filter === 'bw') {
    for (let i = 0; i < d.length; i += 4) {
      const g = d[i]*0.299 + d[i+1]*0.587 + d[i+2]*0.114;
      d[i] = d[i+1] = d[i+2] = g;
    }
  } else if (filter === 'warm') {
    for (let i = 0; i < d.length; i += 4) {
      d[i]   = Math.min(255, d[i]   * 1.12);
      d[i+1] = Math.min(255, d[i+1] * 1.04);
      d[i+2] = Math.max(0,   d[i+2] * 0.88);
    }
  } else if (filter === 'disposable') {
    for (let i = 0; i < d.length; i += 4) {
      d[i]   = Math.min(255, d[i]   * 1.15 + 10);
      d[i+1] = Math.min(255, d[i+1] * 1.05 + 5);
      d[i+2] = Math.max(0,   d[i+2] * 0.90);
    }
    // Vignette
    const cx = w / 2, cy = h / 2;
    const maxDist = Math.sqrt(cx*cx + cy*cy);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        const dist = Math.sqrt((x-cx)**2 + (y-cy)**2);
        const v = 1 - Math.pow(dist / maxDist, 1.5) * 0.55;
        d[idx] *= v; d[idx+1] *= v; d[idx+2] *= v;
      }
    }
  }

  if (filter === 'grain' || filter === 'disposable') {
    for (let i = 0; i < d.length; i += 4) {
      const noise = (Math.random() - 0.5) * 40;
      d[i]   = Math.min(255, Math.max(0, d[i]   + noise));
      d[i+1] = Math.min(255, Math.max(0, d[i+1] + noise));
      d[i+2] = Math.min(255, Math.max(0, d[i+2] + noise));
    }
    // Warm tone for grain filter
    if (filter === 'grain') {
      for (let i = 0; i < d.length; i += 4) {
        d[i]   = Math.min(255, d[i]   * 1.05);
        d[i+2] = Math.max(0,   d[i+2] * 0.95);
      }
    }
  }

  ctx.putImageData(img, 0, 0);
}

// Filter button switching
filterBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    filterBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    filterLabel.textContent = filterNames[currentFilter];
  });
});

// Flip camera
flipBtn.addEventListener('click', () => {
  facingMode = facingMode === 'environment' ? 'user' : 'environment';
  startCamera();
});

// Take photo
shutterBtn.addEventListener('click', () => {
  cancelAnimationFrame(animFrame);
  // Capture at full video resolution for quality
  const captureCanvas = document.createElement('canvas');
  captureCanvas.width = video.videoWidth;
  captureCanvas.height = video.videoHeight;
  const captureCtx = captureCanvas.getContext('2d');
  captureCtx.drawImage(video, 0, 0);
  applyFilter(captureCtx, captureCanvas.width, captureCanvas.height, currentFilter);
  capturedDataURL = captureCanvas.toDataURL('image/jpeg', 0.92);
  previewImg.src = capturedDataURL;
  previewOverlay.classList.remove('hidden');
});

// Retake
document.getElementById('retake-btn').addEventListener('click', () => {
  previewOverlay.classList.add('hidden');
  drawFrame();
});

// Upload
document.getElementById('upload-btn').addEventListener('click', async () => {
  const uploadBtn = document.getElementById('upload-btn');
  uploadBtn.textContent = 'Uploading...';
  uploadBtn.disabled = true;

  const blob = await (await fetch(capturedDataURL)).blob();
  const form = new FormData();
  form.append('photo', blob, 'wedding.jpg');

  try {
    const res = await fetch('/upload', { method: 'POST', body: form });
    const data = await res.json();
    if (data.success) {
      previewOverlay.classList.add('hidden');
      successOverlay.classList.remove('hidden');
    } else {
      alert('Upload failed. Please try again.');
    }
  } catch (e) {
    alert('Something went wrong. Please try again.');
  } finally {
    uploadBtn.textContent = 'Upload 📷';
    uploadBtn.disabled = false;
  }
});

// Take another
document.getElementById('another-btn').addEventListener('click', () => {
  successOverlay.classList.add('hidden');
  drawFrame();
});

startCamera();