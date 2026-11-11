/* eslint-disable prefer-const -- forward declarations are wired after mutually-dependent closure factories. */
// Main entry point: initializes all modules, wires events, starts the app

import '../styles/main.css';
import { collectElements } from './elements.js';
import { S, restoreDraft, currentConv } from './core/state.js';
import { api, refreshApiCaps, savePrefs, onApiCapsChanged } from './core/api.js';
import { toast, copyText } from './core/feedback.js';
import { createSSE } from './core/sse.js';
import { createSettingsModal } from './ui/settings-modal.js';
import { closePopup } from './ui/popup.js';
import { openSheet } from './ui/sheet.js';
import { openAbout } from './ui/about.js';
import { UI_TIMING } from './core/config.js';
import { $ } from './core/dom.js';
import { createServerScreen } from './features/server/index.js';
import { createControlBar } from './features/control-bar/index.js';
import { createChatSidebar } from './features/chat/sidebar.js';
import { createConversation } from './features/chat/conversation.js';
import { createComposer } from './features/chat/composer.js';
import { createMessenger } from './features/chat/messenger.js';
import { createChatCrud } from './features/chat/crud.js';
import { createAttachmentHandler } from './features/attachments.js';
import { createImagePreview } from './features/chat/image-preview.js';
import { createToolsToolbar } from './features/tools/index.js';
import { createTuningScreen } from './features/tuning/index.js';
import { createTranscript } from './transcript/index.js';
import type { AppState, ChatMessage, McpState } from './types';

// ── Collect DOM refs ──────────────────────────────────────────────────────
const E = collectElements();

// ── API mutation lock ─────────────────────────────────────────────────────
let _apiGen = 0;
let _apiMutating = false;

function beginApiMutation(): () => void {
  _apiMutating = true;
  _apiGen++;
  return () => { _apiMutating = false; };
}
function isApiMutating(): boolean { return _apiMutating; }

async function refreshApiStatus(): Promise<void> {
  if (_apiMutating) return;
  const gen = _apiGen;
  try {
    const status = await api('GET', '/api/api-status');
    if (gen !== _apiGen) return;
    if (_apiMutating) return;
    S.externalApi = status;
    if (S.externalApi.connected) refreshApiCaps();
  } catch { /* noop */ }
  if (gen === _apiGen) renderControlBar();
}

// ── Instantiate feature modules ───────────────────────────────────────────

// Image preview modal (needed by transcript bridge)
const imagePreview = createImagePreview({ sheetBackdrop: E.sheetBackdrop });

// Transcript (created early so conversation can reference it)
let transcriptInstance: ReturnType<typeof createTranscript> | null = null;
function getTranscript() {
  if (!transcriptInstance) {
    transcriptInstance = createTranscript({
      onCopy: (t: string) => { copyText(t); toast('Copied', E.toast); },
      onAskAgain: () => messenger.retry(),
      onEdit: (id: string, text: string) => {
        const conv = currentConv();
        if (!conv) return;
        const msg = conv.messages.find((m) => m.id === id);
        if (!msg) return;
        // Update the text part
        const tp = msg.parts.find((p) => p.type === 'text');
        if (tp && tp.type === 'text') tp.text = text;
        messenger.persist(conv).then(conversation.showPage);
      },
      onImageClick: (src: string) => imagePreview.open(src),
      onToolApproval: (id, action, args) => messenger.resolveToolApproval(id, action, args),
    });
  }
  return transcriptInstance;
}

// Forward declarations (assigned below after mutual deps resolved)
let renderControlBar: () => void;
let renderComposer: () => void;
let renderChatSidebar: () => void;
let refreshContextBadge: () => void;
let renderConversation: () => void;
let renderConversationMarks: () => void;
let renderToolsBar: () => void;
let showPage: () => void;
let updateLiveMessage: (amsg: ChatMessage) => void;
let scrollToBottom: () => void;
let loadChats: () => Promise<void>;
let newChat: () => void;
let sendMessage: () => Promise<void>;
let stopStream: () => void;
let renameConversation: (id: string) => void;
let confirmDelete: (id: string) => void;
let revealInFinder: (id: string) => void;
let renameFolder: (id: string) => void;
let confirmDeleteFolder: (id: string) => void;
let revealFolder: (id: string) => void;
let pickAttachments: () => void;
let addAttachmentFiles: (files: File[]) => void;
let autosize: () => void;
let renderAttachments: () => void;
let updateSendState: () => void;
let applyDraftToDom: () => void;

