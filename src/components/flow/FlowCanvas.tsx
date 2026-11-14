'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ago, api, errorText, useLive } from '@/components/live/client';
import { useFeedback } from '@/components/ui/Feedback';
import { Icon, type IconName } from '@/components/ui/Icon';
import type { FlowNode, FlowSnapshot } from '@/services/workflows';

const NODE_W = 230;
const HEIGHT: Record<FlowNode['kind'], number> = { source: 118, agent: 118, queue: 118, output: 118, workflow: 190 };
const ICON: Record<string, IconName> = {
  conversation: 'conversation', feed: 'feed', communities: 'groups', mcp: 'key', agents: 'agents', calls: 'video', games: 'game',
  incidents: 'incidents', map: 'pin', needs: 'bell', notifications: 'bell', signals: 'sparkle',
};
const KIND_LABEL: Record<FlowNode['kind'], string> = { source: 'Source', agent: 'Agents', queue: 'Live', output: 'For you', workflow: 'Workflow' };

type Positions = Record<string, { x: number; y: number }>;
type RunResult = FlowSnapshot['runs'][number];

/**
 * The event as a live graph. Figures refresh every few seconds; nodes can be dragged and the canvas
 * panned and zoomed. Workflow nodes run with one click. Layout is remembered on this device only.
 */
