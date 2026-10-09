/**
 * **The canvas's right-hand column — Phase 35 (D161).** It holds the inspector or the copilot, never
 * both, so only one of the two panels is in the document at a time — and a control may name, in
 * `aria-controls`, only a panel that is there. `scripts/verify-a11y.mjs` found the toolbar's Copilot
 * button pointing at `copilot-panel` while the column showed the inspector: an ARIA reference to
 * nothing, which a screen reader resolves to silence.
 */

export const INSPECTOR_PANEL = "node-inspector";
export const COPILOT_PANEL = "copilot-panel";

export type RightPanel = "inspector" | "copilot";

/** The `aria-controls` a control that opens `panel` may carry: its id while it is shown, else none. */
export function controls(panel: RightPanel, shown: RightPanel): string | undefined {
  if (panel !== shown) return undefined;
  return panel === "copilot" ? COPILOT_PANEL : INSPECTOR_PANEL;
}
