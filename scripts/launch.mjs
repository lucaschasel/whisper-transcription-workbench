import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync('dist/index.html')) {
  console.error('请先运行 npm run build');
  process.exit(1);
}
const child = spawn(process.execPath, ['--import', 'tsx', 'server/main.ts'], {
  stdio: 'inherit',
  windowsHide: true,
});
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  child.kill('SIGTERM');
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
child.on('exit', (code) => {
  if (code && !stopping) {
    stop();
    process.exitCode = code;
  }
});
