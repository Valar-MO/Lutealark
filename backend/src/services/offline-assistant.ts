import { createHash, randomUUID } from "node:crypto";
import type {
  CreateAgentSessionResult,
  RunAgentInput,
  RunAgentResult,
} from "../contracts/agent.js";

const OFFLINE_SESSION_PREFIX = "offline:";
const PENDING_ACTION_TTL_MS = 30 * 60 * 1_000;

type OfflineIntent =
  | "crisis_support"
  | "breathing"
  | "pomodoro"
  | "environment_adjustment"
  | "micro_movement"
  | "lightweight_plan"
  | "daily_checkin"
  | "memory_request"
  | "cycle_question"
  | "task_difficulty"
  | "emotional_support"
  | "general_support";

type PendingAction = {
  action: "breathing" | "daily_checkin" | "focus_timer";
  expiresAt: number;
};

const pendingActions = new Map<string, PendingAction>();

export function createOfflineSession(): CreateAgentSessionResult {
  return {
    sessionCode: `${OFFLINE_SESSION_PREFIX}${randomUUID()}`,
    mode: "offline",
  };
}

export function isOfflineSession(sessionCode: string): boolean {
  return sessionCode.startsWith(OFFLINE_SESSION_PREFIX);
}

export function runOfflineAssistant(input: RunAgentInput): RunAgentResult {
  clearExpiredPendingActions();
  const message = normalize(input.message);
  const pending = pendingActions.get(input.sessionCode);

  if (pending?.action === "breathing" && isAffirmative(message)) {
    pendingActions.delete(input.sessionCode);
    return result(
      input.sessionCode,
      "好的，我们现在进入呼吸空间。你可以选择最舒服的一种节奏；任何时候感到不适，都可以暂停或结束。",
      "breathing",
      "open_breathing",
    );
  }
  if (pending?.action === "breathing" && isNegative(message)) {
    pendingActions.delete(input.sessionCode);
    return result(
      input.sessionCode,
      "好的，不做呼吸练习也完全可以。我们可以继续聊现在最让你费力的部分，或者只把下一步缩小一点。",
      "emotional_support",
    );
  }
  if (pending?.action === "daily_checkin" && isAffirmative(message)) {
    pendingActions.delete(input.sessionCode);
    return result(
      input.sessionCode,
      "好的，我带你打开今天的状态记录。只填你愿意留下的部分即可，也可以选择不分享给聊天助手。",
      "daily_checkin",
      "open_daily_checkin",
    );
  }
  if (pending?.action === "daily_checkin" && isNegative(message)) {
    pendingActions.delete(input.sessionCode);
    return result(
      input.sessionCode,
      "好的，今天不记录也完全可以。你仍然可以直接告诉我，现在最希望减轻哪一部分负担。",
      "general_support",
    );
  }
  if (pending?.action === "focus_timer" && isAffirmative(message)) {
    pendingActions.delete(input.sessionCode);
    return result(
      input.sessionCode,
      "好，我们只做一轮。你可以从 5、10、15 或 25 分钟里选最轻松的时长，时间到就有权结束，不会自动加码。",
      "pomodoro",
      "open_focus_timer",
    );
  }
  if (pending?.action === "focus_timer" && isNegative(message)) {
    pendingActions.delete(input.sessionCode);
    return result(
      input.sessionCode,
      "好的，不开计时器也可以。我们可以只把任务缩成一个不计时的最小动作。",
      "task_difficulty",
    );
  }
  if (pending && isExplanationRequest(message)) {
    if (pending.action === "breathing") {
      return result(
        input.sessionCode,
        "这是一个由前端计时和动画引导的短呼吸练习，用来帮助你把注意力温和地放回身体，不是医疗治疗。任何时候不舒服都可以停止；如果愿意开始，仍然可以回复“好”。",
        "breathing",
        "offer_breathing",
      );
    }
    if (pending.action === "focus_timer") {
      return result(
        input.sessionCode,
        "这是一次可随时停止的短专注计时，只选一个小任务，时间到即可结束，不会自动进入下一轮。如果愿意打开计时器，仍然可以回复“好”。",
        "pomodoro",
        "offer_focus_timer",
      );
    }
    return result(
      input.sessionCode,
      "这是由你主动填写的今日状态记录，包括能量、情绪和身体感受。它不会根据聊天内容自动生成，你也可以关闭“分享给聊天助手”。如果愿意打开记录页，仍然可以回复“好”。",
      "daily_checkin",
      "offer_daily_checkin",
    );
  }

  const intent = classifyIntent(message);
  // A non-confirmation message is treated as a new request. Clear the old
  // pending action so a later standalone “好” cannot confirm stale context.
  if (pending) pendingActions.delete(input.sessionCode);
  switch (intent) {
    case "crisis_support":
      pendingActions.delete(input.sessionCode);
      return result(
        input.sessionCode,
        [
          "听起来你现在可能正处在很危险、很难独自承受的时刻。先不要一个人扛，也先远离可能伤害自己的物品或地点。",
          "如果你已经准备伤害自己、正在实施，或无法保证此刻安全，请立即拨打 120 或 110，或直接前往最近的急诊；同时联系一位可信任的人，请对方现在陪着你。",
          "如果暂时没有立即危险，也请尽快联系当地心理援助热线、学校心理中心或专业医护人员。你可以只回复我：‘现在安全’或‘现在不安全’。",
          "离线基础支持不能替代紧急救援或专业医疗帮助。",
        ].join("\n\n"),
        intent,
        "seek_immediate_help",
      );

    case "breathing":
      return result(
        input.sessionCode,
        "可以。我们先不要求自己立刻平静，只用几分钟把注意力放回呼吸。点击下面的入口后，选择让你觉得最温和的节奏；如有头晕或不适，请马上停下。",
        intent,
        "open_breathing",
      );

    case "pomodoro":
      pendingActions.set(input.sessionCode, {
        action: "focus_timer",
        expiresAt: Date.now() + PENDING_ACTION_TTL_MS,
      });
      return result(
        input.sessionCode,
        "把目标缩成一个短时段会更容易启动。我们可以只选一个任务，先做 5～10 分钟，时间到就结束或休息，不自动加码。如果愿意打开轻专注计时器，回复“好”即可。",
        intent,
        "offer_focus_timer",
      );

    case "environment_adjustment":
      return result(
        input.sessionCode,
        "先把环境的刺激降低一档：屏幕调暗、关掉一个声音来源、把视线范围内最乱的一小块清空，再让身体靠稳。只选其中一项就够了。下面的感官降载工具会带你逐项完成。",
        intent,
        "open_environment_reset",
      );

    case "micro_movement":
      return result(
        input.sessionCode,
        "不用完整锻炼，先做 60 秒微运动：肩膀缓慢向后绕 5 次，双脚踩稳地面，再伸展手臂。疼痛或不适时立即停止。你可以打开下面的微运动引导。",
        intent,
        "open_micro_movement",
      );

    case "lightweight_plan":
      return result(
        input.sessionCode,
        "今天只排三格：一件必须做的小事、一件照顾自己的事、一件做了会轻松一点的事。每件都写成 5～15 分钟能开始的动作，不要求一次做完。",
        intent,
        "open_light_plan",
      );

    case "daily_checkin":
      return result(
        input.sessionCode,
        "可以，我带你打开今天的状态记录。能量、情绪和身体感受都由你主动填写，并可决定是否分享给聊天助手。",
        intent,
        "open_daily_checkin",
      );

    case "memory_request": {
      const summary = memorySummary(message);
      if (isSensitiveMemoryContent(summary)) {
        return result(
          input.sessionCode,
          "我不会把即时情绪、危机内容或原始健康/周期细节保存为长期记忆。它们只用于回应当前这次对话；如果你想保存的是稳定偏好、需要照顾的非医疗限制或长期目标，可以换一种方式告诉我。",
          intent,
        );
      }
      return result(
        input.sessionCode,
        "我可以把这条信息作为长期记忆候选展示给你，但不会自动保存。请核对下面的摘要；只有你再次明确同意，它才会进入长期记忆档案。",
        intent,
        undefined,
        {
          memoryCandidate: {
            candidateId: randomUUID(),
            kind: memoryKind(summary),
            summary,
            requiresConsent: true,
            sourceTurnHash: createHash("sha256")
              .update(`${input.sessionCode}\n${message}`)
              .digest("hex"),
          },
        },
      );
    }

    case "cycle_question": {
      const phase = input.cycleSettings
        ? "我会使用你已经保存的周期设置来调整页面中的节奏提示"
        : "你还没有设置周期起点，可以先在周期页补充";
      return result(
        input.sessionCode,
        `周期中的精力、注意力和情绪体验可能波动，但个体差异很大，不能只靠周期解释。${phase}。如果变化突然、严重或持续影响生活，建议咨询专业医护人员。`,
        intent,
        "open_cycle",
      );
    }

    case "task_difficulty":
      return result(
        input.sessionCode,
        "先不解决整件事，只做一个可见的启动动作：打开需要的文件，写下标题，或列出第一条材料。把它控制在 5 分钟内；完成后再决定是进入短专注，还是把今天的计划继续拆小。",
        intent,
        "open_light_plan",
      );

    case "emotional_support":
      pendingActions.set(input.sessionCode, {
        action: "breathing",
        expiresAt: Date.now() + PENDING_ACTION_TTL_MS,
      });
      return result(
        input.sessionCode,
        "你不需要马上把感受整理清楚。先让双脚碰到地面，找一个身体有支撑的位置，然后只说最明显的那一部分也可以。如果愿意，我可以带你做一次短呼吸练习；回复“好”即可开始。",
        intent,
        "offer_breathing",
      );

    default:
      if (!input.dailyCheckin) {
        pendingActions.set(input.sessionCode, {
          action: "daily_checkin",
          expiresAt: Date.now() + PENDING_ACTION_TTL_MS,
        });
        return result(
          input.sessionCode,
          "我现在处于离线基础支持模式，不能调用 OpenTrek 知识库。你可以告诉我：最想解决的是开始任务、安排今天、降低环境刺激、活动一下，还是先稳定情绪？今天还没有状态记录；如果愿意留下一点能量或感受，回复“好”即可打开记录页。",
          intent,
          "offer_daily_checkin",
        );
      }
      return result(
        input.sessionCode,
        "我现在处于离线基础支持模式，不能调用 OpenTrek 知识库。你可以告诉我：最想解决的是开始任务、安排今天、降低环境刺激、活动一下，还是先稳定情绪？我会先提供一个本地可用的小工具。",
        intent,
      );
  }
}

