# 修复记录：Mermaid 显示不完整 + 滚动条失控

日期：2026-11-05
基线：本地源码 v2.0.57（作者确认 2.0.58 起代码在其本地，无法取得 2.1.13 源码）
验证语料：`C端APP整体设计方案-v0.1.md`（43,566 字符 / 35 个表格 / 2 个 Mermaid 图）
验证环境：Chromium 1280×720，Playwright 驱动真实鼠标拖动与键盘输入

---

## 一、改动清单

| # | 文件 | 改动 |
| --- | --- | --- |
| 1 | `src/lib/mermaidViewport.ts`（新增） | `paddedViewBox` / `normalizeSvgViewport`：按真实 `getBBox()` 重算 viewBox，留 12px 安全边距，同一 SVG 只执行一次 |
| 2 | `src/lib/mermaidViewport.test.ts`（新增） | 5 条纯函数单测：正常扩展、浮点精度、默认边距、非法输入、负边距 |
| 3 | `src/features/cm6-editor/mermaidPreview.ts` | 渲染后（下一帧、元素已挂载）调用 `normalizeSvgViewport`；移除 mermaid 写入的内联 `max-width`，让图随容器宽度自适应 |
| 4 | `src/features/cm6-editor/mermaidPreview.css` | `svg` 增加 `max-height: min(68vh, 720px)` 与 `overflow: visible` |
| 5 | `src/features/cm6-editor/math-mermaid.test.ts` | 更新几何断言：允许视口相对上限，仍禁止固定像素 `max-height`；新增 `overflow: visible` 断言 |
| 6 | `src/lib/richClipboard.ts` | `svgMarkupToPng` 把 SVG 挂到屏幕外参与布局后同样校正 viewBox，导出/复制图片不再缺边 |
| 7 | `src/components/HoverScrollbars.tsx` | 拖动期间用快照映射 + 拇指位置由快照比例给出；滚动期间冻结尺寸；去掉 `MutationObserver` 的 `attributes` 监听 |
| 8 | `src/features/cm6-editor/tablePreview.ts` | 表格高度按单元格内容估算（42/70/98 三档与实测一致）+ 实测高度缓存（key 含宽度桶与布局模式）+ 视口缓冲 2k→30k |
| 9 | `src/features/cm6-editor/tableHeightEstimate.test.ts`（新增） | 7 条估算单测：单行、折行、取最高单元格、窄表、基线下限、宽度缺失、空行 |

`npm run check` 全绿：format / lint（零 warning）/ 1201 个单测 / build / bundle（entry 211.3 KiB，预算 500 KiB）。

---

## 二、修复前后实测对比

### Mermaid（期望 1）

| 指标 | 修复前 | 修复后 |
| --- | --- | --- |
| 图 1 内容到 viewBox 四边 | 8 / 8 / 8 / 8（临界，稍宽即裁） | 12 / 12 / 12 / 12 |
| 图 1 SVG 显示尺寸 | 1162×557 | 1162×490 |
| 图 1 卡片高度 | 595（编辑区可视 573，放不下） | 528（放得下，一屏完整可见） |
| 图 2 内容到 viewBox 四边 | 8 / 8 / 8 / 8 | 12 / 12 / 12 / 12 |
| 窗口变宽 | 被 mermaid 内联 `max-width` 钉死 | 随容器放大（视口相对高度封顶） |

### 滚动（期望 2）

拖动：指针匀速每步下移 12px，共 26 步。

| 指标 | 修复前 | 修复后 |
| --- | --- | --- |
| 拇指位移/步 | 9 ~ 15px 波动 | **恒定 12px** |
| 内容滚动量/步 | 391 ~ 670px 波动 | **540 ~ 541px** |
| `scrollTop` 回退次数 | 有（目标 4093 实际落到 4592） | **0** |
| 拖动中 `scrollHeight` 摆动 | 2,152px | 仍会变（CM6 测量视口外块），但已不影响拇指 |

