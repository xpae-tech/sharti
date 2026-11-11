// Ambient module declarations so TypeScript accepts static asset imports.
// Needed because frontend/tsconfig.json has "types": [] and no CSS typing.

declare module '*.css';

/** Injected by Vite from package.json (see vite.config.ts). */
declare const __APP_VERSION__: string;
