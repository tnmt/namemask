import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyMask, compileDict, redact, scanResidual } from '../src/dict.js';

// tnmt.info の journal-import (mask.ts) のテストと同じ入出力になることを確かめる
const dict = compileDict({ 山田: '同僚', 山田太郎: '同僚', OKストア: '近所のスーパー' });

describe('applyMask', () => {
	it('長いキーから順に置換する', () => {
		const { text, applied } = applyMask('山田太郎と山田とOKストアに行った。', dict);
		assert.equal(text, '同僚と同僚と近所のスーパーに行った。');
		assert.equal(applied.get('山田太郎'), 1);
		assert.equal(applied.get('山田'), 1);
		assert.equal(applied.get('OKストア'), 1);
	});

	it('辞書が null なら何もしない', () => {
		const { text, applied } = applyMask('山田太郎', null);
		assert.equal(text, '山田太郎');
		assert.equal(applied.size, 0);
	});
});

const GAKU_REGEX = '/(?<!\\p{sc=Han})学(?![\\p{sc=Han}ぶび])/';
const regexDict = compileDict({ [GAKU_REGEX]: '息子', 山田学: '息子' });

describe('applyMask (正規表現キー)', () => {
	it('正規表現キーはプレーンキーの後ろに記載順で並べる', () => {
		const d = compileDict({ '/学(?!校)/': '息子', 山田: '同僚', '/花(?!火)/': '娘' });
		assert.deepEqual(
			d.entries.map(([k]) => k),
			['山田', '/学(?!校)/', '/花(?!火)/']
		);
	});

	it('熟語や送り仮名を避けて単漢字の名前だけを置換する', () => {
		const { text, applied } = applyMask('学校で学に会った。学は学びが好きで、大学の学園祭にも行った。', regexDict);
		assert.equal(text, '学校で息子に会った。息子は学びが好きで、大学の学園祭にも行った。');
		assert.equal(applied.get(GAKU_REGEX), 2);
	});

	it('前に漢字が続く場合はプレーンなフルネームのエントリで拾う', () => {
		const { text, applied } = applyMask('山田学と出かけた。', regexDict);
		assert.equal(text, '息子と出かけた。');
		assert.equal(applied.get('山田学'), 1);
		assert.equal(applied.get(GAKU_REGEX), undefined);
	});

	it('文末・行頭の裸の名前も置換する', () => {
		const { text } = applyMask('学\n迎えに行ったのは学。', regexDict);
		assert.equal(text, '息子\n迎えに行ったのは息子。');
	});

	it('置換先の $ を置換パターンとして解釈しない', () => {
		const d = compileDict({ '/学/': '$&' });
		assert.equal(applyMask('学', d).text, '$&');
	});

	it('不正な正規表現キーはエラーにし、キーをメッセージに含めない', () => {
		assert.throws(
			() => compileDict({ 山田: '同僚', '/学(?!/': '息子' }),
			(err) => /2 番目: 正規表現キーが不正/.test(err.message) && !err.message.includes('学')
		);
	});
});

describe('compileDict (wrap)', () => {
	it('置換先を括弧で包む', () => {
		const d = compileDict({ 山田花子: '妻', 太郎: '長男' }, { wrap: '〈〉' });
		assert.equal(applyMask('山田花子と太郎が来た', d).text, '〈妻〉と〈長男〉が来た');
	});

	it('キーが置換後のトークンにマッチする辞書は拒否する', () => {
		assert.throws(() => compileDict({ 山田花子: '妻', 妻: '配偶者' }, { wrap: '〈〉' }), /キーが置換後のトークンにマッチ/);
		assert.throws(() => compileDict({ '/長./': '長男' }, { wrap: '〈〉' }), /1 番目/);
	});

	it('wrap は 2 文字だけ受け付ける', () => {
		assert.throws(() => compileDict({ 山田: '同僚' }, { wrap: '〈' }), /2 文字/);
	});

	it('置換先が空の項目は拒否する', () => {
		assert.throws(() => compileDict({ 山田: '' }), /空でない文字列/);
	});
});

describe('scanResidual', () => {
	it('残存する辞書語を行番号付きで検出する', () => {
		assert.deepEqual(scanResidual('一行目\n山田がいた\n三行目', dict), [{ term: '山田', line: 2 }]);
	});

	it('残存が無ければ空配列', () => {
		assert.deepEqual(scanResidual('同僚と行った', dict), []);
	});

	it('正規表現キーは同じパターンでスキャンする（熟語は誤検知しない）', () => {
		assert.deepEqual(scanResidual('学びの秋が来た。学校に行った。', regexDict), []);
		assert.deepEqual(scanResidual('一行目\n学が寝た\n学びの朝', regexDict), [{ term: GAKU_REGEX, line: 2 }]);
	});
});

describe('redact', () => {
	it('辞書語を伏字にする', () => {
		assert.equal(redact('日記/山田太郎と学.md', compileDict({ 山田太郎: '同僚', [GAKU_REGEX]: '息子' })), '日記/〈?〉と〈?〉.md');
	});
});
