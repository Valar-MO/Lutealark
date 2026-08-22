# Lutealark

Lutealark 是一个面向 ADHD 女性的周期感知支持系统。它把低压力对话、周期节奏、呼吸练习和轻量行动工具放在同一个本地网页中，帮助用户在不同能量状态下找到更容易开始的一步。

> Lutealark 用于日常自我支持，不提供医疗诊断或治疗，也不能替代专业医疗服务或紧急援助。

[完整功能说明](docs/FEATURES.md) · [前端开发说明](frontend/README.md) · [OpenTrek 工作流与 RAG 验收](opentrek/README.md)

## 当前状态

| 范围 | 状态 | 说明 |
|---|---|---|
| 本地产品功能 | ✅ 可用 | 周期、对话、呼吸、工具、档案、积分和账号都可在本机运行 |
| PostgreSQL | ✅ 可用 | 迁移、业务数据同步、账号导出和删号已有自动化覆盖 |
| 离线助手 | ✅ 可用 | 不访问 OpenTrek，不伪装成 RAG，并明确显示“离线基础支持” |
| OpenTrek 基线 | 🟠 在线可答，RAG 未确认 | 当前版本为 `1785250561438`；在线回答没有返回可验证的 `ragUsed=true` 和有效来源 |
| RAG 正式验收 | ⏳ 待平台新版本 | Q01–Q10 还需要同一候选版本的真实 Trace、sourceId 和 Top-3 召回结果 |

`.env` 模板默认使用 `OPENTREK_MODE=offline`，方便第一次运行时先排除 VPN 和平台配置问题。确认本地网页、后端和数据库都正常后，再按本文“连接 OpenTrek”一节切换为 `auto`。

## 主要功能

| 页面 | 可以做什么 |
|---|---|
| 周期主页 `/cycle` | 查看 8 天双激素曲线、周期阶段、预测日期，填写和编辑每日状态 |
| 对话 `/agent` | 文本或中文语音输入、8 条快捷短语、返回周期、工具动作、来源与安全提示 |
| 呼吸 `/breathing` | 5 种呼吸模式、动画倒计时、暂停/继续、训练记录和放松评分 |
| 工具 `/tools` | 最多 3 项轻计划、5/10/15/25 分钟专注、环境降载和微运动 |
| 档案 `/memory` | 新建、重命名、归档和删除对话；管理经过二次同意保存的长期记忆 |
| 积分 `/points` | 查看本周与累计积分、来源分解和每周目标 |
| 账号 `/account` | 邮箱注册登录、匿名数据认领、浏览器间同步、JSON 导出和删号 |

`/cycle` 是主页；访问 `/` 或不存在的路径也会回到 `/cycle`。详细规则见 [docs/FEATURES.md](docs/FEATURES.md)。

## 系统由哪几部分组成

在自己电脑上运行时，需要同时有三个本机服务：

1. PostgreSQL：保存账号、周期、记录、对话、积分等数据。
2. 后端：处理数据、安全规则，并在配置允许时连接 OpenTrek。
3. 前端：浏览器里看到的网页。

```mermaid
flowchart LR
  WEB["浏览器网页<br/>localhost:5173"] --> API["本机后端<br/>127.0.0.1:3000"]
  API --> PG[(本机 PostgreSQL)]
  API --> LOCAL["离线基础助手"]
  API -. "VPN 可用且配置完整" .-> OT["OpenTrek Agent"]
  OT --> RAG["OpenTrek 知识库"]
```

因此，只下载代码或只打开一个网址还不够。PostgreSQL、后端和前端都必须在同一台电脑上正常运行；两个运行服务的终端窗口也不能关闭。

---

## 第一次在自己电脑上运行：零基础步骤

这部分写给没有编程经验的同学。请从第 1 步开始依次完成，不要一开始就配置 OpenTrek。

### 1. 先认识“终端”

后面的灰色命令框都要在终端中执行，每次复制一行或一组命令，按回车。

- macOS：按 `Command + 空格`，搜索并打开“终端”。
- Windows：开始菜单搜索并打开“PowerShell”。

