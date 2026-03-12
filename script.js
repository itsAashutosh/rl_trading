const API_BASE = "http://127.0.0.1:5052";
let trainingInterval = null;
let isTraining = false;
let uploadOk = false;
let portfolioChart = null;
const tabButtons = document.querySelectorAll('.tab-btn');
const tabPanes = document.querySelectorAll('.tab-pane');
const uploadZone = document.getElementById('upload-zone');
const fileInput = document.getElementById('file-input');
const uploadStatus = document.getElementById('upload-status');
const startTrainingBtn = document.getElementById('start-training-btn');
const stopTrainingBtn = document.getElementById('stop-training-btn');
const trainingProgress = document.getElementById('training-progress');
const progressFill = document.getElementById('progress-fill');
const progressText = document.getElementById('progress-text');
const currentEpisode = document.getElementById('current-episode');
const trainingStatus = document.getElementById('training-status');
const resultsContent = document.getElementById('results-content');
const errorModal = document.getElementById('error-modal');
const errorMessage = document.getElementById('error-message');
const closeErrorModal = document.getElementById('close-error-modal');
const inputInitialBalance = document.getElementById('initial-balance');
const inputEpisodes = document.getElementById('episodes');
const inputLearningRate = document.getElementById('learning-rate');
const inputGamma = document.getElementById('gamma');
const inputEpsilon = document.getElementById('epsilon');
const inputEpsilonDecay = document.getElementById('epsilon-decay');
const scrollButtons = document.querySelectorAll('[data-scroll-target]');
const stageOrder = ['upload', 'configure', 'training', 'results'];
const pipelineStageElements = stageOrder.map(stage => document.querySelector(`.stage[data-stage="${stage}"]`));
const stageProgress = document.querySelector('.stage-progress');

