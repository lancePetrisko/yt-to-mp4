/**
 * YT Downloader — renderer process
 * All Node/Electron calls go through window.electronAPI (contextBridge)
 */

let outputFolder = null;
// Map of id -> { url, quality, format, status, percent }
const queue = new Map();

// ── DOM refs ──────────────────────────────────────────────────────────────────
const queueList    = document.getElementById('queueList');
const emptyState   = document.getElementById('emptyState');
const folderPath   = document.getElementById('folderPath');
const btnPickFolder = document.getElementById('btnPickFolder');
const btnAddUrl    = document.getElementById('btnAddUrl');
const btnStartAll  = document.getElementById('btnStartAll');
const modalOverlay = document.getElementById('modalOverlay');
const btnModalCancel = document.getElementById('btnModalCancel');
const btnModalAdd  = document.getElementById('btnModalAdd');
const inputUrl     = document.getElementById('inputUrl');
const inputQuality = document.getElementById('inputQuality');

// ── Platform helpers ──────────────────────────────────────────────────────────
function getPlatformLabel(platform) {
  return (PLATFORM_CONFIG[platform] || PLATFORM_CONFIG.youtube).label;
}

function getPlatformColor(platform) {
  return (PLATFORM_CONFIG[platform] || PLATFORM_CONFIG.youtube).color;
}

function updateQualityOptions(platform) {
  const cfg = PLATFORM_CONFIG[platform] || PLATFORM_CONFIG.youtube;
  inputQuality.innerHTML = cfg.qualityOptions
    .map(o => `<option value="${o.value}">${o.label}</option>`)
    .join('');
  inputQuality.value = cfg.defaultQuality;
}

function detectAndUpdateModal(url) {
  const trimmed = url.trim();
  const hint    = document.getElementById('platformHint');
  const errorEl = document.getElementById('urlError');
  const labelEl = document.getElementById('labelInputUrl');

  if (!trimmed) {
    hint.classList.add('hidden');
    errorEl.classList.add('hidden');
    inputUrl.classList.remove('error');
    labelEl.textContent = 'URL';
    updateQualityOptions('youtube');
    return;
  }

  const platform = detectPlatform(trimmed);

  if (!platform) {
    hint.classList.add('hidden');
    inputUrl.classList.add('error');
    errorEl.textContent = 'Unsupported platform. Paste a YouTube, Twitch VOD (twitch.tv/videos/…), or Kick URL.';
    errorEl.classList.remove('hidden');
    return;
  }

  inputUrl.classList.remove('error');
  errorEl.classList.add('hidden');

  const cfg = PLATFORM_CONFIG[platform];
  hint.textContent = cfg.label;
  hint.style.setProperty('--platform-color', cfg.color);
  hint.classList.remove('hidden');
  labelEl.textContent = `${cfg.label} URL`;
  updateQualityOptions(platform);
}

// ── Modal ─────────────────────────────────────────────────────────────────────
function openModal() {
  inputUrl.value = '';
  document.getElementById('platformHint').classList.add('hidden');
  document.getElementById('urlError').classList.add('hidden');
  document.getElementById('labelInputUrl').textContent = 'URL';
  inputUrl.classList.remove('error');
  updateQualityOptions('youtube');
  document.getElementById('fmtMp4').checked = true;
  modalOverlay.classList.remove('hidden');
  setTimeout(() => inputUrl.focus(), 50);
}

function closeModal() {
  modalOverlay.classList.add('hidden');
}

btnAddUrl.addEventListener('click', openModal);
btnModalCancel.addEventListener('click', closeModal);

modalOverlay.addEventListener('click', (e) => {
  if (e.target === modalOverlay) closeModal();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});

btnModalAdd.addEventListener('click', addFromModal);

inputUrl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addFromModal();
});

inputUrl.addEventListener('input', () => detectAndUpdateModal(inputUrl.value));

async function addFromModal() {
  const url = inputUrl.value.trim();
  if (!url) {
    inputUrl.focus();
    return;
  }

  const platform = detectPlatform(url);
  if (!platform) {
    const errorEl = document.getElementById('urlError');
    errorEl.textContent = 'Unsupported platform. Only YouTube, Twitch VODs, and Kick are supported.';
    errorEl.classList.remove('hidden');
    inputUrl.classList.add('error');
    return;
  }

  const quality = inputQuality.value;
  const format  = document.querySelector('input[name="format"]:checked').value;

  closeModal();

  try {
    const res = await window.electronAPI.addDownload({
      url,
      quality,
      format,
      outputFolder,
      platform,
    });

    if (res.error) {
      alert('Error adding download: ' + res.error);
      return;
    }

    queue.set(res.id, { url, quality, format, platform, status: 'queued', percent: 0 });
    renderQueueItem(res.id);
    updateEmptyState();
  } catch (err) {
    alert('Failed to contact download server: ' + err.message);
  }
}

