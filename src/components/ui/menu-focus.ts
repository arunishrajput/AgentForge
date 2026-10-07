/**
 * Where keyboard focus goes inside a `Menu` — Phase 28.
 *
 * Pure, so it can be tested without a DOM, and separate from `menu.tsx` because the bug
 * it fixes was in exactly this arithmetic. **The account menu was a dead end from the
 * keyboard.** Its first item is the signed-in address, shown disabled. Opening the menu
 * focused item 0, `focus()` on a disabled button does nothing, so focus stayed on the
 * trigger — whose ArrowDown only opens a closed menu — and every item is `tabIndex={-1}`.
 * Settings, the theme choice and Sign out could not be reached without a pointer. End
 * had the same blind spot: it counted back from item 0, so with item 0 disabled it
 * landed one item short of the last. Found by driving the deployed account menu with a
 * keyboard; Phase 27 had verified `Menu` on `/design`, whose first item is enabled.
 *
 * Every function takes the items' `disabled` flags and returns an index into them, or
 * `null` when nothing can take focus.
 */
type Focusable = { disabled?: boolean };

function enabled(items: readonly Focusable[]): number[] {
  return items.flatMap((item, index) => (item.disabled ? [] : [index]));
}

/** The first item that can take focus — where opening the menu puts it, and Home. */
export function firstFocusable(items: readonly Focusable[]): number | null {
  return enabled(items)[0] ?? null;
}

/** The last item that can take focus — End. */
export function lastFocusable(items: readonly Focusable[]): number | null {
  return enabled(items).at(-1) ?? null;
}

/**
 * The next item that can take focus from `from`, `delta` steps on (±1), wrapping at
 * either end. From an item that cannot take focus — which is where focus sits if
 * something else moved it — ArrowDown goes to the first and ArrowUp to the last.
 */
export function stepFocus(items: readonly Focusable[], from: number, delta: 1 | -1): number | null {
  const order = enabled(items);
  if (order.length === 0) return null;
  const at = order.indexOf(from);
  if (at === -1) return delta === 1 ? order[0] : order[order.length - 1];
  return order[(at + delta + order.length) % order.length];
}
