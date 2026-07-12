/**
 * Revolut Importer page — T06 shell only.
 *
 * This is the sandbox route's single React root target. T06 wires only the
 * lifecycle shell: it receives the addon context and the host-supplied route
 * location and renders a minimal placeholder. T07 fills in the four-step
 * wizard (upload → account/mapping → review → reconcile/import).
 *
 * Constraints (see docs/SDK-CONTRACT.md):
 * - No React Router context is available inside the sandbox; do not use the
 *   router hooks. The host passes `location` via the route render callback,
 *   which forwards it here as a prop.
 * - No QueryClient provider; v1 data flow is React state/effects + direct
 *   `ctx.api` calls.
 * - The shell must not call any write APIs. T07 introduces the wizard.
 *
 * The shell imports the pure parser entry (`parseRevolutCsv`) and `Decimal` so
 * the production bundle includes the broker-specific parser dependencies
 * (`papaparse`, `decimal.js`) at T06 already — they are bundled, not
 * externalized (see vite.config.ts). T07 wires `parseRevolutCsv` to a file
 * input.
 */
import { Decimal } from 'decimal.js';
import type { AddonContext, AddonRouteLocation } from '@wealthfolio/addon-sdk';
import { Card, CardContent } from '@wealthfolio/ui';
import { parseRevolutCsv } from '../parser/parse-csv';

export interface ImporterPageProps {
  ctx: AddonContext;
  location: AddonRouteLocation;
}

export function ImporterPage({ ctx, location }: ImporterPageProps) {
  // T06 shell: `ctx` is wired through for T07's wizard (account selection,
  // checkImport, saveMany, mapping). The shell only proves the lifecycle
  // plumbing — it intentionally calls no host APIs. `parseRevolutCsv`/`Decimal`
  // are referenced here so the bundler keeps the parser deps in the addon
  // bundle; T07 wires them to the upload step.
  void ctx;
  void parseRevolutCsv;
  void Decimal;
  return (
    <div className="p-6">
      <Card>
        <CardContent className="p-6">
          <h1 className="text-2xl font-semibold mb-2">Revolut Importer</h1>
          <p className="text-muted-foreground">
            Import workflow is built in later tasks. Add-on loaded successfully.
          </p>
          <p className="text-muted-foreground text-sm mt-2">Route: {location.pathname}</p>
        </CardContent>
      </Card>
    </div>
  );
}

export default ImporterPage;
