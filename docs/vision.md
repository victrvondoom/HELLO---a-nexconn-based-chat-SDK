# The hidden problems, and what HELLO does about them

Every event app promises the same three things: chat, a schedule and a map. Most hackathon teams will
build that. The problems below sit underneath that idea. They don't show up in a demo, but they decide
whether a real event can trust the product. HELLO is designed around them.

## 1. The read-and-act paradox

**The problem.** An AI coordinator is useful only if it can read what people say. "Everything end-to-end
encrypted" means nobody can read anything. Both promises can't be true of the same message, and most
products quietly drop one of them while still claiming both.

**What HELLO does.** It keeps two separate channels and labels both on screen:

| Channel | Who can read it | Why |
|---|---|---|
| HELLO conversation | HELLO's agents and event staff | A report has to be read before anyone can act on it |
| Private messages | Only the two people in the conversation | Nobody needs to act on it, so nobody else may read it |

Every message box says which channel it is. The private channel is end-to-end encrypted in the browser
(ECDH P-256, then HKDF, then AES-256-GCM, with non-extractable keys). The server stores only ciphertext,
and a toggle shows people exactly what the server has. Each conversation also has a safety number that two
people can compare face to face. At an event they are usually standing next to each other, which makes this
the easiest key check of any messaging product.

## 2. A claim of encryption you can't check isn't worth much

**The problem.** Saying "encrypted" costs nothing. Without a way to check, people have to take it on trust,
and the server operator can still swap keys and read everything.

**What HELLO does.**
- "Show what HELLO stores" displays the real stored ciphertext, in place.
- The data export contains private messages exactly as stored, still encrypted.
- Safety numbers detect a swapped key.
- A test sends a real message between two browser profiles, then searches every server response and the
  data export for the plaintext (`tests/e2e/private-messages.mjs`).
- The page itself is limited by a Content-Security-Policy with `connect-src 'self'`. The browser refuses to
  send page data to any other origin, even from injected script.

## 3. The social graph is the most sensitive data at an event

**The problem.** A profile reveals what someone chose to say about themselves. A follower list reveals who
knows whom, which can expose employers, rivals, relationships or a source and a journalist. Most products
show follower lists to everyone. Conference apps also tend to allow open messaging, and unwanted contact at
events is a known safety problem.

**What HELLO does.**
- Follower and following lists are visible only to their owner. Everyone else sees counts.
- "Connections only" profiles require a mutual follow. A one-sided follow unlocks nothing.
- Private messages open only between mutual connections.
- People who turn off discoverability can't be found or followed, except by people they already follow.
- Follows are rate-limited, and every follow notifies the person followed, once.

## 4. Connections disappear when the event ends

**The problem.** People go to events to meet people. Then the event app is deleted, and the connections go
with it. The organiser owns the attendee list, not the attendee.

**What HELLO does.** The follow graph belongs to the person, not the event. Follows are stored globally, so
they carry from one event to the next. The person can download it at any time
(`GET /api/me/export`) or erase it.

## 5. Erasure conflicts with accountability

**The problem.** A person has a right to erasure. Staff who acted on that person's report need a record that
they did. Deleting everything breaks the audit trail; keeping everything breaks the right.

**What HELLO does.** It erases everything that is only about the person: profile, follows in both
directions, device keys and private messages. It redacts the text of what they told HELLO. It keeps the
operational record (that an incident existed, its status, who handled it) without their words. The audit
entry records that an erasure happened and what it covered, never what was erased.

## 6. Wayfinding is an accessibility problem disguised as a navigation problem

**The problem.** Map products optimise for the fastest route, then add an accessibility warning. A
wheelchair user doesn't need a warning; they need a route that works. Third-party map tiles also tell the
map provider where people are and where they are going.

**What HELLO does.** It routes on its own venue graph. Step-free mode removes stairs from the graph before
searching, so it either finds a route with no steps or explains why none exists. It is on by default for
anyone whose profile asks for it. Plan, 3D and heat are three views of one model, so what someone sees and
the route they get can never disagree. The map makes no third-party tile requests, so where people look and
where they go stays inside HELLO.

## 7. Safety messages can't wait in a queue

**The problem.** In a general chat pipeline, "someone collapsed" waits behind everything else and is
classified by the same rules as "the Wi-Fi is slow".

**What HELLO does.** The safety sentinel runs on every message before anything else. It raises emergencies
to critical, turns a question into a report, and shows the event's own emergency guidance first. If the
event has none, it uses generic wording that invents no phone numbers.

## The niche

A general event app competes with every other event app. HELLO is narrower: **an accountable, private
coordination layer for gatherings where failure has a cost**. It fits places where accessibility, safety and
privacy are obligations, not features: conferences with accessibility duties, public-sector and healthcare
events, events where attendees include journalists, activists or minors, and multi-day venues. That
audience doesn't currently have a good product, and it is the audience that pays for one.

## What is still not true

- Data is held in memory: one process, and lost on restart. The Postgres schema exists but isn't wired up.
- Sign-in is a demo shortcut, not authentication. Real end-to-end encryption needs real identity, otherwise
  "the person" is whoever holds the cookie.
- Private messages have no forward secrecy (no ratchet), and one device means one key: a new device can't
  read older messages.
- The venue map is hand-drawn demo data. A real venue needs an editor or an import from floor plans.
