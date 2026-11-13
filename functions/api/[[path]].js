/* Cloudflare Pages Functions —— API 代理
   *.workers.dev 在国内被 DNS 污染，但 *.pages.dev 干净。
   浏览器只和 pages.dev 通信；Pages 在 Cloudflare 内部转发到 Worker，
   这一段走的是 Cloudflare 内网，与公网 DNS 无关。 */

const UPSTREAM = 'https://botc.thinkmoss.workers.dev';

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};

async function forward(request, pathname, search) {
  const target = UPSTREAM + pathname + (search || '');
  const init = {
    method: request.method,
    headers: {
      'Content-Type': request.headers.get('Content-Type') || 'application/json',
      Accept: 'application/json',
    },
  };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const buf = await request.arrayBuffer();
    if (buf.byteLength) init.body = buf;
  }
  const res = await fetch(target, init);
  const body = await res.arrayBuffer();
  return new Response(body, {
    status: res.status,
    headers: {
      'Content-Type': res.headers.get('Content-Type') || 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);

  /* 健康检查：告诉前端「这里只有轮询，没有长连接」 */
  if (url.pathname === '/api/health') {
    try {
      const res = await fetch(UPSTREAM + '/api/health');
      const data = await res.json();
      return new Response(JSON.stringify(Object.assign({}, data, { transport: 'poll', pages: true })), {
        status: 200,
        headers: JSON_HEADERS,
      });
    } catch (err) {
      return new Response(JSON.stringify({ ok: false, error: String(err), transport: 'poll' }), {
        status: 502,
        headers: JSON_HEADERS,
      });
    }
  }

  try {
    return await forward(request, url.pathname, url.search);
  } catch (err) {
    return new Response(JSON.stringify({ error: '上游不可达：' + String(err) }), {
      status: 502,
      headers: JSON_HEADERS,
    });
  }
}