export function FlowCanvas({ eventId, initial }: { eventId: string; initial: FlowSnapshot }) {
  const { data, refresh, stale } = useLive<FlowSnapshot>(`/api/events/${eventId}/flow`, initial, 4000);
  const { toast } = useFeedback();
  const storageKey = `hello.flow.${eventId}`;
  const [moved, setMoved] = useState<Positions>({});
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [dragging, setDragging] = useState<string | null>(null);
  const [panning, setPanning] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, RunResult['steps']>>({});
  const gesture = useRef<{ id: string | null; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const frame = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(storageKey) ?? '{}') as Positions;
      setMoved(saved);
    } catch {
      /* a damaged saved layout is simply ignored */
    }
    const width = frame.current?.clientWidth ?? 1200;
    if (width < 1320) setView({ x: 4, y: 4, k: Math.max(0.3, width / 1340) });
  }, [storageKey]);

  const place = useCallback((n: FlowNode) => moved[n.id] ?? { x: n.x, y: n.y }, [moved]);

  const edges = useMemo(() => {
    const byId = new Map(data.nodes.map((n) => [n.id, n]));
    return data.edges.flatMap((e) => {
      const from = byId.get(e.from);
      const to = byId.get(e.to);
      if (!from || !to) return [];
      const a = place(from);
      const b = place(to);
      if (from.kind === 'workflow') {
        const sx = a.x + NODE_W / 2;
        const tx = b.x + NODE_W / 2;
        const ty = b.y + HEIGHT[to.kind];
        const lift = Math.max(40, (a.y - ty) / 2);
        return [{ key: `${e.from}>${e.to}`, d: `M${sx},${a.y} C${sx},${a.y - lift} ${tx},${ty + lift} ${tx},${ty}`, label: e.label, lx: 0, ly: 0, live: running !== null && e.from === `wf:${running}`, dashed: true }];
      }
      const forward = b.x >= a.x + NODE_W / 2;
      const x1 = forward ? a.x + NODE_W : a.x;
      const x2 = forward ? b.x : b.x + NODE_W;
      const y1 = a.y + HEIGHT[from.kind] / 2;
      const y2 = b.y + HEIGHT[to.kind] / 2;
      const bend = Math.max(50, Math.abs(x2 - x1) / 2) * (forward ? 1 : -1);
      return [{ key: `${e.from}>${e.to}`, d: `M${x1},${y1} C${x1 + bend},${y1} ${x2 - bend},${y2} ${x2},${y2}`, label: e.label, lx: (x1 + x2) / 2, ly: (y1 + y2) / 2 - 6, live: false, dashed: false }];
    });
  }, [data, place, running]);

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>, node: FlowNode | null) {
    if ((event.target as HTMLElement).closest('a,button')) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const origin = node ? place(node) : view;
    gesture.current = { id: node?.id ?? null, startX: event.clientX, startY: event.clientY, originX: origin.x, originY: origin.y };
    if (node) setDragging(node.id);
    else setPanning(true);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    if (!g) return;
    const dx = event.clientX - g.startX;
    const dy = event.clientY - g.startY;
    const id = g.id;
    if (id) setMoved((m) => ({ ...m, [id]: { x: Math.round(g.originX + dx / view.k), y: Math.round(g.originY + dy / view.k) } }));
    else setView((v) => ({ ...v, x: g.originX + dx, y: g.originY + dy }));
  }

  function onPointerUp() {
    if (gesture.current?.id) {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(moved));
      } catch {
        /* storage may be unavailable; the layout then lasts for this visit */
      }
    }
    gesture.current = null;
    setDragging(null);
    setPanning(false);
  }

  const zoom = (factor: number) => { setView((v) => ({ ...v, k: Math.min(1.6, Math.max(0.4, Math.round(v.k * factor * 100) / 100)) })); };

  async function run(workflowId: string, name: string) {
    setRunning(workflowId);
    try {
      const { run: result } = await api<{ run: RunResult }>(`/api/events/${eventId}/flow/run`, 'POST', { workflowId });
      setResults((r) => ({ ...r, [workflowId]: result.steps }));
      toast(result.status === 'SUCCEEDED' ? 'success' : 'error', result.status === 'SUCCEEDED' ? `${name} finished.` : `${name} stopped at a failed step.`);
      await refresh();
    } catch (e: unknown) {
      toast('error', errorText(e));
    } finally {
      setRunning(null);
    }
  }

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div ref={frame} className={panning ? 'canvas is-panning' : 'canvas'} onPointerDown={(e) => { onPointerDown(e, null); }} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
        <div className="canvas__world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
          <svg className="canvas__edges" width="1" height="1" aria-hidden="true">
            {edges.map((e) => (
              <g key={e.key}>
                <path d={e.d} className={e.live ? 'is-flow' : e.dashed ? 'is-quiet' : undefined} />
                {e.label ? (
                  <text x={e.lx} y={e.ly} textAnchor="middle">
                    {e.label}
                  </text>
                ) : null}
              </g>
            ))}
          </svg>
          {data.nodes.map((n) => {
            const p = place(n);
            const steps = n.workflow ? results[n.workflow.id] : undefined;
            return (
              <div
                key={n.id}
                className={`node node--${n.kind} node--${n.tone}${dragging === n.id ? ' is-dragging' : ''}`}
                style={{ left: p.x, top: p.y }}
                onPointerDown={(e) => { onPointerDown(e, n); }}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
              >
                <span className="node__port node__port--in" aria-hidden="true" />
                <span className="node__port node__port--out" aria-hidden="true" />
                <div className="node__head">
                  <Icon name={n.workflow ? 'bolt' : (ICON[n.id] ?? 'sparkle')} />
                  {n.title}
                  <span className="node__kind">{KIND_LABEL[n.kind]}</span>
                </div>
                <div className="node__body">
                  {n.workflow ? (
                    <>
                      <p className="node__caption">{n.caption}</p>
                      <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                        <button type="button" className="button button--sm" disabled={running !== null} onClick={() => void run(n.workflow?.id ?? '', n.title)}>
                          <Icon name="play" /> {running === n.workflow.id ? 'Running…' : 'Run'}
                        </button>
                        <span className="xs faint">{n.workflow.lastRun ? `${n.workflow.lastRun.status === 'SUCCEEDED' ? 'Ran' : 'Failed'} ${ago(data.now, n.workflow.lastRun.at)}` : 'Not run yet'}</span>
                      </div>
                      <ol className="node__steps">
                        {(steps ?? n.workflow.steps.map((label) => ({ label, status: null, detail: '' }))).map((s, i) => (
                          <li key={i}>
                            <span className={s.status === 'SUCCEEDED' ? 'ok' : s.status === 'FAILED' ? 'bad' : 'faint'} aria-hidden="true">
                              {s.status === 'SUCCEEDED' ? '✓' : s.status === 'FAILED' ? '✕' : `${i + 1}.`}
                            </span>
                            <span>{s.detail || s.label}</span>
                          </li>
                        ))}
                      </ol>
                    </>
                  ) : (
                    <>
                      <div className="node__metric">{n.metric}</div>
                      <div className="node__caption">{n.caption}</div>
                      {n.href ? (
                        <Link className="node__open" href={n.href}>
                          Open
                        </Link>
                      ) : null}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="canvas__tools" onPointerDown={(e) => { e.stopPropagation(); }}>
          <button type="button" className="icon-button" onClick={() => { zoom(1 / 1.2); }} aria-label="Zoom out">
            −
          </button>
          <button type="button" className="icon-button" onClick={() => { zoom(1.2); }} aria-label="Zoom in">
            +
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() => {
              setMoved({});
              setView({ x: 0, y: 0, k: 1 });
              try {
                window.localStorage.removeItem(storageKey);
              } catch {
                /* nothing to clear */
              }
            }}
          >
            Reset layout
          </button>
        </div>
      </div>
      <section className="panel" aria-labelledby="runs-heading">
        <div className="panel__head">
          <h2 id="runs-heading">Recent runs</h2>
          <span className="live" role="status">
            <span className="live__dot" aria-hidden="true" />
            {stale ? 'Reconnecting…' : 'Live · every 4s'}
          </span>
        </div>
        {data.runs.length === 0 ? (
          <p className="panel__body small muted" style={{ margin: 0 }}>
            No workflow has run yet. Press Run on any workflow above.
          </p>
        ) : (
          <ul className="runs-list">
            {data.runs.map((r) => (
              <li key={r.id}>
                <span className={r.status === 'SUCCEEDED' ? 'badge badge--success' : 'badge badge--danger'}>{r.status === 'SUCCEEDED' ? 'Finished' : 'Failed'}</span>
                <strong>{r.workflow}</strong>
                <span className="muted">
                  {r.by} · {ago(data.now, r.at)}
                  {r.via === 'MCP' ? ' · through an access token' : ''}
                </span>
                <span className="faint" style={{ flexBasis: '100%' }}>
                  {r.steps.map((s) => s.detail).join(' ')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
