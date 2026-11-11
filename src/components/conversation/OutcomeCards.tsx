import Link from 'next/link';
import type { ParsedOutcome } from '@/lib/validation/outcome';
import { CATEGORY_LABEL, STATUS_LABEL } from '@/domain/labels';
import { formatUtc } from '@/components/ui/labels';
import { Icon } from '@/components/ui/Icon';

import { IncidentBadge } from '@/components/incidents/IncidentBadge';

/** Structured cards rendered under HELLO's reply. Everything shown is taken from the stored, validated outcome. */
export function OutcomeCards({ eventId, outcome }: { eventId: string; outcome: ParsedOutcome }) {
  const hasCards =
    outcome.incidents.length > 0 ||
    outcome.alternatives.length > 0 ||
    outcome.people.length > 0 ||
    outcome.statusReport !== null ||
    outcome.approvalId !== null ||
    Boolean(outcome.room);
  if (!hasCards) return null;

  return (
    <div className="cards" aria-label="Actions taken">
      {outcome.room ? (
        <Link className="map-chip" href={`/events/${eventId}/map?to=${encodeURIComponent(outcome.room.id)}`}>
          <Icon name="map" size={14} /> Directions to {outcome.room.name}
        </Link>
      ) : null}
      {outcome.incidents.map((i) => (
        <article key={i.incidentId} className="ocard ocard--incident">
          <div className="ocard__title">
            <span>{i.title}</span>
            <IncidentBadge status={i.status} />
          </div>
          <div className="ocard__meta">
            {CATEGORY_LABEL[i.category]} · urgency {i.urgency.toLowerCase()}
            {i.attached && i.matchConfidence !== null
              ? ` · matched an open report (confidence ${i.matchConfidence.toFixed(2)})`
              : ' · new incident'}
          </div>
          <div className="ocard__foot">
            <span className="small faint">{STATUS_LABEL[i.status]}</span>
            <Link className="open" href={`/events/${eventId}/incidents/${i.incidentId}`}>
              View incident
            </Link>
          </div>
        </article>
      ))}

      {outcome.approvalId ? (
        <article className="ocard ocard--approval">
          <div className="ocard__title">
            <span>Waiting for an organiser</span>
            <span className="badge badge--warning">Pending approval</span>
          </div>
          <div className="ocard__meta">
            A room change needs organiser approval. Nothing has moved yet, and the result will be posted here.
          </div>
        </article>
      ) : null}

      {outcome.alternatives.length > 0 ? (
        <article className="ocard ocard--alt">
          <div className="ocard__title">
            <span>Sessions with free seats</span>
            <span className="badge badge--success">{outcome.alternatives.length} options</span>
          </div>
          <ul className="list-plain">
            {outcome.alternatives.map((a) => (
              <li key={a.sessionId}>
                <strong>{a.title}</strong>
                <div className="ocard__meta">
                  {a.roomName} · {formatUtc(a.startsAt)}
                  {a.reasons.length > 0 ? ` · ${a.reasons.join(' ')}` : ''}
                </div>
              </li>
            ))}
          </ul>
        </article>
      ) : null}

      {outcome.statusReport ? (
        <article className="ocard ocard--warn">
          <div className="ocard__title">
            <span>{outcome.statusReport.title}</span>
            <IncidentBadge status={outcome.statusReport.status} />
          </div>
          <div className="ocard__meta">
            {outcome.statusReport.assigneeName
              ? `Being handled by ${outcome.statusReport.assigneeName}.`
              : 'Not yet claimed by a staff member.'}{' '}
            Last update {outcome.statusReport.minutesSinceUpdate} min ago.
          </div>
          <div className="ocard__foot">
            <Link className="open" href={`/events/${eventId}/incidents/${outcome.statusReport.incidentId}`}>
              Open incident
            </Link>
          </div>
        </article>
      ) : null}

      {outcome.people.length > 0 ? (
        <article className="ocard">
          <div className="ocard__title">
            <span>People who declared a matching interest</span>
          </div>
          <ul className="list-plain">
            {outcome.people.map((p) => (
              <li key={p.userId}>
                <strong>{p.displayName}</strong>
                <div className="ocard__meta">{p.reason}</div>
              </li>
            ))}
          </ul>
        </article>
      ) : null}
    </div>
  );
}
