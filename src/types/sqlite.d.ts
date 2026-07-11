// Ambient types for the experimental node:sqlite module (not yet in @types/node).
declare module 'node:sqlite' {
  export interface StatementSync {
    run(...params: unknown[]): unknown;
    get(...params: unknown[]): Record<string, unknown> | null;
    all(...params: unknown[]): Array<Record<string, unknown>>;
    iterate(...params: unknown[]): IterableIterator<Record<string, unknown>>;
  }
  export class DatabaseSync {
    constructor(path: string, options?: Record<string, unknown>);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