function syncPipelineStages(activeStage) {
  const index = Math.max(stageOrder.indexOf(activeStage), 0);
  pipelineStageElements.forEach((stageEl, idx) => {
    if (!stageEl) return;
    stageEl.classList.toggle('active', idx === index);
    stageEl.classList.toggle('completed', idx < index);
  });
  if (stageProgress) {
    const span = stageOrder.length > 1 ? (index / (stageOrder.length - 1)) * 100 : 0;
    stageProgress.style.setProperty('--progress', `${Math.min(Math.max(span, 0), 100)}%`);
  }
}
function setActiveTab(tabName) {
  localStorage.setItem('activeTab', tabName);
  switchTabInternal(tabName);
}
function getActiveTab() {
  return localStorage.getItem('activeTab') || 'upload';
}
function setUploadOk(val) {
  uploadOk = val;
  localStorage.setItem('uploadOk', val ? '1' : '');
}
function getUploadOk() {
  return localStorage.getItem('uploadOk') === '1';
}
function switchTabInternal(tabName) {
  tabButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tabName));
  tabPanes.forEach(pane => pane.classList.toggle('active', pane.id === `${tabName}-tab`));
  syncPipelineStages(tabName);
}
function switchTab(tabName) {
  setActiveTab(tabName);
}
async function robustFetch(url, options = {}) {
  try {
    const res = await fetch(url, options);
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch {}
    return { ok: res.ok, status: res.status, json, text, error: null };
  } catch (e) {
    return { ok: false, status: 0, json: null, text: null, error: e };
  }
}
document.addEventListener('DOMContentLoaded', async () => {
  initializeEventListeners();
  uploadOk = getUploadOk();
  startTrainingBtn.disabled = !uploadOk;
  switchTabInternal(getActiveTab());
  const ping = await robustFetch(`${API_BASE}/training-status`);
  if (!ping.ok) {
    const msg = ping.error ? `Network/CORS: ${ping.error.message}` : `Status: ${ping.status}`;
    showErrorModal(`Cannot reach API at ${API_BASE}. ${msg}`);
  } else {
    checkTrainingStatus();
  }
});
function initializeEventListeners() {
  tabButtons.forEach(btn =>
    btn.addEventListener('click', () => switchTab(btn.dataset.tab))
  );
  scrollButtons.forEach(btn => btn.addEventListener('click', handleScrollButton));
  uploadZone.addEventListener('click', () => fileInput.click());
  uploadZone.addEventListener('dragover', handleDragOver);
  uploadZone.addEventListener('dragleave', handleDragLeave);
  uploadZone.addEventListener('drop', handleDrop);
  fileInput.addEventListener('change', handleFileSelect);
  startTrainingBtn.addEventListener('click', startTraining);
  stopTrainingBtn.addEventListener('click', stopTraining);
  closeErrorModal.addEventListener('click', () => toggleErrorModal(false));
  window.addEventListener('click', e => { if (e.target === errorModal) toggleErrorModal(false); });
}
function handleDragOver(e) { e.preventDefault(); uploadZone.classList.add('dragover'); }
function handleDragLeave(e) { e.preventDefault(); uploadZone.classList.remove('dragover'); }
function handleDrop(e) {
  e.preventDefault();
  uploadZone.classList.remove('dragover');
  if (e.dataTransfer.files && e.dataTransfer.files[0]) {
    fileInput.files = e.dataTransfer.files;
    handleFileSelect();
  }
}
function handleFileSelect() {
  const file = fileInput.files && fileInput.files[0];
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) {
    showUploadStatus('File too large (max 10MB)', 'error');
    return;
  }
  uploadCsvFile(file);
}
async function uploadCsvFile(file) {
  showUploadStatus(`Uploading ${file.name}...`, 'info');
  const formData = new FormData();
  formData.append('file', file);
  const res = await robustFetch(`${API_BASE}/upload-csv`, { method: 'POST', body: formData });
  if (!res.ok) {
    const msg = (res.json && (res.json.error || res.json.message)) || res.text || (res.error ? res.error.message : 'Upload failed');
    setUploadOk(false);
    startTrainingBtn.disabled = true;
    showUploadStatus('Upload failed: ' + msg, 'error');
    showErrorModal('Upload failed: ' + msg);
    return;
  }
  setUploadOk(true);
  startTrainingBtn.disabled = false;
  showUploadStatus(`Upload successful! Loaded ${file.name}`, 'success');
  setActiveTab('configure');
  setTimeout(() => { if (uploadStatus) uploadStatus.style.display = 'none'; }, 2500);
}
function showUploadStatus(msg, status = 'success') {
  uploadStatus.style.display = 'block';
  uploadStatus.textContent = msg;
  uploadStatus.className = 'upload-status';
  if (status === 'error') uploadStatus.classList.add('error');
  else if (status === 'info') uploadStatus.classList.add('info');
  else uploadStatus.classList.add('success');
}
async function startTraining() {
  if (isTraining) return;
  if (!uploadOk) {
    showErrorModal('Please upload a CSV before starting training.');
    return;
  }
  const params = {
    initialBalance: Number(inputInitialBalance.value),
    episodes: Number(inputEpisodes.value),
    learningRate: Number(inputLearningRate.value),
    gamma: Number(inputGamma.value),
    epsilon: Number(inputEpsilon.value),
    epsilonDecay: Number(inputEpsilonDecay.value)
  };
  for (const [k, v] of Object.entries(params)) {
    if (!Number.isFinite(v)) {
      showErrorModal(`Parameter "${k}" must be a valid number.`);
      return;
    }
  }
  startTrainingBtn.disabled = true;
  stopTrainingBtn.disabled = false;
  showTrainingProgress(0, 0, 'Starting...');
  isTraining = true;
  const res = await robustFetch(`${API_BASE}/start-training`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  });
  if (!res.ok) {
    const msg = (res.json && (res.json.error || res.json.message)) || res.text || 'Training failed';
    showErrorModal('Training could not start: ' + msg);
    startTrainingBtn.disabled = !uploadOk;
    stopTrainingBtn.disabled = true;
    hideTrainingProgress();
    isTraining = false;
    return;
  }
  setActiveTab('training');
  pollTrainingStatus();
}
async function stopTraining() {
  if (!isTraining) return;
  await robustFetch(`${API_BASE}/stop-training`, { method: 'POST' });
  isTraining = false;
  hideTrainingProgress();
  startTrainingBtn.disabled = !uploadOk;
  stopTrainingBtn.disabled = true;
}
function pollTrainingStatus() {
  clearInterval(trainingInterval);
  trainingInterval = setInterval(checkTrainingStatus, 1500);
}
async function checkTrainingStatus() {
  const res = await robustFetch(`${API_BASE}/training-status`);
  if (!res.ok) {
    clearInterval(trainingInterval);
    hideTrainingProgress();
    const msg = (res.json && (res.json.error || res.json.message)) || res.text || (res.error ? res.error.message : 'Status error');
    showErrorModal('Error fetching status: ' + msg);
    return;
  }
  const state = res.json || {};
  if (state.is_training) {
    showTrainingProgress(state.progress, state.current_episode, 'Training...');
    startTrainingBtn.disabled = true;
    stopTrainingBtn.disabled = false;
    isTraining = true;
    setActiveTab('training');
  } else {
    clearInterval(trainingInterval);
    startTrainingBtn.disabled = !uploadOk;
    stopTrainingBtn.disabled = true;
    isTraining = false;
    hideTrainingProgress();
    if (state.results) {
      renderResults(state.results);
      setActiveTab('results');
      return;
    }
    const r = await robustFetch(`${API_BASE}/training-results`);
    if (r.ok && r.status === 200) {
      renderResults(r.json);
      setActiveTab('results');
    } else if (r.status === 202) {
      resultsContent.innerHTML = `<p class="no-results">Results are still being prepared. Please wait...</p>`;
      setTimeout(checkTrainingStatus, 1000);
    } else {
      const msg = (r.json && (r.json.lastError || r.json.error || r.json.message)) || r.text || (r.error ? r.error.message : 'No training results available.');
      resultsContent.innerHTML = `<p class="no-results">${msg}</p>`;
    }
  }
}
function showTrainingProgress(progress, ep, statusText) {
  trainingProgress.style.display = 'block';
  progressFill.style.width = `${progress || 0}%`;
  progressText.textContent = `${Math.round(progress || 0)}%`;
  currentEpisode.textContent = ep || 0;
  trainingStatus.textContent = statusText || '...';
}
function hideTrainingProgress() {
  trainingProgress.style.display = 'none';
}
function safeNum(v) { return (typeof v === 'number' && isFinite(v)) ? v.toFixed(2) : 'N/A'; }
function renderResults(results) {
  if (!results) {
    resultsContent.innerHTML = `<p class="no-results">No training results available.</p>`;
    return;
  }
  const raw = Array.isArray(results.portfolioHistory) ? results.portfolioHistory : [];
  const portfolio = raw.map(v => (v == null ? null : Number(v))).filter(v => Number.isFinite(v));
  const cards = `
    <div class="results-grid">
      <div class="result-card">
        <h4>Final Balance</h4>
        <div class="value">${safeNum(results.finalBalance)}</div>
      </div>
      <div class="result-card">
        <h4>Total Reward</h4>
        <div class="value">${safeNum(results.totalReward)}</div>
      </div>
      <div class="result-card">
        <h4>Episodes</h4>
        <div class="value">${(typeof results.episodesCompleted === 'number') ? results.episodesCompleted : '?'}</div>
      </div>
    </div>
  `;
  const chartSection = `
    <div class="chart-container">
      <h4>Portfolio Value Over Time</h4>
      <canvas id="portfolio-chart"></canvas>
      ${portfolio.length === 0 ? '<p class="no-results">No portfolio series to plot.</p>' : ''}
    </div>
  `;
  const downloadBtn = `
    <div class="download-section">
      <a href="${API_BASE}/download-qtable" class="btn btn-success" download>Download Q-Table</a>
    </div>
  `;
  resultsContent.innerHTML = cards + chartSection + downloadBtn;
  if (portfolio.length > 0) renderPortfolioChart(portfolio);
}
function renderPortfolioChart(portfolio) {
  if (!window.Chart || !document.getElementById('portfolio-chart')) return;

  if (portfolioChart && typeof portfolioChart.destroy === 'function') {
    portfolioChart.destroy();
  }
  const ctx = document.getElementById('portfolio-chart').getContext('2d');
  const labels = portfolio.map((_, i) => i + 1);
  portfolioChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Portfolio Value',
        data: portfolio,
        borderColor: '#16a34a',
        backgroundColor: 'rgba(22,163,74,0.08)',
        pointRadius: 0,
        borderWidth: 2,
        tension: 0.15,
        fill: true
      }]
    },
    options: {
      responsive: true,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: true } },
      scales: {
        x: { display: true, title: { display: true, text: 'Step' } },
        y: { display: true, title: { display: true, text: 'Value' } }
      }
    }
  });
}
function showErrorModal(msg) { errorMessage.textContent = msg; toggleErrorModal(true); }
function toggleErrorModal(show) { errorModal.style.display = show ? 'flex' : 'none'; }
function handleScrollButton(e) {
  const targetSelector = e.currentTarget.dataset.scrollTarget;
  if (!targetSelector) return;
  e.preventDefault();
  const targetId = targetSelector.startsWith('#') ? targetSelector.slice(1) : targetSelector;
  if (targetId.endsWith('-tab')) {
    const possibleTab = targetId.replace(/-tab$/, '');
    if (stageOrder.includes(possibleTab)) {
      setActiveTab(possibleTab);
    }
  }
  requestAnimationFrame(() => {
    const targetEl = document.querySelector(targetSelector);
    if (targetEl) targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}