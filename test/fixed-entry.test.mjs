import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../docs/connect.js', import.meta.url), 'utf8');
const context = { module: { exports: {} }, URL };
vm.runInNewContext(source, context);
const { normalize } = context.module.exports;
test('fixed entry accepts only explicit private literal and high port', () => {
  for (const value of ['172.20.10.1:8787', 'http://192.168.1.23:8787/', 'http://10.1.2.3:9999', 'http://[fd12:3456::1]:8787/']) {
    assert.ok(normalize(value)); assert.ok(normalize(value).startsWith('http://'));
  }
  for (const value of ['', null, 'https://10.0.0.1:8787', 'localhost:8787', '127.0.0.1:8787', '0.0.0.0:8787', '169.254.1.1:8787', '172.32.0.1:8787', '8.8.8.8:8787', '192.168.1.1:80', '192.168.1.1:65536', '192.168.001.1:8787', '0x7f000001:8787', '3232235777:8787', '192.168.1.999:8787', '10.0.0.1:8787/path', '10.0.0.1:8787?token=x', '10.0.0.1:8787#x', 'user@10.0.0.1:8787', '10.0.0.1:8787\\@example.com', '[::1]:8787', '[fe80::1]:8787', '[fd12::1%en0]:8787', '[fd12:::1]:8787']) assert.equal(normalize(value), null, String(value));
});
function page(saved, search = '') {
  const nodes = new Map();
  const get = id => { if (!nodes.has(id)) nodes.set(id, { hidden: false, checked: true, value: '', listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; } }); return nodes.get(id); };
  let timer, destination, stored = saved;
  const location = { search, hash: '', assign(value) { destination = value; } };
  vm.runInNewContext(source, { document: { getElementById: get }, window: { location, addEventListener() {} }, location,
    URL, URLSearchParams, localStorage: { getItem() { return stored; }, setItem(_, value) { stored = value; }, removeItem() { stored = null; } },
    setTimeout(fn) { timer = fn; return 1; }, clearTimeout() { timer = null; } });
  return { get, tick() { timer?.(); }, get destination() { return destination; }, get stored() { return stored; } };
}
test('fixed entry only auto-navigates a previously confirmed address, with cancel and setup escape', () => {
  const fresh = page(null); fresh.tick(); assert.equal(fresh.destination, undefined);
  const p = page('http://172.20.10.1:8787/'); p.tick(); assert.equal(p.destination, 'http://172.20.10.1:8787/');
  const paused = page('http://172.20.10.1:8787/', '?setup=1'); paused.tick(); assert.equal(paused.destination, undefined);
  const cancel = page('http://172.20.10.1:8787/'); cancel.get('cancel').listeners.click(); cancel.tick(); assert.equal(cancel.destination, undefined);
  const invalid = page('https://attacker.example/'); invalid.tick(); assert.equal(invalid.destination, undefined);
});
test('fixed entry save, opt-out and forget require explicit UI actions', () => {
  const p = page(null); p.get('address').value = '10.0.0.3:8787'; p.get('connectForm').listeners.submit({ preventDefault() {} });
  assert.equal(p.stored, 'http://10.0.0.3:8787/'); assert.equal(p.destination, p.stored);
  const opt = page('http://10.0.0.3:8787/'); opt.get('remember').checked = false; opt.get('connectForm').listeners.submit({ preventDefault() {} }); assert.equal(opt.stored, null);
  const forget = page('http://10.0.0.3:8787/'); forget.get('forget').listeners.click(); forget.tick(); assert.equal(forget.stored, null); assert.equal(forget.destination, undefined);
});
test('fixed entry cannot fetch or relay local data and contains no persistent pairing keys', () => {
  const html = readFileSync(new URL('../docs/index.html', import.meta.url), 'utf8');
  assert.match(html, /connect-src 'none'/); assert.match(html, /no-referrer/);
  assert.doesNotMatch(source, /fetch\(|XMLHttpRequest|WebSocket|\.cookie|serviceWorker/);
  assert.match(source, /location\.assign\(address\)/);
});
