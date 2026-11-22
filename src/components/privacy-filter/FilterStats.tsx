'use client';

import type { EngineStats } from './engine/engine';

/** The live numbers upstream's dock shows: what the filter is doing, and when it fell back to blurring everything. */
export function FilterStats({ stats, compact = false }: { stats: EngineStats; compact?: boolean }) {
  const label = stats.status === 'error' ? 'Blurring everything' : stats.status === 'running' ? 'Protecting' : 'Warming up';
  return (
    <div className={compact ? 'pf-stats pf-stats--compact' : 'pf-stats'} data-status={stats.status} aria-live="polite">
      <span className="pf-stats__status">
        <span className="pf-dot" aria-hidden="true" /> {label}
      </span>
      {stats.errors.length ? (
        <ul className="pf-stats__errors">
          {stats.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : null}
      {!compact ? (
        <dl className="pf-stats__grid">
          <div>
            <dt>Output</dt>
            <dd>{stats.output_fps} fps</dd>
          </div>
          <div>
            <dt>Delay</dt>
            <dd>{stats.latency_ms === null ? '…' : `${stats.latency_ms} ms`}</dd>
          </div>
          <div>
            <dt>Face checks</dt>
            <dd>{stats.head_det_per_s}/s</dd>
          </div>
          <div>
            <dt>Code and number checks</dt>
            <dd>{stats.object_det_per_s}/s</dd>
          </div>
          <div>
            <dt>Screen zoom checks</dt>
            <dd>{stats.zoom_per_s}/s</dd>
          </div>
          <div>
            <dt>Faces seen</dt>
            <dd>{stats.faces_seen}</dd>
          </div>
          <div>
            <dt>People seen</dt>
            <dd>{stats.people_seen}</dd>
          </div>
          <div>
            <dt>Unreadable QR codes</dt>
            <dd>{stats.qr_shapes}</dd>
          </div>
          <div>
            <dt>Screens seen</dt>
            <dd>{stats.screens_seen}</dd>
          </div>
          <div>
            <dt>Fully blurred frames</dt>
            <dd>{stats.failsafe_frames}</dd>
          </div>
          <div>
            <dt>Dropped</dt>
            <dd>{stats.dropped}</dd>
          </div>
          <div>
            <dt>Work per frame</dt>
            <dd>{stats.tick_ms === undefined ? '…' : `${String(stats.tick_ms)} ms`}</dd>
          </div>
        </dl>
      ) : null}
    </div>
  );
}
