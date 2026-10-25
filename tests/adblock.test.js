'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { Readable } = require('node:stream');
const axios = require('axios');
const { cleanPlayerHtml, buildClientShieldScript, rewriteHlsManifest, handlePlayerProxy, AD_URL_PATTERN } = require('../providers/adblock');

const playerUrl = 'https://player.example/embed/123?token=movie';
function unproxy(value) {
  const params = new URL(value, 'http://localhost:3000').searchParams;
  return { url: params.get('url'), ref: params.get('ref') };
}

test('HLS keeps signed segment, audio, key and init URLs relative to the upstream manifest', () => {
  const manifest = '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,URI="audio/list.m3u8?sig=a%2Fb"\n#EXT-X-KEY:METHOD=AES-128,URI="../key?id=1"\n#EXT-X-MAP:URI="init.mp4"\n720/list.m3u8\nhttps://media.example/segment.ts?sig=a%2Fb\n';
  const result = rewriteHlsManifest(manifest, 'https://cdn.example/hls/master.m3u8', playerUrl);
  const urls = [...result.matchAll(/URI="([^"]+)"/g)].map(m => m[1]);
  for (const line of result.split('\n')) if (line && !line.startsWith('#')) urls.push(line);
  assert.deepEqual(urls.map(unproxy), [
    {url:'https://cdn.example/hls/audio/list.m3u8?sig=a%2Fb',ref:playerUrl},
    {url:'https://cdn.example/key?id=1',ref:playerUrl},
    {url:'https://cdn.example/hls/init.mp4',ref:playerUrl},
    {url:'https://cdn.example/hls/720/list.m3u8',ref:playerUrl},
    {url:'https://media.example/segment.ts?sig=a%2Fb',ref:playerUrl}
  ]);
  assert.match(rewriteHlsManifest('#EXTM3U\n#EXT-X-KEY:URI="data:text/plain,test"', playerUrl, playerUrl), /URI="data:text\/plain,test"/);
});

function shieldHarness() {
  const sent = [];
  const NativeXhr = function() {};
  NativeXhr.prototype.open = function(...args) { this.args = args; };
  NativeXhr.prototype.send = function(body) { this.body = body; };
  const window = { location: {origin:'http://localhost:3000'}, fetch: async (...args) => {
    sent.push(args); return new Response('ok');
  }};
  const context = {window,URL,Request,Response,XMLHttpRequest:NativeXhr,JSON:Object.create(JSON),console:{log(){},warn(){},error(){}},
    document:{addEventListener(){},documentElement:{setAttribute(){}}}};
  const script = buildClientShieldScript(playerUrl).match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];
  vm.runInNewContext(script, context);
  return {window,sent,NativeXhr};
}

test('fetch proxies cross-origin CDN and resolves relative API requests against original document', async () => {
  const {window,sent} = shieldHarness();
  await window.fetch('https://cdn.example/master.m3u8', {method:'GET'});
  assert.deepEqual(unproxy(sent[0][0]),{url:'https://cdn.example/master.m3u8',ref:playerUrl});
  await window.fetch('playlist.json');
  assert.equal(unproxy(sent[1][0]).url,'https://player.example/embed/playlist.json');
  const proxied = '/api/player-proxy?url=https%3A%2F%2Fcdn.example%2Fseg.ts&ref=x';
  await window.fetch(proxied);
  assert.equal(sent[2][0],proxied);
});

test('fetch Request retains body, authorization, custom headers and abort signal', async () => {
  const {window,sent} = shieldHarness();
  const request = new Request('https://player.example/api/source',{method:'POST',body:'"signed-payload"',headers:{Borth:'player-token','Content-Type':'application/json'}});
  await window.fetch(request);
  assert.equal(sent[0][1].method,'POST');
  assert.equal(sent[0][1].headers.get('borth'),'player-token');
  assert.equal(Buffer.from(sent[0][1].body).toString(),'"signed-payload"');
  assert.ok(sent[0][1].signal);
});

test('XHR keeps method and async flag while proxying media CDN', () => {
  const {NativeXhr} = shieldHarness();const xhr = new NativeXhr();
  xhr.open('POST','https://cdn.example/api',false);xhr.send('raw-body');
  assert.equal(xhr.args[0],'POST');assert.equal(xhr.args[2],false);
  assert.equal(unproxy(xhr.args[1]).url,'https://cdn.example/api');assert.equal(xhr.body,'raw-body');
});

test('ad requests remain blocked and never hit upstream fetch', async () => {
  const {window,sent} = shieldHarness();
  const response = await window.fetch('https://ads.example/vast/preroll.xml');
  assert.match(await response.text(),/<VAST/);assert.equal(sent.length,0);
  assert.equal(AD_URL_PATTERN.test('https://cdn.example/segment.ts'),false);
});

