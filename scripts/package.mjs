// Zip the contents of dist/ (not the folder itself) into
// testkube-for-github-<version>.zip, the shape the Chrome Web Store accepts.
// Pure Node so it runs on any platform without `zip` or a POSIX shell.
import { readdirSync, readFileSync, statSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { zipSync } from 'fflate';

const root = new URL('..', import.meta.url).pathname;
const dist = join(root, 'dist');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const out = join(root, `testkube-for-github-${version}.zip`);

if (!existsSync(join(dist, 'manifest.json'))) {
  console.error('dist/manifest.json not found; run `npm run build` first.');
  process.exit(1);
}

const files = {};
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else files[relative(dist, full).split(sep).join('/')] = readFileSync(full);
  }
}
walk(dist);

rmSync(out, { force: true });
writeFileSync(out, zipSync(files, { level: 9 }));
console.log(`wrote ${relative(root, out)} (${Object.keys(files).length} files)`);
