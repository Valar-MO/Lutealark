# Lutealark frontend

React 19 + TypeScript + Vite + Tailwind CSS 前端，使用 React Router 和 Zustand。

## 开发

先在 `backend/` 运行迁移并启动后端，再执行：

```bash
cd frontend
npm ci
npm run dev
```

默认打开 `http://localhost:5173/cycle`。Vite 会将 `/api` 代理到 `http://127.0.0.1:3000`，OpenTrek 密钥不会进入浏览器。`/` 和未知路径也会转到 `/cycle`。

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

如前后端不同源，在 `.env` 设置无结尾斜杠的 `VITE_API_BASE_URL`。后端同时必须配置严格 CORS 来源和 credentials；生产环境更推荐同源反向代理。

仓库根目录的 `deploy/` 已提供 Caddy 自动 HTTPS、Nginx、后端和 PostgreSQL 的 Docker Compose 公网模板。网站部署后不再依赖开发电脑；OpenTrek 可保持 `offline`，但服务器后端和数据库仍必须在线。完整步骤见 [`deploy/README.md`](../deploy/README.md)。

## Android

仓库已经包含 Capacitor Android 工程，包名为 `com.lutealark.app`。正式 App 将 `dist` 打包进 WebView，并在构建时注入公网 HTTPS API：

```bash
cd frontend
VITE_API_BASE_URL=https://app.example.com npm run android:sync
npm run android:open
```

在 Android SDK 已安装且包含 API 36 后，可以直接构建 debug APK：

```bash
VITE_API_BASE_URL=https://app.example.com npm run android:build:debug
```

成功产物位于 `frontend/android/app/build/outputs/apk/debug/app-debug.apk`。未配置 `VITE_API_BASE_URL` 时，打包后的 UI 会拒绝原生 API 请求，不能访问后端。生产后端必须精确配置 `CORS_ORIGINS=https://localhost`；Web 继续使用同源 `HttpOnly; SameSite=Strict` Cookie，Android 则使用原生安全存储中的 bearer Token。只有精确的 Capacitor 来源和客户端标记会让注册/登录响应返回该 Token，无效 bearer 不会回退为匿名身份。

配置中的 `CAPACITOR_SERVER_URL=https://app.example.com` 只用于连接已部署网站的内部联调，不是 Play 发布方案。该 URL 只接受 HTTPS，且不得携带账号、token、签名参数或其他秘密。

已接入的原生边界：

- Android 系统返回键在 `/agent` 回到周期页；其他功能页优先按浏览历史返回，没有历史时回周期页；在 `/cycle` 退出 App。
- Manifest 已声明网络和录音权限；系统备份已关闭，避免周期、聊天等本地数据进入 Android 自动备份。
- 启动图复用 `lutealark-logo.png`，自适应和旧版图标复用 `lutealark-bird.png`，不再使用 Capacitor 默认图标。
- 登录 Token 保存在 Android 安全存储中，退出登录和删号时会清理；普通网页不会收到或读取该 Token。
- 当前语音仍依赖 Android WebView 的 Web Speech API，录音授权、中文识别和错误场景必须真机验证。
- Android 账号 JSON 导出使用 Filesystem 写入私有临时缓存，再调起系统 Share 面板；分享成功、取消或失败后都会尽力删除临时文件。网页端继续使用 Blob 下载。

本机已使用 Android SDK 36 和 JDK 21 验证 `npm run android:sync`、`assembleDebug`、`lintDebug` 和 `testDebugUnitTest` 成功，并生成 debug APK。APK/build 目录不会提交到 GitHub，克隆仓库后需按上面的命令重建。当前产物没有注入公网 API 地址，只能验证 UI/原生封装；域名确定后必须重新同步和构建。当前没有安卓真机或模拟器，安装、登录、语音、导出、弱网和返回键仍待设备级验收。

## 验证

```bash
cd frontend
npm run test
npm run lint
npm run build
npm audit
```

当前前端回归基线为 14 个测试文件、78 tests passed，lint、生产构建、Capacitor Android 同步和完整依赖审计均通过。Android 的 `assembleDebug`、`lintDebug` 与 `testDebugUnitTest` 也已通过。

由于使用真实浏览器路由，部署静态文件时必须将 `/agent`、`/cycle` 等未命中路径回退到 `index.html`。客户端随后会将未知路径规范到 `/cycle`。
