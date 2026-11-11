// Cached references to static DOM elements (queried once at startup)

import type { Elements } from './types';

export function collectElements(): Elements {
  return {
    win: document.getElementById('win') as HTMLDivElement,
    newFolderBtn: document.getElementById('newFolderBtn') as HTMLButtonElement,
    newChatBtn: document.getElementById('newChatBtn') as HTMLButtonElement,
    settingsGear: document.getElementById('settingsGear') as HTMLButtonElement,
    settingsModal: document.getElementById('settingsModal') as HTMLDivElement,
    settingsClose: document.getElementById('settingsClose') as HTMLButtonElement,
    settingsTabConnection: document.getElementById('settingsTabConnection') as HTMLButtonElement,
    settingsTabTuning: document.getElementById('settingsTabTuning') as HTMLButtonElement,
    settingsTabPlugins: document.getElementById('settingsTabPlugins') as HTMLButtonElement,
    settingsTabSystem: document.getElementById('settingsTabSystem') as HTMLButtonElement,
    smBackdrop: document.getElementById('smBackdrop') as HTMLDivElement,
    serverForm: document.getElementById('serverForm') as HTMLDivElement,
    serverScroll: document.getElementById('serverScroll') as HTMLDivElement,
    controlBar: document.getElementById('controlBar') as HTMLDivElement,
    cbMark: document.getElementById('cbMark') as HTMLElement,
    cbModel: document.getElementById('cbModel') as HTMLDivElement,
    cbDetail: document.getElementById('cbDetail') as HTMLDivElement,
    cbActions: document.getElementById('cbActions') as HTMLDivElement,
    chatSearch: document.getElementById('chatSearch') as HTMLInputElement,
    convList: document.getElementById('convList') as HTMLDivElement,
    convStage: document.getElementById('convStage') as HTMLDivElement,
    emptyState: document.getElementById('emptyState') as HTMLDivElement,
    emptyMark: document.getElementById('emptyMark') as HTMLElement,
    emptyHint: document.getElementById('emptyHint') as HTMLParagraphElement,
    toolsBar: document.getElementById('toolsBar') as HTMLDivElement,
    composerInput: document.getElementById('composerInput') as HTMLTextAreaElement,
    attachRow: document.getElementById('attachRow') as HTMLDivElement,
    attachPlus: document.getElementById('attachPlus') as HTMLButtonElement,
    engineSlot: document.getElementById('engineSlot') as HTMLButtonElement,
    engineMark: document.getElementById('engineMark') as HTMLElement,
    engineText: document.getElementById('engineText') as HTMLSpanElement,
    effortMenu: document.getElementById('effortMenu') as HTMLButtonElement,
    effortLabel: document.getElementById('effortLabel') as HTMLSpanElement,
    sendBtn: document.getElementById('sendBtn') as HTMLButtonElement,
    sheetBackdrop: document.getElementById('sheetBackdrop') as HTMLDivElement,
    toast: document.getElementById('toast') as HTMLDivElement,
  };
}