function result(
  sessionCode: string,
  content: string,
  intent: OfflineIntent,
  action?: string,
  extraMetadata: Record<string, unknown> = {},
): RunAgentResult {
  return {
    sessionCode,
    content,
    metadata: {
      mode: "offline",
      intent,
      ...(action ? { action } : {}),
      ...extraMetadata,
      ragUsed: false,
      sources: [],
      notice: "OpenTrek 当前不可用；本回复由本地规则生成，未检索知识库。",
    },
  };
}

function classifyIntent(message: string): OfflineIntent {
  if (isCrisisMessage(message)) return "crisis_support";

  if (matches(message, [
    /呼吸(练习|训练|一下)?|喘不过气|带我呼吸|breath/i,
  ])) return "breathing";

  if (matches(message, [
    /番茄|专注(计时|钟|一会)|计时器|pomodoro|倒计时/,
  ])) return "pomodoro";

  if (matches(message, [
    /太吵|噪音|光.*刺眼|环境.*乱|感官|刺激太多|屏幕太亮|降噪|降载|收拾环境/,
  ])) return "environment_adjustment";

  if (matches(message, [
    /微运动|活动一下|伸展|拉伸|肩颈|久坐|动一动|身体僵|散步/,
  ])) return "micro_movement";

  if (matches(message, [
    /今日计划|今天.*安排|轻计划|待办|todo|规划今天|三件事|列.*计划/,
  ])) return "lightweight_plan";

  if (matches(message, [
    /记录(一下)?(今天|今日|现在|当前)?的?(状态|感受|心情|能量)|今日打卡|今天打卡|状态记录|情绪记录/,
  ])) return "daily_checkin";

  if (matches(message, [
    /^(请|可以)?(帮我)?记住|以后(请|希望|都|不要)|长期(目标|偏好)|我的(偏好|习惯|长期目标)是/,
  ])) return "memory_request";

  if (matches(message, [
    /月经|经期|周期|黄体|卵泡|排卵|姨妈|pms|经前/,
  ])) return "cycle_question";

  if (matches(message, [
    /开始不了|无法开始|不知道.*开始|拖延|任务|论文|工作|学习|拆解|事情太多|做不动|启动不了/,
  ])) return "task_difficulty";

  if (matches(message, [
    /焦虑|难过|低落|烦躁|崩溃|很乱|压力|紧张|害怕|委屈|情绪|撑不住|心慌|想哭/,
  ])) return "emotional_support";

  return "general_support";
}

