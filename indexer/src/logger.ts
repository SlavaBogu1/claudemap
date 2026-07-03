// Minimal injectable logger so tests can assert on warnings without spying on console globals.
export interface Logger {
  warn(message: string): void;
  info(message: string): void;
}

export const consoleLogger: Logger = {
  warn: (message: string) => console.warn(`[indexer] WARN ${message}`),
  info: (message: string) => console.info(`[indexer] ${message}`)
};
