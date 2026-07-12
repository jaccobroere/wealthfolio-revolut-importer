/**
 * Revolut Importer addon entry — Wealthfolio 3.6.1 sandbox lifecycle.
 *
 * Verified contract (see docs/SDK-CONTRACT.md):
 * - `enable(ctx)` registers one sidebar item (icon `files`, route
 *   `/addon/revolut-importer`) and one route via `ctx.router.add({ id, path,
 *   render })`. The sidebar handle is saved so it can be removed on disable.
 * - `render({ root, location })` creates exactly ONE React root with
 *   `createRoot(root)` (imported from `react-dom/client`), reuses it across
 *   renders, and renders `<ImporterPage ctx={ctx} location={location} />`.
 *   React Router context is unavailable in the sandbox, so `location` is
 *   forwarded as a prop — never via the router hooks.
 * - `ctx.onDisable()` removes the sidebar item exactly once, unmounts the
 *   root exactly once, and clears both refs so a later `render` starts fresh.
 * - No `component` route field, no manifest contribution field, no `ReactDOM`
 *   globals, no QueryClient provider, no `query` invalidation/refetch. The
 *   manifest simply omits the contribution field; the route type has no
 *   `component` property.
 */
import { createRoot, type Root } from 'react-dom/client';
import type { AddonContext, AddonRouteLocation, SidebarItemHandle } from '@wealthfolio/addon-sdk';
import { ImporterPage } from './pages/importer-page';

const ADDON_ID = 'revolut-importer';
const ROUTE_PATH = '/addon/revolut-importer';

export default function enable(ctx: AddonContext): void {
  let root: Root | null = null;
  let sidebarItem: SidebarItemHandle | null = null;

  sidebarItem = ctx.sidebar.addItem({
    id: ADDON_ID,
    label: 'Revolut Importer',
    icon: 'files',
    route: ROUTE_PATH,
    order: 100,
  });

  ctx.router.add({
    id: ADDON_ID,
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
    // Remove the sidebar item exactly once.
    if (sidebarItem !== null) {
      sidebarItem.remove();
      sidebarItem = null;
    }
    // Unmount the React root exactly once.
    if (root !== null) {
      root.unmount();
      root = null;
    }
  });
}