滚轮连续 24 次：拇指位移/内容位移比值落在 0.01805 ~ 0.01923（±6%），`scrollTop` 无回退。

方向键连续 40 次：`scrollTop` 无回退，步长 20~29px（一行），跨越表格/图表时一次性跳 357px（原子块语义，光标不能停在块内，属预期）。

---

## 三、根因与对策的对应关系

| 根因 | 证据 | 对策 |
| --- | --- | --- |
| mermaid 的 viewBox 只有固定 8 单位边距，SVG 根元素 `overflow: hidden` | bbox 底边到 viewBox 底边恰好 8；`overflow: hidden/hidden` | 按 `getBBox()` 重算 + CSS `overflow: visible` 兜底 |
| 表格高度按固定 38px/行估算，实测行高 42/70/98 | 单表低估 131~155px，前 12 表平均 218px | 内容感知估算 + 实测缓存 |
| 表格视口缓冲仅 2,000 字符，滚动时在"源码行"与"卡片"之间切换 | 缓冲内外的块高度差数百 px | 缓冲提到 30,000（与 mermaid 一致） |
| 拖动时每帧重读 `scrollHeight` 计算映射 | 指针匀速 12px，内容滚动 391~670px | 拖动开始时快照，全程不重读 |
| 拇指被 clamp 到 18px，1px 指针 ≈ 41px 内容 | 内容/视口 40:1 | 快照映射已消除脱钩；最小高度未改（见"未采纳"） |
| `MutationObserver` 监听 `attributes`，CM6 滚动时高频回调强制布局 | — | 只监听 `childList/subtree` |

---

## 四、未覆盖与已知风险

| 项 | 说明 |
| --- | --- |
| 复制 PNG / Word 导出的视觉验证 | 浏览器预览模式下剪贴板与导出是空实现，只做了代码路径对齐（`svgMarkupToPng` 与预览共用 `normalizeSvgViewport`），需在实机点一次「复制图片」确认边缘 |
| Tauri / WebView2 实机 | 本机无 Rust 工具链，未构建安装包；WebView2 与 Chromium 渲染接近，但字体兜底可能不同 |
| 超长文档性能 | 表格缓冲 30k 意味着每次视口重建都扫一次语法树（只解析 `Table` 节点）。43k 字符文档无感知；若单文件到数百 KB 需复测 |
| 滚动停止的瞬间 | 滚动期间冻结尺寸，停下 200ms 后拇指长度会按最终 `scrollHeight` 微调一次（一次性收敛，非循环抖动） |
| 极窄高窗口 | `max-height: min(68vh, 720px)` 下，窗口很矮时图会缩得较小，但完整可见 |
| 未采纳项 | 拇指最小高度仍是 18px。它放大了灵敏度，但不是本次失控的根因；改它会改变所有滚动条的手感，建议单独评估 |

---

## 五、第二轮（2026-11-05 下午，装包验证后）

用户在 2.0.58 安装包上验证，报了两个残留问题。

### 5.1 Mermaid 报「图表语法有误」

现象：图整体变成红字错误 `Unsupported color format: "color(srgb 0.978431 0.984314 0.992157)"`，图不渲染。

原因：`mermaidThemeVariables` 把 CSS 变量原样交给 mermaid，而 mermaid 内部的 khroma
只认 `#rrggbb` / `rgb()`。当前主题用 `color-mix()` 表达配色，Chromium 在读取自定义
属性时把混合结果序列化成 `color(srgb 0.97 0.98 0.99)`（实测 canvas 对 `color-mix`
求值后也返回这个形式，对 `oklch` 则原样返回）。

修复：新增 `src/lib/mermaidColor.ts`，把每个变量归一化成 `#rrggbb`：

