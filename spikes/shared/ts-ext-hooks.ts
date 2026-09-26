// Resolve hook for ts-ext.ts: a relative specifier without an extension that
// fails to resolve is retried with `.ts`, then `.tsx`.
interface Context {
  parentURL?: string;
}
type Next = (specifier: string, context: Context) => Promise<{ url: string }>;

export async function resolve(specifier: string, context: Context, next: Next) {
  try {
    return await next(specifier, context);
  } catch (err) {
    if (!/^\.{1,2}\//.test(specifier) || /\.[cm]?[jt]sx?$/.test(specifier)) throw err;
    for (const ext of ['.ts', '.tsx']) {
      try {
        return await next(specifier + ext, context);
      } catch {
        // try the next extension
      }
    }
    throw err;
  }
}
