# 两个严重 BUG 的定位与修复方案（待审核）

> 状态更新（2026-11-05）：已按本方案实施并通过验证，实测数据与改动清单见
> [`BUGFIX-2026-11-05-mermaid-scroll.md`](./BUGFIX-2026-11-05-mermaid-scroll.md)。

测试对象：`C端APP整体设计方案-v0.1.md`（856 行 / 102 KB / 43,566 字符）
测试基线：本地源码 v2.0.57 + Chromium 浏览器预览（1280×720）。用户实测为 v2.1.13 客户端；作者已确认 2.0.58 起的代码在本地、没有 PR，因此无法逐行比对，但两边症状一致（见文末「与 2.1.13 的关系」）。
结论等级：BUG 2 已完整复现并量化；BUG 1 已定位到临界裁切，用户环境的裁切量取决于字体与系统缩放。

---

## BUG 1：Mermaid 图显示不完整

### 现象

图底部（或右侧）被切掉，节点边框缺失，滚动也无法看到被切部分。

### 复现与证据

用 Chromium 1280×720 打开该文件、滚到第一个 Mermaid 图后测量：

| 指标 | 图 1（flowchart TB） | 图 2（flowchart LR） |
| --- | --- | --- |
| SVG viewBox | `0 0 1316.08 631.40` | `0 0 1775.09 315.80` |
| 实际内容 bbox | `x=8 y=8 w=1300.08 h=615.40` | `x=8 y=8 w=1759.09 h=299.80` |
| 内容底边到 viewBox 底边 | **8 单位（约 7 px）** | **8 单位** |
| 内容右边到 viewBox 右边 | **8 单位** | **8 单位** |
| SVG 计算样式 overflow | `hidden / hidden` | `hidden / hidden` |

图 1 的元素截图里，最底一排节点（统一供给 / 交易履约引擎 / 画像授权分层 …）的下边框已经贴着容器边缘、被切掉——这就是 8 px 余量被吃光的表现。截图见 `.workbuddy/probe/mermaid-0.png`。

### 根因

1. Mermaid 生成 SVG 时，viewBox 按自己的布局尺寸加**固定 8 单位内边距**计算，不按实际字形边界。
2. SVG 根元素是 `overflow: hidden`（浏览器默认），超出 viewBox 的部分**在 SVG 内部就被裁掉**。外层 `.xmd-cm-mermaid-preview` 虽然设了 `overflow: auto`，但拿不到已被 SVG 裁掉的内容，所以滚动也看不到。
3. `applyRenderedMermaidSvg`（`src/features/cm6-editor/mermaidPreview.ts:227`）只做了三件事：删 `height` 属性、设 `preserveAspectRatio`、移除内联 height。**从不校正 viewBox**。删掉 height 之后，显示高度完全由 viewBox 的宽高比决定——viewBox 少了多少，图就少多少。
4. Mermaid 的字体是 `"trebuchet ms", verdana, arial, sans-serif`，中文全部走系统兜底字体。不同机器（微软雅黑 / 思源黑体 / 系统缩放 125%、150%）的字形宽度不同，只要实际宽度比 mermaid 测量值多 8 单位，就必然被裁。

也就是说：**这套渲染在字宽差异面前只有 8 px 容错，用户环境超出了这个容错**。我这边是临界状态（刚好切掉下边框），用户那边切得更多。

### 修复方案

**A1（立即止血，1 行 CSS）**

`src/features/cm6-editor/mermaidPreview.css` 的 `.xmd-cm-mermaid-content svg` 增加：

```css
overflow: visible;
```

超出 viewBox 的内容不再被 SVG 视口裁掉，会溢到 preview 的 18px padding 里，视觉上仍然有余量。
风险：极低。溢出极端时可能压到右上角两个按钮；按钮有底色，可接受。

**A2（根治，覆盖预览与导出）**

在 SVG 插入 DOM 后按真实几何重算 viewBox：

- 新增 `normalizeSvgViewport(svg: SVGSVGElement)`：读 `svg.getBBox()`，写回 `viewBox = [x-12, y-12, w+24, h+24]`，并打一个 `data-xmd-normalized` 标记避免重复执行。
- 调用点 1：`MermaidWidget` 里，`applyRenderedMermaidSvg` 之后用一个 `requestAnimationFrame`（或复用已有的 ResizeObserver 首次回调）执行——此时元素已挂载，`getBBox()` 才有效。
- 调用点 2：`src/lib/richClipboard.ts` 的 `copySvgMarkupAsImage`（复制为图片）和 `src/lib/docxMermaid.ts`（Word 导出），复用同一函数，否则导出的图照样缺边。
- `getBBox()` 在 `htmlLabels: false`（当前配置）下是可靠的；不含 `foreignObject`，没有已知偏差。

不做 A2 只做 A1 也能看，但缩放比例仍按偏小的 viewBox 算，图形会贴边，导出还是缺。

**顺带说明（不是本次修复项）**：图 1 高度 595px，编辑区可视高度 573px，一屏放不下。这是"图太大"，不是"渲染不完整"。如果希望一屏看全，需要另做「适应宽度 / 适应窗口」开关，属于新功能，不混进本次修复。

