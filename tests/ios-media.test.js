'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fixture() {
  class Element {
    constructor(name) { this.localName = name; this.attributes = {}; this.nodeType = 1; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name] ?? null; }
    hasAttribute(name) { return name in this.attributes; }
    querySelectorAll() { return []; }
  }
  class HTMLMediaElement extends Element { constructor() { super('video'); } }
  class HTMLSourceElement extends Element { constructor() { super('source'); } }
  class HTMLTrackElement extends Element { constructor() { super('track'); } }
  for (const ctor of [HTMLMediaElement, HTMLSourceElement, HTMLTrackElement]) {
    Object.defineProperty(ctor.prototype, 'src', { configurable: true, get() { return this.attributes.src; }, set(value) { this.attributes.src = value; } });
  }
  const source = fs.readFileSync('apps/ios/Support/native-media.js', 'utf8').replace('https://cinegram-origin.invalid/__SOURCE__', 'https://player.example/embed/1');
  const context = { URL, Element, document: { documentElement: new Element('html') }, MutationObserver: class { observe() {} } };
  context.window = { location: { origin: 'http://127.0.0.1:31849' }, HTMLMediaElement, HTMLSourceElement, HTMLTrackElement };
  vm.runInNewContext(source, context);
  return { Element, HTMLMediaElement, HTMLSourceElement };
}

test('iOS native HLS video.src preserves signed URL and original referer through the proxy', () => {
  const { HTMLMediaElement } = fixture();
  const video = new HTMLMediaElement();
  video.src = 'https://cdn.example/list?token=a%2Fb';
  const url = new URL(video.src);
  assert.equal(url.origin, 'http://127.0.0.1:31849');
  assert.equal(url.searchParams.get('url'), 'https://cdn.example/list?token=a%2Fb');
  assert.equal(url.searchParams.get('ref'), 'https://player.example/embed/1');
});

test('iOS source elements proxy relative src attributes without affecting images or blobs', () => {
  const { Element, HTMLMediaElement, HTMLSourceElement } = fixture();
  const source = new HTMLSourceElement();
  source.setAttribute('src', '../episode.m3u8');
  assert.equal(new URL(source.getAttribute('src')).searchParams.get('url'), 'https://player.example/episode.m3u8');
  const video = new HTMLMediaElement();
  video.src = 'blob:http://127.0.0.1:31849/stream';
  assert.equal(video.src, 'blob:http://127.0.0.1:31849/stream');
  video.src = '';
  assert.equal(video.src, '');
  const image = new Element('img');
  image.setAttribute('src', 'https://cdn.example/poster.jpg');
  assert.equal(image.getAttribute('src'), 'https://cdn.example/poster.jpg');
});
