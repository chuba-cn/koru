import { execSync } from 'node:child_process';
import path from 'node:path';
import { config } from 'dotenv';

export default function setup() {
  const envPath = path.resolve(__dirname, '../.env.test');
  config({ path: envPath, override: true });

  execSync('pnpm prisma migrate deploy', {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env },
    stdio: 'inherit',
  });
}
