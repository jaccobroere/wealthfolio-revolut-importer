/**
 * UI test setup — jsdom environment + @testing-library/jest-dom matchers.
 *
 * Loaded via `// @vitest-environment jsdom` + `setupFiles` is not global to
 * avoid disturbing the node-environment addon/parser tests. Each UI test
 * file sets the environment inline and imports this setup.
 */
import '@testing-library/jest-dom/vitest';