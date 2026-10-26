// Safari may play HLS natively, bypassing fetch/XHR. Keep those requests on the local proxy too.
(function () {
  'use strict';
  var target = "https://cinegram-origin.invalid/__SOURCE__";
  var origin = window.location.origin;
  function localMediaURL(value) {
    if (value == null || String(value).trim() === '') return value;
    try {
      var remote = new URL(String(value), target);
      if (remote.protocol !== 'https:' || remote.origin === origin) return value;
      var hash = remote.hash;
      remote.hash = '';
      return origin + '/api/player-proxy?url=' + encodeURIComponent(remote.href) + '&ref=' + encodeURIComponent(target) + '&sub=1' + hash;
    } catch (_) { return value; }
  }
  function isMedia(element) {
    return element && /^(video|audio|source|track)$/i.test(element.localName || '');
  }
  ['HTMLMediaElement', 'HTMLSourceElement', 'HTMLTrackElement'].forEach(function (name) {
    var constructor = window[name];
    if (!constructor) return;
    var descriptor = Object.getOwnPropertyDescriptor(constructor.prototype, 'src');
    if (!descriptor || !descriptor.set || !descriptor.configurable) return;
    Object.defineProperty(constructor.prototype, 'src', {
      configurable: descriptor.configurable, enumerable: descriptor.enumerable, get: descriptor.get,
      set: function (value) { return descriptor.set.call(this, localMediaURL(value)); }
    });
  });
  var setAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    if (String(name).toLowerCase() === 'src' && isMedia(this)) value = localMediaURL(value);
    return setAttribute.call(this, name, value);
  };
  function scan(node) {
    if (!node || node.nodeType !== 1) return;
    if (isMedia(node) && node.hasAttribute('src')) {
      var old = node.getAttribute('src'), next = localMediaURL(old);
      if (next !== old) setAttribute.call(node, 'src', next);
    }
    if (node.querySelectorAll) node.querySelectorAll('video[src],audio[src],source[src],track[src]').forEach(scan);
  }
  if (document.documentElement) {
    new MutationObserver(function (records) {
      records.forEach(function (record) {
        if (record.type === 'attributes') scan(record.target);
        else record.addedNodes.forEach(scan);
      });
    }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['src'] });
    scan(document.documentElement);
  }
})();
