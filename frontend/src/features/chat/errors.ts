// Chat error shaping. Kept pure so provider-specific messages and the
// context-window hint can be tested without state or DOM.

export interface ChatErrorContext {
  /** True when the request was routed to an external API. */
  external: boolean;
  /** Display name of the active external connection. */
  serviceName: string;
  /** Advertised context window, when known. */
  contextLimit: number | null;
  /** Number of messages in the conversation. */
  messageCount: number;
}

/** Formats a provider/HTTP error, adding a readable context-overflow hint. */
export function formatChatError(obj: any, ctx: ChatErrorContext, formatTokens: (n: number) => string | null): string {
  const err = obj.error || obj;
  const msg = err.message || JSON.stringify(err);
  if (err.code === 'context_length_exceeded') {
    const svc = ctx.external ? ctx.serviceName : 'the model';
    const ctxTokens = ctx.contextLimit;
    const context = ctxTokens ? `${svc}'s ${formatTokens(ctxTokens)}-token context` : `${svc}'s context`;
    return ctx.messageCount <= 1
      ? `This message is longer than ${context}.`
      : `This chat is longer than ${context}. Start a new chat to continue.`;
  }
  return msg;
}
