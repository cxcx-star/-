# 部署到 Cloudflare（在线版）

局域网版（`node server.js`）和云端版**共用同一份前端**。云端版把后端换成了
Cloudflare Worker + Durable Object，房间状态存在 DO 里，SSE 长连接照旧。

- 页面、素材：由 Workers 静态资源（`public/`）直接分发
- `/api/*`：Worker 路由到每个房间的 Durable Object
- 房间状态：DO 的 SQLite 存储，服务重启/重新部署都不丢
- 官方线上房间监听（watch）：**仅局域网版支持**，云端返回 501

## 部署（手机也能做完）

仓库里已经有 `wrangler.jsonc`，Cloudflare 会自动识别。

1. 控制台 → **Workers & Pages** → **Create** → **Workers** → **Connect to Git**（或 Import a repository）
2. 选仓库 `cxcx-star/-`
3. 构建设置保持默认（它会读 `wrangler.jsonc`，执行 `npx wrangler deploy`）
4. **Deploy**，等 2–3 分钟

部署完成后访问 `https://<项目名>.<你的子域>.workers.dev/`，首页显示的地址就是它。

> 之前那个 **Pages** 项目只有静态文件、没有后端，所以永远「服务未连接」。
> 现在可以把它删掉，避免混淆。

## 命令行部署（有电脑时更快）

```bash
cd clocktower-table
npx wrangler deploy        # 首次会要求登录 Cloudflare
```

## 免费额度说明

| 项目 | 免费额度 | 这个项目的用量 |
|---|---|---|
| Workers 请求 | 10 万次/天 | 一局几十次 |
| Durable Object | 含免费额度 | 每个房间一个 DO，长时间流式连接会占用时长 |
| 静态资源 | 20000 文件 / 单文件 25 MiB | 235 个文件，最大 2 MB |

长时间的 SSE 连接会持续计入 DO 时长，一次两三小时的团基本没问题；
如果长期挂着不用，建议关掉页面。

## 和局域网版的差异

| 能力 | 局域网版 | 云端版 |
|---|---|---|
| 断网可用 | ✅ | ❌ |
| 手机+平板同 Wi-Fi | 必须 | 不需要 |
| 发给外地朋友 | ❌ | ✅ |
| 监听官方线上房间 | ✅ | ❌ |
| 数据存在哪 | 本机 `data/rooms/` | Cloudflare DO |
