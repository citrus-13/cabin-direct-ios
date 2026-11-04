import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const files = ['server.mjs'];
files.push('ios/StandaloneWeb/direct.js');
for (const folder of ['public', 'lib', 'scripts', 'test']) {
  for (const file of await readdir(new URL(`../${folder}/`, import.meta.url))) {
    if (/\.(mjs|js)$/.test(file)) files.push(`${folder}/${file}`);
  }
}
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { cwd: root, stdio: 'inherit' });
  if (result.error || result.status !== 0) process.exit(1);
}
console.log(`Syntax checked ${files.length} JavaScript files. This does not compile the iOS project.`);
