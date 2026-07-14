/**
 * Revolut Importer addon entry — Wealthfolio 3.6.1+ sandbox lifecycle.
 *
 * Sidebar navigation is declared in the manifest (`contributes.links.sidebar`),
 * so the runtime registers only the route renderer. The route id (`main`) MUST
 * match `contributes.routes[].id` in `manifest.json` or the host renders a
 * blank page. The route is currently on the 3.6.1 `render`-callback model; PR 2
 * will switch it to the preferred host-managed `component` model.
 *
 * Verified contract (see docs/SDK-CONTRACT.md):
 * - `enable(ctx)` registers one route via `ctx.router.add({ id, path, render })`.
 *   `id` must equal `manifest.json` `contributes.routes[].id`.
 * - `render({ root, location })` creates exactly ONE React root with
 *   `createRoot(root)` (imported from `react-dom/client`), reuses it across
 *   renders, and renders `<ImporterPage ctx={ctx} location={location} />`.
 *   React Router context is unavailable in the sandbox, so `location` is
 *   forwarded as a prop — never via the router hooks.
 * - `ctx.onDisable()` unmounts the root exactly once and clears refs so a later
 *   `render` starts fresh.
 * - No `ctx.sidebar.addItem` — navigation comes from `contributes.links.sidebar`.
 * - No `component` route field, no `ReactDOM` globals, no QueryClient provider.
 */
import { createRoot, type Root } from 'react-dom/client';
import type { AddonContext, AddonRouteLocation } from '@wealthfolio/addon-sdk';
import { ImporterPage } from './pages/importer-page';

/** Route id — MUST match `manifest.json` `contributes.routes[].id`. */
const ROUTE_ID = 'main';
/** Sandbox route path (plural, manifest-id-derived). */
const ROUTE_PATH = '/addons/revolut-importer';

export default function enable(ctx: AddonContext): void {
  let root: Root | null = null;

  // Sidebar navigation is manifest-declared (`contributes.links.sidebar`); the
  // runtime registers only the route renderer. The route id MUST match the
  // manifest's declared route id.
  ctx.router.add({
    id: ROUTE_ID,
    path: ROUTE_PATH,
    render: ({
      root: routeRoot,
      location,
    }: {
      root: HTMLElement;
      location: AddonRouteLocation;
    }) => {
      // Create one React root lazily and reuse it across renders.
      if (root === null) {
        root = createRoot(routeRoot);
      }
      root.render(<ImporterPage ctx={ctx} location={location} />);
    },
  });

  ctx.onDisable(() => {
    // Unmount the React root exactly once.
    if (root !== null) {
      root.unmount();
      root = null;
    }
  });
}