// ── Server screen ─────────────────────────────────────────────────────────
const serverScreen = createServerScreen(E, {
  renderServer: () => { renderServer(); renderControlBar(); renderComposer(); renderConversationMarks(); },
  renderControlBar: () => renderControlBar(),
  renderComposer: () => renderComposer(),
  refreshApiCaps: () => refreshApiCaps(),
  beginApiMutation: () => beginApiMutation(),
  start: (model: string) => {
    S.prefs.selectedModel = model;
    renderServer(); renderControlBar();
    api('POST', '/api/start', { model, options: S.prefs.options || {} }).then(() => {
      settings.open();
    });
  },
  download: (model: string) => {
    api('POST', '/api/download', { model }).catch((e: any) => toast(e.message || 'Failed to start download', E.toast));
  },
  savePrefs: () => savePrefs(),
});
let renderServer: () => void;
const tuningScreen = createTuningScreen({
  onSave: () => savePrefs(),
  onRender: () => { renderSettingsView(); },
  onRequestRender: () => { renderComposer(); renderToolsBar(); },
});

const settingsTabs: Record<AppState['settingsTab'], HTMLButtonElement> = {
  connection: E.settingsTabConnection,
  tuning: E.settingsTabTuning,
  plugins: E.settingsTabPlugins,
  system: E.settingsTabSystem,
};

function syncSettingsTabs(): void {
  const active = settingsTabs[S.settingsTab];
  for (const [key, btn] of Object.entries(settingsTabs)) {
    const isActive = key === S.settingsTab;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', String(isActive));
  }

  // Measure the active tab so the sliding pill follows the real label width.
  const tabs = E.settingsTabConnection.parentElement;
  if (tabs && active.offsetWidth > 0) {
    tabs.style.setProperty('--tab-x', `${active.offsetLeft}px`);
    tabs.style.setProperty('--tab-w', `${active.offsetWidth}px`);
    revealSettingsTab(active, tabs);
  }
}

/** Token per tab strip so a new reveal cancels the previous animation. */
const tabScrollAnimations = new WeakMap<HTMLElement, number>();