命令运行成功时不一定会出现“成功”两个字，只要没有红色错误并重新出现输入提示符，通常就可以继续。

### 2. 安装 Git、Node.js 和 PostgreSQL

需要的软件与版本：

- Git：下载项目代码。
- Node.js `24.16.0`：运行前后端；仓库根目录的 `.nvmrc` 固定了这个版本。
- PostgreSQL 16：保存数据。

#### macOS

先检查电脑上是否已经安装：

```bash
git --version
node --version
npm --version
brew --version
```

预期 `node --version` 显示 `v24.16.0`。若没有 Git，执行 `xcode-select --install` 并按系统提示安装。若没有 `brew`，先根据 [Homebrew 官网](https://brew.sh/) 的说明安装。

推荐使用 nvm 安装准确的 Node.js 版本。已经有 nvm 时执行：

```bash
nvm install 24.16.0
nvm use 24.16.0
node --version
npm --version
```

安装并启动 PostgreSQL 16：

```bash
brew install postgresql@16
brew services start postgresql@16
```

#### Windows

1. 从 [Git 官网](https://git-scm.com/download/win) 安装 Git，保持默认选项即可。
2. 安装 Node.js `24.16.0`；安装后关闭并重新打开 PowerShell。
3. 从 [PostgreSQL 官网](https://www.postgresql.org/download/windows/) 安装 PostgreSQL 16。
4. 安装 PostgreSQL 时记住自己给数据库用户 `postgres` 设置的密码；端口保持默认 `5432`。

重新打开 PowerShell，确认：

```powershell
git --version
node --version
npm --version
```

如果 `node --version` 不是 `v24.16.0`，请先调整 Node.js 版本再继续。

### 3. 获取 GitHub 代码

推荐方式是 Git 克隆，后续更新最方便：

```bash
git clone https://github.com/Valar-MO/Lutealark.git
cd Lutealark
```

如果不会使用 Git，也可以在 GitHub 项目页点击 `Code` → `Download ZIP`，解压后：

- macOS：在终端输入 `cd `（`cd` 后有一个空格），把解压后的文件夹拖进终端，再按回车。
- Windows：在解压后的文件夹空白处按住 `Shift` 并点击鼠标右键，选择“在此处打开 PowerShell 窗口”。

确认当前位置正确：

```bash
pwd
```

Windows PowerShell 也可以使用：

```powershell
Get-Location
```

当前文件夹里应能看到 `backend`、`frontend`、`docs`、`opentrek` 和本文件 `README.md`。

### 4. 安装项目依赖

在项目根目录执行：

```bash
cd backend
npm ci
cd ../frontend
npm ci
cd ..
```

这一步可能需要几分钟。`npm ci` 必须分别在 `backend` 和 `frontend` 中运行，不能只运行一次。

### 5. 创建本地数据库

#### macOS

在项目根目录或任意终端位置执行：

```bash
brew services start postgresql@16
"$(brew --prefix postgresql@16)/bin/createdb" lutealark
whoami
```

- `createdb: database creation failed: ERROR: database "lutealark" already exists` 表示以前已经创建过，可以继续。
- `whoami` 输出的是你的 Mac 用户名，下一步会用到。

macOS Homebrew 默认常见的连接写法是：

```dotenv
DATABASE_URL=postgresql://你的Mac用户名@127.0.0.1:5432/lutealark
```

例如 `whoami` 输出 `xiaoming`，就写成 `postgresql://xiaoming@127.0.0.1:5432/lutealark`。这里只是格式示例，不要把示例用户名照抄。

#### Windows

1. 开始菜单打开 PostgreSQL 16 的 `SQL Shell (psql)`。
2. 依次出现 `Server`、`Database`、`Port`、`Username` 时，按回车接受默认值。
3. 输入安装 PostgreSQL 时设置的 `postgres` 密码。输入密码时屏幕不显示字符是正常现象。
4. 看到 `postgres=#` 后执行：

```sql
CREATE DATABASE lutealark;
```

5. 看到 `CREATE DATABASE` 后执行 `\q` 退出。

Windows 常见连接写法是：

```dotenv
DATABASE_URL=postgresql://postgres:你的PostgreSQL密码@127.0.0.1:5432/lutealark
```

如果密码中包含 `@`、`:`、`/`、`#` 等字符，需要进行 URL 编码；不确定时请让项目负责人协助生成连接字符串，不要把密码发到群聊、GitHub Issue 或截图中。

### 6. 创建自己的 `backend/.env`

这里最容易混淆，请先看清两个文件：

| 文件 | 用途 | 是否在 GitHub 中 |
|---|---|---|
| `backend/.env.example` | 安全模板，只有字段名和示例 | 是，下载仓库就能看到 |
| `backend/.env` | 每个人自己电脑上的真实配置 | 否，Git 会忽略，不能上传 |

仓库不会提供含真实密钥的 `.env`。请复制模板生成自己的文件。

macOS/Linux：

```bash
cp backend/.env.example backend/.env
chmod 600 backend/.env
```

`backend/.env.example` 是仓库里唯一需要复制的配置模板；它不会包含项目密钥。
第一次运行把 `OPENTREK_MODE` 保持为 `offline`，确认本地功能后再按第 10 步联网。

Windows PowerShell：

```powershell
Copy-Item backend\.env.example backend\.env
notepad backend\.env
```

macOS 可以执行下面命令用系统文本编辑器打开：

```bash
open -e backend/.env
```

第一次运行请使用下面的离线配置。只需要把 `DATABASE_URL` 换成上一节得到的本机连接：

```dotenv
HOST=127.0.0.1
PORT=3000
DATABASE_URL=postgresql://你的本机数据库连接
DATABASE_SSL=false
DATABASE_POOL_MAX=10
CORS_ORIGINS=

OPENTREK_BASE_URL=
OPENTREK_APP_KEY=
OPENTREK_AGENT_CODE=
OPENTREK_AGENT_VERSION=1785250561438
OPENTREK_MODE=offline
OPENTREK_TIMEOUT_MS=10000
OPENTREK_RUN_TIMEOUT_MS=60000
OPENTREK_RETRY_DELAY_MS=250
```

各字段从哪里来：

| 字段 | 来源 |
|---|---|
| `DATABASE_URL` | 你自己电脑上的 PostgreSQL；不需要向同事索取 |
| `OPENTREK_BASE_URL` | 项目负责人或 OpenTrek 平台管理员通过私密渠道提供 |
| `OPENTREK_APP_KEY` | 项目负责人或平台管理员通过私密渠道提供，只能放在本机 `.env` |
| `OPENTREK_AGENT_CODE` | 项目负责人或平台管理员通过私密渠道提供 |
| `OPENTREK_AGENT_VERSION` | 模板已经给出，当前基线是 `1785250561438` |
| `OPENTREK_MODE` | 第一次运行使用 `offline`；联网测试再改为 `auto` |

请勿把 `backend/.env`、数据库密码、APP_KEY、VPN 凭据、会话 Token 或内部链接提交到 GitHub，也不要粘贴到公开聊天或截图中。

### 7. 迁移数据库并启动后端

打开第一个终端，进入项目根目录，再执行：

```bash
cd backend
npm run db:migrate
npm run dev
```

`npm run db:migrate` 会创建系统需要的数据表。后端启动后，这个终端会持续显示日志，这是正常现象；不要关闭它，也不要继续在这个窗口输入其他命令。

打开浏览器访问：

- [http://127.0.0.1:3000/health](http://127.0.0.1:3000/health)
- [http://127.0.0.1:3000/health/database](http://127.0.0.1:3000/health/database)

两个地址都应返回 JSON，数据库健康检查应显示正常。如果第二个地址报错，先解决 PostgreSQL 或 `DATABASE_URL`，再启动前端。

### 8. 启动前端并打开网页

保持后端终端不动，再打开第二个终端，进入同一个项目的 `frontend`：

```bash
cd frontend
npm run dev
```

终端会显示 `Local` 地址，通常是 `http://localhost:5173/`。不要关闭这个终端。

在浏览器打开：

- 主页：[http://localhost:5173/cycle](http://localhost:5173/cycle)
- 对话页：[http://localhost:5173/agent](http://localhost:5173/agent)

第一次使用 `offline` 时，对话页显示“离线基础支持 · 未使用 OpenTrek/RAG”是正确结果。此时仍可测试周期、记录、呼吸、工具、账号和数据库功能。

### 9. 第一次启动后的检查清单

- [ ] `/health` 能显示后端正常。
- [ ] `/health/database` 能显示数据库正常。
- [ ] `/cycle` 能看到周期主页和水彩背景。
- [ ] `/agent` 顶部或入口处能返回周期主页。
- [ ] 能新增一条每日状态，刷新页面后仍存在。
- [ ] 对话页发送“有个任务启动不了”能得到明确标为离线基础支持的回复。
- [ ] 底部导航或侧栏能打开呼吸、工具、档案、积分和账号页。

完成这些检查后，本地基础环境才算安装成功。

### 10. 可选：连接 VPN 和 OpenTrek

请在离线模式成功后再做这一步。

1. 连接项目获授权的 VPN。
2. 向项目负责人或 OpenTrek 管理员私下获取 `OPENTREK_BASE_URL`、`OPENTREK_APP_KEY` 和 `OPENTREK_AGENT_CODE`。
3. 打开 `backend/.env`，填入这三项，保留：

```dotenv
OPENTREK_AGENT_VERSION=1785250561438
OPENTREK_MODE=auto
```

4. 回到后端终端按 `Ctrl+C` 停止，再执行 `npm run dev` 重启。
5. 打开 [http://127.0.0.1:3000/health/opentrek](http://127.0.0.1:3000/health/opentrek) 查看本地配置状态。
6. 进入 `/agent`，点击“重新连接 OpenTrek”或新建对话，再发送问题。

`/health/opentrek` 只确认本机配置是否完整，不会主动向平台发起问答。“OpenTrek 在线”也只证明在线回答链路成功；只有同一次回复明确返回 `ragUsed=true` 且带有有效来源时，页面才会显示已使用 RAG。当前基线 `1785250561438` 还没有提供这组证据，所以看到“OpenTrek 在线 · 未确认使用 RAG”不是提问方式错误，也不是前端 Bug。

### 11. 停止、下次启动和更新

停止系统：在前端和后端两个终端中分别按 `Ctrl+C`。

下次使用：

1. 启动 PostgreSQL。macOS 可执行 `brew services start postgresql@16`；Windows 通常会随系统自动启动 PostgreSQL 服务。
2. 需要 OpenTrek 时先连接 VPN。
3. 第一个终端进入 `backend`，执行 `npm run dev`。
4. 第二个终端进入 `frontend`，执行 `npm run dev`。
5. 打开终端实际显示的本地地址，通常是 `http://localhost:5173/cycle`。

使用 Git 克隆的同学更新代码：

```bash
git pull
cd backend
npm ci
npm run db:migrate
cd ../frontend
npm ci
cd ..
```

然后按上面的顺序重新启动后端和前端。`git pull` 不会覆盖被忽略的 `backend/.env`，但仍建议自己安全备份配置。使用 ZIP 的同学需要重新下载和解压新版代码，再把自己的 `backend/.env` 复制到新文件夹；不要把旧的 `node_modules` 复制过去。

## 常见问题

### `npm`、`node` 或 `git` 找不到

软件没有安装完成，或安装后没有重新打开终端。关闭所有终端，重新打开，再执行：

```bash
git --version
node --version
npm --version
```

### 提示找不到 `package.json`

当前目录不对。运行 `pwd`（Windows 可运行 `Get-Location`）确认位置：

- 后端命令必须在 `Lutealark/backend`。
- 前端命令必须在 `Lutealark/frontend`。
- `git pull` 应在 `Lutealark` 根目录。

### Windows 复制后找不到 `.env`

确认文件实际名称是 `.env`，不是 `.env.txt`。可在 PowerShell 执行：

```powershell
Get-ChildItem -Force backend
```

### PostgreSQL 连接失败

依次检查：

1. PostgreSQL 16 是否已启动。
2. 数据库名是否确实为 `lutealark`。
3. `backend/.env` 的用户名、密码、端口是否正确。
4. 修改 `.env` 后是否重启了后端。

macOS 可执行：

```bash
brew services list
"$(brew --prefix postgresql@16)/bin/psql" -d lutealark
```

Windows 可重新打开 `SQL Shell (psql)` 测试登录。

### 提示数据库 `lutealark` 不存在

重新执行第 5 步创建数据库。数据库迁移只能创建表，不能替你创建数据库本身。

### 提示 `Migration checksum mismatch`

迁移文件一旦在某个数据库执行过，项目会记录它的校验和；文件被改动时会主动停止，避免悄悄改变已有数据结构。先确认自己没有编辑 `backend/migrations/*.sql`，然后备份数据库并联系项目维护者，不要直接删除 `schema_migrations` 表或手工改校验和。全新数据库应能直接执行 `npm run db:migrate`；如果只是换了电脑，创建一个新的 `lutealark` 数据库即可。

### 提示密码认证失败

这不是网页账号密码，而是 PostgreSQL 数据库密码。Windows 通常使用安装 PostgreSQL 时给 `postgres` 设置的密码；macOS Homebrew 默认连接可能不需要密码。

### 3000 或 5173 端口已被占用

通常是以前启动的后端或前端还在运行。找到旧终端并按 `Ctrl+C`，然后重新启动。不要同时运行两份后端。

若只有 5173 被其他程序占用，可以在 `frontend` 中运行：

```bash
npm run dev -- --host 127.0.0.1 --port 5174 --strictPort
```

然后打开 `http://localhost:5174/cycle`。后端仍必须使用 3000，因为前端开发代理默认连接 `127.0.0.1:3000`。

### 页面打不开、空白或和预期版本不一样

检查两个终端是否仍在运行，并以 Vite 终端显示的 `Local` 地址为准。然后在浏览器按 `Command + Shift + R`（macOS）或 `Ctrl + F5`（Windows）强制刷新。

### 页面显示“离线基础支持”

- `OPENTREK_MODE=offline`：这是第一次运行的预期状态。
- `OPENTREK_MODE=auto`：检查 VPN、三个管理员配置项和版本号，重启后端，再点击聊天页重连。
- 状态显示“OpenTrek 在线 · 未确认使用 RAG”：在线链路正常，但平台回复没有给出可验证的 RAG 证据；换提问方式不能修复工作流。

### 不小心把 `.env` 加入了 Git

不要提交，也不要推送。立即联系项目负责人处理；密钥如果曾经被提交，应由管理员轮换。不要在 Issue 或群聊中粘贴文件内容。

## 技术与安全摘要

- 前端：React 19、TypeScript、Vite、Tailwind CSS、React Router、Zustand。
- 后端：Node.js、TypeScript、Hono、tRPC、Zod。
- 数据库：PostgreSQL 16。
- 智能体：阿里云专有云 OpenTrek Agent Dev V3.2.0。
- 登录只使用 `HttpOnly; SameSite=Strict` Cookie；数据库只保存会话 Token 的 SHA-256。
- Agent Session 按账号、匿名设备或未标识主体以及在线/离线模式绑定 24 小时，数据库只保存 Session Code 哈希。
- 周期阶段、积分、身份范围和来源字段由后端校验，不让模型或浏览器任意填写。
- RAG 来源和长期记忆严格分开；危机分支不注入记忆，也不显示来源。
- PostgreSQL 保存全量状态和呼吸历史；页面最近 30 条只是显示窗口，不表示删除更早数据。
- 当前采用应用层用户范围隔离，不是 PostgreSQL RLS。

## 测试与质量

后端：

```bash
cd backend
npm ci
npm run db:migrate
RUN_AUTH_DB_TESTS=true npm test
npm run check
npm run build
npm audit
npm run eval:opentrek:validate
npm run eval:opentrek:sources:validate
```

前端：

```bash
cd frontend
npm ci
npm test
npm run lint
npm run build
npm audit
```

2026-08-22 本轮实际验证结果：后端 Vitest `20` 个测试文件、`233` 个测试通过（另有 `3` 个数据库相关测试跳过，共 `236` 个测试）；前端 Vitest `14` 个测试文件、`66` 个测试通过；前后端 `check`、`lint`、`build` 均通过；前后端 `npm audit` 均为 `0` 个已知漏洞。全新临时 PostgreSQL 数据库的 5 个迁移全部成功。当前本机旧开发库因历史迁移校验和不同而被保护性拒绝，详见上面的常见问题。OpenTrek 数据集的本地结构校验不会访问 VPN 或平台；它不能替代真实 RAG Trace 和来源召回验收。

## OpenTrek RAG 的当前问题与下一步

仓库中的 `opentrek/` 是工作流、P01–P07 Prompt、Schema、来源归一化脚本和评估数据的版本控制规格，但修改这些文件不会自动改变平台上已经发布的 Agent。

当前已确认：

- 版本 `1785250561438` 可以在线创建 Session 和回答周期问题。
- 返回结果没有同时满足 `ragUsed=true` 与 1–3 条有效 `sources`。
- 前端显示“未确认使用 RAG”是正确的保护，不是用户没有输入到所谓的触发词。
- 后端只接收受信任的周期/状态上下文；上游 metadata 只保留 `schemaVersion`、`workflowVersion`、意图、策略、动作、合法记忆候选、`ragUsed` 和带 `sourceId` 的来源。
- `ragUsed=true` 只有在同一次回复存在至少一条有效来源时才会传给前端；否则统一显示未确认，并返回空来源。
- 后端对来源保留一个受限的 OpenTrek 检索字段兼容层：`data`/`results` 等已命名列表包装会被解开，`itemId`/`documentId` 等可映射为 `sourceId`，`fileName`/`documentName` 可映射为标题，`fileUrl`、`chunkContent` 和常见分数别名也会先经过同样的长度、URL 和类型校验。只有明确的布尔值 `ragUsed=true`、非危机意图以及同时存在来源 ID 和标题时才会保留；别名不会自行触发或证明 RAG。平台 Trace 仍是确定真实字段和来源归属的唯一依据。

正式修复顺序：

1. 在 OpenTrek 平台复制 `1785250561438`，不直接修改正在使用的版本。
2. 接入真实知识检索节点和来源归一化节点，按 `opentrek/` 中的工作流与 Schema 配置所有结果分支。
3. 发布一个新的候选版本，并让后端临时指向该候选版本。
4. 从同一候选版本的 Trace 获取真实来源字段和 sourceId，补齐 Q01–Q10 标注。
5. 实际运行在线评估；路由达到 ≥90%、危机与安全 100%、权威 Top-3 来源召回 ≥80% 后，再替换当前基线。

完整平台步骤与验收门槛见 [opentrek/README.md](opentrek/README.md)。完成前不能声称当前系统已经读取 OpenTrek RAG 数据。

## 项目结构

```text
Lutealark/
├─ backend/             后端、数据库迁移、账号和 OpenTrek 代理
│  ├─ .env.example     可提交的安全配置模板
│  └─ .env             每个人自己创建的真实配置，Git 忽略
├─ frontend/            React 网页和静态图片资源
├─ packages/contracts/  前后端共享 TypeScript 类型
├─ opentrek/            工作流、Prompt、Schema、脚本和评估样例
└─ docs/                完整功能与维护文档
```

## 文档维护约定

任何用户可见功能、页面、路由、接口、数据或安全行为、OpenTrek 状态、配置方式和已验证结果发生变化，都必须在同一次变更中同步更新：

1. `README.md`：项目首页、零基础运行步骤和当前状态。
2. `docs/FEATURES.md`：完整功能、数据边界和验收状态。

涉及 OpenTrek Prompt、工作流、Schema、平台发布步骤或评估门槛时，还必须同步更新 `opentrek/README.md`。测试数字只能在对应命令实际运行后更新。文档、示例、日志和截图中不得包含 APP_KEY、密码、会话 Token、内部签名链接或真实用户数据。
