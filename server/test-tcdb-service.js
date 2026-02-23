const assert = require('assert');
const { TcdbService } = require('./tcdb-service');

const service = new TcdbService({ scraperDir: '/tmp/CardVoice/tcdb-scraper' });

assert.strictEqual(typeof service.browse, 'function', 'browse method exists');
assert.strictEqual(typeof service.preview, 'function', 'preview method exists');
assert.strictEqual(typeof service.importSet, 'function', 'importSet method exists');
assert.strictEqual(typeof service.getStatus, 'function', 'getStatus method exists');
assert.strictEqual(typeof service.cancel, 'function', 'cancel method exists');

const status = service.getStatus();
assert.strictEqual(status.running, false);
assert.strictEqual(status.phase, 'idle');
assert.strictEqual(status.result, null);
assert.strictEqual(status.error, null);

console.log('All TcdbService smoke tests passed');
