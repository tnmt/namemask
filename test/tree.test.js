import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { compileDict } from '../src/dict.js';
import { maskTree, scanTree } from '../src/tree.js';

const BIN = fileURLToPath(new URL('../bin/namemask.js', import.meta.url));

const replacements = {
	山田花子: '妻',
	花子: '妻',
	'/(?<![ぁ-ん])はなちゃん/': '妻',
	山田一郎: '長男'
};
const dict = compileDict(replacements, { wrap: '〈〉' });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'namemask-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function write(root, rel, content) {
	const file = path.join(root, rel);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, content);
}

function listTree(root) {
	return fs.readdirSync(root, { recursive: true }).map((p) => p.split(path.sep).join('/')).sort();
}

function makeVault(name) {
	const vault = path.join(tmp, name);
	write(vault, 'Daily/2026-10-01.md', '今日は[[山田花子]]と公園へ。はなちゃんは元気。おはなちゃんの絵本を読んだ。\n');
	write(vault, '山田花子.md', '# 山田花子\n誕生日のメモ\n');
	write(vault, '山田一郎/学校.md', '[[山田一郎/学校|一郎の学校]] 参照\n');
	write(vault, 'board.canvas', JSON.stringify({ nodes: [{ text: '花子の予定' }] }));
	write(vault, 'image.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]));
	return vault;
}

describe('maskTree', () => {
	const vault = makeVault('vault');
	const out = path.join(tmp, 'masked');
	maskTree(vault, out, dict);

	it('ファイル名とディレクトリ名を置換する', () => {
		assert.deepEqual(listTree(out), [
			'Daily',
			'Daily/2026-10-01.md',
			'board.canvas',
			'image.png',
			'〈妻〉.md',
			'〈長男〉',
			'〈長男〉/学校.md'
		]);
	});

	it('本文を置換し、正規表現の境界外は残す', () => {
		assert.equal(
			fs.readFileSync(path.join(out, 'Daily/2026-10-01.md'), 'utf-8'),
			'今日は[[〈妻〉]]と公園へ。〈妻〉は元気。おはなちゃんの絵本を読んだ。\n'
		);
		assert.match(fs.readFileSync(path.join(out, 'board.canvas'), 'utf-8'), /〈妻〉の予定/);
	});

	it('wikilink の参照先がリネーム後のファイルと一致する', () => {
		const daily = fs.readFileSync(path.join(out, 'Daily/2026-10-01.md'), 'utf-8');
		const target = /\[\[([^\]|]+)\]\]/.exec(daily)[1];
		assert.ok(fs.existsSync(path.join(out, `${target}.md`)));
		const school = fs.readFileSync(path.join(out, '〈長男〉/学校.md'), 'utf-8');
		const schoolTarget = /\[\[([^\]|]+)\|/.exec(school)[1];
		assert.ok(fs.existsSync(path.join(out, `${schoolTarget}.md`)));
	});

	it('非テキストはそのままコピーする', () => {
		assert.deepEqual(fs.readFileSync(path.join(out, 'image.png')), fs.readFileSync(path.join(vault, 'image.png')));
	});

	it('dst にあった古いファイルを残さない', () => {
		write(out, 'stale.md', 'old');
		maskTree(vault, out, dict);
		assert.ok(!fs.existsSync(path.join(out, 'stale.md')));
	});

	it('置換後のパスが衝突したら止める', () => {
		const v = path.join(tmp, 'collide');
		write(v, '花子.md', 'a');
		write(v, '山田花子.md', 'b');
		assert.throws(() => maskTree(v, path.join(tmp, 'collide-out'), dict), /衝突/);
	});

	it('symlink は辿らない', () => {
		const v = path.join(tmp, 'link');
		write(v, 'note.md', 'x');
		fs.symlinkSync('/etc', path.join(v, 'etc'));
		const o = path.join(tmp, 'link-out');
		maskTree(v, o, dict);
		assert.deepEqual(listTree(o), ['note.md']);
	});
});

describe('scanTree', () => {
	it('置換後のツリーには残留がない', () => {
		const out = path.join(tmp, 'scan-clean');
		maskTree(makeVault('vault2'), out, dict);
		assert.deepEqual(scanTree(out, dict), []);
	});

	it('本文・パス・バイナリの残留を伏字パスで返す', () => {
		const dir = path.join(tmp, 'residue');
		write(dir, 'ok/note.md', '一行目\n二行目 花子\n');
		write(dir, '山田一郎/a.md', 'x');
		write(dir, 'doc.pdf', Buffer.concat([Buffer.from([0x25, 0x50, 0xff]), Buffer.from('山田花子')]));
		const hits = scanTree(dir, dict);
		assert.deepEqual(hits, [
			{ path: 'doc.pdf', line: 1 },
			{ path: 'ok/note.md', line: 2 },
			{ path: '〈?〉', line: 0 },
			{ path: '〈?〉/a.md', line: 0 }
		]);
		assert.ok(!JSON.stringify(hits).includes('花子'));
	});
});

describe('CLI', () => {
	const dictFile = path.join(tmp, 'mask-dict.json');
	fs.writeFileSync(dictFile, JSON.stringify({ replacements }));
	const run = (...args) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf-8' });

	it('tree と scan', () => {
		const out = path.join(tmp, 'cli-out');
		assert.equal(run('tree', '--dict', dictFile, '--wrap', '〈〉', makeVault('vault3'), out).status, 0);
		const r = run('scan', '--dict', dictFile, '--wrap', '〈〉', out);
		assert.equal(r.status, 0, r.stderr);
	});

	it('残留があれば exit 1 で、出力に実名を含めない', () => {
		const dir = path.join(tmp, 'cli-residue');
		write(dir, '山田花子/日記.md', 'はなちゃんと散歩\n');
		const r = run('scan', '--dict', dictFile, dir);
		assert.equal(r.status, 1);
		assert.match(r.stderr, /residue: 〈\?〉 \(path\)/);
		assert.match(r.stderr, /residue: 〈\?〉\/日記\.md:1/);
		assert.ok(!/花子|はな/.test(r.stdout + r.stderr));
	});

	const hasYq = spawnSync('yq', ['--version']).status === 0;
	it('YAML の辞書を yq 経由で読む', { skip: !hasYq && 'yq がない' }, () => {
		const yaml = path.join(tmp, 'mask-dict.yaml');
		fs.writeFileSync(yaml, "replacements:\n  '/(?<!\\p{sc=Han})花(?!火)/': 娘\n  \"山田\": 同僚\n");
		const r = spawnSync(process.execPath, [BIN, 'text', '--dict', yaml, '--wrap', '〈〉'], {
			input: '山田と花が花火を見た',
			encoding: 'utf-8'
		});
		assert.equal(r.stdout, '〈同僚〉と〈娘〉が花火を見た', r.stderr);
	});

	it('読めない YAML は中身を出さずに止める', { skip: !hasYq && 'yq がない' }, () => {
		const yaml = path.join(tmp, 'broken.yaml');
		fs.writeFileSync(yaml, 'replacements:\n  "山田花子": [\n');
		const r = run('scan', '--dict', yaml, tmp);
		assert.equal(r.status, 2);
		assert.ok(!r.stderr.includes('花子'), r.stderr);
	});

	it('辞書が空なら止める', () => {
		const empty = path.join(tmp, 'empty.json');
		fs.writeFileSync(empty, '{}');
		const r = run('scan', '--dict', empty, tmp);
		assert.equal(r.status, 2);
		assert.match(r.stderr, /辞書が空/);
	});

	it('text は stdin を置換する', () => {
		const r = spawnSync(process.execPath, [BIN, 'text', '--dict', dictFile], { input: '山田一郎と花子', encoding: 'utf-8' });
		assert.equal(r.stdout, '長男と妻');
	});
});