// ── Folder picker ─────────────────────────────────────────────────────────────
btnPickFolder.addEventListener('click', async () => {
  const folder = await window.electronAPI.selectFolder();
  if (folder) {
    outputFolder = folder;
    folderPath.textContent = folder;
    folderPath.title = folder;
  }
});

// ── Start All ─────────────────────────────────────────────────────────────────
btnStartAll.addEventListener('click', () => {
  for (const [id, item] of queue.entries()) {
    if (item.status === 'queued') {
      startItem(id);
    }
  }
});

async function startItem(id) {
  const item = queue.get(id);
  if (!item || item.status !== 'queued') return;

  item.status = 'downloading';
  updateItemUI(id);

  try {
    const res = await window.electronAPI.startDownload(id);
    if (res.error) {
      item.status = 'error';
      setStatusLabel(id, res.error, 'error');
      updateItemUI(id);
    }
  } catch (err) {
    item.status = 'error';
    setStatusLabel(id, err.message, 'error');
    updateItemUI(id);
  }
}

async function cancelItem(id) {
  const item = queue.get(id);
  if (!item) return;
  try {
    await window.electronAPI.cancelDownload(id);
  } catch (_) {}
  item.status = 'cancelled';
  updateItemUI(id);
}

function removeItem(id) {
  // If running, cancel first
  const item = queue.get(id);
  if (item && (item.status === 'downloading' || item.status === 'merging')) {
    window.electronAPI.cancelDownload(id).catch(() => {});
  }
  queue.delete(id);
  const el = document.getElementById(`item-${id}`);
  if (el) el.remove();
  updateEmptyState();
}

// ── Progress events ───────────────────────────────────────────────────────────
window.electronAPI.onProgress((data) => {
  const { id, percent, status, message } = data;
  const item = queue.get(id);
  if (!item) return;

  if (percent !== null && percent !== undefined) {
    item.percent = percent;
  }
  item.status = status;

  updateItemUI(id);

  const labelClass = status === 'done' ? 'done'
    : status === 'error' ? 'error'
    : status === 'merging' ? 'merging'
    : '';

  setStatusLabel(id, message || status, labelClass);
});

// ── Render helpers ────────────────────────────────────────────────────────────
function renderQueueItem(id) {
  const item = queue.get(id);
  if (!item) return;

  const div = document.createElement('div');
  div.className = 'queue-item status-queued';
  div.id = `item-${id}`;

  const truncUrl = item.url.length > 70
    ? item.url.slice(0, 67) + '…'
    : item.url;

  const isTwitchAudio = item.platform === 'twitch' && item.quality === 'audio';
  const formatClass = (item.format === 'mp3' || isTwitchAudio) ? 'mp3' : '';
  const formatLabel = (item.format === 'mp3' || isTwitchAudio) ? 'MP3' : 'MP4';

  const platColor = getPlatformColor(item.platform);
  const platLabel = getPlatformLabel(item.platform);

  const qOpts = (PLATFORM_CONFIG[item.platform] || PLATFORM_CONFIG.youtube).qualityOptions;
  const qSelectHtml = qOpts.map(o =>
    `<option value="${o.value}"${o.value === item.quality ? ' selected' : ''}>${o.label}</option>`
  ).join('');

  div.innerHTML = `
    <div class="item-top">
      <div class="item-thumb">▶</div>
      <div class="item-info">
        <div class="item-url" title="${escapeHtml(item.url)}">${escapeHtml(truncUrl)}</div>
        <div class="item-badges">
          <span class="badge badge-platform" style="--platform-color:${platColor}" id="badge-p-${id}">${platLabel}</span>
          <span class="badge badge-quality" id="badge-q-${id}">${escapeHtml(item.quality)}</span>
          <span class="badge badge-format ${formatClass}" id="badge-f-${id}">${formatLabel}</span>
        </div>
      </div>
      <div class="item-controls">
        <select class="item-select" id="sel-q-${id}" title="Quality">
          ${qSelectHtml}
        </select>
        <select class="item-select" id="sel-f-${id}" title="Format">
          <option value="mp4"${item.format === 'mp4' ? ' selected' : ''}>MP4</option>
          <option value="mp3"${item.format === 'mp3' ? ' selected' : ''}>MP3</option>
        </select>
        <button class="btn btn-log" id="btn-log-${id}" title="View logs">Logs</button>
        <button class="btn btn-primary btn-icon" id="btn-start-${id}" title="Start">▶</button>
        <button class="btn btn-danger btn-icon" id="btn-cancel-${id}" title="Cancel" style="display:none">■</button>
        <button class="btn btn-ghost btn-icon" id="btn-remove-${id}" title="Remove">✕</button>
      </div>
    </div>
    <div class="item-progress">
      <div class="progress-row">
        <div class="progress-track">
          <div class="progress-fill" id="prog-${id}" style="width:0%"></div>
        </div>
        <span class="progress-pct" id="pct-${id}">0%</span>
      </div>
      <div class="status-label" id="lbl-${id}">Queued</div>
    </div>
  `;

  queueList.appendChild(div);

  // Wire up inline controls
  div.querySelector(`#sel-q-${id}`).addEventListener('change', (e) => {
    item.quality = e.target.value;
    document.getElementById(`badge-q-${id}`).textContent = item.quality;
    // Update format badge if Twitch "Audio Only" is selected/deselected
    if (item.platform === 'twitch') {
      const isAudio = item.quality === 'audio';
      const fBadge = document.getElementById(`badge-f-${id}`);
      fBadge.textContent = (isAudio || item.format === 'mp3') ? 'MP3' : 'MP4';
      fBadge.className = `badge badge-format${(isAudio || item.format === 'mp3') ? ' mp3' : ''}`;
    }
  });

  div.querySelector(`#sel-f-${id}`).addEventListener('change', (e) => {
    item.format = e.target.value;
    const badge = document.getElementById(`badge-f-${id}`);
    badge.textContent = item.format.toUpperCase();
    badge.className = `badge badge-format${item.format === 'mp3' ? ' mp3' : ''}`;
  });

  div.querySelector(`#btn-log-${id}`).addEventListener('click', () => showLogs(id));
  div.querySelector(`#btn-start-${id}`).addEventListener('click', () => startItem(id));
  div.querySelector(`#btn-cancel-${id}`).addEventListener('click', () => cancelItem(id));
  div.querySelector(`#btn-remove-${id}`).addEventListener('click', () => removeItem(id));
}

