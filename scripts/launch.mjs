import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
if (!existsSync('dist/index.html')) {
  console.error('请先运行 npm run build');
  process.exit(1);
}
const mode = 'transcribe';
const children = [mode].map((m) =>
  spawn(process.execPath, ['--import', 'tsx', 'server/main.ts', m], {
    stdio: 'inherit',
    windowsHide: true,
  }),
);
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const child of children)
  child.on('exit', (code) => {
    if (code && !stopping) {
      stop();
      process.exitCode = code;
    }
  });
