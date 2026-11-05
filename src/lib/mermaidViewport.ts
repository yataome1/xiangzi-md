/**
 * Mermaid 生成的 SVG 用自己的布局尺寸加一个固定内边距算 viewBox，而 SVG 根元素
 * 默认 `overflow: hidden`。中文字形走系统兜底字体，同一条标签在不同机器 / 系统
 * 缩放下的实际宽度并不相同，只要比 mermaid 的测量值多出那几个像素，超出的部分
 * 就会被 SVG 视口直接裁掉——外层容器的 `overflow: auto` 也拿不到已经裁掉的内容，
 * 用户看到的就是「图显示不完整」。
 *
 * 这里在 SVG 进入文档后按真实几何（getBBox）重算一次 viewBox，并留出安全边距，
 * 让边距与字体无关。预览、复制为图片、Word 导出共用同一套计算，避免三条路径
 * 各自缺边。
 */

export interface SvgBoundingBox {
  x: number
  y: number
  width: number
  height: number
}

const VIEWPORT_PADDING = 12
/** 低于这个差值的修正没有意义，只会换来一次多余的 layout。 */
const MIN_VIEWBOX_DELTA = 2

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

/** 由内容包围盒推出带安全边距的 viewBox 字符串；输入不合法时返回 null。 */
export function paddedViewBox(box: SvgBoundingBox, padding = VIEWPORT_PADDING): string | null {
  if (![box.x, box.y, box.width, box.height].every(Number.isFinite)) return null
  if (box.width <= 0 || box.height <= 0) return null
  const pad = Math.max(0, padding)
  return [
    round(box.x - pad),
    round(box.y - pad),
    round(box.width + pad * 2),
    round(box.height + pad * 2),
  ].join(' ')
}

function parseViewBox(value: string | null): SvgBoundingBox | null {
  if (!value) return null
  const parts = value.trim().split(/\s+/).map(Number)
  if (parts.length !== 4 || !parts.every(Number.isFinite)) return null
  return { x: parts[0], y: parts[1], width: parts[2], height: parts[3] }
}

/**
 * 把 SVG 的 viewBox 对齐到它真实的内容边界。必须在元素已经进入文档（有 layout）
 * 之后调用；detached 元素的 getBBox 会返回 0。
 *
 * 同一个 SVG 只处理一次：重算会改变元素尺寸并触发 ResizeObserver / requestMeasure，
 * 重复执行就会变成自己触发自己的抖动源。
 */
export function normalizeSvgViewport(svg: SVGSVGElement, padding = VIEWPORT_PADDING): boolean {
  if (svg.dataset.xmdViewport === 'normalized') return false
  let box: SvgBoundingBox
  try {
    const raw = svg.getBBox()
    box = { x: raw.x, y: raw.y, width: raw.width, height: raw.height }
  } catch {
    // getBBox throws on elements that are not rendered at all.
    return false
  }
  const next = paddedViewBox(box, padding)
  if (!next) return false
  svg.dataset.xmdViewport = 'normalized'

  const current = parseViewBox(svg.getAttribute('viewBox'))
  if (current) {
    const delta = Math.max(
      Math.abs(current.x - (box.x - padding)),
      Math.abs(current.y - (box.y - padding)),
      Math.abs(current.width - (box.width + padding * 2)),
      Math.abs(current.height - (box.height + padding * 2)),
    )
    if (delta < MIN_VIEWBOX_DELTA) return false
  }
  svg.setAttribute('viewBox', next)
  return true
}

/** 测试与调用方共用的默认边距，避免预览和导出各写一个数字。 */
export const MERMAID_VIEWPORT_PADDING = VIEWPORT_PADDING