### 验收标准

1. 浏览器缩放 100% / 125% / 150% 三档下，图 1 最底一排节点的下边框完整可见。
2. 断言 `bbox` 四边到 viewBox 边界的距离 ≥ 8 单位。
3. 图内「复制图片」得到的 PNG、Word 导出的图，四边不缺内容。
4. 第二张横版图（flowchart LR）右侧标签「理解 兴趣、状态、目标、限制」不被裁。

---

## BUG 2：拖动滚动条时失控跳动

### 现象

拖右侧滚动条向下，滚动条位置与内容不同步，上下抖动；越往文档下方越严重。

### 已复现并量化（真实鼠标拖动，非模拟赋值）

拖动 26 步、每步指针下移 12px，实测：

| 指标 | 实测 |
| --- | --- |
| 拖动过程中 `scrollHeight` 变化 | 23,127 → 25,279（摆动 **2,152 px**），后续区段在 24,697 ~ 25,584 之间反复 |
| 指针每下移 12px，thumb 实际位移 | 在 **9 ~ 15 px** 之间波动（应为恒定 12px） |
| 指针每下移 12px，内容实际滚动 | 在 **391 ~ 670 px** 之间波动 |
| thumb 高度 | 被 clamp 到最小 **18 px**（内容/视口约 40:1） |
| 因此 1px 指针位移对应内容滚动 | 约 **42 px** |

匀速拖动却得到变速滚动，这就是"失控感"的来源。

### 根因（三层，缺一不可）

**第 1 层：表格高度被系统性低估**

`TableWidget.estimatedHeight`（`tablePreview.ts:1614`）是：

```ts
return (this.table.rows.length + 1) * this.rowHeight + 2   // rowHeight 默认 38
```

注释写着 "Initial CM6 viewport estimate only. The rendered table is always measured from its DOM."——但**只有进入渲染范围的表格才会被测量**，之外的仍按 38px/行排布。

实测这份文档的表格（每行都因长文本折行）：

| 表格 | 行数 | 估算高度 | 实际高度 | 低估 |
| --- | --- | --- | --- | --- |
| 表 1 | 5 | 192 | 323 | **131** |
| 表 2 | 4 | 154 | 309 | **155** |
| 前 12 个表格合计 | — | — | — | **2,613（平均每个 218）** |
| 全文表格总数 | 35 | — | — | 推算累计约 **7,000+** |

单行实测高度 42 / 70 / 70 / 98，是估算值 38 的 1.1 ~ 2.6 倍。

**第 2 层：CM6 在滚动时用实测值改写高度图**

视口外的表格按 38px/行排布，一旦进入渲染范围就被测量、改写 heightMap，文档总高度随之变化。这就是拖动中 `scrollHeight` 摆动 2,152px 的来源。Mermaid 也贡献一部分（首次估算 112，实测 613，两个图合计约 1,000px），但表格是主因。

**第 3 层：自定义滚动条把高度变化直接翻译成 thumb 位移**

`HoverScrollbars.handleThumbPointerMove`（`src/components/HoverScrollbars.tsx:159`）**每次 pointermove 都重新读 `target.scrollHeight`**：

```ts
const contentLength = axis === 'horizontal' ? target.scrollWidth : target.scrollHeight
const thumbLength = Math.max(18, trackLength * (viewportLength / contentLength))
const maxThumbOffset = Math.max(1, trackLength - thumbLength)
const maxScroll = Math.max(0, contentLength - viewportLength)
const nextScroll = drag.scrollPosition + (delta / maxThumbOffset) * maxScroll
```

`contentLength` 一变，`maxScroll` 与 `maxThumbOffset` 同时变，同一个 `delta` 映射出完全不同的滚动量。thumb 的 `transform` 又是从实时 `scrollTop / (scrollHeight - clientHeight)` 反算的，于是指针匀速、thumb 变速，视觉上就是"上下跳"。

**越往下越严重**：累计被低估的表格越多，单次修正幅度越大（实测后段单步高度变化 600~700px），映射失真越明显。

### 修复方案（三层，建议全做）

**B1（止血：拖动期间用固定映射）**
改 `src/components/HoverScrollbars.tsx`：

- `handleThumbPointerDown` 时快照：`{ startPointer, startScroll, contentLength, viewportLength, trackLength, thumbLength, maxScroll, maxThumbOffset }`，存进 `dragRef`。
- `handleThumbPointerMove` 只用快照计算，不再读实时 `scrollHeight`：
  `nextScroll = snapshot.startScroll + (delta / snapshot.maxThumbOffset) * snapshot.maxScroll`
- 拖动期间 thumb 的 `transform` 也按快照比例或直接跟随指针移动，不要每帧从实时 `scrollTop` 反算。
- `finishDrag` 时清空快照，恢复实时 metrics，并沿用已有的 `settleScrollbarInteraction`（连发 3 帧 `requestMeasure`）。

风险：低。副作用是松手瞬间 thumb 可能微调一次（因为文档高度已变），属于可接受的一次性收敛。

