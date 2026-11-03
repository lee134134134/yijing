# PDF 语料工程

将 `pdf/` 下的书籍转成可检索、可引用到页码的 Markdown。

## 目录

```
corpus/
  manifest.yaml           # 语料台账(入库 gin 跟踪)
  config/<bookId>.yaml    # 单本切分规则(可选)
  <bookId>/*.md           # 生成的章节(不入库)
  qa/<bookId>.md          # 逐本 QA 报告(不入库)
  ocr-needed/<bookId>.txt # 需 OCR 的页码(不入库)
```

## 使用

```bash
# 1. 扫描 pdf/ 生成台账(会保留已有的 scope/duplicateOf 人工修改)
npm run pdf:inventory

# 2. 先处理核心书目(倪海厦系列)
npm run pdf2md -- --all --scope core

# 3. 单本重跑
npm run pdf2md -- --book <bookId>

# 4. 全量(含传统典籍,耗时较长)
npm run pdf:build
```

## 单本切分规则

默认按 `第X章/卷/篇`、`【标题】`、数字编号切分。若某本书标题格式不同,新增：

```yaml
# corpus/config/<bookId>.yaml
headingPattern: '^(辨(太阳|阳明|少阳|太阴|少阴|厥阴).{0,30}病脉证并治.{0,10})$'
```

`bookId` 见 `corpus/manifest.yaml`。

## QA 门禁

每本产出 `corpus/qa/<bookId>.md`：

- 页数 / 文字层覆盖率
- 需 OCR 页码
- 章节数 / 文件数 / 字符数
- 结果：通过 / 未通过

文字层覆盖率 < 98% 视为未通过。扫描件不会伪造内容,只会写入 `ocr-needed` 清单。

## 当前状态（2026-11-03）

- 台账：40 本（`0611` 倪海厦系列 = core，`0612` 传统典籍 = reference）
- 文字层可用：13/40（core 11 本全部可用，含 OCR 后的《天机道》；reference 2 本）
- 需 OCR：27 本（均在 reference，多为扫描版）
- 已产出：约 6.9MB、280+ 章节 Markdown；逐本报告 `corpus/qa/*.md`
- 索引：已 ingest 4086 个知识块（含摘要层 + 全文层），FTS5 同量
- 检索基线：`npm run eval` → recall@5 100%（16 条种子题）、无答案准确率 100%

## OCR（macOS PDFKit + RapidOCR）

无需 tesseract/poppler：

```bash
# 1. 安装 Python 依赖(若证书报错,加 --trusted-host pypi.org --trusted-host files.pythonhosted.org)
npm run ocr:setup

# 2. 编译 Swift 渲染器(首次会自动编译;也可手动)
npm run ocr:build

# 3. 对无文字层书目批量 OCR
npm run pdf:ocr -- --scope core
# 或单本
npm run pdf2md -- --ocr <bookId>
```

实现：
- 渲染:PDFKit 逐页转 PNG(默认 1800px 宽)
- 识别:RapidOCR;竖排文本按列重排(右列优先,同列自上而下)
- 断点续跑:`corpus/ocr/<bookId>/page-XXXX.txt`
- 依赖:Xcode Command Line Tools + Python 3.11

扫描件不会被伪造为正文;OCR 后 QA 覆盖率 < 98% 仍会标记未通过。

## 入库

`src/ingestion/corpus-loader.ts` 会读取 `corpus/**/*.md` 的 front-matter：

```yaml
book: 伤寒论
chapter: 辨太阳病
pageStart: 3
pageEnd: 5
```

映射为 `KnowledgeMetadata` 的 `book/chapter/pageStart/pageEnd/layer=fulltext`，
与 `memory/` 的 `layer=curated` 摘要共存。引用会带 `book + page`。

## 已知限制

- 标题识别是启发式,不同版本需人工调 `headingPattern`
- 繁体原文保留,未做简体转换（引用保真优先）
- 页眉页脚按“跨页重复”规则清理,极端排版需人工抽查
- 未做目录/页码偏移校准,`pageStart/pageEnd` 是 PDF 物理页
