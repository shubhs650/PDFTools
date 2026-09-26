// Files being opened and open failures, for the tab strip and the error
// dialog (M1-13). File names stay in the UI; never in reports (rule 10).
import { createStore, useStore } from 'zustand';
import type { OpenErrorKind } from './errors';
import { INITIAL, transition, type OpenEvent, type OpenPhase } from './openMachine';

export interface OpenJob {
  id: number;
  name: string;
  state: OpenPhase;
}

export interface OpenFailure {
  id: number;
  name: string;
  kind: OpenErrorKind;
}

interface OpenStoreState {
  jobs: OpenJob[];
  failures: OpenFailure[];
  /** Document whose close is waiting on Save / Don't save / Cancel. */
  closePrompt: string | null;
}

export const openStore = createStore<OpenStoreState>()(() => ({
  jobs: [],
  failures: [],
  closePrompt: null,
}));

export function useOpen<T>(selector: (s: OpenStoreState) => T): T {
  return useStore(openStore, selector);
}

let nextId = 1;

export function startJob(name: string): number {
  const id = nextId++;
  openStore.setState((s) => ({ jobs: [...s.jobs, { id, name, state: INITIAL }] }));
  return id;
}

/** Applies an event; final states leave the job list (errors move to failures). */
export function advance(id: number, event: OpenEvent): OpenPhase {
  let result: OpenPhase = INITIAL;
  openStore.setState((s) => {
    const job = s.jobs.find((j) => j.id === id);
    if (!job) return {};
    const state = transition(job.state, event);
    result = state;
    if (state.phase === 'reading' || state.phase === 'opening' || state.phase === 'password') {
      return { jobs: s.jobs.map((j) => (j.id === id ? { ...j, state } : j)) };
    }
    return {
      jobs: s.jobs.filter((j) => j.id !== id),
      failures:
        state.phase === 'error'
          ? [...s.failures, { id, name: job.name, kind: state.kind }]
          : s.failures,
    };
  });
  return result;
}

export function dismissFailure(id: number): void {
  openStore.setState((s) => ({ failures: s.failures.filter((f) => f.id !== id) }));
}

/** The file waiting for its open password (one at a time: files open in order). */
export const selectPasswordJob = (s: OpenStoreState): OpenJob | undefined =>
  s.jobs.find((j) => j.state.phase === 'password');
