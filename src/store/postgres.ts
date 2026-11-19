import { Client, Pool, type PoolClient, type PoolConfig } from 'pg';
import type {
  Announcement,
  ApprovalRequest,
  AuditEntry,
  EventRecord,
  Follow,
  Incident,
  IncidentReport,
  IncidentTimelineEntry,
  KeyBundle,
  Membership,
  Message,
  Notification,
  Payment,
  ProfileRecord,
  ReferenceDoc,
  Room,
  SealedMessage,
  Session,
  SignalPattern,
  User,
} from '../domain/types';
import type { Venue } from '../domain/venue/types';
import { COLLECTION_NAMES, type CollectionName, type Collections } from '../domain/product';
import { OPEN_STATUSES } from '../domain/incidents/lifecycle';
import { DomainError } from '../domain/errors';
import { SCHEMA_SQL, TABLES } from './postgres-schema';
import { VersionConflictError, type SeedData, type SeedableStore } from './store';

/**
 * Postgres implementation of `HelloStore`.
 *
 * It keeps the exact semantics of the in-memory store, which every service and test was written against:
 * - records come back as they were written (the whole record is `data jsonb`);
 * - lists keep insertion order (`seq`), and the lists the memory store sorts are sorted the same way here,
 *   with insertion order breaking ties, as JavaScript's stable sort does;
 * - every read-modify-write (`docMutate`, the version-checked updates) runs in a transaction that locks the
 *   row first (`select … for update`). That replaces the memory store's "synchronous inside the method"
 *   guarantee, and it holds across several app instances, which the memory store cannot.
 *
 * Connections: one pool per store. `searchPath` puts the tables in their own schema, which is how each test
 * gets an isolated database.
 */

type Row = { data: unknown };

const asList = <T>(rows: Row[]): T[] => rows.map((r) => r.data as T);
const json = (value: unknown): string => JSON.stringify(value);
const IDENT = /^[a-z_][a-z0-9_]{0,62}$/;

export interface PostgresOptions {
  connectionString: string;
  /** Schema to create and use. Defaults to `public`. Tests use one schema per harness. */
  schema?: string;
  /** Pool size. The default suits one app instance; tests use a small pool. */
  max?: number;
  /** How long an idle connection is kept. Tests keep it short so finished tests hold no connections. */
  idleTimeoutMillis?: number;
}

export class PostgresHelloStore implements SeedableStore {
  private constructor(
    private readonly pool: Pool,
    readonly schema: string,
    private readonly config: PoolConfig,
  ) {}

  /** Connects, creates the schema if needed (under an advisory lock, so instances can start together). */
  static async connect(options: PostgresOptions): Promise<PostgresHelloStore> {
    const schema = options.schema ?? 'public';
    if (!IDENT.test(schema)) throw new Error('The Postgres schema name must be a plain identifier.');
    const config: PoolConfig = {
      connectionString: options.connectionString,
      max: options.max ?? 10,
      idleTimeoutMillis: options.idleTimeoutMillis ?? 10_000,
      // Every connection works in the store's schema.
      options: `-c search_path=${schema}`,
    };
    const pool = new Pool(config);
    // An idle client that loses its connection must not crash the process.
    pool.on('error', () => undefined);
    const store = new PostgresHelloStore(pool, schema, config);
    await store.tx(async (c) => {
      await c.query('select pg_advisory_xact_lock(hashtext($1))', [`hello_store_schema:${schema}`]);
      if (schema !== 'public') await c.query(`create schema if not exists ${schema}`);
      await c.query(SCHEMA_SQL);
    });
    return store;
  }

  /** Closes the pool. With `dropSchema`, removes the store's schema too (used by tests). */
  async close(options: { dropSchema?: boolean } = {}): Promise<void> {
    if (options.dropSchema && this.schema !== 'public') {
      await this.pool.query(`drop schema if exists ${this.schema} cascade`);
    }
    await this.pool.end();
  }

  /** Sends a notification on a channel (Postgres NOTIFY). Payloads must stay under 8,000 bytes. */
  async notify(channel: string, payload: string): Promise<void> {
    await this.pool.query('select pg_notify($1, $2)', [channel, payload]);
  }

