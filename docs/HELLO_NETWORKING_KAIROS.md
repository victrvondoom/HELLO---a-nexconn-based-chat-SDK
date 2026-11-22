# Kairos: networking intelligence (2026-11-22)

Status: **planned**, with a small honest beginning.

## Built

- **People worth meeting** on Today: listed speakers of sessions in your plan, then people whose own declared,
  opt-in interests match yours (existing `discoverPeople`, which respects `discoverable`). Each suggestion says
  why. Nothing is inferred beyond what people declared; nobody is called "hiring" or a "referral".
- Existing People page: directory, follows, profiles with visibility settings, private messages.

## Planned

Private networking profile (target role, interests, learning goals); event-URL import of public programme and
speaker data with provenance (respecting site rules, never private attendee data); explainable ranking with
multi-hop paths; relationship memory (typed and consented voice notes, reviewed before saving); grounded
follow-up drafts that cite the notes they used and are always sent by the person; cross-event recall; a
personal contact QR distinct from room QR codes, with consent on both sides; four-round speed networking with
a documented matching objective and a deterministic fallback; optional sponsor offers that never see private
notes, graphs or job-seeking status. Each needs the graph layer (`docs/HELLO_EVENT_GRAPH.md`) and its own tests
before it is described as working.
