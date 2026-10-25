'use strict';
// Bundled into the desktop application. All networking happens on this device.
process.env.CINEGRAM_EMBEDDED = '1';
const app = require('../../server');
const server = app.listen(31847, '127.0.0.1', () => {
  process.parentPort?.postMessage({ type: 'ready', url: 'http://127.0.0.1:31847' });
  if (!process.parentPort) console.log('CineGram backend ready on http://127.0.0.1:31847');
});
server.on('error', error => {
  process.parentPort?.postMessage({ type: 'error', message: error.message });
  process.exitCode = 1;
});
process.parentPort?.on('message', event => {
  if (event.data?.type === 'shutdown') { server.close(); server.closeAllConnections(); process.exit(0); }
});
