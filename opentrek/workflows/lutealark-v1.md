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
   │  → emotion/environment/micro-movement/breathing strategy
   │  → P03/P05/P07
   ├─ daily_checkin
   │  → deterministic renderer(action=open_daily_checkin)
   ├─ memory_request
   │  → consent-gated memory candidate renderer
   └─ smalltalk → general response
→ corresponding result renderer
```

Rules:

- The crisis branch never reaches retrieval, points, memory or cycle advice.
- Enable “recall file address” on retrieval, but capture the actual Trace JSON
  before configuring `normalize-sources.py`.
- Every renderer returns an explicit `ragUsed` boolean. RAG renderers return
  `ragUsed=true` with 1–3 sources from that exact run. Non-RAG and crisis
  renderers return `ragUsed=false` with `sources=[]`. Never infer this flag from
  answer wording or attach a source from another run.
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
