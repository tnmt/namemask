import type { MaskDict } from './dict.js';

export const DEFAULT_TEXT_EXTENSIONS: string[];

export function maskTree(src: string, dst: string, dict: MaskDict, options?: { textExtensions?: string[] }): void;

export function scanTree(dir: string, dict: MaskDict): { path: string; line: number }[];
