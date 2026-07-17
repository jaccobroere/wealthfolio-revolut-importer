/**
 * Revolut Importer addon entry — Wealthfolio 3.6.1 sandbox lifecycle.
 *
 * Targets the published `@wealthfolio/addon-sdk` 3.6.1, which supports only the
 * `render`-callback route model. (The host-managed `component` route model is
 * unreleased — it lands in 3.6.2 — so migration to it is future work, not
 * pending cleanup.) In the 3.6.1 host, sidebar navigation is registered at
 * runtime along with the route; manifest-declared navigation was introduced
 * after this host version.
 *
 * Verified contract (see docs/SDK-CONTRACT.md):
 * - `enable(ctx)` registers a sidebar item and route via
 *   `ctx.sidebar.addItem(...)` and `ctx.router.add({ id, path, render })`.
 * - `render({ root, location })` creates exactly ONE React root with
 *   `createRoot(root)` (imported from `react-dom/client`), reuses it across
 *   renders, and renders `<ImporterPage ctx={ctx} location={location} />`.
 *   React Router context is unavailable in the sandbox, so `location` is
 *   forwarded as a prop — never via the router hooks.
 * - `onRendered`: the 3.6.1 iframe host includes this acknowledgement callback
 *   in the runtime context, although it is intentionally absent from the public
 *   SDK type. Calling it acknowledges route completion and is retained
 *   defensively in both importers; it is undocumented, so keep it isolated and
 *   re-verify against the host if the SDK changes.
 * - `ctx.onDisable()` unmounts the root exactly once and clears refs so a later
 *   `render` starts fresh.
 * - No `component` route field, no `ReactDOM` globals, no QueryClient provider.
 */
import { createRoot, type Root } from 'react-dom/client';
import type { AddonContext, AddonRouteRenderContext } from '@wealthfolio/addon-sdk';
import { ImporterPage } from './pages/importer-page';

const ROUTE_ID = 'main';
/** Wealthfolio 3.6.1 add-on route namespace. */
const ROUTE_PATH = '/addon/revolut-importer';

export function enable(ctx: AddonContext): void {
  // Function-local per-enable state. Each `enable` starts fresh, so no
  // module-scoped mutable state, no double-enable guard, and no test-only
  // reset helper is needed.
  let root: Root | null = null;
  let sidebarRemoved = false;
  const sidebarItem = ctx.sidebar.addItem({
    id: 'revolut-importer',
    label: 'Revolut Import',
    icon: 'files',
    route: ROUTE_PATH,
    order: 101,
  });
  ctx.router.add({
    id: ROUTE_ID,
    path: ROUTE_PATH,
    render: ({ root: routeRoot, location, ...hostContext }: AddonRouteRenderContext) => {
      // Create one React root lazily and reuse it across renders.
      if (root === null) {
        root = createRoot(routeRoot);
      }
      root.render(<ImporterPage ctx={ctx} location={location} />);
      // Undocumented 3.6.1 host acknowledgement callback (see file header).
      const onRendered = (hostContext as { onRendered?: unknown }).onRendered;
      if (typeof onRendered === 'function') {
        onRendered();
      }
    },
  });

  ctx.onDisable(() => {
    if (!sidebarRemoved) {
      sidebarItem.remove();
      sidebarRemoved = true;
    }
    // Unmount the React root exactly once.
    if (root !== null) {
      root.unmount();
      root = null;
    }
  });
}
