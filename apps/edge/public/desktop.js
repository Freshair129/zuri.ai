// @spec FR-150 — local provider and hardware settings without an Edge Device worker surface.
const $ = id => document.getElementById(id);
const native = Boolean(window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke);
const panelWidth = () => $('appMain').clientWidth;
const TAB_ORDER = ['overview', 'ai', 'settings'];
const HOME_PAGE = { overview: 'overviewHome', ai: 'aiHome', settings: 'settingsHome' };
const PROVIDERS = ['ollama', 'codex', 'claude'];
const PROVIDER_LABELS = { ollama: 'Ollama', codex: 'Codex', claude: 'Claude' };
const PROVIDER_STATE_LABELS = {
  MISSING: 'ไม่พบโปรแกรม',
  LOGGED_OUT: 'ยังไม่ได้ Login',
  AUTHENTICATING: 'กำลังรอการยืนยันใน Browser',
  READY: 'พร้อมตรวจแล้ว',
  FAILED: 'ตรวจไม่สำเร็จ',
  BLOCKED: 'ยังไม่พร้อม',
};

const state = {
  activeTab: 'overview',
  activePage: { overview: 'overviewHome', ai: 'aiHome', settings: 'settingsHome' },
  userNavigated: false,
  initialRoutePending: true,
  status: null,
  inventory: null,
  inventoryError: null,
  inventoryBusy: false,
  inventoryPage: 0,
  providerSettings: null,
  provider: 'ollama',
  drafts: {},
  dirty: { ollama: false, codex: false, claude: false },
  providerBusy: false,
  providerStates: { ollama: null, codex: null, claude: null },
  providerTimers: {},
  ollamaModels: [],
  ollamaDiscovery: null,
  selectedOllamaModel: '',
  modelPage: 0,
  detail: { pages: [], page: 0, returnTab: 'settings', returnElement: null },
  compact: false,
  overviewPage: 0,
  cliResult: null,
  updateResult: null,
};

const compactPageState = { ai: 0, cli: 0, about: 0 };

function text(value, fallback = '—') {
  if (value === null || value === undefined || String(value).trim() === '') return fallback;
  return String(value);
}

function setText(id, value, fallback = '—') {
  const element = $(id);
  if (element) element.textContent = text(value, fallback);
}

function setSummaryValue(id, value, fallback, title) {
  const element = $(id);
  if (!element) return;
  element.replaceChildren();
  const valueText = value === null || value === undefined || String(value).trim() === '' ? fallback : String(value);
  if (!valueText) return;
  if (value === null || value === undefined || String(value).trim() === '' || valueText.length <= 72) {
    element.textContent = valueText;
    return;
  }
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'summary-detail-button';
  button.textContent = valueText.slice(0, 68) + '…';
  button.setAttribute('aria-label', (title || 'ดูรายละเอียด') + ': ' + valueText);
  button.addEventListener('click', () => openDetail(title || 'รายละเอียด', valueText, state.activeTab, button));
  element.appendChild(button);
}

function setVisible(id, visible) {
  const element = $(id);
  if (element) element.hidden = !visible;
}

function setTone(id, tone = '') {
  const element = $(id);
  if (!element) return;
  const base = element.id === 'statusBadge' ? 'status-badge' : element.classList.contains('state-label') ? 'state-label' : '';
  if (base) element.className = base + (tone ? ' ' + tone : '');
  else {
    element.classList.remove('info', 'success', 'warning', 'error');
    if (tone) element.classList.add(tone);
  }
}

function setMessage(id, value = '', tone = '') {
  const element = $(id);
  if (!element) return;
  element.textContent = value || '';
  element.classList.remove('info', 'success', 'warning', 'error');
  if (tone) element.classList.add(tone);
}

