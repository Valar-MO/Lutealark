# Lutealark 公网部署

`deploy/` 提供一套把 Lutealark 放到云服务器或 VPS 的 Docker Compose 模板：Nginx 托管 Vite 静态文件，Node 服务连接 Compose 内的 PostgreSQL。生产环境叠加 Caddy 后由它终止 HTTPS、自动申请证书，并将 `/api`、`/trpc`、`/health` 直接代理到 backend，其余页面和静态资源代理到 frontend。这样后端能获得真实客户端地址用于登录限速，同时浏览器仍只访问一个域名，Web 登录 Cookie 不需要跨域配置。本地 HTTP overlay 仍由 Nginx 同源代理 API。

## 架构和前提

- 需要安装 Docker Engine 和 Docker Compose v2；本机没有 Docker 时只能做配置静态检查，不能在本机启动这套服务。
- 需要一个有 DNS 记录的云服务器/VPS。生产部署使用 `docker-compose.caddy.yml`，Caddy 对外提供 80/443 并自动申请证书；DNS 必须指向服务器，且云防火墙放行 TCP 80/443 和 UDP 443。
- 基础 Compose 不直接发布前端端口；本地 HTTP 冒烟测试可叠加 `docker-compose.local.yml`，仅用于内网或开发机。
- PostgreSQL 只在 Compose 私有网络中可见，不映射宿主机 `5432`。
- `migrate` 是一次性服务，等待数据库健康后执行 `backend/scripts/migrate.ts`；迁移成功后才启动后端。
- OpenTrek 默认 `OPENTREK_MODE=offline`，适合暂时不接入专网的公网版本。不要把 `OPENTREK_APP_KEY` 或其他密钥写入镜像、仓库或前端变量。
- Web 同源访问不需要 CORS，生产模板默认保持 `CORS_ORIGINS=`。如果 Android Capacitor App 连接这个后端，才在受保护的运行时环境中设置精确值 `CORS_ORIGINS=https://localhost`；不要使用 `*`。
- Caddy 统一下发 HSTS、CSP、防嵌套、权限策略和 MIME 防嗅探等安全头；当前 CSP 只允许页面连接同源 API。

## 首次部署

在服务器上执行：

```bash
cp deploy/.env.production.example deploy/.env.production
# 编辑 deploy/.env.production，替换 POSTGRES_PASSWORD 和 LUTEALARK_DOMAIN
docker compose --env-file deploy/.env.production \
  -f deploy/docker-compose.yml -f deploy/docker-compose.caddy.yml config --quiet
docker compose --env-file deploy/.env.production \
  -f deploy/docker-compose.yml -f deploy/docker-compose.caddy.yml up -d --build
curl --fail https://app.example.com/health
```

`POSTGRES_PASSWORD` 会被 Compose 拼接进容器内的 `DATABASE_URL`；如果密码包含 URL 保留字符，请使用 URL 编码后的值。修改环境变量或代码后重新执行 `up -d --build`。查看状态和迁移日志：

```bash
docker compose --env-file deploy/.env.production -f deploy/docker-compose.yml ps
docker compose --env-file deploy/.env.production -f deploy/docker-compose.yml logs --no-log-prefix migrate backend
```

本地不具备 DNS/证书条件时，可执行 HTTP 冒烟测试：

```bash
docker compose --env-file deploy/.env.production \
  -f deploy/docker-compose.yml -f deploy/docker-compose.local.yml up -d --build
curl --fail http://127.0.0.1:8080/health
```

`HTTP_PORT` 只由本地 overlay 使用，默认是 `8080`。生产 Caddy 使用标准 80/443，不要把数据库端口映射到公网。

## 更新和备份

部署新版本前可先拉取代码，然后执行同一条 `up -d --build`。数据库数据位于 Docker volume `lutealark_postgres_data`；至少按云平台策略定期备份 PostgreSQL，不要把 volume 当作唯一备份。

```bash
docker compose --env-file deploy/.env.production -f deploy/docker-compose.yml exec db \
  sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > lutealark-backup.sql
```

## 验证边界

仓库开发机如果没有 Docker、云服务器或 DNS，不能据此声称公网地址已经可访问。部署主机上至少应检查：`config --quiet` 成功、`migrate` 已退出 0、`backend` 和 `frontend` 为 healthy，以及 HTTPS 域名下 `/health`、`/cycle` 和 `/agent` 能分别返回健康 JSON 与 SPA 页面。Caddy 的证书申请结果可通过 `docker compose ... logs caddy` 检查。
