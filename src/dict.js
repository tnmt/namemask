/**
 * 固有名詞マスキング辞書。
 * mask-dict.yaml の `replacements` (表記 → 役割語) を受け取り、既知の固有名詞を決定的に置換する。
 * キーを "/pattern/flags" で囲むと正規表現として扱い、g・u フラグを常に付与する。
 */

const REGEX_KEY = /^\/(.+)\/([a-z]*)$/;

/** "/pattern/flags" 形式のキーを RegExp にする（該当しなければ null） */
function parseRegexKey(key) {
	const m = REGEX_KEY.exec(key);
	if (!m) return null;
	const flags = [...new Set(m[2] + 'gu')].join('');
	return new RegExp(m[1], flags);
}

function parseWrap(wrap) {
	if (wrap === undefined || wrap === null || wrap === '') return null;
	const chars = [...wrap];
	if (chars.length !== 2) throw new Error('wrap には開き括弧と閉じ括弧の 2 文字を指定してください');
	return chars;
}

/**
 * 辞書をコンパイルする。プレーンキーはキー長の降順（「山田太郎」を「山田」より先に処理）、
 * 正規表現キーはその後に記載順で並べる。
 *
 * エラーメッセージにはキーそのものを含めない。キーは実名なので、ログ経由で外に出さないため
 * 何番目の項目かだけを示す。
 */
export function compileDict(replacements, { wrap } = {}) {
	const brackets = parseWrap(wrap);
	const raw = Object.entries(replacements ?? {}).map(([from, to], i) => ({ from, to, index: i + 1 }));
	for (const { from, to, index } of raw) {
		if (from.length === 0) throw new Error(`replacements の ${index} 番目: キーが空です`);
		if (typeof to !== 'string' || to.length === 0)
			throw new Error(`replacements の ${index} 番目: 置換先は空でない文字列にしてください`);
	}

	const plain = raw.filter(({ from }) => !REGEX_KEY.test(from)).sort((a, b) => b.from.length - a.from.length);
	const regex = raw.filter(({ from }) => REGEX_KEY.test(from));

	const rules = [...plain, ...regex].map(({ from, to, index }) => {
		let re = null;
		try {
			re = parseRegexKey(from);
		} catch (err) {
			// V8 のメッセージは "Invalid regular expression: /<pattern>/<flags>: <理由>" で、パターン（実名）を含む
			const reason = err.message.split(': ').at(-1);
			throw new Error(`replacements の ${index} 番目: 正規表現キーが不正です (${reason})`);
		}
		const token = brackets ? `${brackets[0]}${to}${brackets[1]}` : to;
		return { from, token, re, index };
	});

	// 置換後のトークンに辞書のキーがマッチすると、残留検査が置換済みの箇所を検出し続けてしまう
	if (brackets) {
		for (const rule of rules) {
			for (const { token } of rules) {
				if (matches(token, rule)) {
					throw new Error(`replacements の ${rule.index} 番目: キーが置換後のトークンにマッチします`);
				}
			}
		}
	}

	return { entries: rules.map(({ from, token }) => [from, token]), rules };
}

function matches(text, rule) {
	// search() は g フラグの lastIndex に影響されないため、同じ RegExp の再利用に安全
	return rule.re ? text.search(rule.re) !== -1 : text.includes(rule.from);
}

/**
 * 辞書を適用し、置換した語と回数を返す。プレーンキーは単純文字列置換
 * （日本語に単語境界はないため）、正規表現キーは正規表現置換
 */
export function applyMask(text, dict) {
	const applied = new Map();
	if (!dict) return { text, applied };
	let out = text;
	for (const { from, token, re } of dict.rules) {
		if (re) {
			const count = [...out.matchAll(re)].length;
			if (count > 0) {
				applied.set(from, count);
				out = out.replace(re, () => token);
			}
		} else {
			const parts = out.split(from);
			if (parts.length > 1) {
				applied.set(from, parts.length - 1);
				out = parts.join(token);
			}
		}
	}
	return { text: out, applied };
}

/** 辞書語が残っていないかを行単位でスキャンする */
export function scanResidual(text, dict) {
	if (!dict) return [];
	const hits = [];
	const lines = text.split('\n');
	for (const rule of dict.rules) {
		lines.forEach((line, i) => {
			if (matches(line, rule)) hits.push({ term: rule.from, line: i + 1 });
		});
	}
	return hits;
}

/** 辞書語に当たる箇所を固定の伏字に置き換える。ログに出す前に使う */
export function redact(text, dict, placeholder = '〈?〉') {
	let out = text;
	for (const { from, re } of dict.rules) {
		out = re ? out.replace(re, () => placeholder) : out.split(from).join(placeholder);
	}
	return out;
}
