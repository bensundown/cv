/**
 * Build the offline desktop app.
 *   node build.mjs [--win|--mac|--linux] [--dir]
 * 1. Bundles our server + core code (esbuild, third-party packages kept external).
 * 2. Stages a flat app folder: main.mjs, server/embedded.mjs, web/ (built UI), migrations/, icon.
 * 3. Installs production dependencies into the stage with npm (flat node_modules).
 * 4. Runs electron-builder on the stage → ../../release/desktop/.
 * Requires the web app to be built first (pnpm --filter @sn/web build).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const stage = path.join(here, 'stage');
const out = path.join(root, 'release', 'desktop');
const serverPkg = JSON.parse(fs.readFileSync(path.join(root, 'apps/server/package.json'), 'utf8'));
const desktopPkg = JSON.parse(fs.readFileSync(path.join(here, 'package.json'), 'utf8'));
const args = process.argv.slice(2);

const webDist = path.join(root, 'apps/web/dist');
if (!fs.existsSync(path.join(webDist, 'index.html'))) throw new Error('Build the web app first: pnpm --filter @sn/web build');

fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(path.join(stage, 'server'), { recursive: true });

// Third-party runtime dependencies stay external (installed below); our workspace code is bundled.
const runtimeDeps = { ...Object.fromEntries(Object.entries(serverPkg.dependencies).filter(([n]) => !n.startsWith('@sn/'))), ...(desktopPkg.dependencies ?? {}) };
await build({
  entryPoints: [path.join(root, 'apps/server/src/embedded.ts')],
  outfile: path.join(stage, 'server/embedded.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  external: Object.keys(runtimeDeps).filter((n) => n !== 'qrcode'),
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'warning',
});

fs.cpSync(webDist, path.join(stage, 'web'), { recursive: true });
fs.cpSync(path.join(root, 'apps/server/migrations'), path.join(stage, 'migrations'), { recursive: true });
fs.copyFileSync(path.join(here, 'main.mjs'), path.join(stage, 'main.mjs'));
fs.copyFileSync(path.join(here, 'build/icon.png'), path.join(stage, 'icon.png'));

const stagePkg = {
  name: 'sound-ninja-design-studio',
  productName: 'Sound Ninja Design Studio',
  version: desktopPkg.version,
  description: 'Sound Ninja Design Studio — offline event production design',
  author: 'Sound Ninja',
  private: true,
  type: 'module',
  main: 'main.mjs',
  dependencies: runtimeDeps,
};
fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify(stagePkg, null, 2));
execFileSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: stage, stdio: 'inherit', shell: process.platform === 'win32' });

const platform = args.find((a) => ['--win', '--mac', '--linux'].includes(a)) ?? { win32: '--win', darwin: '--mac' }[process.platform] ?? '--linux';
const builderConfig = {
  appId: 'za.co.soundninja.designstudio',
  productName: 'Sound Ninja Design Studio',
  copyright: 'Sound Ninja',
  directories: { app: stage, output: out, buildResources: path.join(here, 'build') },
  electronVersion: desktopPkg.devDependencies.electron,
  asar: true,
  // PGlite loads its WebAssembly/data files from disk; keep them outside the archive.
  asarUnpack: ['node_modules/@electric-sql/pglite/**'],
  files: ['**/*'],
  artifactName: 'Sound-Ninja-Design-Studio-${version}-${os}-${arch}.${ext}',
  win: { target: [{ target: 'nsis', arch: ['x64'] }], icon: path.join(here, 'build/icon.png'), signAndEditExecutable: false },
  nsis: { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true, createDesktopShortcut: true, shortcutName: 'Sound Ninja Design Studio' },
  mac: { target: [{ target: 'dmg', arch: ['arm64', 'x64'] }], category: 'public.app-category.productivity', icon: path.join(here, 'build/icon.png'), identity: null },
  linux: { target: [args.includes('--dir') ? 'dir' : 'AppImage'], category: 'Office', icon: path.join(here, 'build/icon.png') },
};
if (args.includes('--dir')) {
  builderConfig.win.target = ['dir'];
  builderConfig.mac.target = ['dir'];
}
fs.writeFileSync(path.join(here, 'electron-builder.json'), JSON.stringify(builderConfig, null, 2));
const bin = path.join(here, 'node_modules', '.bin', process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder');
execFileSync(bin, [platform, '--config', path.join(here, 'electron-builder.json'), '--publish', 'never'], { cwd: here, stdio: 'inherit', shell: process.platform === 'win32' });
console.log(`\nDesktop build written to ${out}`);