function showGlobalError(value) { setMessage('globalError', value || 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ', 'error'); }
function clearGlobalError() { setMessage('globalError', ''); }
function showGlobalMessage(value, tone = 'success') { setMessage('globalMessage', value || '', tone); }
function errorMessage(failure) { return text(failure && (failure.message || failure), 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ'); }

function formatDate(value, fallback = 'ยังไม่ได้ตรวจ') {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? text(value, fallback) : date.toLocaleString('th-TH');
}

function formatBytes(value) {
  if (value === null || value === undefined || value === '') return 'ไม่พร้อมใช้งาน';
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return 'ไม่พร้อมใช้งาน';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let amount = bytes;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) { amount /= 1024; index += 1; }
  return new Intl.NumberFormat('th-TH', { maximumFractionDigits: index ? 1 : 0 }).format(amount) + ' ' + units[index];
}

function formatPercent(free, total) {
  if (free === null || free === undefined || total === null || total === undefined || free === '' || total === '') return 'ไม่พร้อมใช้งาน';
  const freeNumber = Number(free);
  const totalNumber = Number(total);
  if (!Number.isFinite(freeNumber) || !Number.isFinite(totalNumber) || totalNumber <= 0) return 'ไม่พร้อมใช้งาน';
  return Math.round((freeNumber / totalNumber) * 100) + '% ว่าง';
}

async function invoke(command, args = {}) {
  if (!native) throw new Error('หน้าตัวอย่างในเบราว์เซอร์ยังเชื่อมต่อ Desktop IPC ไม่ได้');
  return window.__TAURI__.core.invoke(command, args);
}

function focusElement(id) { window.requestAnimationFrame(() => { const element = $(id); if (element) element.focus(); }); }

function providerStateTone(value) {
  if (value === 'READY') return 'success';
  if (['AUTHENTICATING', 'LOGGED_OUT', 'BLOCKED'].includes(value)) return 'warning';
  if (['FAILED', 'MISSING'].includes(value)) return 'error';
  return '';
}

function updateTabBadge(id, visible, tone = 'warning') {
  const element = $(id);
  if (!element) return;
  element.hidden = !visible;
  element.dataset.tone = tone;
}

function renderTabBadges() {
  updateTabBadge('aiTabBadge', Object.values(state.dirty).some(Boolean));
  updateTabBadge('settingsTabBadge', Boolean(state.cliResult && state.cliResult.error), 'error');
}

function renderCompactOverview() {
  const blocks = Array.from(document.querySelectorAll('.overview-block'));
  const compact = state.compact;
  const prerequisites = Array.from($('prerequisites').children);
  const enlarged = compact && document.body.dataset.textZoom === 'true';
  // `blocks.slice(2)` rather than `blocks[2]`: the enlarged path used to name the last card by
  // index, so adding a fourth made it unreachable at 200% text zoom — visible to no one who
  // did not test at that zoom, which is the only place this list is used.
  const pages = enlarged ? [blocks[0], ...prerequisites.map(() => blocks[1]), ...blocks.slice(2)] : blocks;
  $('overviewHome').classList.toggle('compact-steps', compact);
  setVisible('overviewCompactNav', compact);
  if (!compact) {
    for (const block of blocks) block.hidden = false;
    for (const row of prerequisites) row.hidden = false;
    return;
  }
  state.overviewPage = Math.max(0, Math.min(state.overviewPage, pages.length - 1));
  for (const block of blocks) block.hidden = block !== pages[state.overviewPage];
  for (const [index, row] of prerequisites.entries()) row.hidden = enlarged && index !== state.overviewPage - 1;
  setText('overviewCompactLabel', 'ส่วนที่ ' + (state.overviewPage + 1) + ' / ' + pages.length);
  $('overviewCompactPrev').disabled = state.overviewPage <= 0;
  $('overviewCompactNext').disabled = state.overviewPage >= pages.length - 1;
}

function renderCompactPage(key, pageId, selector, navId, labelId, previousId, nextId) {
  const page = $(pageId);
  if (!page) return;
  const blocks = Array.from(page.querySelectorAll(selector));
  const total = blocks.length;
  // Keep the two short release cards together at 800x560; the one-card
  // stepper remains for the genuinely compact 640x480 tier.
  const compact = state.compact && !(key === 'about' && panelWidth() >= 680 && window.innerHeight >= 500);
  page.classList.toggle('compact-steps', compact);
  setVisible(navId, compact && blocks.length > 1);
  if (!compact) {
    delete page.dataset.compactStep;
    for (const block of blocks) block.hidden = false;
    return;
  }
  if (!blocks.length) return;
  compactPageState[key] = Math.max(0, Math.min(compactPageState[key], total - 1));
  page.dataset.compactStep = String(compactPageState[key]);
  for (const [index, block] of blocks.entries()) block.hidden = index !== compactPageState[key];
  setText(labelId, 'ส่วนที่ ' + (compactPageState[key] + 1) + ' / ' + total);
  $(previousId).disabled = compactPageState[key] <= 0;
  $(nextId).disabled = compactPageState[key] >= total - 1;
}

function renderAiCompactPage() {
  const page = $('aiHome');
  const choice = page && page.querySelector('.provider-choice-card');
  const form = page && page.querySelector('.provider-form-card');
  if (!page || !choice || !form) return;
  const compact = state.compact || panelWidth() <= 960 || window.innerHeight <= 600;
  const textZoom = document.body.dataset.textZoom === 'true';
  const total = compact ? (textZoom ? (state.provider === 'ollama' ? 8 : 9) : 3) : 1;
  page.classList.toggle('compact-steps', compact);
  setVisible('aiCompactNav', compact && total > 1);
  if (!compact) {
    delete page.dataset.compactStep;
    delete page.dataset.provider;
    choice.hidden = false;
    form.hidden = false;
    for (const option of page.querySelectorAll('.provider-option')) option.hidden = false;
    return;
  }
  compactPageState.ai = Math.max(0, Math.min(compactPageState.ai, total - 1));
  page.dataset.compactStep = String(compactPageState.ai);
  page.dataset.provider = state.provider;
  const providerStep = textZoom && compactPageState.ai < 3;
  choice.hidden = providerStep ? false : compactPageState.ai !== 0;
  form.hidden = providerStep || compactPageState.ai === 0;
  const options = [...page.querySelectorAll('.provider-option')];
  options.forEach((option, index) => {
    option.hidden = !textZoom ? false : compactPageState.ai < 3 ? index !== compactPageState.ai : false;
  });
  setText('aiCompactLabel', 'ส่วนที่ ' + (compactPageState.ai + 1) + ' / ' + total);
  $('aiCompactPrev').disabled = compactPageState.ai <= 0;
  $('aiCompactNext').disabled = compactPageState.ai >= total - 1;
}

function renderCompactPages() {
  renderAiCompactPage();
  renderCompactPage('cli', 'cliPage', '.settings-form-block', 'cliCompactNav', 'cliCompactLabel', 'cliCompactPrev', 'cliCompactNext');
  renderCompactPage('about', 'aboutPage', '.settings-form-block', 'aboutCompactNav', 'aboutCompactLabel', 'aboutCompactPrev', 'aboutCompactNext');
}

function setTab(tab, { focus = true, user = false } = {}) {
  if (!TAB_ORDER.includes(tab)) return;
  if ($('detailPage') && !$('detailPage').hidden) closeDetail(false);
  state.activeTab = tab;
  state.userNavigated = state.userNavigated || user;
  for (const candidate of TAB_ORDER) {
    const button = $('tab-' + candidate);
    const panel = $('panel-' + candidate);
    const selected = candidate === tab;
    if (button) { button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1; }
    if (panel) panel.hidden = !selected;
  }
  if (focus) focusElement('tab-' + tab);
  renderTabBadges();
}

function setTabFocus(tab) {
  for (const candidate of TAB_ORDER) {
    const button = $('tab-' + candidate);
    if (button) button.tabIndex = candidate === tab ? 0 : -1;
  }
  focusElement('tab-' + tab);
}

function activateTabFromKeyboard(event, tab) {
  const index = TAB_ORDER.indexOf(tab);
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') { event.preventDefault(); setTabFocus(TAB_ORDER[(index + 1) % TAB_ORDER.length]); }
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') { event.preventDefault(); setTabFocus(TAB_ORDER[(index - 1 + TAB_ORDER.length) % TAB_ORDER.length]); }
  else if (event.key === 'Home') { event.preventDefault(); setTabFocus(TAB_ORDER[0]); }
  else if (event.key === 'End') { event.preventDefault(); setTabFocus(TAB_ORDER[TAB_ORDER.length - 1]); }
  else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setTab(tab, { focus: true, user: true }); }
}

function panelPages(tab) { return Array.from(document.querySelectorAll('#panel-' + tab + ' > .page-view')); }
function pageBelongsTo(tab, page) { return Boolean(page && page.closest('#panel-' + tab)); }

function showPage(tab, pageId, { focus = true } = {}) {
  const page = $(pageId);
  if (!pageBelongsTo(tab, page)) return;
  for (const candidate of panelPages(tab)) candidate.hidden = candidate !== page;
  state.activePage[tab] = pageId;
  renderCompactPages();
  if (focus) {
    const focusTarget = page.querySelector('.back-button, input, button, [tabindex="0"]');
    window.requestAnimationFrame(() => { if (focusTarget) focusTarget.focus(); });
  }
}

function showHome(tab, options = {}) { showPage(tab, HOME_PAGE[tab], options); }

function openDetail(title, value, returnTab = state.activeTab, returnElement = null) {
  const raw = text(value, 'ไม่มีรายละเอียดเพิ่มเติม');
  state.detail.resizeObserver?.disconnect();
  state.detail.fontObserver?.disconnect();
  state.detail = { raw, pages: [raw], page: 0, returnTab, returnElement };
  for (const tab of TAB_ORDER) $('panel-' + tab).hidden = true;
  $('detailPage').hidden = false;
  $('detailTitle').textContent = title;
  renderDetail();
  state.detail.resizeObserver = new ResizeObserver(() => renderDetail());
  state.detail.resizeObserver.observe($('detailContent'));
  state.detail.fontObserver = new MutationObserver(() => renderDetail());
  state.detail.fontObserver.observe($('detailContent'), { attributes: true, attributeFilter: ['style', 'class'], subtree: true });
  focusElement('detailBack');
}

function closeDetail(restoreFocus = true) {
  state.detail.resizeObserver?.disconnect();
  state.detail.fontObserver?.disconnect();
  $('detailPage').hidden = true;
  setTab(state.detail.returnTab || state.activeTab, { focus: false });
  if (restoreFocus) window.requestAnimationFrame(() => (state.detail.returnElement || $('tab-' + state.activeTab)).focus());
}

function renderDetail() {
  if ($('detailPage').hidden) return;
  const content = $('detailContent');
  let paragraph = content.querySelector('p');
  if (!paragraph) {
    paragraph = document.createElement('p');
    content.replaceChildren(paragraph);
  }
  const style = getComputedStyle(content);
  const font = getComputedStyle(paragraph);
  const availableHeight = content.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
  const geometry = [content.clientWidth, availableHeight, font.font, font.lineHeight].join('|');
  if (state.detail.geometry !== geometry) {
    const oldOffset = state.detail.pages.slice(0, state.detail.page).join('').length;
    const characters = Array.from(state.detail.raw);
    const pages = [];
    let offset = 0;
    // Measure actual wrapping; character budgets cannot account for Thai,
    // long URLs, window resizing or the user's text size.
    while (offset < characters.length) {
      let low = 1;
      let high = characters.length - offset;
      let length = 1;
      while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        paragraph.textContent = characters.slice(offset, offset + middle).join('');
        if (paragraph.getBoundingClientRect().height <= availableHeight + .5
          && paragraph.scrollWidth <= paragraph.clientWidth + 1) {
          length = middle;
          low = middle + 1;
        } else high = middle - 1;
      }
      pages.push(characters.slice(offset, offset + length).join(''));
      offset += length;
    }
    state.detail.pages = pages.length ? pages : [''];
    state.detail.page = 0;
    let retained = 0;
    while (state.detail.page < state.detail.pages.length - 1
      && retained + state.detail.pages[state.detail.page].length <= oldOffset) {
      retained += state.detail.pages[state.detail.page++].length;
    }
    state.detail.geometry = geometry;
  }
  state.detail.page = Math.max(0, Math.min(state.detail.page, state.detail.pages.length - 1));
  paragraph.textContent = state.detail.pages[state.detail.page] || '';
  setText('detailPageLabel', 'หน้า ' + (state.detail.page + 1) + ' / ' + state.detail.pages.length);
  setText('detailProgress', state.detail.pages.length > 1 ? 'ใช้ก่อนหน้า / ถัดไปเพื่ออ่านต่อ' : 'รายละเอียด');
  $('detailPrev').disabled = state.detail.page <= 0;
  $('detailNext').disabled = state.detail.page >= state.detail.pages.length - 1;
}

function selectedModel(provider = state.provider) { return text(state.drafts[provider] && state.drafts[provider].model, ''); }
function providerReady(provider = state.provider) {
  if (!selectedModel(provider)) return false;
  if (provider === 'ollama') return Boolean(state.ollamaDiscovery && state.ollamaDiscovery.available && state.ollamaModels.some(item => item.name === selectedModel(provider)));
  return Boolean(state.providerStates[provider] && state.providerStates[provider].state === 'READY' && state.drafts[provider].allowCloud);
}

function savedProviderReady() {
  const settings = state.providerSettings;
  if (!settings || state.provider !== settings.provider || anyDirty()) return false;
  const provider = settings.provider;
  const model = text(settings[provider === 'ollama' ? 'ollama_model' : provider + '_model'], '');
  if (!model) return false;
  if (provider === 'ollama') return true;
  return Boolean(settings.allow_cloud && state.providerStates[provider] && state.providerStates[provider].state === 'READY');
}

function setPrerequisite(id, tone, detail) {
  const row = $(id);
  if (!row) return;
  row.classList.remove('success', 'warning', 'error');
  if (tone) row.classList.add(tone);
  const small = row.querySelector('small');
  if (small) small.textContent = detail;
  const icon = row.querySelector('.state-icon');
  if (icon) icon.textContent = tone === 'success' ? '✓' : tone === 'error' ? '!' : '•';
}

function renderOverview() {
  const savedProvider = state.providerSettings && state.providerSettings.provider;
  const savedModel = savedProvider && text(state.providerSettings[savedProvider === 'ollama' ? 'ollama_model' : savedProvider + '_model'], '');
  setSummaryValue('providerModelSummary', savedProvider ? PROVIDER_LABELS[savedProvider] + ' · ' + (savedModel || 'ยังไม่ได้เลือกโมเดล') : '', savedProvider ? 'ยังไม่ได้เลือกโมเดล' : 'ยังไม่ได้อ่านการตั้งค่า', 'ตัวช่วยและโมเดล');
  const ready = Boolean(state.providerSettings && savedProviderReady());
  const configurationError = state.status && state.status.configuration_error;
  setText('statusBadge', native ? 'ตั้งค่าในเครื่อง' : 'Browser preview · IPC unavailable');
  setTone('statusBadge', native ? 'info' : 'warning');
  setText('providerStateSummary', savedProvider ? PROVIDER_LABELS[savedProvider] : 'ยังไม่ได้ตั้งค่า');
  setText('overviewProviderStateLarge', savedProvider ? (ready ? 'พร้อมใช้งาน' : 'ต้องตรวจการตั้งค่า') : 'ยังไม่ได้ตั้งค่า');
  setText('overviewProviderHint', savedProvider ? 'ตั้งค่าผู้ให้บริการในเครื่องแล้ว' : 'เลือกผู้ให้บริการและโมเดล');
  setText('overviewState', configurationError ? 'ตรวจการตั้งค่าไม่สำเร็จ' : ready ? 'ผู้ให้บริการพร้อมใช้' : 'ตั้งค่าผู้ให้บริการ');
  setMessage('overviewProviderReason', configurationError || '');
  setVisible('overviewProviderReason', Boolean(configurationError));
  setTone('overviewProviderTone', configurationError ? 'error' : ready ? 'success' : 'warning');
  setMessage('overviewFeedback', native ? '' : 'เปิดแอป Desktop เพื่ออ่านสถานะและแก้การตั้งค่าในเครื่อง', native ? '' : 'warning');

  setPrerequisite('overviewProvider', ready ? 'success' : state.providerSettings ? 'warning' : '', state.providerSettings ? (ready ? 'บันทึกและตรวจพร้อมแล้ว' : 'ต้องบันทึกหรือตรวจบัญชี') : 'ยังไม่ได้ตั้งค่า');
  setText('prerequisiteCount', ready ? '1 / 1 พร้อม' : '0 / 1 ต้องตั้งค่า');
  setVisible('overviewConfigure', !ready);
  renderCompactOverview();
}

function updateComputerName() {
  if (!state.inventory) {
    setText('computerName', native ? 'กำลังอ่านชื่อเครื่อง…' : 'อ่านชื่อเครื่องไม่ได้ใน Browser');
    return;
  }
  setText('computerName', state.inventory.computerName, 'อ่านชื่อเครื่องไม่ได้');
}

function normalizeInventory(raw) {
  const value = raw && raw.data && raw.status === undefined ? raw.data : raw;
  const source = value && typeof value === 'object' ? value : {};
  return {
    status: source.status || 'unavailable',
    capturedAt: source.capturedAt || null,
    computerName: source.computerName === undefined ? null : source.computerName,
    os: source.os || null,
    cpus: Array.isArray(source.cpus) ? source.cpus : [],
    memory: source.memory || null,
    gpus: Array.isArray(source.gpus) ? source.gpus : [],
    volumes: Array.isArray(source.volumes) ? source.volumes : [],
    fieldErrors: source.fieldErrors && typeof source.fieldErrors === 'object' ? source.fieldErrors : {},
  };
}

function inventoryFieldError(field) {
  const code = state.inventory && state.inventory.fieldErrors && state.inventory.fieldErrors[field];
  const labels = { UNAVAILABLE: 'ไม่พร้อมใช้งาน', TIMEOUT: 'ตรวจเกินเวลา', PARSE_ERROR: 'อ่านผลตรวจไม่ได้', PERMISSION_DENIED: 'ไม่มีสิทธิ์อ่าน', NOT_TRUSTWORTHY: 'แหล่งข้อมูลไม่ผ่านการยืนยัน', UNSUPPORTED_PLATFORM: 'ไม่รองรับบนระบบนี้' };
  return labels[code] || '';
}

function inventoryValue(value, field = '') { return value === null || value === undefined || value === '' ? inventoryFieldError(field) || 'ไม่พร้อมใช้งาน' : String(value); }
function chunk(items, size) {
  if (!items.length) return [[]];
  const result = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function hardwarePages() {
  const inventory = state.inventory || normalizeInventory({});
  const itemSize = window.innerHeight < 560 ? 2 : 4;
  const pages = [{
    title: 'ระบบ',
    groups: [{ title: 'ระบบปฏิบัติการ', facts: [
      ['ชื่อเครื่อง', inventoryValue(inventory.computerName, 'computerName')],
      ['ระบบ', inventoryValue(inventory.os && inventory.os.caption, 'os.caption')],
      ['เวอร์ชัน', inventoryValue(inventory.os && inventory.os.version, 'os.version')],
      ['สถาปัตยกรรม', inventoryValue(inventory.os && inventory.os.architecture, 'os.architecture')],
    ] }],
  }];
  const cpus = chunk(inventory.cpus, itemSize);
  for (const [index, items] of cpus.entries()) pages.push({ title: index ? 'CPU · รายการ ' + (index + 1) : 'CPU', groups: [{ title: 'หน่วยประมวลผล', list: items.map((cpu, itemIndex) => {
    const fieldIndex = index * itemSize + itemIndex;
    return inventoryValue(cpu.name, 'cpus[' + fieldIndex + '].name') + ' · ' + inventoryValue(cpu.physicalCores, 'cpus[' + fieldIndex + '].physicalCores') + ' cores · ' + inventoryValue(cpu.logicalProcessors, 'cpus[' + fieldIndex + '].logicalProcessors') + ' threads';
  }), empty: 'ไม่พบข้อมูล CPU' }] });
  pages.push({ title: 'RAM', groups: [{ title: 'หน่วยความจำ', facts: [['ติดตั้งในเครื่อง', formatBytes(inventory.memory && inventory.memory.installedBytes)], ['ระบบมองเห็น', formatBytes(inventory.memory && inventory.memory.osVisibleBytes)]] }] });
  const gpus = chunk(inventory.gpus, itemSize);
  for (const [index, items] of gpus.entries()) pages.push({ title: index ? 'GPU · รายการ ' + (index + 1) : 'GPU', groups: [{ title: 'กราฟิก', list: items.map((gpu, itemIndex) => {
    const fieldIndex = index * itemSize + itemIndex;
    return inventoryValue(gpu.name, 'gpus[' + fieldIndex + '].name') + ' · VRAM ' + formatBytes(gpu.dedicatedVramBytes) + ' · Driver ' + inventoryValue(gpu.driverVersion, 'gpus[' + fieldIndex + '].driverVersion');
  }), empty: 'ไม่พบ GPU ที่อ่านได้' }] });
  const volumes = chunk(inventory.volumes, itemSize);
  for (const [index, items] of volumes.entries()) pages.push({ title: index ? 'พื้นที่จัดเก็บ · รายการ ' + (index + 1) : 'พื้นที่จัดเก็บ', groups: [{ title: 'Fixed volumes', list: items.length ? items.map((volume, itemIndex) => {
    const fieldIndex = index * itemSize + itemIndex;
    return inventoryValue(volume.driveLetter, 'volumes[' + fieldIndex + '].driveLetter') + ' · ' + formatBytes(volume.freeBytes) + ' ว่างจาก ' + formatBytes(volume.totalBytes) + ' · ' + formatPercent(volume.freeBytes, volume.totalBytes);
  }) : [inventoryFieldError('volumes') || 'ไม่พบ volume ที่อ่านได้'] }] });
  if (state.compact && document.body.dataset.textZoom === 'true') {
    return pages.flatMap(page => page.groups.flatMap(group => {
      if (group.facts) return group.facts.map(fact => ({ title: page.title, groups: [{ title: group.title, facts: [fact] }] }));
      if (group.list?.length) return group.list.map(value => ({ title: page.title, groups: [{ title: group.title, list: [value] }] }));
      return [{ title: page.title, groups: [group] }];
    }));
  }
  return pages;
}

function appendHardwareGroup(parent, group) {
  const card = document.createElement('article');
  card.className = 'hardware-group';
  const heading = document.createElement('h3');
  heading.textContent = group.title;
  card.appendChild(heading);
  if (group.facts) {
    const facts = document.createElement('dl');
    facts.className = 'hardware-facts';
    for (const pair of group.facts) {
      const term = document.createElement('dt');
      const description = document.createElement('dd');
      term.textContent = pair[0];
      description.textContent = pair[1];
      if (String(pair[1]).length > 60) {
        const detail = document.createElement('button');
        detail.className = 'button secondary';
        detail.textContent = 'อ่านค่าเต็ม';
        detail.addEventListener('click', () => openDetail(pair[0], pair[1], 'overview', detail));
        description.replaceChildren(detail);
      }
      facts.append(term, description);
    }
    card.appendChild(facts);
  }
  if (group.list) {
    const list = document.createElement('ul');
    list.className = 'hardware-list';
    for (const [index, value] of group.list.entries()) {
      const item = document.createElement('li');
      if (value.length > 120 || (state.compact && document.body.dataset.textZoom === 'true')) {
        const detail = document.createElement('button');
        detail.className = 'button secondary';
        detail.textContent = 'ดูรายละเอียด ' + (index + 1);
        detail.addEventListener('click', () => openDetail(group.title, value, 'overview', detail));
        item.appendChild(detail);
      } else item.textContent = value;
      list.appendChild(item);
    }
    card.appendChild(list);
  }
  if (group.empty && !group.list?.length) { const empty = document.createElement('p'); empty.className = 'muted compact-text'; empty.textContent = group.empty; card.appendChild(empty); }
  parent.appendChild(card);
}

function renderHardwareSummary() {
  const inventory = state.inventory;
  if (!inventory) {
    setText('hardwareStatus', native ? 'กำลังอ่าน…' : 'Unavailable');
    setText('hardwareSystemSummary', native ? 'กำลังอ่าน…' : 'Unavailable');
    setText('hardwareCpuSummary', '—');
    setText('hardwareMemorySummary', '—');
    setText('hardwareGpuSummary', '—');
    setText('hardwareCapturedAt', native ? 'กำลังอ่าน snapshot' : 'Browser preview ไม่มี native inventory');
    updateComputerName();
    return;
  }
  const stale = Boolean(state.inventoryError);
  setText('hardwareStatus', stale ? 'snapshot เก่า' : inventory.status === 'ready' ? 'พร้อม' : inventory.status === 'partial' ? 'บางส่วน' : 'Unavailable');
  setTone('hardwareStatus', stale || inventory.status === 'partial' ? 'warning' : inventory.status === 'ready' ? 'success' : 'error');
  setText('hardwareSystemSummary', inventory.os && inventory.os.caption, inventoryFieldError('os.caption') || 'ไม่พร้อมใช้งาน');
  setText('hardwareCpuSummary', inventory.cpus.length ? inventory.cpus.length + ' รายการ' : inventoryFieldError('cpus') || 'ไม่พร้อมใช้งาน');
  setText('hardwareMemorySummary', inventory.memory ? formatBytes(inventory.memory.installedBytes) : inventoryFieldError('memory') || 'ไม่พร้อมใช้งาน');
  setText('hardwareGpuSummary', inventory.gpus.length ? inventory.gpus.length + ' รายการ' : inventoryFieldError('gpus') || 'ไม่พร้อมใช้งาน');
  const captured = inventory.capturedAt ? 'ตรวจเมื่อ ' + formatDate(inventory.capturedAt) : 'ไม่มีเวลาตรวจ';
  setText('hardwareCapturedAt', state.inventoryError ? captured + ' · อ่านซ้ำไม่สำเร็จ' : captured);
  updateComputerName();
}

function renderHardwarePage() {
  const pages = hardwarePages();
  state.inventoryPage = Math.max(0, Math.min(state.inventoryPage, pages.length - 1));
  const current = pages[state.inventoryPage];
  const content = $('hardwareContent');
  content.replaceChildren();
  for (const group of current.groups) appendHardwareGroup(content, group);
  setText('hardwarePageLabel', current.title + ' · หน้า ' + (state.inventoryPage + 1) + ' / ' + pages.length);
  $('hardwarePrev').disabled = state.inventoryPage <= 0;
  $('hardwareNext').disabled = state.inventoryPage >= pages.length - 1;
  const statusMessage = state.inventoryError ? 'อ่าน snapshot ล่าสุดไม่ได้: ' + state.inventoryError : state.inventory && state.inventory.status === 'partial' ? 'บางรายการอ่านไม่ได้ จะแสดงเหตุผลรายช่องโดยไม่แทนค่าด้วยศูนย์' : state.inventory && state.inventory.status === 'unavailable' ? 'ยังไม่สามารถอ่านข้อมูลจากเครื่องนี้ได้' : '';
  setMessage('hardwarePageStatus', statusMessage, state.inventoryError ? 'error' : state.inventory && state.inventory.status === 'partial' ? 'warning' : '');
}

async function loadInventory() {
  if (state.inventoryBusy) return;
  state.inventoryBusy = true;
  state.inventoryError = null;
  renderHardwareSummary();
  if (!native) {
    state.inventory = normalizeInventory({ status: 'unavailable', fieldErrors: { all: 'UNSUPPORTED_PLATFORM' } });
    state.inventoryBusy = false;
    renderHardwareSummary();
    renderHardwarePage();
    return;
  }
  try {
    state.inventory = normalizeInventory(await invoke('get_machine_inventory'));
    state.inventoryPage = 0;
    renderHardwareSummary();
    renderHardwarePage();
  } catch (failure) {
    state.inventoryError = errorMessage(failure);
    if (!state.inventory) state.inventory = normalizeInventory({ status: 'unavailable', fieldErrors: { all: 'UNAVAILABLE' } });
    setMessage('overviewFeedback', 'อ่านสเปคเครื่องไม่ได้: ' + errorMessage(failure), 'error');
    renderHardwareSummary();
    renderHardwarePage();
  } finally {
    state.inventoryBusy = false;
    $('hardwareRefresh').disabled = !native;
    $('hardwarePageRefresh').disabled = !native;
  }
}

async function loadDesktopStatus() {
  try {
    const status = await invoke('get_desktop_status');
    state.status = status || {};
    renderOverview();
    if (state.initialRoutePending && !state.userNavigated) {
      state.initialRoutePending = false;
      setTab('overview', { focus: false });
    }
    clearGlobalError();
  } catch (failure) {
    showGlobalError(errorMessage(failure));
    state.status = { configuration_error: errorMessage(failure) };
    renderOverview();
    if (state.initialRoutePending) { state.initialRoutePending = false; setTab('overview', { focus: false }); }
  }
}

function makeDrafts(settings) {
  const source = settings || {};
  return {
    ollama: { baseUrl: text(source.ollama_base_url, 'http://127.0.0.1:11434'), model: text(source.ollama_model, ''), allowCloud: false },
    codex: { baseUrl: '', model: text(source.codex_model, ''), allowCloud: Boolean(source.allow_cloud) },
    claude: { baseUrl: '', model: text(source.claude_model, ''), allowCloud: Boolean(source.allow_cloud) },
  };
}

function currentDraft() {
  if (!state.drafts[state.provider]) state.drafts[state.provider] = { baseUrl: '', model: '', allowCloud: false };
  return state.drafts[state.provider];
}

function syncDraftFromForm() {
  const draft = currentDraft();
  if (state.provider === 'ollama') {
    draft.baseUrl = $('ollamaUrl').value;
    draft.model = state.selectedOllamaModel || draft.model || '';
  } else {
    draft.model = $('providerModel').value;
    draft.allowCloud = $('allowCloud').checked;
  }
}

function anyDirty() { return Object.values(state.dirty).some(Boolean); }
function markProviderDirty() { syncDraftFromForm(); state.dirty[state.provider] = true; renderProvider(); renderOverview(); }

function setProviderRadio(provider) {
  const id = provider === 'ollama' ? 'providerOllama' : provider === 'codex' ? 'providerCodex' : 'providerClaude';
  if ($(id)) $(id).checked = true;
}

function renderProvider() {
  const draft = currentDraft();
  setProviderRadio(state.provider);
  setText('providerFormTitle', 'ตั้งค่า ' + PROVIDER_LABELS[state.provider]);
  $('ollamaFields').hidden = state.provider !== 'ollama';
  $('cliFields').hidden = state.provider === 'ollama';
  $('ollamaUrl').value = state.drafts.ollama && state.drafts.ollama.baseUrl || 'http://127.0.0.1:11434';
  $('providerModel').value = draft.model || '';
  $('allowCloud').checked = state.provider !== 'ollama' && Boolean(draft.allowCloud);
  state.selectedOllamaModel = state.drafts.ollama && state.drafts.ollama.model || '';
  setText('selectedOllamaModel', state.selectedOllamaModel, 'ยังไม่ได้เลือก');
  const providerStatus = state.provider === 'ollama' ? state.ollamaDiscovery : state.providerStates[state.provider];
  const statusValue = providerStatus && (providerStatus.state || (providerStatus.available ? 'READY' : 'BLOCKED')) || (state.provider === 'ollama' && state.selectedOllamaModel ? 'READY' : 'BLOCKED');
  setText('providerStateLabel', PROVIDER_STATE_LABELS[statusValue] || statusValue);
  setTone('providerStateLabel', providerStateTone(statusValue));
  if (state.provider === 'ollama') setText('ollamaDiscoveryStatus', state.ollamaDiscovery && state.ollamaDiscovery.message || '');
  else setText('providerAuth', state.providerStates[state.provider] && state.providerStates[state.provider].message || 'ยังไม่ได้ตรวจบัญชี');
  setVisible('cancelLogin', Boolean(state.providerStates[state.provider] && state.providerStates[state.provider].state === 'AUTHENTICATING'));
  setVisible('providerDirty', anyDirty());
  setText('providerSaveState', anyDirty() ? 'มีการตั้งค่าที่ยังไม่บันทึก' : state.providerSettings ? 'บันทึกแล้ว' : 'ยังไม่ได้อ่านการตั้งค่า');
  const mutationLocked = !native || state.providerBusy;
  for (const id of ['providerOllama', 'providerCodex', 'providerClaude', 'ollamaUrl', 'providerModel', 'allowCloud', 'saveProvider', 'providerLogin']) $(id).disabled = mutationLocked;
  $('discoverModels').disabled = !native || state.providerBusy;
  $('openModelPicker').disabled = !native || state.provider !== 'ollama' || state.providerBusy;
  $('providerCheck').disabled = !native || state.providerBusy;
  $('cancelLogin').disabled = !native || state.providerBusy;
  renderTabBadges();
}

async function loadProviderSettings() {
  try {
    const settings = await invoke('get_provider_settings');
    if (!PROVIDERS.includes(settings && settings.provider)) throw new Error('อ่านการตั้งค่าตัวช่วยไม่ได้');
    state.providerSettings = settings;
    state.provider = settings.provider;
    state.drafts = makeDrafts(settings);
    state.dirty = { ollama: false, codex: false, claude: false };
    renderProvider();
    renderOverview();
    if (state.provider !== 'ollama') checkProvider(state.provider, { silent: true });
  } catch (failure) {
    state.providerSettings = null;
    setMessage('providerSaveState', errorMessage(failure), 'error');
    renderProvider();
    renderOverview();
  }
}

function scheduleProviderPoll(provider) {
  clearTimeout(state.providerTimers[provider]);
  if (state.providerStates[provider] && state.providerStates[provider].state === 'AUTHENTICATING') state.providerTimers[provider] = setTimeout(() => checkProvider(provider, { silent: true }), 2000);
}

async function checkProvider(provider = state.provider, { silent = false } = {}) {
  if (!native || !PROVIDERS.includes(provider) || provider === 'ollama') {
    if (provider === 'ollama') {
      state.ollamaDiscovery = state.ollamaDiscovery || { state: 'BLOCKED', message: 'Ollama ใช้การค้นหาโมเดลแทนสถานะ Login' };
      renderProvider();
    }
    return;
  }
  state.providerBusy = true;
  renderProvider();
  try {
    const result = await invoke('get_provider_status', { provider });
    state.providerStates[provider] = result;
    if (!silent || provider === state.provider) setMessage('providerMessage', result.message || PROVIDER_STATE_LABELS[result.state] || result.state, providerStateTone(result.state));
    scheduleProviderPoll(provider);
  } catch (failure) {
    state.providerStates[provider] = { state: 'FAILED', message: errorMessage(failure) };
    if (!silent || provider === state.provider) setMessage('providerMessage', errorMessage(failure), 'error');
  } finally {
    state.providerBusy = false;
    renderProvider();
    renderOverview();
  }
}

async function startProviderLogin() {
  const provider = state.provider;
  if (provider === 'ollama' || !native || state.providerBusy) return;
  state.providerBusy = true;
  clearGlobalError();
  renderProvider();
  try {
    const result = await invoke('start_provider_login', { provider });
    state.providerStates[provider] = result;
    setMessage('providerMessage', result.message || 'กำลังรอการยืนยันใน Browser', 'warning');
    scheduleProviderPoll(provider);
  } catch (failure) { setMessage('providerMessage', errorMessage(failure), 'error'); }
  finally { state.providerBusy = false; renderProvider(); }
}

async function cancelProviderLogin() {
  const provider = state.provider;
  if (provider === 'ollama' || !native || state.providerBusy) return;
  state.providerBusy = true;
  renderProvider();
  try {
    const result = await invoke('cancel_provider_login', { provider });
    state.providerStates[provider] = result;
    setMessage('providerMessage', result.message || 'ยกเลิก Login แล้ว', 'warning');
    clearTimeout(state.providerTimers[provider]);
  } catch (failure) { setMessage('providerMessage', errorMessage(failure), 'error'); }
  finally { state.providerBusy = false; renderProvider(); }
}

function modelPageSize(models = state.ollamaModels) {
  if (document.body.dataset.textZoom === 'true') return 1;
  const compact = window.innerHeight < 500 || panelWidth() < 680;
  const medium = window.innerHeight < 600 || panelWidth() < 960;
  const longName = models.some(model => String(model && model.name || '').length > 48);
  if (compact) return 2;
  if (medium || longName) return 3;
  return 5;
}

function filteredModels() {
  const query = String($('modelSearch').value || '').trim().toLocaleLowerCase();
  const models = state.ollamaModels.slice();
  const selected = state.drafts.ollama && state.drafts.ollama.model || '';
  if (selected && !models.some(item => item.name === selected) && !query) models.unshift({ name: selected, missing: true });
  return models.filter(item => !query || item.name.toLocaleLowerCase().includes(query));
}

function modelNamePreview(value) {
  const name = String(value || '');
  if (name.length <= 40) return name;
  return name.slice(0, 25) + '…' + name.slice(-12);
}

function renderModels() {
  const models = filteredModels();
  const pageSize = modelPageSize(models);
  const pages = Math.max(1, Math.ceil(models.length / pageSize));
  state.modelPage = Math.max(0, Math.min(state.modelPage, pages - 1));
  const pageItems = models.slice(state.modelPage * pageSize, (state.modelPage + 1) * pageSize);
  $('modelResults').style.setProperty('--model-rows', String(pageSize));
  $('modelResults').replaceChildren();
  if (!pageItems.length) {
    const empty = document.createElement('div');
    empty.className = 'model-empty';
    empty.textContent = state.ollamaDiscovery && state.ollamaDiscovery.available === false ? 'ยังเชื่อมต่อ Ollama ไม่ได้ ให้ตรวจที่อยู่แล้วค้นหาอีกครั้ง' : models.length ? 'ไม่พบโมเดลที่ตรงกับคำค้น' : 'ยังไม่มีรายการโมเดล กดค้นหาอีกครั้งเพื่ออ่านจาก Ollama';
    $('modelResults').appendChild(empty);
  } else {
    for (const model of pageItems) {
      const fullName = String(model.name || '');
      const selected = fullName === (state.drafts.ollama && state.drafts.ollama.model);
      const row = document.createElement('div');
      row.className = 'model-result';
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(selected));
      row.setAttribute('aria-label', fullName);
      const nameWrap = document.createElement('span');
      nameWrap.className = 'model-result-name';
      const name = document.createElement('strong');
      name.textContent = modelNamePreview(fullName);
      name.title = fullName;
      nameWrap.appendChild(name);
      if (model.missing) {
        const status = document.createElement('small');
        status.textContent = 'เลือกไว้ แต่ไม่พบตอนค้นหาล่าสุด';
        nameWrap.appendChild(status);
      }
      const actions = document.createElement('span');
      actions.className = 'model-result-actions';
      const detail = document.createElement('button');
      detail.type = 'button';
      detail.className = 'button ghost model-result-detail';
      detail.dataset.modelDetail = fullName;
      detail.setAttribute('aria-label', 'ดูชื่อโมเดลเต็ม ' + fullName);
      detail.textContent = 'ดูเต็ม';
      detail.addEventListener('click', event => {
        event.stopPropagation();
        openDetail('ชื่อโมเดลเต็ม', fullName, 'ai', detail);
      });
      const select = document.createElement('button');
      select.type = 'button';
      select.className = 'button secondary model-result-select';
      select.disabled = !native || state.providerBusy;
      select.textContent = selected ? 'เลือกอยู่' : 'เลือก';
      select.addEventListener('click', () => {
        if (!native || state.providerBusy) return;
        state.drafts.ollama.model = fullName;
        state.selectedOllamaModel = fullName;
        state.dirty.ollama = true;
        showPage('ai', 'aiHome', { focus: false });
        renderProvider();
        focusElement('openModelPicker');
        setMessage('providerMessage', 'เลือกโมเดล ' + fullName + ' แล้ว กดบันทึกเพื่อใช้กับงาน', 'warning');
      });
      actions.append(detail, select);
      row.append(nameWrap, actions);
      $('modelResults').appendChild(row);
    }
  }
  setText('modelCount', models.length + ' รายการ');
  setText('modelPageLabel', 'หน้า ' + (state.modelPage + 1) + ' / ' + pages);
  $('modelPrev').disabled = state.modelPage <= 0;
  $('modelNext').disabled = state.modelPage >= pages - 1;
  $('modelRefresh').disabled = !native || state.providerBusy;
  setMessage('modelStatus', state.ollamaDiscovery && state.ollamaDiscovery.message || '');
}

async function discoverModels() {
  if (!native || state.providerBusy) return;
  const baseUrl = String(state.drafts.ollama && state.drafts.ollama.baseUrl || $('ollamaUrl').value || '').trim();
  state.drafts.ollama.baseUrl = baseUrl;
  state.providerBusy = true;
  setMessage('ollamaDiscoveryStatus', 'กำลังค้นหาโมเดล…', 'warning');
  renderProvider();
  try {
    const result = await invoke('discover_ollama', { baseUrl });
    state.ollamaModels = (Array.isArray(result && result.models) ? result.models : []).map(item => ({ name: typeof item === 'string' ? item : item && item.name })).filter(item => item.name);
    state.ollamaDiscovery = result;
    state.modelPage = 0;
    setMessage('ollamaDiscoveryStatus', state.ollamaModels.length ? 'พบ ' + state.ollamaModels.length + ' โมเดล' : 'ยังไม่พบโมเดลที่ติดตั้งใน Ollama', state.ollamaModels.length ? 'success' : 'warning');
    renderModels();
  } catch (failure) {
    state.ollamaDiscovery = { available: false, message: errorMessage(failure), state: 'FAILED' };
    setMessage('ollamaDiscoveryStatus', errorMessage(failure), 'error');
    renderModels();
  } finally { state.providerBusy = false; renderProvider(); }
}

async function saveProvider() {
  if (!native || state.providerBusy) return;
  syncDraftFromForm();
  const selectedProvider = state.provider;
  if (!String(currentDraft().model || '').trim()) { setMessage('providerMessage', 'กรุณาเลือกโมเดลของตัวช่วยนี้ก่อนบันทึก', 'error'); return; }
  state.providerBusy = true;
  renderProvider();
  const selectedDraft = { ...currentDraft() };
  const settings = {
    ...(state.providerSettings || {}),
    provider: selectedProvider,
    ollama_base_url: selectedProvider === 'ollama'
      ? selectedDraft.baseUrl
      : state.providerSettings && state.providerSettings.ollama_base_url || 'http://127.0.0.1:11434',
    ollama_model: selectedProvider === 'ollama' ? selectedDraft.model : state.providerSettings && state.providerSettings.ollama_model || '',
    codex_model: selectedProvider === 'codex' ? selectedDraft.model : state.providerSettings && state.providerSettings.codex_model || '',
    claude_model: selectedProvider === 'claude' ? selectedDraft.model : state.providerSettings && state.providerSettings.claude_model || '',
    allow_cloud: selectedProvider === 'ollama' ? false : Boolean(selectedDraft.allowCloud),
  };
  try {
    state.providerSettings = await invoke('save_provider_settings', { settings });
    const savedDrafts = makeDrafts(state.providerSettings);
    const previousDrafts = state.drafts;
    state.drafts = savedDrafts;
    for (const provider of PROVIDERS) {
      if (provider !== selectedProvider && previousDrafts[provider]) state.drafts[provider] = previousDrafts[provider];
    }
    state.dirty[selectedProvider] = false;
    setMessage('providerMessage', 'บันทึกผู้ให้บริการแล้ว', 'success');
    renderProvider();
    renderOverview();
  } catch (failure) { setMessage('providerMessage', errorMessage(failure), 'error'); }
  finally { state.providerBusy = false; renderProvider(); }
}

async function checkCli() {
  if (!native) return;
  const bin = $('cli').value;
  $('checkCli').disabled = true;
  setMessage('cliDiagnostics', 'กำลังตรวจ ' + bin + '…', 'warning');
  try {
    const result = await invoke('check_headless_cli', { bin });
    state.cliResult = result;
    const summary = result && result.message || 'พบ ' + bin;
    setMessage('cliDiagnostics', summary + (result && result.version ? '\nเวอร์ชัน: ' + result.version : ''), result && result.success === false ? 'error' : 'success');
    const detail = result && result.data ? JSON.stringify(result.data, null, 2) : result && result.version || '';
    setVisible('cliDetails', detail.length > 220);
    $('cliDetails').dataset.detail = detail;
  } catch (failure) {
    state.cliResult = { error: errorMessage(failure) };
    setMessage('cliDiagnostics', errorMessage(failure), 'error');
    setVisible('cliDetails', false);
  } finally { $('checkCli').disabled = false; renderTabBadges(); }
}

async function checkUpdate() {
  if (!native) return;
  $('checkUpdate').disabled = true;
  setMessage('updateDiagnostics', 'กำลังตรวจอัปเดต…', 'warning');
  try {
    const result = await invoke('check_app_update');
    state.updateResult = result;
    const data = result && result.data || {};
    setMessage('updateDiagnostics', result && result.message || 'ยังไม่มีข้อมูล updater', result && result.success === false ? 'warning' : data.hasUpdate ? 'warning' : 'success');
    const detail = data.body || (data.version ? 'เวอร์ชันใหม่: ' + data.version : '');
    setVisible('updateDetails', Boolean(detail));
    $('updateDetails').dataset.detail = detail;
  } catch (failure) {
    state.updateResult = { error: errorMessage(failure) };
    setMessage('updateDiagnostics', 'Updater ยังไม่พร้อมใช้งาน: ' + errorMessage(failure), 'warning');
    setVisible('updateDetails', false);
  } finally { $('checkUpdate').disabled = false; }
}

function setCompactMode() {
  const next = panelWidth() < 960 || window.innerHeight < 600;
  state.compact = next;
  document.body.dataset.compact = String(next);
  renderModels();
  if (!$('hardwarePage').hidden) renderHardwarePage();
  renderCompactOverview();
  renderCompactPages();
}

function installTextZoomObserver() {
  const update = () => {
    const large = [...document.querySelectorAll('h1,h2,h3,h4,p,dt,dd,label,button,input,select,textarea,[role="tab"],[role="status"],[role="alert"],[role="heading"],strong,small')]
      .some(element => element.style.fontSize && parseFloat(element.style.fontSize) >= 24);
    const value = String(large);
    if (document.body.dataset.textZoom === value) return;
    document.body.dataset.textZoom = value;
    setCompactMode();
  };
  new MutationObserver(update).observe(document.body, { attributes: true, attributeFilter: ['style'], subtree: true });
  update();
}

function bindTabs() {
  for (const tab of TAB_ORDER) {
    const button = $('tab-' + tab);
    button.addEventListener('click', () => setTab(tab, { user: true }));
    button.addEventListener('keydown', event => activateTabFromKeyboard(event, tab));
  }
}

function bindNavigation() {
  $('overviewConfigure').addEventListener('click', () => { compactPageState.ai = 0; setTab('ai', { user: true }); showHome('ai'); focusElement('providerOllama'); });
  $('hardwareOpen').addEventListener('click', () => { state.inventoryPage = 0; showPage('overview', 'hardwarePage'); renderHardwarePage(); });
  $('hardwareBack').addEventListener('click', () => { showHome('overview'); focusElement('hardwareOpen'); });
  $('hardwareRefresh').addEventListener('click', loadInventory);
  $('hardwarePageRefresh').addEventListener('click', loadInventory);
  $('hardwarePrev').addEventListener('click', () => { state.inventoryPage -= 1; renderHardwarePage(); });
  $('hardwareNext').addEventListener('click', () => { state.inventoryPage += 1; renderHardwarePage(); });
  $('overviewCompactPrev').addEventListener('click', () => { state.overviewPage -= 1; renderCompactOverview(); });
  $('overviewCompactNext').addEventListener('click', () => { state.overviewPage += 1; renderCompactOverview(); });
  for (const [key, previousId, nextId] of [
    ['ai', 'aiCompactPrev', 'aiCompactNext'],
    ['cli', 'cliCompactPrev', 'cliCompactNext'],
    ['about', 'aboutCompactPrev', 'aboutCompactNext'],
  ]) {
    $(previousId).addEventListener('click', () => { compactPageState[key] -= 1; renderCompactPages(); });
    $(nextId).addEventListener('click', () => { compactPageState[key] += 1; renderCompactPages(); });
  }
  $('openModelPicker').addEventListener('click', () => {
  if (!native || state.providerBusy) return;
    state.modelPage = 0;
    showPage('ai', 'modelPage');
    renderModels();
  });
  $('modelBack').addEventListener('click', () => { showHome('ai'); focusElement('openModelPicker'); });
  $('modelSearch').addEventListener('input', () => { state.modelPage = 0; renderModels(); });
  $('modelRefresh').addEventListener('click', discoverModels);
  $('modelPrev').addEventListener('click', () => { state.modelPage -= 1; renderModels(); });
  $('modelNext').addEventListener('click', () => { state.modelPage += 1; renderModels(); });
  $('discoverModels').addEventListener('click', discoverModels);
  $('saveProvider').addEventListener('click', saveProvider);
  $('providerLogin').addEventListener('click', startProviderLogin);
  $('cancelLogin').addEventListener('click', cancelProviderLogin);
  $('providerCheck').addEventListener('click', () => checkProvider(state.provider));
  for (const input of document.querySelectorAll('input[name="provider"]')) input.addEventListener('change', () => {
    const previous = state.provider;
    syncDraftFromForm();
    if (previous !== input.value) {
      state.dirty[previous] = true;
      state.dirty[input.value] = true;
    }
    state.provider = input.value;
    if (state.compact || panelWidth() <= 960 || window.innerHeight <= 600) {
      compactPageState.ai = document.body.dataset.textZoom === 'true' ? 3 : 1;
    }
    renderProvider();
    renderCompactPages();
    renderOverview();
  });
  $('ollamaUrl').addEventListener('input', markProviderDirty);
  $('providerModel').addEventListener('input', markProviderDirty);
  $('allowCloud').addEventListener('change', markProviderDirty);
  $('openCli').addEventListener('click', () => { showPage('settings', 'cliPage'); focusElement('cliBack'); });
  $('openAbout').addEventListener('click', () => { showPage('settings', 'aboutPage'); focusElement('aboutBack'); });
  $('cliBack').addEventListener('click', () => { showHome('settings'); focusElement('openCli'); });
  $('aboutBack').addEventListener('click', () => { showHome('settings'); focusElement('openAbout'); });
  $('checkCli').addEventListener('click', checkCli);
  $('checkUpdate').addEventListener('click', checkUpdate);
  $('cliDetails').addEventListener('click', () => openDetail('รายละเอียดการตรวจ CLI', $('cliDetails').dataset.detail, 'settings', $('cliDetails')));
  $('updateDetails').addEventListener('click', () => openDetail('รายละเอียดอัปเดต', $('updateDetails').dataset.detail, 'settings', $('updateDetails')));
  $('detailBack').addEventListener('click', () => closeDetail());
  $('detailPrev').addEventListener('click', () => { state.detail.page -= 1; renderDetail(); });
  $('detailNext').addEventListener('click', () => { state.detail.page += 1; renderDetail(); });
}

function renderInitialUnavailable() {
  if (native) return;
  setText('statusBadge', 'Browser preview · IPC unavailable');
  setTone('statusBadge', 'warning');
  setMessage('overviewFeedback', 'เปิดแอป Zuri Local Runtime เพื่ออ่านสถานะและแก้การตั้งค่าในเครื่อง', 'warning');
  $('checkCli').disabled = true;
  $('checkUpdate').disabled = true;
  $('hardwareRefresh').disabled = true;
  $('hardwarePageRefresh').disabled = true;
  $('discoverModels').disabled = true;
  $('providerLogin').disabled = true;
  $('providerCheck').disabled = true;
}

async function startup() {
  bindTabs();
  bindNavigation();
  setCompactMode();
  installTextZoomObserver();
  window.addEventListener('resize', setCompactMode);
  renderInitialUnavailable();
  renderProvider();
  renderHardwareSummary();
  renderHardwarePage();
  if (!native) {
    renderOverview();
    return;
  }
  await Promise.allSettled([
    loadDesktopStatus(),
    loadProviderSettings(),
    loadInventory(),
    (async () => {
      try {
        const raw = await invoke('get_app_version');
        const value = typeof raw === 'string' ? raw : raw && (raw.version || raw.value || raw.data);
        const version = value ? String(value) : '';
        setText('appVersion', version, 'อ่านเวอร์ชันไม่ได้');
        setText('headerVersion', version ? 'v' + version : 'อ่านเวอร์ชันไม่ได้');
      }
      catch (failure) { setText('appVersion', 'อ่านเวอร์ชันไม่ได้'); setMessage('updateDiagnostics', errorMessage(failure), 'warning'); }
    })(),
  ]);
  renderOverview();
  renderProvider();
  renderHardwareSummary();
}

startup();