/** Bring a partially clipped tab fully into the visible tab strip. */
function revealSettingsTab(tab: HTMLButtonElement, strip: HTMLElement): void {
  const stripRect = strip.getBoundingClientRect();
  const tabRect = tab.getBoundingClientRect();
  const leftOverflow = tabRect.left - stripRect.left;
  const rightOverflow = tabRect.right - stripRect.right;
  const delta = leftOverflow < 0 ? leftOverflow : rightOverflow > 0 ? rightOverflow : 0;
  if (!delta) return;

  const maxScroll = Math.max(0, strip.scrollWidth - strip.clientWidth);
  const target = Math.min(maxScroll, Math.max(0, strip.scrollLeft + delta));
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    strip.scrollLeft = target;
    return;
  }

  const token = (tabScrollAnimations.get(strip) ?? 0) + 1;
  tabScrollAnimations.set(strip, token);
  const start = strip.scrollLeft;
  const change = target - start;
  const duration = Math.min(420, Math.max(180, Math.abs(change) * 0.6));
  const startedAt = performance.now();
  const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
  const step = (now: number): void => {
    if (tabScrollAnimations.get(strip) !== token) return;
    const progress = Math.min(1, (now - startedAt) / duration);
    strip.scrollLeft = start + change * easeOutCubic(progress);
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function renderSettingsView(): void {
  syncSettingsTabs();
  if (S.settingsTab === 'tuning') {
    tuningScreen.render(E.serverForm);
    return;
  }
  if (S.settingsTab === 'plugins') {
    tuningScreen.renderPlugins(E.serverForm);
    return;
  }
  if (S.settingsTab === 'system') {
    tuningScreen.renderSystem(E.serverForm);
    return;
  }
  serverScreen.renderServer();
}

renderServer = renderSettingsView;

// ── Control bar ───────────────────────────────────────────────────────────
const controlBar = createControlBar(E, {
  renderServer: () => { if (!S.settingsOpen || S.settingsTab === 'connection') renderServer(); },
  renderComposer: () => renderComposer(),
  renderConversationMarks: () => renderConversationMarks(),
  beginApiMutation: () => beginApiMutation(),
  refreshApiStatus: () => refreshApiStatus(),
  refreshApiCaps: () => refreshApiCaps(),
  start: (model: string) => {
    S.prefs.selectedModel = model;
    renderServer(); renderControlBar();
    api('POST', '/api/start', { model, options: S.prefs.options || {} }).then(() => {
      settings.open();
    });
  },
});
renderControlBar = controlBar.renderControlBar;

// ── Chat sidebar ──────────────────────────────────────────────────────────
const sidebar = createChatSidebar(E, {
  renderConversation: () => renderConversation(),
  applyDraftToDom: () => applyDraftToDom(),
  autosize: () => autosize(),
  renderAttachments: () => renderAttachments(),
  renderComposer: () => renderComposer(),
  renameConversation: (id: string) => renameConversation(id),
  confirmDelete: (id: string) => confirmDelete(id),
  revealInFinder: (id: string) => revealInFinder(id),
  renameFolder: (id: string) => renameFolder(id),
  confirmDeleteFolder: (id: string) => confirmDeleteFolder(id),
  revealFolder: (id: string) => revealFolder(id),
});
loadChats = sidebar.loadData;
renderChatSidebar = sidebar.renderChatSidebar;
refreshContextBadge = sidebar.refreshContextBadge;
newChat = sidebar.newChat;

// ── Conversation ──────────────────────────────────────────────────────────
const conversation = createConversation(E, {
  getTranscript: () => getTranscript(),
});
renderConversation = conversation.renderConversation;
renderConversationMarks = conversation.renderConversationMarks;
showPage = conversation.showPage;
updateLiveMessage = conversation.updateLiveMessage;
scrollToBottom = conversation.scrollToBottom;

// ── Composer ──────────────────────────────────────────────────────────────
const composer = createComposer(E, {
  stopStream: () => stopStream(),
  sendMessage: () => sendMessage(),
  savePrefs: () => savePrefs(),
  pickAttachments: () => pickAttachments(),
  addAttachmentFiles: (files: File[]) => addAttachmentFiles(files),
  openSettings: () => settings.open(),
  renderChatSidebar: () => renderChatSidebar(),
});
renderComposer = composer.renderComposer;
autosize = composer.autosize;
renderAttachments = composer.renderAttachments;
updateSendState = composer.updateSendState;
applyDraftToDom = composer.applyDraftToDom;

// ── MCP Tools Toolbar ─────────────────────────────────────────────────────
const toolsToolbar = createToolsToolbar(E, {
  savePrefs: () => savePrefs(),
  renderComposer: () => renderComposer(),
});
renderToolsBar = toolsToolbar.renderToolsBar;

// ── Messenger ─────────────────────────────────────────────────────────────
const messenger = createMessenger(E, {
  autosize: () => autosize(),
  renderAttachments: () => renderAttachments(),
  renderChatSidebar: () => renderChatSidebar(),
  renderConversation: () => renderConversation(),
  renderComposer: () => renderComposer(),
  showPage: () => showPage(),
  scrollToBottom: () => scrollToBottom(),
  updateLiveMessage: (amsg: ChatMessage) => updateLiveMessage(amsg),
});
sendMessage = messenger.sendMessage;
stopStream = messenger.stopStream;

// ── Chat CRUD ─────────────────────────────────────────────────────────────
const chatCrud = createChatCrud(E, {
  loadChats: () => loadChats(),
  renderChatSidebar: () => renderChatSidebar(),
  renderConversation: () => renderConversation(),
  restoreDraft: () => restoreDraft(applyDraftToDom),
  stopStream: () => stopStream(),
});
renameConversation = chatCrud.renameConversation;
confirmDelete = chatCrud.confirmDelete;
revealInFinder = chatCrud.revealInFinder;
renameFolder = chatCrud.renameFolder;
confirmDeleteFolder = chatCrud.confirmDeleteFolder;
revealFolder = chatCrud.revealFolder;

// ── Attachments ───────────────────────────────────────────────────────────
const attachments = createAttachmentHandler({
  renderAttachments: () => renderAttachments(),
  updateSendState: () => updateSendState(),
});
pickAttachments = attachments.pickAttachments;
addAttachmentFiles = attachments.addAttachmentFiles;

// ── Settings modal ────────────────────────────────────────────────────────
const settings = createSettingsModal(E, {
  onAfterOpen: () => { renderSettingsView(); renderControlBar(); },
  onAfterClose: () => { /* noop */ },
});

// ── Render dispatcher ─────────────────────────────────────────────────────
function renderAll(): void {
  renderServer();
  renderControlBar();
  renderChatSidebar();
  renderConversation();
  renderToolsBar();
  renderComposer();
}

function renderStateDependent(): void {
  if (S.settingsOpen) {
    if (S.settingsTab === 'connection') {
      if (S.serverView === 'method') renderServer();
      else if (S.serverView === 'engine') {
        // While still on first run (no models yet) do a full repaint so the
        // primary CTA / popular list appear the moment suggestions load.
        if ((S.models || []).length === 0) renderServer();
        else serverScreen.updateInPlace();
      }
    }
    renderControlBar();
  }
  renderToolsBar();
  renderComposer();
  renderConversationMarks();
  refreshContextBadge();
}

// ── SSE ───────────────────────────────────────────────────────────────────
const sse = createSSE({
  loadChats: () => loadChats(),
  renderAll: () => renderAll(),
  renderStateDependent: () => renderStateDependent(),
  renderControlBar: () => renderControlBar(),
  renderComposer: () => renderComposer(),
  renderConversationMarks: () => renderConversationMarks(),
  renderServer: () => { if (!S.settingsOpen || S.settingsTab === 'connection') renderServer(); },
  renderToolsBar: () => renderToolsBar(),
  onMcpUpdate: (state: McpState) => {
    toolsToolbar.syncFromServer(state);
    // Keep the Plugins & MCP cards in sync with server reloads (for example
    // after saving mcp.json) without interrupting an in-progress edit.
    const active = document.activeElement as HTMLElement | null;
    if (S.settingsOpen && S.settingsTab === 'plugins' && !active?.closest('.mcp-config-editor')) {
      renderSettingsView();
    }
  },
  toast: (msg: string) => toast(msg, E.toast),
  isApiMutating: () => isApiMutating(),
  updateDownloadInPlace: () => serverScreen.updateDownloadInPlace(),
  surfaceEngineView: () => {
    S.settingsTab = 'connection';
    S.serverView = 'engine';
    settings.open();
  },
});

// ── Global keyboard shortcuts ─────────────────────────────────────────────

/** Close a native select/datalist popup by removing focus from its control. */
function blurNativeDropdown(): void {
  const active = document.activeElement;
  if (active instanceof HTMLSelectElement) active.blur();
  else if (active instanceof HTMLInputElement && active.list) active.blur();
}

document.addEventListener('mousedown', (e: MouseEvent) => {
  const active = document.activeElement;
  if (!(active instanceof HTMLSelectElement) && !(active instanceof HTMLInputElement && active.list)) return;
  if (e.target !== active && !active.contains(e.target as Node)) active.blur();
}, true);

document.addEventListener('keydown', (e: KeyboardEvent) => {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && (e.key === ',' || e.key === '1')) { e.preventDefault(); settings.toggle(); }
  else if (mod && e.key.toLowerCase() === 'n') { e.preventDefault(); newChat(); }
  else if (mod && e.key === '.') { if (S.streaming === S.currentId) { e.preventDefault(); stopStream(); } }
  else if (e.key === 'Escape') { closePopup(); blurNativeDropdown(); }
});


