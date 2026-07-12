/**
 * Account select — destination account dropdown.
 *
 * Uses `ctx.api.accounts.getAll()` (permission: `accounts.getAll`). The
 * selected account id is the import destination. No account selected →
 * Import is blocked.
 */
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@wealthfolio/ui';
import { Label } from '@wealthfolio/ui';
import type { Account, HostAPI } from '@wealthfolio/addon-sdk';

export interface AccountSelectProps {
  api: HostAPI;
  /** Currently selected account id, if any. */
  accountId: string | null;
  /** Called when the user selects an account. */
  onSelect: (accountId: string) => void;
}

export function AccountSelect({ api, accountId, onSelect }: AccountSelectProps) {
  const [accounts, setAccounts] = useState<readonly Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.accounts
      .getAll()
      .then((list) => {
        if (cancelled) return;
        setAccounts(list);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Destination account</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <Label htmlFor="revolut-account-select" className="text-sm">
          Select the Wealthfolio account to import into
        </Label>
        <select
          id="revolut-account-select"
          aria-label="Destination account"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          value={accountId ?? ''}
          disabled={loading}
          onChange={(e) => onSelect(e.target.value)}
        >
          <option value="" disabled>
            {loading ? 'Loading accounts…' : 'Select an account'}
          </option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ({a.currency})
            </option>
          ))}
        </select>
        {loadError && (
          <p className="text-destructive text-sm" role="alert">
            Failed to load accounts: {loadError}
          </p>
        )}
        {!loading && accounts.length === 0 && !loadError && (
          <p className="text-muted-foreground text-sm">
            No accounts found. Create an account in Wealthfolio first.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default AccountSelect;