function updateItemUI(id) {
  const item = queue.get(id);
  if (!item) return;

  const el = document.getElementById(`item-${id}`);
  if (!el) return;

  // Update status class
  el.className = `queue-item status-${item.status}`;

  const progFill = document.getElementById(`prog-${id}`);
  const pctLabel = document.getElementById(`pct-${id}`);
  const btnStart  = document.getElementById(`btn-start-${id}`);
  const btnCancel = document.getElementById(`btn-cancel-${id}`);
  const selQ = document.getElementById(`sel-q-${id}`);
  const selF = document.getElementById(`sel-f-${id}`);

  const isRunning = item.status === 'downloading' || item.status === 'merging';
  const isDone    = item.status === 'done';
  const isFinal   = isDone || item.status === 'error' || item.status === 'cancelled';

  // Progress bar
  if (item.status === 'merging') {
    progFill.style.width = '99%';
    progFill.classList.add('indeterminate');
    pctLabel.textContent = '99%';
  } else {
    progFill.classList.remove('indeterminate');
    const pct = Math.min(100, Math.max(0, item.percent || 0));
    progFill.style.width = pct + '%';
    pctLabel.textContent = pct.toFixed(0) + '%';
  }

  // Buttons
  if (isRunning) {
    btnStart.style.display  = 'none';
    btnCancel.style.display = '';
  } else {
    btnStart.style.display  = isFinal ? 'none' : '';
    btnCancel.style.display = 'none';
  }

  // Disable selects while running or done
  if (selQ) selQ.disabled = isRunning || isFinal;
  if (selF) selF.disabled = isRunning || isFinal;
}

function setStatusLabel(id, text, cls) {
  const lbl = document.getElementById(`lbl-${id}`);
  if (!lbl) return;
  lbl.textContent = text || '';
  lbl.className = `status-label${cls ? ' ' + cls : ''}`;
}

function updateEmptyState() {
  emptyState.style.display = queue.size === 0 ? 'flex' : 'none';
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Log viewer ────────────────────────────────────────────────────────────────
const logOverlay = document.getElementById('logOverlay');
const logOutput  = document.getElementById('logOutput');
const btnLogClose = document.getElementById('btnLogClose');

btnLogClose.addEventListener('click', () => logOverlay.classList.add('hidden'));
logOverlay.addEventListener('click', (e) => {
  if (e.target === logOverlay) logOverlay.classList.add('hidden');
});

async function showLogs(id) {
  logOutput.innerHTML = 'Loading...';
  logOverlay.classList.remove('hidden');
  try {
    const res = await window.electronAPI.getLogs(id);
    if (res.error) {
      logOutput.textContent = 'Error: ' + res.error;
      return;
    }
    if (!res.logs || res.logs.length === 0) {
      logOutput.textContent = 'No logs recorded yet for this download.';
      return;
    }
    // Render with color-coded lines
    logOutput.innerHTML = res.logs.map((line) => {
      let cls = '';
      if (line.includes('[STDERR]')) cls = 'log-line-stderr';
      else if (line.includes('[CMD]')) cls = 'log-line-cmd';
      else if (line.includes('[EXIT]')) cls = 'log-line-exit';
      else if (line.includes('[INFO]')) cls = 'log-line-info';
      return `<span class="${cls}">${escapeHtml(line)}</span>`;
    }).join('\n');
    // Scroll to bottom
    logOutput.scrollTop = logOutput.scrollHeight;
  } catch (err) {
    logOutput.textContent = 'Failed to fetch logs: ' + err.message;
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
updateEmptyState();
