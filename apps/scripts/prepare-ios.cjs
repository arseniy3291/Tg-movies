'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const esbuild = require('esbuild');
const sharp = require('sharp');
const root = path.resolve(__dirname, '../..');
(async () => {
  const app = path.join(root, 'apps/ios/CineGram');
  const resources = path.join(app, 'WebAssets');
  // Resources is reserved by Apple's iOS bundle layout.
  await fs.rm(path.join(app, 'Resources'), { recursive: true, force: true });
  await fs.mkdir(resources, { recursive: true });
  await fs.cp(path.join(root, 'public'), path.join(resources, 'public'), { recursive: true });
  const helper = path.join(root, 'apps/bundle/ios-shield-helper.cjs');
  await esbuild.build({ entryPoints: [path.join(root, 'providers/adblock.js')], outfile: helper,
    bundle: true, platform: 'node', target: 'node22', format: 'cjs', nodePaths: [path.join(root, 'apps/node_modules')] });
  const { buildClientShieldScript } = require(helper);
  await fs.writeFile(path.join(resources, 'shield.html'), buildClientShieldScript('https://cinegram-origin.invalid/__SOURCE__'));
  await fs.rm(helper);
  const source = await fs.readFile(path.join(root, 'server.js'), 'utf8');
  const key = source.match(/const KP_KEY = '([^']+)'/)[1];
  await fs.writeFile(path.join(resources, 'config.json'), JSON.stringify({ metadataKey: key }));
  const icons = path.join(app, 'Assets.xcassets/AppIcon.appiconset');
  await fs.mkdir(icons, { recursive: true });
  await sharp(path.join(root, 'public/cinegram-icon.svg'), { density: 768 }).resize(1024,1024)
    .flatten({ background: '#080808' }).removeAlpha().png().toFile(path.join(icons, 'AppIcon.png'));
  await fs.writeFile(path.join(icons, 'Contents.json'), JSON.stringify({ images: [{ filename: 'AppIcon.png', idiom: 'universal', platform: 'ios', size: '1024x1024' }], info: { author: 'xcode', version: 1 } }, null, 2));
  await fs.writeFile(path.join(app, 'Assets.xcassets/Contents.json'), JSON.stringify({ info: { author: 'xcode', version: 1 } }));
  console.log('iOS resources prepared');
})().catch(error => { console.error(error); process.exitCode = 1; });
