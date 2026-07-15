# Lutealark

Lutealark 是一个为 ADHD 女性提供周期感知、任务缓冲与情绪支持的智能体项目。

项目由两部分组成：

```text
Lutealark/
├─ backend/   Hono、tRPC、OpenTrek 接入及后端测试
└─ frontend/  React、Vite、Tailwind CSS 前端应用
```

## 技术栈

- 前端：React 19、TypeScript、Vite、Tailwind CSS
- 后端：Node.js、TypeScript、Hono、tRPC
- 智能体：阿里云专有云 OpenTrek Agent Dev
- 测试：Vitest



## 启动后端

首次运行时，进入后端目录并准备环境变量：

```powershell
cd C:\Users\wface\Desktop\Lutealark\backend
Copy-Item .env.example .env
npm install
```

在 `backend/.env` 中填写：

- `OPENTREK_BASE_URL`：OpenTrek Agent API 基础地址
- `OPENTREK_APP_KEY`：平台 APP_KEY
- `OPENTREK_AGENT_CODE`：智能体编码
- `OPENTREK_AGENT_VERSION`：已发布的版本编码
- `OPENTREK_TIMEOUT_MS`：创建会话超时时间
- `OPENTREK_RUN_TIMEOUT_MS`：运行智能体超时时间

启动后端：

```powershell
cd C:\Users\wface\Desktop\Lutealark\backend
npm run dev
```

默认地址为 `http://localhost:3000`，健康检查地址为 `http://localhost:3000/health`。

不要把真实 APP_KEY 写进前端、提交到 Git，或者通过截图公开。

## 启动前端

保持后端运行，再打开一个 PowerShell 窗口：

```powershell
cd C:\Users\wface\Desktop\Lutealark\frontend
npm install
npm run dev
```

打开终端中 `Local:` 后显示的地址，通常是 `http://localhost:5173`。

本地开发时，Vite 会把前端的 `/api` 请求代理到 `http://localhost:3000`，因此 OpenTrek APP_KEY 始终只保存在后端。

## 已实现的后端接口

- `GET /health`：后端健康检查
- `POST /api/agent/session`：创建 OpenTrek 会话
- `POST /api/agent/chat`：发送消息并获取智能体回复
- `POST /api/workflow/cycle`：计算当前周期阶段
- `POST /trpc/agent.createSession`：通过 tRPC 创建会话
- `POST /trpc/agent.chat`：通过 tRPC 发送消息
- `GET /trpc/cycle.calculate`：通过 tRPC 计算周期

## 聊天接口示例

首先调用 `POST /api/agent/session` 获取 `sessionCode`，然后调用 `POST /api/agent/chat`：

```json
{
  "sessionCode": "会话 UUID",
  "message": "我今天不知道怎么开始工作",
  "metadata": {},
  "attachments": []
}
```

后端会统一返回：

```json
{
  "sessionCode": "会话 UUID",
  "content": "智能体回复内容",
  "metadata": {
    "intent": "task_difficulty"
  }
}
```

## 常用命令

后端：

```powershell
cd backend
npm run dev
npm run check
npm test
npm run build
```

前端：

```powershell
cd frontend
npm run dev
npm run lint
npm run build
```

## 当前进度

- 已完成 OpenTrek 创建会话与聊天代理
- 已完成意图与元数据透传
- 已完成周期计算基础接口
- 已完成响应式聊天前端
- 下一步：周期设置与周期状态页面
