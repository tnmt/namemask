# namemask

辞書に従って、テキストやファイルツリーに含まれる既知の固有名詞を役割語に置き換え、
置換漏れ（残留）を検査するツール。日記やノートを LLM やブログに渡す前の前処理に使う。

rsync・git・同期といった周辺処理は持たない。呼び出し側で組み合わせる。

## 辞書

```yaml
replacements:
  "山田太郎": 同僚
  "山田": 同僚
  "OKストア": スーパー
  # キーを /.../ で囲むと正規表現として扱う（g・u フラグは自動付与。YAML はシングルクォート推奨）。
  # 例: 単漢字の名前「学」を、熟語（学校・大学）や送り仮名（学ぶ・学び）を避けて置換する:
  '/(?<!\p{sc=Han})学(?![\p{sc=Han}ぶび])/': 息子
```

- プレーンなキーはキー長の降順、正規表現キーはその後に記載順で、逐次置換する
- 日本語には単語境界がないので、プレーンなキーは単純な部分文字列置換になる。
  ひらがな・あだ名など普通の語に誤爆しやすい短い表記は、lookaround 付きの正規表現キーで書く
- 正規表現は JavaScript の構文で解釈する
- `--wrap 〈〉` を付けると置換先を `〈同僚〉` のように包む。このとき、どのキーも包んだ後の
  トークンにマッチしないことを読み込み時に検査する
- エラーメッセージやログにはキーを出さず、何番目の項目かだけを示す

## CLI

```sh
namemask text --dict mask-dict.yaml [--wrap 〈〉] < in.md > out.md
namemask tree --dict mask-dict.yaml [--wrap 〈〉] [--text-ext md]... SRC DST
namemask scan --dict mask-dict.yaml DIR
```

- `tree`: DST を作り直し、SRC のファイル名・ディレクトリ名と、テキスト拡張子
  （既定 `md canvas base txt csv json yaml yml`）の本文を置換して書き出す。
  それ以外のファイルはそのままコピーし、symlink は辿らない。
  別々の表記が同じパスに畳まれる場合はエラーにする。
  Obsidian の `[[wikilink]]` もファイル名と同じ規則で置換されるので、リンクは切れない
- `scan`: DIR 以下の全ファイルの本文（非テキストも UTF-8 として読む）とパスに辞書語が残っていれば、
  伏字にしたパスと行番号を出して exit 1 で終わる
- 辞書が空なら、どのコマンドも exit 2 で止まる

YAML の読み込みに [yq](https://github.com/mikefarah/yq) を使う。拡張子が `.json` の辞書なら不要。

## ライブラリ

```js
import { compileDict, applyMask, scanResidual, maskTree, scanTree } from 'namemask';

const dict = compileDict({ 山田太郎: '同僚' }, { wrap: '〈〉' });
applyMask('山田太郎と会った', dict).text; // => '〈同僚〉と会った'
```

## Nix

```nix
inputs.namemask.url = "github:tnmt/namemask";
# inputs.namemask.packages.${system}.default
```

`nix flake check` でテストが走る。
