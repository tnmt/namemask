export interface MaskRule {
	from: string;
	token: string;
	re: RegExp | null;
	index: number;
}

export interface MaskDict {
	/** [置換元, 置換先]。適用順に並ぶ */
	entries: [string, string][];
	rules: MaskRule[];
}

export interface CompileOptions {
	/** 置換先を包む開き括弧と閉じ括弧の 2 文字（例: "〈〉"） */
	wrap?: string;
}

export function compileDict(replacements: Record<string, string> | null | undefined, options?: CompileOptions): MaskDict;

export function applyMask(text: string, dict: MaskDict | null): { text: string; applied: Map<string, number> };

export function scanResidual(text: string, dict: MaskDict | null): { term: string; line: number }[];

export function redact(text: string, dict: MaskDict, placeholder?: string): string;
