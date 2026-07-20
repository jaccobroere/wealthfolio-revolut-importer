import { execFileSync } from 'node:child_process';

function run(script: 'integration:down' | 'integration:up'): void {
  execFileSync('pnpm', ['run', script], { stdio: 'inherit' });
}

export default function globalSetup(): void {
  run('integration:down');
  run('integration:up');
}