function normalize(message: string): string {
  return message.trim().toLowerCase();
}

function matches(message: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(message));
}

function isAffirmative(message: string): boolean {
  return /^(好|好的|可以|行|要|愿意|开始|来吧|嗯|ok|okay)[呀啊吧呢。！! ]*$/.test(message);
}

function isNegative(message: string): boolean {
  return /^(不|不要|不了|不用|算了|拒绝|no|nope)[呀啊吧呢。！! ]*$/.test(message);
}

function isExplanationRequest(message: string): boolean {
  return /^(这|那)?(个)?是(什么|怎么回事)|^(什么是|怎么做|如何做)|^(能|可以)?解释(一下)?/.test(message);
}

function memorySummary(message: string): string {
  const stripped = message
    .replace(/^(请|可以)?(帮我)?记住[：,:，\s]*/, "")
    .trim();
  return (stripped || message).slice(0, 300);
}

function memoryKind(summary: string): "preference" | "constraint" | "long_term_goal" {
  if (/目标|计划|想要完成|希望完成|长期/.test(summary)) return "long_term_goal";
  if (/不能|不要|避免|限制|需要照顾|不适合/.test(summary)) return "constraint";
  return "preference";
}

export function isCrisisMessage(message: string): boolean {
  return matches(normalize(message), [
    /自杀|轻生|不想活|结束生命|伤害自己|自残|活不下去|去死|永远消失/,
    /kill\s*myself|suicid|self[- ]?harm|end\s+my\s+life/i,
  ]);
}

export function isSensitiveMemoryContent(summary: string): boolean {
  return /(自杀|轻生|自残|伤害自己|不想活|焦虑|难过|低落|崩溃|烦躁|压力|紧张|害怕|委屈|心慌|想哭|情绪|疲惫|睡不(?:好|着)|失眠|月经|经期|周期|黄体|卵泡|排卵|怀孕|疾病|诊断|症状|疼痛|用药|药物|病史|suicid|self[- ]?harm|anxious|anxiety|depress|sad|panic|stress|afraid|scared|fatigue|tired|insomnia|sleep|menstrual|period|pregnan|diagnos|symptom|pain|medicat|disease|illness)/i.test(summary);
}

function clearExpiredPendingActions(): void {
  const now = Date.now();
  for (const [sessionCode, pending] of pendingActions) {
    if (pending.expiresAt <= now) pendingActions.delete(sessionCode);
  }
}
