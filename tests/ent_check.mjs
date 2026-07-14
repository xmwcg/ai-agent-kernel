const BASE = 'http://localhost:8799';
const ADMIN = 'test-admin-123';
const j = async (r) => ({ status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text() });

(async () => {
  // 1) public config
  let r = await fetch(BASE + '/api/config');
  console.log('1) /api/config ->', JSON.stringify(await r.json()));

  // 2) chat WITHOUT token -> 401
  r = await fetch(BASE + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'hi' }) });
  console.log('2) chat no-token ->', r.status, '(expect 401)');

  // 3) chat WITH admin token -> SSE
  r = await fetch(BASE + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + ADMIN }, body: JSON.stringify({ message: '用一句话说明你的身份' }) });
  console.log('3) chat admin-token ->', r.status, r.headers.get('content-type'));
  let buf = '';
  const reader = r.body.getReader(); const dec = new TextDecoder();
  while (true) { const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true }); }
  const hasTool = buf.includes('"tool"'); const hasDone = buf.includes('[DONE]');
  console.log('   has [DONE]:', hasDone, '| event lines:', buf.split('\n').filter(l => l.startsWith('data:')).length);

  // 4) admin stats
  r = await fetch(BASE + '/api/admin/stats', { headers: { authorization: 'Bearer ' + ADMIN } });
  const st = await r.json();
  console.log('4) /api/admin/stats ->', r.status, '| totalRequests:', st.metrics?.totalRequests, '| tokens:', st.metrics?.totalTokens, '| tenants:', st.tokens?.length);

  // 5) create tenant key
  r = await fetch(BASE + '/api/admin/keys', { method: 'POST', headers: { authorization: 'Bearer ' + ADMIN, 'content-type': 'application/json' }, body: JSON.stringify({ label: 'acme' }) });
  const k = await r.json();
  console.log('5) create tenant key ->', r.status, '| tenantId:', k.tenantId);
  if (!k.token) return console.log('   FAILED to create key');

  // 6) chat WITH tenant token
  r = await fetch(BASE + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + k.token }, body: JSON.stringify({ message: 'hi' }) });
  console.log('6) chat tenant-token ->', r.status, '(expect 200)');

  // 7) tenant cannot hit admin stats
  r = await fetch(BASE + '/api/admin/stats', { headers: { authorization: 'Bearer ' + k.token } });
  console.log('7) tenant -> admin stats ->', r.status, '(expect 401)');

  console.log('\n=== enterprise layer check done ===');
})().catch(e => console.log('ERR', e.message));
