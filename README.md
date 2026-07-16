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
- 已完成周期计算接口、周期设置页面与状态展示
- 已完成周期设置本地保存
- 已完成后端可信周期计算并将周期状态注入 OpenTrek
- 已完成任务、周期、情绪三个核心 RAG 检索分支
- 已完成 OpenTrek 输入标准化节点，兼容画布文本调试与后端 JSON 请求
- 已完成周期状态驱动的低压力回复 Prompt
- 已完成响应式聊天前端
- 下一步：环境支持、呼吸训练和感受记录模块

## 周期感知数据流

前端只向后端提交末次月经日期和平均周期长度，不直接决定周期阶段或能量值：

```text
周期设置页面
→ POST /api/workflow/cycle
→ 后端计算并展示周期状态
→ 浏览器 localStorage 保存周期设置
→ 聊天请求携带 cycleSettings
→ 后端重新计算可信周期状态
→ 注入 OpenTrek message.metadata，并将同一组字段封装进 message.text JSON
```

注入智能体的周期字段包括：

- `currentPhase`
- `phaseName`
- `isBufferMode`
- `dayOfCycle`
- `daysToNextPeriod`
- `energyValue`
- `cycleLength`

由于当前 OpenTrek V3.2.0 画布没有明确暴露入站 `message.metadata`，后端会把
用户输入与周期字段同时封装为以下 `message.text`：

```json
{
  "input": "用户原始消息",
  "currentPhase": "luteal_late",
  "phaseName": "黄体晚期",
  "isBufferMode": true,
  "dayOfCycle": 25,
  "daysToNextPeriod": 4,
  "energyValue": 2,
  "cycleLength": 28
}
```

## OpenTrek 工作流配置

当前工作流的核心链路为：

```text
开始
→ 输入标准化（脚本任务）
→ 意图识别
→ 条件分支
├─ task_difficulty → 文档检索 → 任务降级回复 → 结果渲染
├─ cycle_question → 文档检索 → 周期解释回复 → 结果渲染
├─ emotion_support → 文档检索 → 情绪支持回复 → 结果渲染
├─ safety_crisis → 危机回应 → 结果渲染
└─ smalltalk → 通用回复 → 结果渲染
```

输入标准化节点接收“开始 → 用户输入”，并同时兼容两种输入：

- 画布调试传入的普通文本：直接作为 `userText`。
- 后端传入的 JSON 文本：解析出 `userText` 和全部周期字段。

后续节点统一引用输入标准化节点输出的：

- `userText`
- `currentPhase`
- `phaseName`
- `isBufferMode`
- `dayOfCycle`
- `daysToNextPeriod`
- `energyValue`
- `cycleLength`
- `hasCycleData`

知识库使用 `LutealPhase_Buffer_ADHD_v1`，当前检索配置为：

```text
检索策略：向量检索
最大召回条数：5
最低召回分数：0.75
```

任务、周期和情绪回复节点分别引用对应的检索结果与周期状态。危机回应不经过普通 RAG 分支，且不能因周期状态降低安全等级。

结果渲染节点的“结果回调 URL”应保持未配置。选择“引用”但不指定 URL 会导致结果渲染长时间等待并最终失败。

## 当前验证状态

- 后端周期计算、周期字段防伪造和 OpenTrek JSON 封装已有自动化测试。
- 前端已验证周期设置、状态展示和周期感知聊天调用。
- 平台已验证任务 RAG 召回和周期分支端到端回复。
- 知识库阈值精调、10 条 Query 召回率评测和前端引用展示留待后续完成。
