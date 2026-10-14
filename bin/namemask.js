#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { applyMask, compileDict } from '../src/dict.js';
import { DEFAULT_TEXT_EXTENSIONS, maskTree, scanTree } from '../src/tree.js';

const USAGE = `usage:
  namemask text --dict FILE [--wrap 〈〉]              stdin を置換して stdout へ
  namemask tree --dict FILE [--wrap 〈〉] [--text-ext EXT]... SRC DST
  namemask scan --dict FILE [--wrap 〈〉] DIR          残留があれば exit 1

FILE は mask-dict.yaml 形式（replacements: の下に "表記": 役割語）。
.json 以外は PATH 上の yq (mikefarah/yq) で JSON に変換して読む。`;

// yq や JSON.parse のエラーは辞書の該当行（実名）を含みうるので、詳細を捨てて固定文言にする
function loadReplacements(file) {
	let json;
	if (file.endsWith('.json')) {
		json = fs.readFileSync(file, 'utf-8');
	} else {
		try {
			json = execFileSync('yq', ['-o=json', '.', file], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
		} catch (err) {
			throw new Error(`辞書を読めません (yq: ${err.code ?? `exit ${err.status}`})`);
		}
	}
	let doc;
	try {
		doc = JSON.parse(json);
	} catch {
		throw new Error('辞書を JSON として解釈できません');
	}
	return doc?.replacements ?? {};
}

function main(argv) {
	const { values, positionals } = parseArgs({
		args: argv,
		allowPositionals: true,
		options: {
			dict: { type: 'string' },
			wrap: { type: 'string' },
			'text-ext': { type: 'string', multiple: true },
			help: { type: 'boolean', short: 'h' }
		}
	});
	const [command, ...rest] = positionals;
	if (values.help || !command) {
		console.log(USAGE);
		return values.help ? 0 : 2;
	}
	if (!values.dict) throw new Error('--dict を指定してください');

	const dict = compileDict(loadReplacements(values.dict), { wrap: values.wrap });
	// 辞書が空のまま走ると何も置換されずに素通しになるので、配布ミスを疑って止める
	if (dict.rules.length === 0) throw new Error('辞書が空です');

	switch (command) {
		case 'text': {
			process.stdout.write(applyMask(fs.readFileSync(0, 'utf-8'), dict).text);
			return 0;
		}
		case 'tree': {
			if (rest.length !== 2) throw new Error('tree には SRC と DST を指定してください');
			maskTree(rest[0], rest[1], dict, { textExtensions: values['text-ext'] ?? DEFAULT_TEXT_EXTENSIONS });
			return 0;
		}
		case 'scan': {
			if (rest.length !== 1) throw new Error('scan には DIR を指定してください');
			const hits = scanTree(rest[0], dict);
			for (const { path, line } of hits) {
				console.error(line === 0 ? `residue: ${path} (path)` : `residue: ${path}:${line}`);
			}
			if (hits.length > 0) {
				console.error(`namemask: ${hits.length} residue(s) found`);
				return 1;
			}
			return 0;
		}
		default:
			throw new Error(`不明なコマンドです: ${command}`);
	}
}

try {
	process.exitCode = main(process.argv.slice(2));
} catch (err) {
	console.error(`namemask: ${err.message}`);
	process.exitCode = 2;
}
