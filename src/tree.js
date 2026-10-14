import fs from 'node:fs';
import path from 'node:path';
import { applyMask, redact, scanResidual } from './dict.js';

export const DEFAULT_TEXT_EXTENSIONS = ['md', 'canvas', 'base', 'txt', 'csv', 'json', 'yaml', 'yml'];

const strictUtf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const lenientUtf8 = new TextDecoder('utf-8', { ignoreBOM: true });

/** dir 以下の通常ファイルとディレクトリを、相対パスの辞書順で列挙する。symlink 等は含めない */
function* walk(root, rel = '') {
	const entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
	entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
	for (const entry of entries) {
		const childRel = rel === '' ? entry.name : `${rel}/${entry.name}`;
		if (entry.isDirectory()) {
			yield { rel: childRel, type: 'dir' };
			yield* walk(root, childRel);
		} else if (entry.isFile()) {
			yield { rel: childRel, type: 'file' };
		}
	}
}

function maskName(name, dict) {
	const masked = applyMask(name, dict).text;
	if (masked === '' || masked === '.' || masked === '..' || masked.includes('/') || masked.includes('\0')) {
		throw new Error('置換後のファイル名が不正です');
	}
	return masked;
}

function isTextPath(rel, textExtensions) {
	const ext = path.posix.extname(rel).slice(1).toLowerCase();
	return textExtensions.has(ext);
}

/**
 * src のツリーを、パスの各要素と本文を置換しながら dst へ書き出す。dst は毎回作り直す。
 * テキスト拡張子のファイルのうち UTF-8 として読めるものだけ本文を置換し、それ以外はそのままコピーする
 * （残留していれば scanTree が検出する）。
 */
export function maskTree(src, dst, dict, { textExtensions = DEFAULT_TEXT_EXTENSIONS } = {}) {
	const exts = new Set(textExtensions.map((e) => e.toLowerCase()));
	const srcAbs = path.resolve(src);
	const dstAbs = path.resolve(dst);
	if (dstAbs === srcAbs || dstAbs.startsWith(srcAbs + path.sep) || srcAbs.startsWith(dstAbs + path.sep)) {
		throw new Error('src と dst は互いに含まない別のディレクトリにしてください');
	}

	fs.rmSync(dstAbs, { recursive: true, force: true });
	fs.mkdirSync(dstAbs, { recursive: true });

	// 別々の表記（例: 漢字とひらがな）が同じトークンに畳まれると、ファイルが上書きされて消える
	const maskedRelOf = new Map([['', '']]);
	const seen = new Set();
	for (const { rel, type } of walk(srcAbs)) {
		const parent = path.posix.dirname(rel);
		const maskedParent = maskedRelOf.get(parent === '.' ? '' : parent);
		const name = maskName(path.posix.basename(rel), dict);
		const maskedRel = maskedParent === '' ? name : `${maskedParent}/${name}`;
		if (seen.has(maskedRel)) throw new Error(`置換後のパスが衝突します: ${redact(maskedRel, dict)}`);
		seen.add(maskedRel);

		const out = path.join(dstAbs, maskedRel);
		if (type === 'dir') {
			maskedRelOf.set(rel, maskedRel);
			fs.mkdirSync(out);
			continue;
		}
		const buf = fs.readFileSync(path.join(srcAbs, rel));
		let text = null;
		if (isTextPath(rel, exts)) {
			try {
				text = strictUtf8.decode(buf);
			} catch {
				text = null;
			}
		}
		if (text === null) fs.writeFileSync(out, buf);
		else fs.writeFileSync(out, applyMask(text, dict).text);
	}
}

/**
 * dir 以下の全ファイルの本文（バイナリも UTF-8 として読む）とパスに辞書語が残っていないか検査する。
 * 返す path は辞書語を伏字にしたもので、term は含めない（呼び出し側がそのままログに出せるように）。
 * line が 0 のヒットはパス自体の残留を表す。
 */
export function scanTree(dir, dict) {
	const root = path.resolve(dir);
	const hits = [];
	for (const { rel, type } of walk(root)) {
		const pathHit = scanResidual(rel, dict).length > 0;
		const shown = pathHit ? redact(rel, dict) : rel;
		if (pathHit) hits.push({ path: shown, line: 0 });
		if (type !== 'file') continue;
		const text = lenientUtf8.decode(fs.readFileSync(path.join(root, rel)));
		const lines = new Set(scanResidual(text, dict).map((h) => h.line));
		for (const line of [...lines].sort((a, b) => a - b)) hits.push({ path: shown, line });
	}
	return hits;
}
