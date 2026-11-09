/* Original Cabin fixed-entry launcher. No discovery, fetch, accounts or media relay. */
(() => {
  'use strict';
  const key = 'cabin-confirmed-local-receiver-v1';
  function normalize(value) {
    if (typeof value !== 'string' || value.length > 128 || /[\s\\%?#@]/.test(value)) return null;
    const raw = value.startsWith('http://') ? value : `http://${value}`;
    const match = /^http:\/\/(\d{1,3}(?:\.\d{1,3}){3}|\[[a-fA-F0-9:]+\]):([0-9]{4,5})\/?$/.exec(raw);
    if (!match || Number(match[2]) < 1024 || Number(match[2]) > 65535) return null;
    const host = match[1];
    if (!host.startsWith('[')) {
      const parts = host.split('.');
      if (parts.some(p => (p.length > 1 && p[0] === '0') || Number(p) > 255)) return null;
      const [a, b] = parts.map(Number);
      if (!(a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168))) return null;
    } else if (!/^\[f[cd][a-fA-F0-9]{2}:/i.test(host)) return null; // ULA only; no loopback, link-local or scoped literal.
    try {
      const url = new URL(raw);
      if (url.protocol !== 'http:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
      return `${url.origin}/`;
    } catch (_) { return null; }
  }
  // Export only the deterministic parser to the Node test harness.
  if (typeof module !== 'undefined' && module.exports) { module.exports = { normalize }; return; }
  const $ = id => document.getElementById(id);
  let timer = null, saved = null;
  const cancel = () => { clearTimeout(timer); timer = null; $('cancel').hidden = true; };
  function forget() {
    cancel(); saved = null; try { localStorage.removeItem(key); } catch (_) {}
    $('forget').hidden = true; $('status').textContent = '地址已忘记。请填写手机当前显示的地址。';
  }
  function go(address) {
    cancel();
    // A top-level navigation, never a public-origin cross-network request or probe.
    window.location.assign(address);
  }
  try { saved = normalize(localStorage.getItem(key)); } catch (_) {}
  // Never accept addresses/credentials from a public URL; remove unexpected fragments.
  if (location.hash) { try { history.replaceState(null, '', location.pathname + location.search); } catch (_) {} }
  if (saved) {
    $('address').value = saved; $('forget').hidden = false;
    if (new URLSearchParams(location.search).get('setup') !== '1') {
      $('status').textContent = '3 秒后进入上次确认的手机地址。地址改变时请先取消。';
      $('cancel').hidden = false; timer = setTimeout(() => go(saved), 3000);
    }
  }
  $('cancel').addEventListener('click', () => { cancel(); $('status').textContent = '自动连接已取消，请核对手机地址。'; });
  $('forget').addEventListener('click', forget);
  $('address').addEventListener('input', cancel);
  $('remember').addEventListener('change', cancel);
  $('connectForm').addEventListener('submit', event => {
    event.preventDefault(); cancel(); $('error').textContent = '';
    const address = normalize($('address').value.trim());
    if (!address) { $('error').textContent = '请原样填写 Cabin 的本地 http:// 地址和端口，不要填写固定入口、配对码或公网地址。'; return; }
    try {
      if ($('remember').checked) localStorage.setItem(key, address);
      else localStorage.removeItem(key);
    } catch (_) { $('status').textContent = '浏览器不能保存地址，本次仍可连接。'; }
    go(address);
  });
  window.addEventListener('pagehide', cancel);
})();
