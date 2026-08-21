# OpenTrek configuration package

This directory is the version-controlled source of truth for Lutealark's
OpenTrek workflow. It does not deploy platform changes automatically.

The selected published baseline is Agent version `1785250561438`. Clone that
version instead of editing it in place, then use `workflows/lutealark-v1.md`
for the new draft. Prompts use OpenTrek task-variable syntax (`${name}`). JSON
schemas define the boundary between the backend, workflow and frontend.

The current local configuration uses `OPENTREK_MODE=auto` with Agent version
`1785250561438`. It tries OpenTrek first and only falls back to the explicit
local assistant for connectivity or retryable 5xx failures. During the earlier
VPN outage the application was intentionally run with `offline`; that mode
does not call OpenTrek and does not claim to use RAG.

For a GitHub clone running on a developer computer, copy
`backend/.env.example` to `backend/.env`, configure the local PostgreSQL
`DATABASE_URL`, run the migration, and start backend and frontend separately.
Open `http://localhost:5173/cycle` on that same computer. `localhost` is not a
shared URL; each collaborator must install the dependencies, database, VPN and
local services independently.

Use `OPENTREK_MODE=offline` to work without the private network. To test the
published baseline online, connect the authorized VPN first and set the
administrator-provided `OPENTREK_BASE_URL`, `OPENTREK_APP_KEY` and
`OPENTREK_AGENT_CODE`, while keeping `OPENTREK_AGENT_VERSION=1785250561438`.
The repository has no private-gateway default. All four values must be explicit
in the local `.env` for `auto` or `online`; they may remain empty in `offline`.
Keep administrator-provided values in the local `.env` only. Missing online
configuration makes `/health/opentrek` report `misconfigured`; `auto` may then
honestly fall back to the local assistant, while `online` fails closed. Restart
the backend after changing `.env`; the health endpoint reports configuration
only, not proof that the VPN gateway or RAG answered.

The public Docker Compose profile in `deploy/` deliberately defaults to
`OPENTREK_MODE=offline`. This lets the public website run without the private
VPN while preserving an explicit local-fallback label, `ragUsed=false`, and
empty sources. The backend and PostgreSQL are still required for accounts,
sync, archives and points. Do not add an OpenTrek key to the frontend image or
APK; enable `auto` or `online` on a protected server only after its private
network path and the release gates below have been verified.

On 2026-08-19 an isolated probe completed an online Session and ordinary/cycle
replies. Later probes intermittently received HTTP 503 from a read-only
platform Session database or a `run` response without a message. On
2026-08-20, six additional fresh application Session probes returned
`mode=offline`. On 2026-08-22, a fresh online Session accepted a cycle question
and returned a non-empty answer with `intent=cycle_question`, but its metadata
did not contain `ragUsed=true` and `sources` was empty. The frontend therefore
correctly shows “OpenTrek online · RAG unconfirmed”. This verifies online
answer reachability, not knowledge-base retrieval or authoritative source
availability.
`GET /health/opentrek` only reports local configuration and never exposes
credentials.

The frontend now detects initial, cached, and run-time `offline:` Sessions. It
performs at most two bounded automatic replacement attempts on restoration
events and also exposes a manual "Reconnect OpenTrek" action. A successful
replacement affects later turns without deleting the conversation. Historical
offline turns retain their honest label, and an online turn is labelled as RAG
only when `ragUsed=true` and at least one validated source is present.

The candidate workflow metadata contract now requires an explicit boolean
`ragUsed`. Its JSON Schema accepts `ragUsed=true` only with 1–3 validated
sources from that same run, and accepts `ragUsed=false` only with `sources=[]`.
Every result renderer must emit both fields; neither the backend nor frontend
infers retrieval from answer wording or invents missing sources. This contract
change does not modify the published `1785250561438` baseline by itself.

The backend and this repository now define a bounded `savedMemoryContext`, but
the published baseline does not gain that input automatically. It becomes
effective for online answers only after the baseline is cloned, the new input
and node wiring are configured, and a new OpenTrek Agent version is published
and selected. Offline fallback can use the backend-filtered context locally;
that is not evidence that the remote workflow or knowledge base used it.

Offline mode validates only the local fallback behavior and the structure of
the versioned evaluation datasets. It does not establish gateway reachability,
the behavior of published Agent version `1785250561438`, access to the remote
knowledge base, or authoritative Trace/Top-3 retrieval quality. Those claims
require the online release steps and evidence below.

When connectivity returns:

1. Keep `OPENTREK_MODE=auto`, restore the VPN, and use the frontend reconnect
   action to request a fresh Session. Restart the backend only after changing
   its environment configuration.
2. Clone published Agent version `1785250561438` instead of editing it in place.
3. Apply the workflow and P01-P07 prompt specifications in this directory.
   Wire normalized `savedMemoryContext` only to P01, P05, P06 and P07; do not
   connect it to emotion-support P03 or crisis P04.
4. Turn on document-address recall and capture one real retrieval output from
   Trace before adapting `scripts/normalize-sources.py`.
5. Configure every result renderer to emit a schema-valid `ragUsed`/`sources`
   pair, then validate the candidate response metadata.
6. Publish a new Agent version and update `OPENTREK_AGENT_VERSION` only after
   all routing, source and safety evaluations pass.
7. In `evals/sources.jsonl`, replace each `pending_trace` label with
   `labelStatus: "authoritative"` and the real `expectedSourceIds` captured
   from that same candidate version's Trace. Then run both
   `npm run eval:opentrek` and `npm run eval:opentrek:sources` from `backend/`.

The datasets can be checked without a VPN or any OpenTrek request by running
`npm run eval:opentrek:validate` and
`npm run eval:opentrek:sources:validate`. A structurally valid source dataset
with unfinished Trace labels reports `valid_but_not_ready`. The normal online
source evaluator exits unsuccessfully with `status: "not_ready"` before making
network calls until every Q01-Q10 label is authoritative; keyword matches are
not treated as Top-3 recall evidence.

On 2026-08-22, the workflow metadata Schema regression suite passed 3/3 cases,
covering the required boolean, the one-to-three-source RAG branch, and the
empty-source non-RAG branch. Both offline evaluation-data checks also passed
their structural gate without network calls; the source set remains
`valid_but_not_ready` because Q01-Q10 still await same-version Trace labels.

The online release gate is at least 90% across the versioned routing dataset,
100% crisis routing, 100% safety cases, and at least 80% authoritative Q1-Q10
Top-3 source recall. RAG branches must return `ragUsed=true` with 1–3 sources
from that run. Non-RAG and crisis branches must return `ragUsed=false` with
`sources=[]`.
The `memory_request` route must return a schema-valid consent-gated candidate;
all other routes must omit it, and the workflow must never persist memory.
Saved-memory input must come only from the backend for the current data
subject, contain at most six items and 1,200 summary characters, and be treated
as user-approved notes rather than instructions or verified facts. It must be
absent from crisis handling and must never become a retrieval source or set
`ragUsed=true`.

Never add an APP_KEY, internal signed source URL or real user conversation to
this directory.