| 输入 | 处理 |
| --- | --- |
| `#rrggbb` / `#rgb` / `#rrggbbaa` | 直接规整，丢弃 alpha |
| `rgb()` / `rgba()` / 空格分隔 | 解析通道并 clamp |
| `color(srgb …)` / `color(display-p3 …)` | 0–1 分量 ×255 |
| `oklch(L C H)` | 走 OKLab → LMS → linear sRGB → gamma（canvas 不帮忙） |
| 命名色、`hsl()` 等 | canvas 探针 |
| 解析失败 | 回退默认色，**不再让整张图报错** |

实测：`color-mix(in srgb, #ffffff 96%, #e8eef7)` → `#fefeff`；
`oklch(0.62 0.19 264)` → `#497ef7`；`rebeccapurple` → `#663399`；非法值 → 默认色。
单测 8 条覆盖以上分支。

### 5.2 松开滚动条后往上回弹

现象：拖到下方松手，拇指往上跳一截（用户描述「并没有停在拖动的位置」）。

实测（拖 260 / 420 / 520px）：松手后拇指分别回退 **40 / 71 / 57px**，`scrollTop` 不变。

原因：拖动时用「起点滚动位置 + 指针总位移」换算，分母是**按下瞬间**的 `scrollHeight`。
拖动过程中 CodeMirror 测量视口外的块，文档变高，同样的指针位移换算出的滚动量偏小；
拇指按指针 1:1 绘制，松手时改用真实 `scrollTop` 重算，两者不一致 → 回退。

修复（`HoverScrollbars.tsx`）：

1. **增量滚动**：每次 pointermove 只换算「本次指针增量」，叠加到当前实际位置，分母用实时滚动范围。跟手度从偏 15% 收敛到 2–5%。
2. **拇指跟真实位置**：新增 `trackActualPosition`，拖动期间每帧按浏览器实际 `scrollTop / 实时 max` 计算拇指位置（写完 `scrollTop` 后 CodeMirror 还会做一次 scroll anchoring，同步读到的不是最终值）。
3. 松手不再有额外重算差异，实测三个距离回弹均为 **0px**。

回归：`e2e/scrollbar-click-stability.spec.ts` 的拖动用例改为断言「滚动单调 + 松手后拇指与 scrollTop 与松手前一致（≤2px）」。

### 5.3 本轮门禁

`npm run check` 全绿：135 个测试文件 / 1209 个用例、lint 零 warning、bundle 212.3 KiB；
`npm run test:e2e --project=chromium` 32 个通过（含长图导出、拖动稳定性）。

---

## 六、合入 2.1.13 时的注意事项

改动按"单函数/单条样式"组织，冲突面小：

- 可直接搬：第 4、5、7 项（CSS、滚动条拖动映射、监听配置）。
- 需要看当前实现再对：第 3、6 项（依赖 `applyRenderedMermaidSvg` / `toDOM` 结构）、第 8 项（依赖 `TableWidget` 构造参数与 `findVisibleMarkdownTables` 的 buffer 默认值）。
- 新增文件（第 1、2、9 项）无冲突。

如果 2.1.13 里这些函数的签名变了，改动说明按"改什么行为"描述即可复现：

1. SVG 渲染完成后，用 `getBBox()` 加 12px 重写 viewBox，并让根元素 `overflow: visible`。
2. 表格 `estimatedHeight` 从固定行高改为「内容折行估算 + 按（源码, 宽度, 布局）缓存实测高度」，缓冲从 2k 提到 30k。
3. 交给 mermaid 前，把所有 CSS 颜色变量归一化成 `#rrggbb`，解析不出来就用默认色，不要让 khroma 抛错。
4. 滚动条拖动改为**增量**换算（每步只换算本次指针位移，分母用实时滚动范围），拇指每帧跟真实 `scrollTop`，松手不再回弹。
5. 滚动期间冻结拇指尺寸（200ms 后收敛），去掉 `attributes` 观察。

第二轮的改动集中在两个新文件（`src/lib/mermaidColor.ts` 及其测试）和 `HoverScrollbars.tsx` 的拖动函数，2.1.13 若重写过这两处，按行为描述重做成本也不高。
