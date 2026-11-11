// Connection method selection cards (top-level server view)

import { el, esc } from '../../core/dom.js';
import { S } from '../../core/state.js';

export function renderMethodCards(form: HTMLElement, handlers: { onSelectApi: () => void; onSelectEngine: () => void }): void {
  const { onSelectApi, onSelectEngine } = handlers;
  const title = el('div', 'srv-title', 'Connection Method');
  form.appendChild(title);
  const desc = el('p', 'srv-desc', 'Choose how to connect to an AI model service.');
  form.appendChild(desc);

  const apiActive = S.externalApi.connected;
  const engineActive = S.state && S.state.phase === 'ready';

  // API card
  const apiCard = el('button', 'conn-card');
  const apiDot = apiActive ? '<span class="conn-dot active"></span>' : '';
  apiCard.innerHTML =
    '<div class="conn-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M7 12h4M7 15h6"/></svg></div>' +
    '<div class="conn-info"><div class="conn-title-row"><h3>External API</h3>' + apiDot + '</div><p>Connect to any OpenAI-compatible REST endpoint by URL.</p></div>' +
    '<span class="conn-arrow">\u203a</span>';
  apiCard.onclick = onSelectApi;
  form.appendChild(apiCard);

  // Engine card
  const engCard = el('button', 'conn-card');
  const engDot = engineActive ? '<span class="conn-dot active"></span>' : '';
  engCard.innerHTML =
    '<div class="conn-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M9 9h6v6H9zM4 10h-2M4 14h-2M22 10h-2M22 14h-2M10 4v-2M14 4v-2M10 22v-2M14 22v-2"/></svg></div>' +
    '<div class="conn-info"><div class="conn-title-row"><h3>Splash Engine</h3>' + engDot + '</div><p>Run a model directly on this Mac using the Splash runtime.</p></div>' +
    '<span class="conn-arrow">›</span>';
  engCard.onclick = onSelectEngine;
  form.appendChild(engCard);
}

export function renderBreadcrumb(form: HTMLElement, crumb: string, onBack: () => void): void {
  const bc = el('nav', 'breadcrumb');
  const back = el('button', 'bc-back', '← Back');
  back.onclick = onBack;
  bc.appendChild(back);
  if (crumb) {
    const sep = el('span', 'bc-sep', '/');
    const cur = el('span', 'bc-current', esc(crumb));
    bc.appendChild(sep); bc.appendChild(cur);
  }
  form.appendChild(bc);
}
