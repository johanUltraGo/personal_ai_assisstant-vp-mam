/**
 * Plug-in connector interface (spec §7: "Every connector uses a plug-in
 * interface, so new services can be added without rewriting the core").
 * Every connector — Gmail, Drive, and anything added in Phase 4
 * (Innovate School, Sola, Calendar) — implements this same shape so the
 * core app never has service-specific branching in it.
 */
export interface ConnectorHealth {
  configured: boolean;
  detail: string;
}

export interface Connector {
  readonly type: string;
  health(): ConnectorHealth;
}

export class ConnectorNotConfiguredError extends Error {}
