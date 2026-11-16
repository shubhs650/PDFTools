// About's build-time modules (M10-01, ADR-027 D-48), made by the
// third-party notices plugin in scripts/vite-assets.ts.

/** Every runtime package with its license texts (scripts/notices.ts `licenseData`). */
declare module 'virtual:open-source-licenses' {
  const data: {
    texts: string[];
    packages: {
      name: string;
      version: string;
      license: string;
      homepage?: string;
      texts: [string, number][];
    }[];
  };
  export default data;
}

/** The installed version and license of each "Built with" package. */
declare module 'virtual:built-with' {
  const data: Record<string, { version: string; license: string }>;
  export default data;
}
