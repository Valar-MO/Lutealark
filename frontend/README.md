# Lutealark frontend

React 19 + TypeScript + Vite + Tailwind CSS 前端，使用 React Router 和 Zustand。

第一次从 GitHub 下载项目、安装 PostgreSQL、创建 `backend/.env` 或连接
OpenTrek，请从根目录的 [README.md](../README.md) 按“零基础步骤”操作。
本文件只补充前端开发信息。

## 开发

先在 `backend/` 运行迁移并启动后端，再执行：

```bash
cd frontend
npm ci
npm run dev
```

默认打开 `http://localhost:5173/cycle`。Vite 会将 `/api` 代理到 `http://127.0.0.1:3000`，OpenTrek 密钥不会进入浏览器。`/` 和未知路径也会转到 `/cycle`。
如果 `5173` 已被占用，必须使用 Vite 终端实际显示的 `Local` 端口；旧端口中的标签页不代表当前前端。Vite 仅接受 `localhost`、`127.0.0.1` 或 `::1`，并只为与当前页面 Host 精确一致的本地请求改写 API 代理 Origin，所以使用 `5174`、`5175` 等实际端口不需要修改后端 CORS，外站或端口不符的请求仍会被拒绝。后台创建 Agent Session 或连接 OpenTrek 时，聊天入口、输入和“新对话”仍可使用，当前消息发送中才会阻止重复发送和新建对话。

可用路由：

- `/cycle`：默认主页，包含周期曲线/轮盘、每日状态及历史编辑/删除
- `/agent`：聊天、OpenTrek 重连、离线/在线与 RAG 状态、来源、工具 action，以及需二次明确同意的长期记忆候选
- `/breathing`：呼吸练习、评分及历史删除
- `/tools`：轻计划、专注、降载和微运动
- `/memory`：对话档案与经同意保存的长期记忆
- `/points`：积分和每周目标
- `/account`：注册、登录、注销、跨设备同步、完整 JSON 导出和账号删除

周期设置、每日状态、呼吸记录和轻计划会本地优先保存，然后同步到 PostgreSQL。本地缓存与待同步状态按匿名设备 UUID / 账号 userId 分区，轻计划再按上海日期分区。只上传显式 dirty 修改；离线删除使用持久化 tombstone，专注、环境/感官和微运动记录使用稳定 UUID outbox，刷新后仍可幂等重试。匿名设备 UUID 只是未登录时的数据分区键，不是认证凭据；账号登录使用后端 HttpOnly Cookie。

PostgreSQL 保留全量每日状态和呼吸历史；产品快照与当前本地窗口只取各自最近 30 条。这是页面读取窗口，不是数据库保留上限；账号完整导出仍包含全量历史。

数据导出与账号删除仅对登录账号开放。删除时页面要求输入当前密码和账号邮箱二次确认；服务器删除成功后，前端会清空当前聊天、个人数据和本地待同步状态。

助手提出的长期记忆候选不会自动保存。页面会展示准确摘要并要求用户勾选同意；用户可以拒绝，保存后也能在 `/memory` 编辑、归档或删除。危机、即时情绪和原始健康/周期内容不会作为候选展示。

后端只会把当前数据主体、未归档且经过敏感/时间性过滤的长期记忆作为后续问答参考，危机请求不注入记忆，记忆也不会被展示为 RAG 来源。

Agent Session 在服务端与当前账号/匿名设备及在线/离线模式绑定。如果会话过期、未绑定或被其他主体复用，后端返回 `409 AGENT_SESSION_RECREATE_REQUIRED`；前端会自动重建一次 Session 并重试该请求一次。对 `auto` 模式产生的 `offline:` Session，页面另外提供有界自动重连和“重新连接 OpenTrek”手动操作；成功后只替换 Session，不清空当前对话。

聊天入口态和全屏聊天顶栏都有“← 返回周期”，只导航回 `/cycle`；“新对话”才会清空当前对话。周期、Agent 入口和聊天三个主内容面板都直接使用 `/assets/background.jpg`，而不是只在页面外围显示。

本项目只支持本地浏览器运行。前端固定通过 Vite 开发服务器的 `/api` 代理访问本机后端。浏览器登录使用 `HttpOnly; SameSite=Strict` Cookie，账号 JSON 导出通过浏览器下载。

## 验证

```bash
cd frontend
npm run test
npm run lint
npm run build
npm audit
```

运行命令后的实际结果应作为当前验证结论；不要沿用历史测试数字。

2026-08-25 实际结果：Vitest `17` 个文件、`91` 个测试全部通过，lint、build 通过，`npm audit` 为 0 个已知漏洞。当前 `5175` 页面来源经代理创建 Session 为 HTTP 201、聊天为 HTTP 200 且回复非空；外站来源及绕过代理的错误来源仍为 HTTP 403。

`/` 和未知路径会在客户端规范到 `/cycle`。
