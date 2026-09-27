// Loads a document's properties from the Work worker (M2-12), again when
// its saved state changes (a save adds a revision). Shared by File →
// Properties and Protect → Security Info.
import { useEffect, useState } from 'react';
import { useDocuments } from '../../app/store/documentStore';
import type { DocProperties } from '../../workers/work/properties';
import { workClient } from '../view/host';

export type PropertiesState =
  { state: 'loading' } | { state: 'ready'; props: DocProperties } | { state: 'failed' };

export function useDocProperties(docId: string | null): PropertiesState {
  const saves = useDocuments((s) => (docId ? (s.docs[docId]?.appendedBytes ?? 0) : 0));
  const [result, setResult] = useState<{ key: string; value: PropertiesState } | null>(null);
  const key = `${docId ?? ''}|${String(saves)}`;
  useEffect(() => {
    if (!docId) return;
    const job = workClient().run('docProperties', { docId });
    job.promise.then(
      (props) => {
        setResult({ key, value: { state: 'ready', props } });
      },
      () => {
        setResult({ key, value: { state: 'failed' } });
      },
    );
    return () => {
      job.cancel();
    };
  }, [docId, key]);
  return result?.key === key ? result.value : { state: 'loading' };
}
