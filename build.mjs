// Builds the static site. `node build.mjs` writes docs/ (served by GitHub Pages);
// `node build.mjs --emulator` writes test-out/ wired to the local Firebase emulators.
import * as esbuild from 'esbuild';
import fs from 'node:fs';

const emulator = process.argv.includes('--emulator');
const out = emulator ? 'test-out' : 'docs';
const version = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);

fs.rmSync(out, {recursive: true, force: true});
fs.mkdirSync(out + '/icons', {recursive: true});
await esbuild.build({
  entryPoints: ['src/main.js'],
  bundle: true,
  minify: true,
  format: 'esm',
  target: ['es2020'],
  outfile: out + '/app.js',
  define: {__EMULATOR__: String(emulator)},
  legalComments: 'none',
  charset: 'utf8',
  logLevel: 'warning'
});
const stamp = s => s.replaceAll('__VERSION__', version);
fs.writeFileSync(out + '/index.html', stamp(fs.readFileSync('src/index.html', 'utf8')));
fs.writeFileSync(out + '/sw.js', stamp(fs.readFileSync('src/sw.js', 'utf8')));
fs.copyFileSync('src/manifest.webmanifest', out + '/manifest.webmanifest');
for (const f of fs.readdirSync('src/icons')) fs.copyFileSync('src/icons/' + f, out + '/icons/' + f);
fs.writeFileSync(out + '/.nojekyll', '');
console.log(`built ${out}/ (version ${version}, app.js ${(fs.statSync(out + '/app.js').size / 1024).toFixed(0)} KB)`);
