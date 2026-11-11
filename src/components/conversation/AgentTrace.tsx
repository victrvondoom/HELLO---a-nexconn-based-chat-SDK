import type { ParsedOutcome } from '@/lib/validation/outcome';
import { AGENT_NAME, GROUNDING_LABEL, type ReferenceKind } from '@/agents/types';

type Trace = NonNullable<ParsedOutcome['agents']>;

const KIND_LABEL: Record<ReferenceKind, string> = {
  EVENT_GUIDE: 'Event guide',
  STAFF_PROCEDURE: 'Staff procedure',
  SCHEDULE: 'Schedule record',
  WEB: 'Web · unverified',
};

/**
 * The sources a reply rests on, numbered to match the [n] markers in the reply, and a
 * collapsible record of what each agent did. Everything shown comes from the validated stored trace.
 */
export function AgentTrace({ trace, showSteps }: { trace: Trace; showSteps: boolean }) {
  const ran = trace.steps.filter((s) => s.status !== 'SKIPPED').length;
  return (
    <div className="stack" style={{ gap: 8 }}>
      {trace.references.length > 0 ? (
        <section className="sources" aria-label="Sources">
          <div className="sources__head">
            <span>Sources</span>
            <span className={`grounding grounding--${trace.grounding}`}>{GROUNDING_LABEL[trace.grounding]}</span>
          </div>
          <ol>
            {trace.references.map((r, index) => (
              <li key={r.id} className="source">
                <span className="source__n" aria-label={`Source ${index + 1}`}>
                  {index + 1}
                </span>
                <span style={{ minWidth: 0 }}>
                  <span className="row" style={{ gap: 6 }}>
                    {r.url ? (
                      <a className="source__title" href={r.url} target="_blank" rel="noopener noreferrer nofollow">
                        {r.title}
                      </a>
                    ) : (
                      <span className="source__title">{r.title}</span>
                    )}
                    <span className="xs faint">{KIND_LABEL[r.kind]}</span>
                  </span>
                  <span className="source__snippet">{r.snippet}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {showSteps ? (
        <details className="trace">
          <summary>
            <span className="trace__dots" aria-hidden="true">
              {trace.steps.map((s, i) => (
                <span key={`${s.agent}-${i}`} className={`trace__dot trace__dot--${s.status}`} />
              ))}
            </span>
            How HELLO worked this out · {ran} of {trace.steps.length} agents ran · {Math.round(trace.totalMs)} ms
          </summary>
          <ol>
            {trace.steps.map((s, i) => (
              <li key={`${s.agent}-${i}`}>
                <span className={`trace__dot trace__dot--${s.status}`} aria-hidden="true" />
                <span className="trace__agent">
                  {AGENT_NAME[s.agent]}
                  {s.status !== 'DONE' ? <span className="xs faint"> · {s.status.toLowerCase()}</span> : null}
                </span>
                <span className="trace__summary muted">{s.summary}</span>
                <span className="trace__ms">{s.durationMs < 1 ? '<1' : Math.round(s.durationMs)} ms</span>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </div>
  );
}
