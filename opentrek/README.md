# OpenTrek configuration package

This directory is the version-controlled source of truth for Lutealark's
OpenTrek workflow. It does not publish platform changes automatically.

The selected published baseline is Agent version `1785250561438`. Clone that
version instead of editing it in place, then use `workflows/lutealark-v1.md`
for the new draft. Prompts use OpenTrek task-variable syntax (`${name}`). JSON
schemas define the boundary between the backend, workflow and frontend.

The repository template defaults to `OPENTREK_MODE=offline`, so a new clone can
verify PostgreSQL, backend and frontend without the private network. Maintainer
online testing uses `auto` with Agent version `1785250561438`: it tries
OpenTrek first and falls back to the explicit local assistant only for
connectivity or retryable 5xx failures. `offline` never calls OpenTrek and
never claims to use RAG.

For a GitHub clone running on a developer computer, copy
`backend/.env.example` to `backend/.env`, configure the local PostgreSQL
`DATABASE_URL`, run the migration, and start backend and frontend separately.
Open `http://localhost:5173/cycle` on that same computer. `localhost` is not a
shared URL; each collaborator must install the dependencies, database and local
services independently. VPN is only needed for the optional `auto`/`online`
OpenTrek test below; offline local development does not need the private
network.

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
In the latest 2026-08-22 probe, `createSession` reached the configured 10-second
timeout in both the application path and a forced-online client probe. `auto`
therefore returned an explicitly offline Session. The immediate prerequisite is
restoring VPN/gateway reachability; after that, a new same-version Trace is
still required to diagnose retrieval and source metadata.
A final application-level repeat returned that explicit offline Session after
about 11 seconds. The following cycle question was handled locally with
`intent=cycle_question`, `ragUsed=false` and zero sources; no answer text or
credential was recorded as test evidence.
`GET /health/opentrek` only reports local configuration and never exposes
credentials.

The frontend now detects initial, cached, and run-time `offline:` Sessions. It
performs at most two bounded automatic replacement attempts on restoration
events and also exposes a manual "Reconnect OpenTrek" action. A successful
replacement affects later turns without deleting the conversation. Historical
offline turns retain their honest label, and an online turn is labelled as RAG
only when `ragUsed=true` and at least one validated source is present. Restored
conversation metadata is checked again in the browser; only the three retrieval
intents can expose sources, so an old or malformed message cannot gain a RAG
badge merely by carrying `ragUsed=true`.

The candidate workflow metadata contract now requires `schemaVersion`,
`workflowVersion`, `intent`, `strategy`, an explicit boolean `ragUsed` and
`sources`. Its JSON Schema accepts `ragUsed=true` only with 1–3 validated
sources from that same run, and accepts `ragUsed=false` only with
`sources=[]`. Every result renderer must emit all required fields; the backend
keeps only this allowlist (plus a validated memory candidate and action), and
the frontend requires online mode, `ragUsed=true` and at least one `sourceId`
before showing RAG. Neither side infers retrieval from answer wording or
invents missing sources. The backend accepts a small compatibility alias set
and unwraps named list containers such as `data`/`results` to a bounded depth for provider-shaped
retrieval items (`itemId`/`documentId`,
`fileName`/`documentName`, `fileUrl`, `chunkContent` and common score names),
continuing to a later named container when an earlier one is empty. Each
OpenTrek response body is capped at 2 MiB before JSON parsing so a malformed
gateway response cannot consume unbounded backend memory,
but only after the renderer has supplied the strict boolean `ragUsed=true` and
the intent is one of `task_difficulty`, `cycle_question` or `emotion_support`,
and each item has a usable ID and title. When a response has multiple named
containers, an empty container or one containing only invalid items does not
mask a later container with valid source items. An alias is not evidence by itself,
and a JSON-serialized source list is still rejected unless its items pass the same
checks. Capture a real Trace and update `normalize-sources.py` with the actual
field names before relying on this compatibility path. This contract change
does not modify the published `1785250561438` baseline by itself.

For workflow metadata vocabulary, the backend canonicalizes a small legacy
alias set before applying the allowlist: `crisis_support` becomes
`safety_crisis`, `emotional_support` becomes `emotion_support`,
`open_pomodoro` becomes `open_focus_timer`, and
`open_environment_reset`/`open_micro_movement` become
`show_environment_reset`/`show_micro_movement`. The aliases are accepted only
for compatibility; new workflow nodes and the Schema must emit the canonical
values.

The source normalizer treats URL, excerpt, chunk and score fields as optional:
an invalid optional value is dropped while a later valid alias (if present) or
a source with a valid ID and title is retained. `ragUsed=true` is schema-valid only for the three retrieval
intents, so tool, memory, small-talk and crisis branches must emit an empty
source list. The online source evaluator also requires the normalized response
to carry the explicit boolean `ragUsed=true`; a non-empty source array alone
cannot pass the Top-3 recall gate. The routing and safety evaluator includes
`actualRagUsed` beside `actualSources` in each JSON case result so a missing
RAG declaration is visible during diagnosis, without weakening any pass gate.

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
5. Configure every result renderer to emit `schemaVersion`,
   `workflowVersion`, `intent`, `strategy` and a schema-valid
   `ragUsed`/`sources` pair, then validate the candidate response metadata.
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

On 2026-08-22, the workflow metadata Schema regression suite passed 4/4 cases,
covering the required boolean, the one-to-three-source RAG branch, and the
retrieval-intent restriction and the empty-source non-RAG branch. Both offline evaluation-data checks also passed
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

Attachments are not a product feature in the current local web build. The
backend rejects non-empty attachment arrays instead of forwarding unvalidated
provider objects. Upstream trace fields, signed URLs, arbitrary metadata and
raw error text are not returned to the browser.

Never add an APP_KEY, internal signed source URL or real user conversation to
this directory.