// ── Settings tabs ─────────────────────────────────────────────────────────
function selectSettingsTab(tab: AppState['settingsTab']): void {
  if (S.settingsTab === tab) {
    syncSettingsTabs();
    return;
  }
  if (tab === 'plugins') tuningScreen.collapseMcpConfig();
  S.settingsTab = tab;
  renderSettingsView();
  renderControlBar();
  renderComposer();
}
E.settingsTabConnection.onclick = () => selectSettingsTab('connection');
E.settingsTabTuning.onclick = () => selectSettingsTab('tuning');
E.settingsTabPlugins.onclick = () => selectSettingsTab('plugins');
E.settingsTabSystem.onclick = () => selectSettingsTab('system');

// ── Reactive: re-render composer when API caps arrive ─────────────────────
onApiCapsChanged(() => { renderComposer(); refreshContextBadge(); });

// ── Boot ──────────────────────────────────────────────────────────────────
const appVersionBtn = document.getElementById('appVersion') as HTMLButtonElement;
appVersionBtn.textContent = __APP_VERSION__;
appVersionBtn.onclick = () => openAbout(E.sheetBackdrop, __APP_VERSION__);
document.getElementById('win')!.classList.add('ready');
composer.wire();
E.newChatBtn.onclick = newChat;
E.newFolderBtn.onclick = () => {
  openSheet(E.sheetBackdrop,
    '<div class="sheet-head">New folder</div><div class="sheet-body"><input class="big" id="nfInput" placeholder="Folder name"></div>',
    ['<button class="btn" data-role="cancel">Cancel</button>', '<button class="btn prominent" data-role="go">Create</button>'],
    (root: HTMLElement, close: () => void) => {
      const inp = $('#nfInput', E.sheetBackdrop) as HTMLInputElement;
      const go = () => {
        const name = inp.value.trim();
        if (!name) return;
        api('POST', '/api/folders', { name }).then(() => {
          loadChats().then(() => renderChatSidebar());
          close();
        });
      };
      inp.onkeydown = (e: KeyboardEvent) => { if (e.key === 'Enter') go(); };
      ($('[data-role="go"]', root) as HTMLButtonElement).onclick = go;
      setTimeout(() => { inp.focus(); }, UI_TIMING.focusDelayMs);
    });
};
sse.bootstrap().finally(sse.connectSSE);