  /**
   * Listens on a channel with a dedicated connection (LISTEN cannot share a pooled one). If the connection
   * drops, it reconnects after a short wait. Returns a function that stops listening.
   */
  async listen(channel: string, onPayload: (payload: string) => void): Promise<() => Promise<void>> {
    if (!IDENT.test(channel)) throw new Error('The channel name must be a plain identifier.');
    let stopped = false;
    let client: Client | null = null;
    const open = async (): Promise<void> => {
      const next = new Client({ connectionString: this.config.connectionString, options: this.config.options });
      next.on('notification', (message) => {
        if (message.channel === channel && message.payload) onPayload(message.payload);
      });
      next.on('error', () => {
        if (stopped) return;
        client = null;
        setTimeout(() => {
          if (!stopped) open().catch(() => undefined);
        }, 2_000).unref();
      });
      await next.connect();
      await next.query(`listen ${channel}`);
      client = next;
    };
    await open();
    return async () => {
      stopped = true;
      await client?.end().catch(() => undefined);
    };
  }

  /** Empties every table. Used by the demo reset. */
  async wipe(): Promise<void> {
    await this.pool.query(`truncate ${TABLES.join(', ')} restart identity`);
  }

  /** True when no event has been stored yet: a new database that needs its first data. */
  async isEmpty(): Promise<boolean> {
    const { rows } = await this.pool.query<{ n: string }>('select count(*)::text as n from hello_events');
    return rows[0]?.n === '0';
  }

  async getMeta<T>(key: string): Promise<T | null> {
    const { rows } = await this.pool.query<{ value: unknown }>('select value from hello_meta where key = $1', [key]);
    return rows[0] ? (rows[0].value as T) : null;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    await this.pool.query('insert into hello_meta (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = excluded.value', [key, json(value)]);
  }

