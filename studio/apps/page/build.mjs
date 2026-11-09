/**
 * Build the single-file page edition: node build.mjs → dist/sound-ninja-studio.html
 * Everything (engine, UI, 3D, spreadsheet reader) is inlined; only fonts load from Google Fonts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'dist');
fs.mkdirSync(out, { recursive: true });
const r = await build({
  entryPoints: [path.join(here, 'src/main.tsx')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2020',
  jsx: 'automatic',
  write: false,
  define: { 'process.env.NODE_ENV': '"production"' },
  legalComments: 'none',
  logLevel: 'warning',
});
const js = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = fs.readFileSync(path.join(here, 'src/base.css'), 'utf8') + fs.readFileSync(path.join(here, 'src/page.css'), 'utf8');
const html = `<title>Sound Ninja Design Studio</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&family=Manrope:wght@400;500;600;700;800&family=Plus+Jakarta+Sans:wght@600;700;800&display=swap">
<style>${css}</style>
<div id="root"></div>
<script>${js}</script>
`;
fs.writeFileSync(path.join(out, 'sound-ninja-studio.html'), html);
console.log(`dist/sound-ninja-studio.html ${(html.length / 1024).toFixed(0)} KiB`);
