/**
 * Revolut addon 3.6.1 sandbox lifecycle tests.
 *
 * Proves the documented SDK contract:
 *  1. `enable(ctx)` registers exactly one sidebar item and one route.
 *  2. Multiple `render({ root, location })` calls invoke `createRoot` exactly
 *     once and reuse the same root.
 *  3. `onDisable` removes the sidebar item exactly once and unmounts the root
 *     exactly once.
 *  4. After disable, a fresh `render` creates a new root (refs were cleared).
 *  5. Static: `src/addon.tsx` + `manifest.json` contain no `component:` /
 *     `contributes`, and `createRoot` is imported from `react-dom/client`.
 *
 * `react-dom/client` is mocked so `createRoot` is a spy returning a fake root.
 * `@wealthfolio/ui` is mocked to avoid pulling the full UI library (which
 * touches `document`/`window` at import time) into the node test environment;
 * the lifecycle test only cares about root/sidebar/router wiring, not paint.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Mock the host UI library before importing the addon. The sandbox lifecycle
// test does not paint; stubbing Card/CardContent avoids a DOM dependency.
vi.mock('@wealthfolio/ui', () => ({
  Card: ({ children }: { children: unknown }) => children,
  CardContent: ({ children }: { children: unknown }) => children,
}));

// Fake React root returned by the mocked `createRoot`.
interface FakeRoot {
  render: ReturnType<typeof vi.fn>;
  unmount: ReturnType<typeof vi.fn>;
}

const fakeRoots: FakeRoot[] = [];

vi.mock('react-dom/client', () => ({
  createRoot: vi.fn(() => {
    const root: FakeRoot = { render: vi.fn(), unmount: vi.fn() };
    fakeRoots.push(root);
    return root;
  }),
}));

// Imported after mocks are registered.
import type { AddonContext, SidebarItemConfig, SidebarItemHandle } from '@wealthfolio/addon-sdk';
const addonModule = await import('../src/addon');
const enable = addonModule.default;

const { createRoot } = await import('react-dom/client');

// --- Minimal fake AddonContext -------------------------------------------------

function createFakeContext() {
  const remove = vi.fn<() => void>();
  const sidebarItem = { remove } satisfies SidebarItemHandle;
  const sidebarCalls: { config: unknown }[] = [];
  const routerCalls: { config: unknown }[] = [];
  let disableCallback: (() => void) | null = null;

  const ctx: AddonContext = {
    ui: {
      root: {} as HTMLElement,
    },
    sidebar: {
      addItem: vi.fn((config: SidebarItemConfig): SidebarItemHandle => {
        sidebarCalls.push({ config });
        return sidebarItem;
      }),
    },
    router: {
      add: vi.fn((config: unknown) => {
        routerCalls.push({ config });
      }),
    },
    onDisable: vi.fn((cb: () => void) => {
      disableCallback = cb;
    }),
    // The lifecycle test never calls host APIs; cast a minimal stub to satisfy
    // the AddonContext type without implementing the full HostAPI surface.
    api: {} as AddonContext['api'],
  };

  return { ctx, sidebarItem, sidebarCalls, routerCalls, getDisable: () => disableCallback };
}

function makeRoot(): HTMLElement {
  // A real element is not required because `createRoot` is mocked, but the
  // contract types require an HTMLElement. Use a minimal stand-in.
  return {} as HTMLElement;
}

function makeLocation(pathname = '/addon/revolut-importer') {
  return { pathname, search: '', hash: '', params: {} };
}

describe('Revolut addon 3.6.1 sandbox lifecycle', () => {
  beforeEach(() => {
    fakeRoots.length = 0;
    vi.mocked(createRoot).mockClear();
  });

  it('enable(ctx) registers one sidebar item and one route', () => {
    const { ctx, sidebarCalls, routerCalls } = createFakeContext();
    enable(ctx);

    expect(sidebarCalls).toHaveLength(1);
    expect(routerCalls).toHaveLength(1);

    const sidebarConfig = sidebarCalls[0]!.config as Record<string, unknown>;
    expect(sidebarConfig).toMatchObject({
      id: 'revolut-importer',
      label: 'Revolut Importer',
      icon: 'files',
      route: '/addon/revolut-importer',
    });

    const routeConfig = routerCalls[0]!.config as Record<string, unknown>;
    expect(routeConfig).toMatchObject({
      id: 'revolut-importer',
      path: '/addon/revolut-importer',
    });
    expect(typeof routeConfig.render).toBe('function');
  });

  it('repeated render() calls invoke createRoot exactly once and reuse the root', () => {
    const { ctx, routerCalls } = createFakeContext();
    enable(ctx);
    const render = (
      routerCalls[0]!.config as { render: (args: { root: HTMLElement; location: unknown }) => void }
    ).render;

    const root1 = makeRoot();
    const loc = makeLocation();
    render({ root: root1, location: loc });
    render({ root: root1, location: loc });
    render({ root: root1, location: loc });

    expect(createRoot).toHaveBeenCalledTimes(1);
    expect(fakeRoots).toHaveLength(1);
    // The reused root's render is called once per render() invocation.
    expect(fakeRoots[0]!.render).toHaveBeenCalledTimes(3);
  });

  it('onDisable removes the sidebar item exactly once and unmounts the root exactly once', () => {
    const { ctx, sidebarItem, routerCalls, getDisable } = createFakeContext();
    enable(ctx);
    const render = (
      routerCalls[0]!.config as { render: (args: { root: HTMLElement; location: unknown }) => void }
    ).render;

    // Render once so a root exists.
    render({ root: makeRoot(), location: makeLocation() });
    expect(fakeRoots).toHaveLength(1);

    const disable = getDisable();
    expect(disable).not.toBeNull();
    disable!();

    expect(sidebarItem.remove).toHaveBeenCalledTimes(1);
    expect(fakeRoots[0]!.unmount).toHaveBeenCalledTimes(1);
  });

  it('after disable, a fresh render creates a new root (refs cleared)', () => {
    const { ctx, routerCalls, getDisable } = createFakeContext();
    enable(ctx);
    const render = (
      routerCalls[0]!.config as { render: (args: { root: HTMLElement; location: unknown }) => void }
    ).render;

    render({ root: makeRoot(), location: makeLocation() });
    expect(fakeRoots).toHaveLength(1);
    const firstRoot = fakeRoots[0]!;

    getDisable()!();

    // After disable, a fresh render must create a brand-new root.
    render({ root: makeRoot(), location: makeLocation() });
    expect(createRoot).toHaveBeenCalledTimes(2);
    expect(fakeRoots).toHaveLength(2);
    expect(fakeRoots[1]).not.toBe(firstRoot);
  });

  it('onDisable is idempotent (second disable is a no-op)', () => {
    const { ctx, sidebarItem, getDisable } = createFakeContext();
    enable(ctx);

    const disable = getDisable()!;
    disable();
    disable();

    expect(sidebarItem.remove).toHaveBeenCalledTimes(1);
  });
});

// --- Static source/manifest assertions ---------------------------------------

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const addonSrc = readFileSync(resolve(repoRoot, 'src/addon.tsx'), 'utf8');
const manifestSrc = readFileSync(resolve(repoRoot, 'manifest.json'), 'utf8');

describe('Revolut addon static contract', () => {
  it('imports createRoot from react-dom/client', () => {
    expect(addonSrc).toMatch(/from\s+['"]react-dom\/client['"]/);
    expect(addonSrc).toMatch(/createRoot/);
  });

  it('addon.tsx has no component: / contributes / useLocation / useParams / QueryClientProvider', () => {
    expect(addonSrc).not.toMatch(/\bcomponent\s*:/);
    expect(addonSrc).not.toMatch(/\bcontributes\b/);
    expect(addonSrc).not.toMatch(/useLocation/);
    expect(addonSrc).not.toMatch(/useParams/);
    expect(addonSrc).not.toMatch(/QueryClientProvider/);
  });

  it('manifest.json has no contributes field', () => {
    expect(manifestSrc).not.toMatch(/"contributes"/);
  });

  it('manifest.json has no component field', () => {
    expect(manifestSrc).not.toMatch(/"component"/);
  });

  it('addon.tsx registers sidebar.addItem, router.add, and onDisable', () => {
    expect(addonSrc).toMatch(/sidebar\.addItem/);
    expect(addonSrc).toMatch(/router\.add/);
    expect(addonSrc).toMatch(/onDisable/);
  });
});
