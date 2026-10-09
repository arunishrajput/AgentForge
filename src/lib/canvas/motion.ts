/**
 * The one piece of motion the CSS `prefers-reduced-motion` block cannot reach.
 *
 * `globals.css` collapses every animation and transition in the product when the
 * user asks for reduced motion. React Flow's `fitView` is different: it tweens the
 * viewport in JavaScript from a `duration` argument, so the only way to honour the
 * preference is to pass 0.
 *
 * Read at call time rather than cached, because a user can change the setting while
 * the page is open, and the canvas is a page that stays open. Guarded for the server
 * render, where `window` does not exist — the editor is a client component but Next
 * still renders it once on the server.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** `duration` for a React Flow viewport tween, honouring the preference. */
export function tweenMs(ms: number): number {
  return prefersReducedMotion() ? 0 : ms;
}

/** A screen rectangle — the part of a `DOMRect` the camera rule reads. */
export interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * **Whether every box is wholly inside the frame — Phase 36.** The camera moves to a step a copilot
 * sentence cites only when it is out of sight; pressing sentence after sentence of a workflow already
 * on screen should ring steps, not zoom the canvas about (found in the browser walk, D169). A box that
 * could not be measured (`undefined`) counts as out of sight, so the camera goes and looks.
 */
export function allInFrame(boxes: readonly (Box | undefined)[], frame: Box | undefined): boolean {
  if (!frame) return false;
  return boxes.every(
    (box) =>
      box !== undefined &&
      box.left >= frame.left &&
      box.right <= frame.right &&
      box.top >= frame.top &&
      box.bottom <= frame.bottom,
  );
}
