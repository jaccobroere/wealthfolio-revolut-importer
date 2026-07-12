import { createRoot, type Root } from 'react-dom/client';
import type { AddonContext } from '@wealthfolio/addon-sdk';
import { Card, CardContent } from '@wealthfolio/ui';

const ADDON_ID = 'revolut-importer';
const ROUTE_PATH = '/addon/revolut-importer';

function ImporterPlaceholder() {
  return (
    <div className="p-6">
      <Card>
        <CardContent className="p-6">
          <h1 className="text-2xl font-semibold mb-2">Revolut Importer</h1>
          <p className="text-muted-foreground">
            Import workflow is built in later tasks. Add-on loaded successfully.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export default function enable(ctx: AddonContext) {
  let root: Root | null = null;

  const sidebarItem = ctx.sidebar.addItem({
    id: ADDON_ID,
    label: 'Revolut Importer',
    icon: 'files',
    route: ROUTE_PATH,
    order: 100,
  });

  ctx.router.add({
    path: ROUTE_PATH,
    render: ({ root: routeRoot }) => {
      root ??= createRoot(routeRoot);
      root.render(<ImporterPlaceholder />);
    },
  });

  ctx.onDisable(() => {
    sidebarItem.remove();
    root?.unmount();
    root = null;
  });
}
