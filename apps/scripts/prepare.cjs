'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const esbuild = require('esbuild');
const sharp = require('sharp');
const root = path.resolve(__dirname, '../..');
const apps = path.join(root, 'apps');

async function main() {
  const out = path.join(apps, 'bundle');
  await fs.mkdir(out, { recursive: true });
  await esbuild.build({ entryPoints: [path.join(apps, 'shared/backend.cjs')], outfile: path.join(out, 'backend.cjs'),
    bundle: true, platform: 'node', target: 'node22', format: 'cjs', nodePaths: [path.join(apps, 'node_modules')],
    define: { 'require.main': 'undefined' }, external: ['electron'], logLevel: 'info' });
  await fs.cp(path.join(root, 'public'), path.join(out, 'public'), { recursive: true });
  const icon = await sharp(path.join(root, 'public/cinegram-icon.svg'), { density: 768 }).resize(1024, 1024)
    .flatten({ background: '#080808' }).png().toBuffer();
  await fs.writeFile(path.join(out, 'icon.png'), icon);
  if (process.argv.includes('android')) {
    const assets = path.join(apps, 'android/app/src/main/assets');
    await fs.mkdir(assets, { recursive: true });
    await fs.cp(path.join(root, 'public'), path.join(assets, 'public'), { recursive: true });
    // Bundle the helper so a clean build needs only apps/node_modules.
    const helper = path.join(out, 'shield-helper.cjs');
    await esbuild.build({ entryPoints: [path.join(root, 'providers/adblock.js')], outfile: helper,
      bundle: true, platform: 'node', target: 'node22', format: 'cjs', nodePaths: [path.join(apps, 'node_modules')] });
    const { buildClientShieldScript } = require(helper);
    const token = 'https://cinegram-origin.invalid/__SOURCE__';
    await fs.writeFile(path.join(assets, 'shield.html'), buildClientShieldScript(token));
    await fs.rm(helper);
    const java = path.join(apps, 'android/app/src/main/java/app/cinegram/AppConfig.java');
    // The metadata API key is the same configured in the existing server.
    const source = await fs.readFile(path.join(root, 'server.js'), 'utf8');
    const key = source.match(/const KP_KEY = '([^']+)'/)[1];
    await fs.writeFile(java, 'package app.cinegram;\nfinal class AppConfig { static final String KP_KEY = ' + JSON.stringify(key) + '; }\n');
    const res = path.join(apps, 'android/app/src/main/res/drawable');
    await fs.mkdir(res, { recursive: true });
    await sharp(icon).resize(192, 192).toFile(path.join(res, 'app_icon.png'));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
