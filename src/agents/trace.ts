import type { AgentId, AgentStep, AgentStepStatus, AgentTrace, Grounding, Reference } from './types';

const clockMs = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export interface StepResult<T> {
  value: T;
  summary: string;
  status?: AgentStepStatus;
  confidence?: number | null;
  references?: Reference[];
}

/**
 * Records one message's run through the agent mesh. Each `step` times an agent, keeps its
 * summary and the references it produced, and turns a thrown error into a FAILED step so one
 * agent's failure is visible in the trace instead of hiding the rest of the run.
 */
export class AgentRun {
  private readonly steps: AgentStep[] = [];
  private readonly references = new Map<string, Reference>();
  private readonly startedAt = clockMs();

  async step<T>(agent: AgentId, run: () => Promise<StepResult<T>>, onError: (error: unknown) => T): Promise<T> {
    const started = clockMs();
    try {
      const result = await run();
      this.record(agent, result.status ?? 'DONE', result.summary, clockMs() - started, result.confidence ?? null, result.references ?? []);
      return result.value;
    } catch (error: unknown) {
      this.record(agent, 'FAILED', 'This step failed. The rest of the run continued without it.', clockMs() - started, null, []);
      return onError(error);
    }
  }

  record(
    agent: AgentId,
    status: AgentStepStatus,
    summary: string,
    durationMs = 0,
    confidence: number | null = null,
    references: Reference[] = [],
  ): void {
    for (const r of references) this.references.set(r.id, r);
    this.steps.push({
      agent,
      status,
      summary: summary.slice(0, 280),
      durationMs: Math.max(0, Math.round(durationMs * 10) / 10),
      confidence: confidence === null ? null : Math.round(confidence * 100) / 100,
      referenceIds: references.map((r) => r.id),
    });
  }

  /** References in first-cited order. The reply's [n] markers index into this list. */
  citations(): Reference[] {
    return [...this.references.values()];
  }

  finish(grounding: Grounding): AgentTrace {
    return {
      steps: this.steps.slice(),
      references: this.citations().slice(0, 8),
      grounding,
      totalMs: Math.round((clockMs() - this.startedAt) * 10) / 10,
    };
  }
}
