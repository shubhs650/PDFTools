// Open-password requests (D-19, §7.12). The open pipeline waits on
// `askPassword`; the password dialog answers. The password is handed straight
// to the engine and never stored by this module (M2-Q7).
const waiting = new Map<number, (password: string | null) => void>();

/** Resolves with the password the user typed, or null if they cancelled. */
export function askPassword(jobId: number): Promise<string | null> {
  return new Promise((resolve) => {
    waiting.set(jobId, resolve);
  });
}

export function answerPassword(jobId: number, password: string | null): void {
  const resolve = waiting.get(jobId);
  waiting.delete(jobId);
  resolve?.(password);
}
