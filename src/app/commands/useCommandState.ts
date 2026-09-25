import { useSyncExternalStore } from 'react';
import { appStore } from '../store/appStore';
import { documentStore } from '../store/documentStore';
import { commandState, subscribeCommands, type CommandState } from './dispatch';

function subscribe(onChange: () => void): () => void {
  const offs = [
    subscribeCommands(onChange),
    appStore.subscribe(onChange),
    documentStore.subscribe(onChange),
  ];
  return () => {
    for (const off of offs) off();
  };
}

/** Enabled/pressed state of a command, updated when stores or handlers change. */
export function useCommandState(id: string): CommandState {
  // Serialize to keep the snapshot stable between renders.
  const snapshot = useSyncExternalStore(subscribe, () => JSON.stringify(commandState(id)));
  return JSON.parse(snapshot) as CommandState;
}