test('HTML rewriting does not mutate URL literals inside inline scripts', () => {
  const inline = 'const config = {source:"<video src=\\"/not-a-tag.mp4\\">", nested:{src:"https://cdn.example/x"}};';
  const html = '<html><head><script>'+inline+'</script><script src="../runtime.js"></script></head><body></body></html>';
  const result = cleanPlayerHtml(html, playerUrl);
  assert.ok(result.includes(inline));
  assert.ok(result.includes(encodeURIComponent('https://player.example/runtime.js')));
  for (const match of result.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) new vm.Script(match[1]);
});

test('proxy keeps original player referer, raw POST, Range and 206 metadata and streams bytes', async t => {
  const original = axios.defaults.adapter; let forwarded;
  axios.defaults.adapter = async config => {
    forwarded = config;
    return {data:Readable.from([Buffer.from('video')]),status:206,statusText:'Partial Content',headers:{'content-type':'video/mp4','content-range':'bytes 0-4/500','content-length':'5','accept-ranges':'bytes'},config};
  };
  t.after(()=>{axios.defaults.adapter=original;});
  const express = require('express');const app=express();
  app.use(express.raw({type:'*/*'}));app.all('/api/player-proxy',handlePlayerProxy);
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  t.after(()=>new Promise(r=>server.close(r)));
  const raw=Buffer.from('"signed-payload"');
  const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/player-proxy?url='+encodeURIComponent('https://cdn.example/manifest')+'&ref='+encodeURIComponent(playerUrl)+'&sub=1',{
    method:'POST',body:raw,headers:{'Content-Type':'application/json',Range:'bytes=0-4',Borth:'player-token'}});
  assert.equal(response.status,206);assert.equal(response.headers.get('content-range'),'bytes 0-4/500');assert.equal(await response.text(),'video');
  assert.equal(forwarded.headers.get('Referer'),playerUrl);assert.equal(forwarded.headers.get('Origin'),'https://player.example');
  assert.equal(forwarded.headers.get('Borth'),'player-token');assert.equal(forwarded.headers.get('Range'),'bytes=0-4');assert.deepEqual(forwarded.data,raw);
});

test('extensionless HLS with an octet-stream MIME type is detected and emits absolute proxy URLs', async t => {
  const original = axios.defaults.adapter;
  axios.defaults.adapter = async config => ({data:Readable.from([Buffer.from('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100\nlow/list.m3u8\n')]),status:200,statusText:'OK',headers:{'content-type':'application/octet-stream','etag':'"upstream-body"','content-length':'52'},config});
  t.after(()=>{axios.defaults.adapter=original;});
  const express=require('express');const app=express();app.get('/api/player-proxy',handlePlayerProxy);
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  t.after(()=>new Promise(r=>server.close(r)));
  const origin='http://127.0.0.1:'+server.address().port;
  const response=await fetch(origin+'/api/player-proxy?url='+encodeURIComponent('https://cdn.example/opaque/master')+'&ref='+encodeURIComponent(playerUrl));
  const body=await response.text();const line=body.trim().split('\n').at(-1);
  assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/mpegurl/);
  assert.equal(new URL(line).origin,origin);
  assert.equal(unproxy(line).url,'https://cdn.example/opaque/low/list.m3u8');
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.notEqual(response.headers.get('etag'),'"upstream-body"');
});

test('dynamically inserted SVG icons use the proxied sprite and preserve symbol fragments', () => {
  let observerCallback; let writes = 0;
  const makeUse = value => ({localName:'use', value,
    getAttribute(name) {return name === 'href' ? null : this.value;},
    getAttributeNS() {return this.value;},
    setAttributeNS(ns,name,value) {assert.equal(ns,'http://www.w3.org/1999/xlink');this.value=value;writes++;}
  });
  const icon=makeUse('/images/allplay.svg#allplay-enter-fullscreen');
  const root={querySelectorAll(){return [icon];},setAttribute(){}};
  function Observer(callback) {observerCallback=callback;this.observe=()=>{};}
  const Xhr=function(){};Xhr.prototype.open=()=>{};Xhr.prototype.send=()=>{};
  const script=buildClientShieldScript(playerUrl).match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];
  vm.runInNewContext(script,{URL,Request,Response,JSON:Object.create(JSON),MutationObserver:Observer,XMLHttpRequest:Xhr,
    console:{log(){},error(){},warn(){}},window:{location:{origin:'http://localhost:3000'}},
    document:{documentElement:root,addEventListener(){}}});
  const result=new URL(icon.value);
  assert.equal(result.origin,'http://localhost:3000');
  assert.equal(result.hash,'#allplay-enter-fullscreen');
  assert.equal(result.searchParams.get('url'),'https://player.example/images/allplay.svg');
  observerCallback([{type:'attributes',target:icon}]);
  assert.equal(writes,1,'rewriting must not create an observer loop');
  const setting=makeUse('/images/allplay.svg#allplay-settings');
  observerCallback([{type:'childList',addedNodes:[setting]}]);
  assert.equal(new URL(setting.value).hash,'#allplay-settings');
  const internal=makeUse('#local-symbol');
  observerCallback([{type:'childList',addedNodes:[internal]}]);
  assert.equal(internal.value,'#local-symbol');
});
