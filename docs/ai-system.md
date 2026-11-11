# AI system

## Principle

AI helps HELLO **understand** messages. It does not **act** on them. The model output is a routing
hint. Permissions, state rules and approvals decide every outcome.

## Components

| Piece | File | Role |
|---|---|---|
| Intent schema | `src/ai/intent.ts` (`IntentResultSchema`) | Zod schema for every provider result. Anything invalid is rejected. |
| Provider interface | `IntentProvider` | `classify(input, signal)` returns raw JSON. Callers never trust it directly. |
| Deterministic interpreter | `interpretDeterministically` | Rule-based classification. Used when no provider is configured, and as the fallback. |
| Orchestrator | `interpretMessage` | Applies the timeout, catches rate limits and errors, validates the output, and records `fallbackReason`. |
| Classifier | `src/domain/incidents/classify.ts` | Category, urgency, equipment, room resolution. Shared by the interpreter and the duplicate checks. |

## Fallback reasons (shown to the user)

`NO_PROVIDER_CONFIGURED`, `PROVIDER_TIMEOUT`, `PROVIDER_RATE_LIMITED`, `PROVIDER_ERROR`,
`INVALID_STRUCTURED_OUTPUT`. The conversation displays the source of every interpretation.

## What is verified

- Judge-scenario sentences route correctly under the deterministic interpreter (unit tests in `tests/unit/intent.test.ts`).
- Timeouts, rate limits, provider errors and schema-invalid output all fall back without losing the report (tests).
- A combined message ("microphone not working and too many people in Room 3") raises both AV and CAPACITY concerns.

## Not done

- **No LLM provider is connected.** No provider adapter exists, and no key is read. The app works fully without one.
- No evaluation set beyond the unit tests, so the deterministic rules have not been measured against real
  attendee language.
- No model-based entity extraction beyond the rules. No summarisation or recommendation generation with a model.

## Adding a provider

Implement `IntentProvider` and pass it to `createContext({ intentProvider })`. Keep the returned object
inside `IntentResultSchema`. Do not let the provider return actions, IDs or permission decisions.

## Agent mesh

Message handling runs as seven agents (`src/agents/types.ts` lists them, with what each must never do).
The trace for each message is stored with it and validated on read (`src/lib/validation/outcome.ts`); links
that are not http(s) are dropped to null before they can be rendered.

- **Event guide retrieval** (`src/agents/knowledge.ts`): deterministic BM25 over title, tags and body, with
  light stemming. Answers only at relevance ≥ `ANSWER_THRESHOLD` (0.34). Documents with `audience: 'STAFF'` are
  filtered out before ranking for non-staff, so they cannot appear even as citations.
- **Safety sentinel** (`src/agents/sentinel.ts`): pattern-based. Raises the urgency to CRITICAL, turns a
  question into a report, and puts the event guide's emergency page first in the reply. If the event has no
  such page, it uses generic wording that names no phone number or place.
- **Web research** (`src/agents/web.ts`): runs only for questions with outside-the-venue cues, after the
  schedule and guide have failed. The query is redacted (emails, phone numbers, handles, member names) and
  given the venue city. Results are schema-checked, cleaned, de-duplicated and capped, and the timeout does not
  depend on the provider honouring the abort signal. Tests use fake providers only.
- **Grounding**: every reply is labelled `VERIFIED_RECORDS`, `EVENT_GUIDE`, `WEB_UNVERIFIED` or `NO_ANSWER`.
