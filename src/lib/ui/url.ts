/**
 * **Changing the address bar without a navigation, in a way Next's router hears** — Phase 32.
 *
 * Next 16 patches `history.replaceState` so a page can change its URL in place and the router
 * follows (`node_modules/next/dist/docs/01-app/01-getting-started/04-linking-and-navigating.md`).
 * But the patch **skips any call whose state object carries Next's own marker (`__NA`)**, taking
 * it for one of the router's own writes — and `window.history.state` *is* the router's object,
 * marker and all. Passing it, as the list first did, changed the address without telling the
 * router; the router's next commit (any `router.refresh()`) then wrote back the address the page
 * had loaded with. Phase 32's browser walk found it as a renamed tag whose link kept the old name.
 *
 * So the state is always `null`, as Next's own examples pass — the patch then copies the router's
 * state across itself.
 */
export interface UrlEnvironment {
  location: Pick<Location, "pathname" | "search" | "hash">;
  history: Pick<History, "replaceState">;
}

/** Replace the current address with `next` unless it already is that. True when it wrote. */
export function replaceAddress(next: string, env: UrlEnvironment = window): boolean {
  const { pathname, search, hash } = env.location;
  if (next === `${pathname}${search}${hash}`) return false;
  env.history.replaceState(null, "", next);
  return true;
}