  private async tx<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const result = await work(client);
      await client.query('commit');
      return result;
    } catch (error: unknown) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async one<T>(sql: string, params: unknown[]): Promise<T | null> {
    const { rows } = await this.pool.query<Row>(sql, params);
    return rows[0] ? (rows[0].data as T) : null;
  }

  private async many<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const { rows } = await this.pool.query<Row>(sql, params);
    return asList<T>(rows);
  }

  /** Locked read-merge-write of one row in a table keyed by `id`. Throws NOT_FOUND when the row is missing. */
  private async patchRow<T extends object>(table: string, id: string, notFound: string, merge: (current: T) => T, extraColumns: (next: T) => Record<string, unknown> = () => ({})): Promise<T> {
    return this.tx(async (c) => {
      const { rows } = await c.query<Row>(`select data from ${table} where id = $1 for update`, [id]);
      const row = rows[0];
      if (!row) throw new DomainError('NOT_FOUND', notFound);
      const next = merge(row.data as T);
      const extra = extraColumns(next);
      const keys = Object.keys(extra);
      const sets = ['data = $2::jsonb', ...keys.map((k, i) => `${k} = $${i + 3}`)].join(', ');
      await c.query(`update ${table} set ${sets} where id = $1`, [id, json(next), ...keys.map((k) => extra[k])]);
      return next;
    });
  }

  /** Version-checked update, the Postgres form of the memory store's compare-and-set. */
  private async versioned<T extends { version: number }>(table: string, id: string, expectedVersion: number, entity: string, notFound: string, merge: (current: T) => T): Promise<T> {
    return this.tx(async (c) => {
      const { rows } = await c.query<Row>(`select data from ${table} where id = $1 for update`, [id]);
      const row = rows[0];
      if (!row) throw new DomainError('NOT_FOUND', notFound);
      const current = row.data as T;
      if (current.version !== expectedVersion) throw new VersionConflictError(entity);
      const next = merge(current);
      await c.query(`update ${table} set data = $2::jsonb, version = $3 where id = $1`, [id, json(next), next.version]);
      return next;
    });
  }

  // --- seeding ---

  async seed(data: SeedData): Promise<void> {
    await this.tx(async (c) => {
      for (const p of data.profiles ?? []) await c.query('insert into hello_profiles (user_id, data) values ($1, $2::jsonb) on conflict (user_id) do update set data = excluded.data', [p.userId, json(p)]);
      for (const f of data.follows ?? []) await c.query('insert into hello_follows (follower_id, followee_id, data) values ($1, $2, $3::jsonb) on conflict do nothing', [f.followerId, f.followeeId, json(f)]);
      for (const v of data.venues ?? []) await c.query('insert into hello_venues (event_id, data) values ($1, $2::jsonb) on conflict (event_id) do update set data = excluded.data', [v.eventId, json(v)]);
      for (const d of data.referenceDocs ?? []) await c.query('insert into hello_reference_docs (id, event_id, data) values ($1, $2, $3::jsonb) on conflict (id) do nothing', [d.id, d.eventId, json(d)]);
      for (const a of data.announcements ?? []) await c.query('insert into hello_announcements (id, event_id, data) values ($1, $2, $3::jsonb) on conflict (id) do nothing', [a.id, a.eventId, json(a)]);
      for (const n of data.notifications ?? []) await c.query('insert into hello_notifications (id, event_id, recipient_user_id, dedupe_key, data) values ($1, $2, $3, $4, $5::jsonb) on conflict do nothing', [n.id, n.eventId, n.recipientUserId, n.dedupeKey, json(n)]);
      for (const e of data.events) await c.query('insert into hello_events (id, data) values ($1, $2::jsonb) on conflict (id) do update set data = excluded.data', [e.id, json(e)]);
      for (const u of data.users) await c.query('insert into hello_users (id, data) values ($1, $2::jsonb) on conflict (id) do update set data = excluded.data', [u.id, json(u)]);
      for (const m of data.memberships) await c.query('insert into hello_memberships (id, event_id, user_id, data) values ($1, $2, $3, $4::jsonb) on conflict (id) do update set data = excluded.data', [m.id, m.eventId, m.userId, json(m)]);
      for (const r of data.rooms) await c.query('insert into hello_rooms (id, event_id, data) values ($1, $2, $3::jsonb) on conflict (id) do update set data = excluded.data', [r.id, r.eventId, json(r)]);
      for (const s of data.sessions) await c.query('insert into hello_sessions (id, event_id, data) values ($1, $2, $3::jsonb) on conflict (id) do update set data = excluded.data', [s.id, s.eventId, json(s)]);
      for (const i of data.incidents ?? []) await c.query('insert into hello_incidents (id, event_id, version, data) values ($1, $2, $3, $4::jsonb) on conflict (id) do update set data = excluded.data, version = excluded.version', [i.id, i.eventId, i.version, json(i)]);
      for (const r of data.reports ?? []) await c.query('insert into hello_reports (id, event_id, incident_id, reporter_user_id, data) values ($1, $2, $3, $4, $5::jsonb) on conflict (id) do nothing', [r.id, r.eventId, r.incidentId, r.reporterUserId, json(r)]);
      for (const t of data.timeline ?? []) await c.query('insert into hello_timeline (id, incident_id, data) values ($1, $2, $3::jsonb) on conflict (id) do nothing', [t.id, t.incidentId, json(t)]);
    });
  }

  // --- events, users, memberships ---

  getEvent(eventId: string): Promise<EventRecord | null> {
    return this.one('select data from hello_events where id = $1', [eventId]);
  }

  getUser(userId: string): Promise<User | null> {
    return this.one('select data from hello_users where id = $1', [userId]);
  }

  listUsers(): Promise<User[]> {
    return this.many('select data from hello_users order by seq');
  }

  updateUser(userId: string, patch: Partial<Pick<User, 'displayName' | 'interests' | 'discoverable' | 'accessibilityRequired'>>): Promise<User> {
    return this.patchRow<User>('hello_users', userId, 'User not found.', (current) => ({ ...current, ...patch }));
  }

  listMembershipsOfUser(userId: string): Promise<Membership[]> {
    return this.many('select data from hello_memberships where user_id = $1 order by seq', [userId]);
  }

  findMembership(eventId: string, userId: string): Promise<Membership | null> {
    return this.one('select data from hello_memberships where event_id = $1 and user_id = $2 order by seq limit 1', [eventId, userId]);
  }

  listMemberships(eventId: string): Promise<Membership[]> {
    return this.many('select data from hello_memberships where event_id = $1 order by seq', [eventId]);
  }

  updateMembership(membershipId: string, patch: Partial<Pick<Membership, 'availability' | 'zone' | 'skills'>>): Promise<Membership> {
    return this.patchRow<Membership>('hello_memberships', membershipId, 'Membership not found.', (current) => ({ ...current, ...patch }));
  }

  // --- rooms & sessions ---

  listRooms(eventId: string): Promise<Room[]> {
    return this.many('select data from hello_rooms where event_id = $1 order by seq', [eventId]);
  }

  getRoom(roomId: string): Promise<Room | null> {
    return this.one('select data from hello_rooms where id = $1', [roomId]);
  }

  listSessions(eventId: string): Promise<Session[]> {
    return this.many('select data from hello_sessions where event_id = $1 order by seq', [eventId]);
  }

  getSession(sessionId: string): Promise<Session | null> {
    return this.one('select data from hello_sessions where id = $1', [sessionId]);
  }

  async updateSession(sessionId: string, patch: Partial<Pick<Session, 'roomId'>>): Promise<void> {
    await this.patchRow<Session>('hello_sessions', sessionId, 'Session not found.', (current) => ({ ...current, ...patch }));
  }

  // --- messages ---

  async insertMessage(message: Message): Promise<void> {
    await this.pool.query('insert into hello_messages (id, event_id, sender_user_id, data) values ($1, $2, $3, $4::jsonb) on conflict (id) do nothing', [message.id, message.eventId, message.senderUserId, json(message)]);
  }

  listMessages(eventId: string): Promise<Message[]> {
    return this.many('select data from hello_messages where event_id = $1 order by seq', [eventId]);
  }

  // --- incidents (optimistic concurrency) ---

  async insertIncident(incident: Incident): Promise<void> {
    const { rowCount } = await this.pool.query('insert into hello_incidents (id, event_id, version, data) values ($1, $2, $3, $4::jsonb) on conflict (id) do nothing', [incident.id, incident.eventId, incident.version, json(incident)]);
    if (rowCount === 0) throw new DomainError('VALIDATION_FAILED', `Incident ${incident.id} already exists.`);
  }

  getIncident(incidentId: string): Promise<Incident | null> {
    return this.one('select data from hello_incidents where id = $1', [incidentId]);
  }

  listIncidents(eventId: string): Promise<Incident[]> {
    return this.many('select data from hello_incidents where event_id = $1 order by seq', [eventId]);
  }

  updateIncident(incidentId: string, expectedVersion: number, patch: Partial<Incident>, now: number): Promise<Incident> {
    return this.versioned<Incident>('hello_incidents', incidentId, expectedVersion, 'incident', 'Incident not found.', (current) => ({ ...current, ...patch, version: current.version + 1, updatedAt: now }));
  }

  // --- reports ---

  async insertReport(report: IncidentReport): Promise<void> {
    await this.pool.query('insert into hello_reports (id, event_id, incident_id, reporter_user_id, data) values ($1, $2, $3, $4, $5::jsonb) on conflict (id) do nothing', [report.id, report.eventId, report.incidentId, report.reporterUserId, json(report)]);
  }

  listReportsForEvent(eventId: string): Promise<IncidentReport[]> {
    return this.many('select data from hello_reports where event_id = $1 order by seq', [eventId]);
  }

  listReportsForIncident(incidentId: string): Promise<IncidentReport[]> {
    return this.many('select data from hello_reports where incident_id = $1 order by seq', [incidentId]);
  }

  // --- timeline & audit ---

  async appendTimeline(entry: IncidentTimelineEntry): Promise<void> {
    await this.pool.query('insert into hello_timeline (id, incident_id, data) values ($1, $2, $3::jsonb) on conflict (id) do nothing', [entry.id, entry.incidentId, json(entry)]);
  }

  listTimeline(incidentId: string): Promise<IncidentTimelineEntry[]> {
    return this.many(`select data from hello_timeline where incident_id = $1 order by (data->>'at')::bigint, seq`, [incidentId]);
  }

  async appendAudit(entry: AuditEntry): Promise<void> {
    await this.pool.query('insert into hello_audit (id, event_id, data) values ($1, $2, $3::jsonb) on conflict (id) do nothing', [entry.id, entry.eventId, json(entry)]);
  }

  listAudit(eventId: string): Promise<AuditEntry[]> {
    return this.many('select data from hello_audit where event_id = $1 order by seq', [eventId]);
  }

  // --- approvals ---

  async insertApproval(approval: ApprovalRequest): Promise<void> {
    const { rowCount } = await this.pool.query('insert into hello_approvals (id, event_id, version, data) values ($1, $2, $3, $4::jsonb) on conflict (id) do nothing', [approval.id, approval.eventId, approval.version, json(approval)]);
    if (rowCount === 0) throw new DomainError('VALIDATION_FAILED', `Approval ${approval.id} already exists.`);
  }

  getApproval(approvalId: string): Promise<ApprovalRequest | null> {
    return this.one('select data from hello_approvals where id = $1', [approvalId]);
  }

  listApprovals(eventId: string): Promise<ApprovalRequest[]> {
    return this.many('select data from hello_approvals where event_id = $1 order by seq', [eventId]);
  }

  updateApproval(approvalId: string, expectedVersion: number, patch: Partial<ApprovalRequest>): Promise<ApprovalRequest> {
    return this.versioned<ApprovalRequest>('hello_approvals', approvalId, expectedVersion, 'approval request', 'Approval not found.', (current) => ({ ...current, ...patch, version: current.version + 1 }));
  }

  // --- announcements ---

  async insertAnnouncement(announcement: Announcement): Promise<void> {
    await this.pool.query('insert into hello_announcements (id, event_id, data) values ($1, $2, $3::jsonb) on conflict (id) do nothing', [announcement.id, announcement.eventId, json(announcement)]);
  }

  listAnnouncements(eventId: string): Promise<Announcement[]> {
    return this.many(`select data from hello_announcements where event_id = $1 order by (data->>'publishedAt')::bigint desc, seq`, [eventId]);
  }

  // --- notifications ---

  async insertNotificationIfNew(notification: Notification): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      'insert into hello_notifications (id, event_id, recipient_user_id, dedupe_key, data) values ($1, $2, $3, $4, $5::jsonb) on conflict do nothing',
      [notification.id, notification.eventId, notification.recipientUserId, notification.dedupeKey, json(notification)],
    );
    return rowCount === 1;
  }

  async markNotificationsRead(recipientUserId: string, eventId: string, now: number): Promise<number> {
    const { rowCount } = await this.pool.query(
      `update hello_notifications set data = jsonb_set(data, '{readAt}', to_jsonb($3::bigint)) where recipient_user_id = $1 and event_id = $2 and data->'readAt' = 'null'::jsonb`,
      [recipientUserId, eventId, now],
    );
    return rowCount ?? 0;
  }

  async deleteNotificationsFor(recipientUserId: string): Promise<number> {
    const { rowCount } = await this.pool.query('delete from hello_notifications where recipient_user_id = $1', [recipientUserId]);
    return rowCount ?? 0;
  }

  listNotifications(recipientUserId: string): Promise<Notification[]> {
    return this.many(`select data from hello_notifications where recipient_user_id = $1 order by (data->>'createdAt')::bigint desc, seq`, [recipientUserId]);
  }

  // --- signal intelligence ---

  async upsertSignalPatterns(patterns: SignalPattern[]): Promise<void> {
    for (const incoming of patterns) {
      await this.tx(async (c) => {
        const { rows } = await c.query<Row>('select data from hello_signal_patterns where id = $1 for update', [incoming.id]);
        const existing = rows[0]?.data as SignalPattern | undefined;
        // Human review is never overwritten by a recomputation.
        const merged: SignalPattern =
          existing && existing.reviewStatus !== 'PENDING_REVIEW'
            ? { ...incoming, reviewStatus: existing.reviewStatus, reviewedByUserId: existing.reviewedByUserId, reviewedAt: existing.reviewedAt }
            : incoming;
        await c.query('insert into hello_signal_patterns (id, event_id, data) values ($1, $2, $3::jsonb) on conflict (id) do update set data = excluded.data', [merged.id, merged.eventId, json(merged)]);
      });
    }
  }

  listSignalPatterns(eventId: string): Promise<SignalPattern[]> {
    return this.many('select data from hello_signal_patterns where event_id = $1 order by seq', [eventId]);
  }

  getSignalPattern(patternId: string): Promise<SignalPattern | null> {
    return this.one('select data from hello_signal_patterns where id = $1', [patternId]);
  }

  updateSignalPattern(patternId: string, patch: Partial<SignalPattern>): Promise<SignalPattern> {
    return this.patchRow<SignalPattern>('hello_signal_patterns', patternId, 'Signal pattern not found.', (current) => ({ ...current, ...patch }));
  }

  async countOpenAssignments(eventId: string): Promise<Map<string, number>> {
    const { rows } = await this.pool.query<{ assignee: string; n: string }>(
      `select data->>'assigneeUserId' as assignee, count(*)::text as n from hello_incidents
       where event_id = $1 and data->>'assigneeUserId' is not null and data->>'status' = any($2::text[])
       group by 1`,
      [eventId, [...OPEN_STATUSES]],
    );
    return new Map(rows.map((r) => [r.assignee, Number(r.n)]));
  }

  // --- social graph ---

  getProfile(userId: string): Promise<ProfileRecord | null> {
    return this.one('select data from hello_profiles where user_id = $1', [userId]);
  }

  async putProfile(profile: ProfileRecord): Promise<void> {
    await this.pool.query('insert into hello_profiles (user_id, data) values ($1, $2::jsonb) on conflict (user_id) do update set data = excluded.data', [profile.userId, json(profile)]);
  }

  async deleteProfile(userId: string): Promise<void> {
    await this.pool.query('delete from hello_profiles where user_id = $1', [userId]);
  }

  async addFollow(follow: Follow): Promise<boolean> {
    const { rowCount } = await this.pool.query('insert into hello_follows (follower_id, followee_id, data) values ($1, $2, $3::jsonb) on conflict do nothing', [follow.followerId, follow.followeeId, json(follow)]);
    return rowCount === 1;
  }

  async removeFollow(followerId: string, followeeId: string): Promise<boolean> {
    const { rowCount } = await this.pool.query('delete from hello_follows where follower_id = $1 and followee_id = $2', [followerId, followeeId]);
    return (rowCount ?? 0) > 0;
  }

  listFollowers(userId: string): Promise<Follow[]> {
    return this.many('select data from hello_follows where followee_id = $1 order by seq', [userId]);
  }

  listFollowing(userId: string): Promise<Follow[]> {
    return this.many('select data from hello_follows where follower_id = $1 order by seq', [userId]);
  }

  async removeAllFollows(userId: string): Promise<number> {
    const { rowCount } = await this.pool.query('delete from hello_follows where follower_id = $1 or followee_id = $1', [userId]);
    return rowCount ?? 0;
  }

  // --- end-to-end encrypted messages ---

  async putKeyBundle(bundle: KeyBundle): Promise<void> {
    await this.pool.query('insert into hello_key_bundles (id, user_id, data) values ($1, $2, $3::jsonb) on conflict (id) do nothing', [bundle.id, bundle.userId, json(bundle)]);
  }

  listKeyBundles(userId: string): Promise<KeyBundle[]> {
    return this.many(`select data from hello_key_bundles where user_id = $1 order by (data->>'createdAt')::bigint, seq`, [userId]);
  }

  async deleteKeyBundles(userId: string): Promise<number> {
    const { rowCount } = await this.pool.query('delete from hello_key_bundles where user_id = $1', [userId]);
    return rowCount ?? 0;
  }

  async insertSealedMessage(message: SealedMessage): Promise<void> {
    await this.pool.query('insert into hello_sealed (id, sender_id, recipient_id, data) values ($1, $2, $3, $4::jsonb) on conflict (id) do nothing', [message.id, message.senderId, message.recipientId, json(message)]);
  }

  listSealedBetween(a: string, b: string): Promise<SealedMessage[]> {
    return this.many(
      `select data from hello_sealed where (sender_id = $1 and recipient_id = $2) or (sender_id = $2 and recipient_id = $1) order by (data->>'createdAt')::bigint, seq`,
      [a, b],
    );
  }

  listSealedInvolving(userId: string): Promise<SealedMessage[]> {
    return this.many('select data from hello_sealed where sender_id = $1 or recipient_id = $1 order by seq', [userId]);
  }

  async deleteSealedInvolving(userId: string): Promise<number> {
    const { rowCount } = await this.pool.query('delete from hello_sealed where sender_id = $1 or recipient_id = $1', [userId]);
    return rowCount ?? 0;
  }

  // --- payments ---

  async insertPayment(payment: Payment): Promise<void> {
    await this.pool.query(
      'insert into hello_payments (id, payer_id, payee_id, version, data) values ($1, $2, $3, $4, $5::jsonb) on conflict (id) do update set data = excluded.data, version = excluded.version',
      [payment.id, payment.payerId, payment.payeeId, payment.version, json(payment)],
    );
  }

  getPayment(paymentId: string): Promise<Payment | null> {
    return this.one('select data from hello_payments where id = $1', [paymentId]);
  }

  updatePayment(paymentId: string, expectedVersion: number, patch: Partial<Payment>): Promise<Payment> {
    return this.versioned<Payment>('hello_payments', paymentId, expectedVersion, 'payment', 'Payment not found.', (current) => ({ ...current, ...patch, version: current.version + 1 }));
  }

  listPaymentsBetween(a: string, b: string): Promise<Payment[]> {
    return this.many(
      `select data from hello_payments where (payer_id = $1 and payee_id = $2) or (payer_id = $2 and payee_id = $1) order by (data->>'createdAt')::bigint, seq`,
      [a, b],
    );
  }

  listPaymentsFrom(payerId: string): Promise<Payment[]> {
    return this.many('select data from hello_payments where payer_id = $1 order by seq', [payerId]);
  }

  // --- rights ---

  async redactMessagesFrom(userId: string, replacement: string): Promise<number> {
    const { rowCount } = await this.pool.query(`update hello_messages set data = data || jsonb_build_object('text', $2::text, 'interpretation', null) where sender_user_id = $1`, [userId, replacement]);
    return rowCount ?? 0;
  }

  async redactReportsFrom(userId: string, replacement: string): Promise<number> {
    const { rowCount } = await this.pool.query(`update hello_reports set data = data || jsonb_build_object('text', $2::text) where reporter_user_id = $1`, [userId, replacement]);
    return rowCount ?? 0;
  }

  async redactPaymentNotesFrom(payerId: string, replacement: string): Promise<number> {
    const { rowCount } = await this.pool.query(`update hello_payments set data = data || jsonb_build_object('note', $2::text) where payer_id = $1 and data->>'note' is not null`, [payerId, replacement]);
    return rowCount ?? 0;
  }

  getVenue(eventId: string): Promise<Venue | null> {
    return this.one('select data from hello_venues where event_id = $1', [eventId]);
  }

  listReferenceDocs(eventId: string): Promise<ReferenceDoc[]> {
    return this.many('select data from hello_reference_docs where event_id = $1 order by seq', [eventId]);
  }

  // --- accounts ---

  async insertUser(user: User): Promise<void> {
    const { rowCount } = await this.pool.query('insert into hello_users (id, data) values ($1, $2::jsonb) on conflict (id) do nothing', [user.id, json(user)]);
    if (rowCount === 0) throw new DomainError('VALIDATION_FAILED', 'That account already exists.');
  }

  async insertMembership(membership: Membership): Promise<void> {
    await this.pool.query(
      'insert into hello_memberships (id, event_id, user_id, data) values ($1, $2, $3, $4::jsonb) on conflict (id) do update set data = excluded.data, event_id = excluded.event_id, user_id = excluded.user_id',
      [membership.id, membership.eventId, membership.userId, json(membership)],
    );
  }

  // --- document collections ---

  private static collection(name: CollectionName): CollectionName {
    if (!(COLLECTION_NAMES as readonly string[]).includes(name)) throw new DomainError('NOT_FOUND', 'Unknown collection.');
    return name;
  }

  async docPut<K extends CollectionName>(collection: K, doc: Collections[K]): Promise<void> {
    await this.pool.query('insert into hello_documents (collection, id, data) values ($1, $2, $3::jsonb) on conflict (collection, id) do update set data = excluded.data', [
      PostgresHelloStore.collection(collection),
      doc.id,
      json(doc),
    ]);
  }

  async docPutIfAbsent<K extends CollectionName>(collection: K, doc: Collections[K]): Promise<boolean> {
    const { rowCount } = await this.pool.query('insert into hello_documents (collection, id, data) values ($1, $2, $3::jsonb) on conflict do nothing', [PostgresHelloStore.collection(collection), doc.id, json(doc)]);
    return rowCount === 1;
  }

  docGet<K extends CollectionName>(collection: K, id: string): Promise<Collections[K] | null> {
    return this.one('select data from hello_documents where collection = $1 and id = $2', [PostgresHelloStore.collection(collection), id]);
  }

  /**
   * `where` is an equality match on top-level fields, as in the memory store. Defined values become a JSON
   * containment test (`@>`, served by the GIN index); a key whose value is undefined matches documents that
   * do not have that key, which is what `doc[key] === undefined` means.
   */
  docList<K extends CollectionName>(collection: K, where: Partial<Collections[K]> = {}): Promise<Collections[K][]> {
    const defined: Record<string, unknown> = {};
    const missing: string[] = [];
    for (const [key, value] of Object.entries(where)) {
      if (value === undefined) missing.push(key);
      else defined[key] = value;
    }
    const params: unknown[] = [PostgresHelloStore.collection(collection), json(defined)];
    const absent = missing.map((key) => {
      params.push(key);
      return ` and not (data ? $${params.length})`;
    });
    return this.many(`select data from hello_documents where collection = $1 and data @> $2::jsonb${absent.join('')} order by seq`, params);
  }

  async docDelete(collection: CollectionName, id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query('delete from hello_documents where collection = $1 and id = $2', [PostgresHelloStore.collection(collection), id]);
    return (rowCount ?? 0) > 0;
  }

  async docMutate<K extends CollectionName>(collection: K, id: string, change: (doc: Collections[K]) => Collections[K] | null): Promise<Collections[K] | null> {
    const name = PostgresHelloStore.collection(collection);
    return this.tx(async (c) => {
      // The row lock is what makes two simultaneous moves, likes or approvals serialise.
      const { rows } = await c.query<Row>('select data from hello_documents where collection = $1 and id = $2 for update', [name, id]);
      const row = rows[0];
      if (!row) return null;
      const next = change(row.data as Collections[K]);
      if (next === null) return null;
      await c.query('update hello_documents set data = $3::jsonb where collection = $1 and id = $2', [name, id, json(next)]);
      return next;
    });
  }

  // --- media bytes ---

  async blobPut(id: string, bytes: Uint8Array): Promise<void> {
    await this.pool.query('insert into hello_blobs (id, bytes) values ($1, $2) on conflict (id) do update set bytes = excluded.bytes', [id, Buffer.from(bytes)]);
  }

  async blobGet(id: string): Promise<Uint8Array | null> {
    const { rows } = await this.pool.query<{ bytes: Buffer }>('select bytes from hello_blobs where id = $1', [id]);
    const bytes = rows[0]?.bytes;
    return bytes ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) : null;
  }

  async blobDelete(id: string): Promise<void> {
    await this.pool.query('delete from hello_blobs where id = $1', [id]);
  }
}
