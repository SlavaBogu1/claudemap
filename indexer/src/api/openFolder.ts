import { exec } from "node:child_process";

export type OpenFolderFn = (targetPath: string) => void;

/** Windows: launch the OS file explorer at a real folder path. Never invoked directly in tests. */
export const defaultOpenFolder: OpenFolderFn = (targetPath: string) => {
  exec(`explorer.exe "${targetPath}"`);
};
