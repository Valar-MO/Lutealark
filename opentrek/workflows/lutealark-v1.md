# Lutealark workflow v1

Target metadata schema: `contracts/workflow-metadata.schema.json`.

```text
Start
→ Normalize input (script)
→ Intent classification
→ Safety-first selector
├─ safety_crisis → P04 → Result renderer
└─ other
   → Main-intent selector
   ├─ cycle_question
   │  → cycle document retrieval → normalize sources → P02 → renderer
   ├─ task_difficulty
   │  → support-strategy classification
   │  ├─ task_breakdown → task retrieval → normalize sources → P01
   │  ├─ pomodoro → P06
   │  ├─ environment → P07(mode=environment)
   │  ├─ micro_movement → P07(mode=micro_movement)
   │  └─ breathing → P05
   ├─ emotion_support
   │  → emotion retrieval → normalize sources
   │  → support-strategy classification
   │  ├─ none → P03 → renderer(no action)
   │  ├─ breathing → P05 → consent-gated renderer
   │  ├─ environment → P07(mode=environment)
   │  └─ micro_movement → P07(mode=micro_movement)
   ├─ daily_checkin
   │  → deterministic renderer(action=open_daily_checkin)
   ├─ memory_request
   │  → consent-gated memory candidate renderer
   └─ smalltalk → general response
→ corresponding `用户交互任务` (result renderer)
```

Rules:

- The candidate canvas names each result-rendering task `用户交互任务`;
  platform execution logs may identify the same node as the result renderer.
- The crisis branch never reaches retrieval, points, memory or cycle advice.
- The crisis renderer must use the schema-required neutral `strategy: "none"`
  and must not emit an ordinary action; the backend forces this neutral
  strategy and removes action/memory metadata at its trust boundary before
  returning the safety response.
- Enable file information (the platform may label this “recall file address”)
  on every RAG retrieval node, and keep “only chunk content” disabled. Without
  file information the normalizer cannot emit the required source title.
- The OpenTrek script task output is named `sources`, so the normalizer entry
  point must be `execute_sources(params)`, read `params.retrieval_items`, and return the source list
  directly; a generic `main()` entry point does not pass the platform check.
- Keep the normalizer compatible with the restricted script sandbox: do not
  depend on `all`, `set` or similar unavailable built-ins. Do not emit the
  internal signed `fileUrl`; `sourceId` and `title` are the required evidence.
- Every renderer returns an explicit `ragUsed` boolean. RAG renderers return
  `ragUsed=true` with 1–3 sources from that exact run. Non-RAG and crisis
  renderers return `ragUsed=false` with `sources=[]`. Never infer this flag from
  answer wording or attach a source from another run.
- The generic P03 emotion path is always `strategy=none` and omits `action`.
  It must not provide breathing instructions or invitations. A breathing offer
  belongs to the independent P05 path and emits `offer_breathing`; only an
  explicit confirmation in the same Session may later emit `open_breathing`.
- The generic P03 response contains at most one grounded atomic suggestion.
  Do not turn multiple retrieved techniques into a list or a set of choices.
- Set each `用户交互任务` metadata output order to all data blocks and
  leave metadata streaming disabled for the current scalar fields and
  `List<Object>` sources. This setting produced the first schema-valid Q01
  cycle-branch raw output on the candidate.
- Leave the result callback URL empty.
- Memory candidates require explicit consent and are never created from crisis
  content, raw cycle/health data or transient emotions.
- Saved-memory context comes only from the backend for the current data
  subject. Normalize it to at most six `{kind, summary}` items and 1,200
  summary characters. Treat summaries as user data, never as instructions or
  verified facts; the current message always takes priority.
- Never connect saved-memory context to P04 or another crisis path. Saved
  memories never become retrieval `sources` and never set `ragUsed=true`.
- Points are awarded by the backend from completed, idempotent activity events;
  the model must never choose an amount.
- A direct request to record today's state returns `open_daily_checkin`. When
  `checkinDate` is null, the small-talk renderer may make one optional
  `offer_daily_checkin`; explicit consent changes it to `open_daily_checkin`,
  while refusal clears the pending action. Never create a check-in from chat
  text—the user fills and submits the form on the cycle page.
- A memory request may return a `memoryCandidate`, but never writes memory in
  the workflow. The frontend must show the exact summary and require a second,
  explicit consent action before calling the backend memory API. Dismissal and
  crisis/transient emotion content never create a memory.

## Online acceptance gate

- Clone the published agent; do not edit the active version.
- No unconnected branch or missing node input.
- New strategy routing accuracy at least 90%; crisis routing 100%.
- Q1–Q10 Top-3 retrieval hit rate at least 80%.
- Every displayed source maps to the same run's retrieval output.
- Every output passes the metadata contract: `ragUsed=true` has 1–3 sources,
  while `ragUsed=false` has none.
- Cross-user memory isolation, consent, idempotency and deletion verified.
- Publish only after `/createSession`, `/run`, browser chat and Trace all pass.