**B2（治本：表格高度实测缓存）**
仿 `MermaidRenderCache` 的做法，给表格加一个模块级高度缓存：

- key = `table.source + 可用宽度 + layoutMode`（宽度必须进 key，侧边栏开合会改变折行）
- `toDOM` 首次测量后、以及已有的 `ResizeObserver` 回调里写入实测高度
- `estimatedHeight` 优先取缓存，命中时 CM6 拿到的是真实高度，滚动到该表格不会再有修正
- 未命中时改进估算：按列宽与字符数估算折行数（`ceil(文本宽 / 列宽)`），而不是固定 38/行

风险：中。key 少了宽度会复用错误高度，反而更糟，必须把宽度纳入。建议 B1 先上线，B2 单独 PR 并用这份文件做回归。

**B3（放大器：降低刷新频率）**
`HoverScrollbars` 的 `MutationObserver` 目前是 `{ childList: true, subtree: true, attributes: true }`。CM6 在滚动时高频改 class / style，`attributes: true` 会让它每帧回调、每帧读 `scrollHeight`（强制布局）。改为只观察 `childList/subtree`，拖动期间不刷新 metrics，松手后再刷。

风险：低。

**可选（非必须）**：thumb 最小高度 18px 对 40:1 的文档太小，建议提到 24~28px。它不解决根因，但能降低灵敏度，让拖动更可控。

### 验收标准

1. 用这份文件从顶拖到底：`scrollTop` 序列必须单调递增，thumb 位移与指针位移误差 < 2px。
2. 拖动期间 `scrollHeight` 波动：B1 后 UI 表现稳定即可；B2 后应降到 200px 以内。
3. 现有 `e2e/scrollbar-click-stability.spec.ts` 扩展一条"拖动稳定性"断言（连续拖动采样，禁止回退）。
4. 顶部/中部/底部三段各拖一次，三段的滚动灵敏度一致。

---

## 与 2.1.13 的关系（作者已确认 2.0.58 起代码在本地，无 PR）

这带来两个约束：

1. **不能假定 2.0.57 的实现等于线上 2.1.13**。但你在 2.1.13 客户端上仍然稳定复现了这两个 BUG，症状与这里在 2.0.57 上测到的完全一致——说明 2.1.13 里这几处实现没有实质变化，根因判断和修复方向对 2.1.13 同样成立。置信度：症状一致为高，代码一致为中（无法验证）。
2. **改动无法直接合并**，只能作为 patch / 改动说明交作者对齐。因此按"冲突概率"重排优先级：

| 项 | 改动范围 | 套用到 2.1.13 的冲突概率 |
| --- | --- | --- |
| A1 CSS `overflow: visible` | 1 条样式 | 极低，可直接贴 |
| B1 拖动固定映射 | `HoverScrollbars.tsx` 单个函数 + 快照字段 | 低，函数体可整段替换 |
| B3 去掉 `attributes` 监听 | 1 行配置 | 极低 |
| A2 viewBox 按 bbox 重算 | `mermaidPreview.ts` widget 生命周期 + 两个导出调用点 | 中，依赖 `applyRenderedMermaidSvg` / `toDOM` 结构未变 |
| B2 表格高度缓存 | `tablePreview.ts` widget 构造与 `estimate` | 中高，依赖 `TableWidget` 构造参数 |

建议：先交付 A1 / B1 / B3（少文件、按函数定位，作者几乎可以直接抄），A2 / B2 附完整改动说明与验收脚本，由作者在本地代码上对齐后再合。

如果能拿到 2.1.13 的源码，或至少这四个文件的当前版本（`mermaidPreview.ts`、`mermaidPreview.css`、`HoverScrollbars.tsx`、`tablePreview.ts`），我可以直接把改动做在最新代码上，省掉一次人工对齐。

---

## 建议执行顺序

| 顺序 | 改动 | 文件 | 风险 | 能否独立验证 |
| --- | --- | --- | --- | --- |
| 1 | B1 拖动固定映射 | `HoverScrollbars.tsx` | 低 | 能，纯前端 |
| 2 | A1 CSS overflow | `mermaidPreview.css` | 极低 | 能 |
| 3 | B3 去掉 attributes 监听 | `HoverScrollbars.tsx` | 低 | 能 |
| 4 | A2 viewBox 按 bbox 重算 | `mermaidPreview.ts`、`richClipboard.ts`、`docxMermaid.ts` | 中 | 能，需覆盖导出 |
| 5 | B2 表格高度缓存 | `tablePreview.ts` | 中 | 能，需宽度变化回归 |

1-3 是止血，改动小、可回滚；4-5 是根治，各自独立 PR。

## 需要你确认

1. **A1 + A2 是否都做**，还是先只上 A1（一行 CSS）观察效果。
2. **B2 是否本次一起做**。不做的话，滚动条不会跳了（B1 保证），但文档总高度仍会在首次滚动时变化，滚动条 thumb 长度会轻微变一次。
3. 是否顺手把 thumb 最小高度从 18px 调大（可选，不属于修复）。
