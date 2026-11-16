/* 官方魔典的两个接口也要经过 Pages 转发（它们同样在 Worker 上） */

const UPSTREAM = 'https://botc.thinkmoss.workers.dev';

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  try {
    const init = {
      method: request.method,
      headers: { 'Content-Type': request.headers.get('Content-Type') || 'application/json' },
    };
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      const buf = await request.arrayBuffer();
      if (buf.byteLength) init.body = buf;
    }
    const res = await fetch(UPSTREAM + url.pathname + url.search, init);
    const body = await res.arrayBuffer();
    return new Response(body, {
      status: res.status,
      headers: {
        'Content-Type': res.headers.get('Content-Type') || 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ status: 500, reason: '上游不可达' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
}
