import { execFileSync } from 'node:child_process';

export default function globalTeardown(): void {
  execFileSync('pnpm', ['run', 'integration:down'], { stdio: 'inherit' });
}
