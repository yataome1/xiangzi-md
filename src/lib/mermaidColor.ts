/**
 * Mermaid 的配色来自 CSS 变量（见 `lib/mermaidPreview.ts` 的 `mermaidThemeVariables`），
 * 它内部用 khroma 解析颜色，只认 `#rrggbb`、`rgb()` 这类传统写法。
 *
 * 浏览器把自定义属性里的 `color-mix()` / `light-dark()` 求值后，可能序列化成
 * `color(srgb 0.978431 0.984314 0.992157)`；主题 CSS 里也可能直接写
 * `oklch()` / `display-p3`。这些值原样交给 mermaid 会抛
 * `Unsupported color format`，整张图变成错误态——一个配色写法不该让图渲染不出来。
 *
 * 这里把读到的颜色统一归一化成 `#rrggbb`：能直接换算的换算，其余交给浏览器
 * 做一次真实的颜色解析，仍解析不了就退回调用方给的默认色。
 */

const HEX6 = /^#([0-9a-f]{6})$/i
const HEX3 = /^#([0-9a-f]{3})$/i
const HEX8 = /^#([0-9a-f]{8})$/i
const RGB_FUNCTION = /^rgba?\(\s*([^)]+)\)$/i
const COLOR_FUNCTION = /^color\(\s*([a-z0-9-]+)\s+([^)]+)\)$/i

function clampByte(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(255, Math.round(value)))
}

function toHex(r: number, g: number, b: number): string {
  const byte = (value: number): string => clampByte(value).toString(16).padStart(2, '0')
  return `#${byte(r)}${byte(g)}${byte(b)}`
}

/** 把 `0.978` 或 `97.8%` 这类分量换成 0–255。 */
function parseComponent(token: string, scale: number): number | null {
  const text = token.trim()
  if (!text) return null
  if (text.endsWith('%')) {
    const percent = Number.parseFloat(text.slice(0, -1))
    return Number.isFinite(percent) ? (percent / 100) * 255 : null
  }
  const value = Number.parseFloat(text)
  return Number.isFinite(value) ? value * scale : null
}

function parseRgbFunction(value: string): string | null {
  const match = RGB_FUNCTION.exec(value)
  if (!match) return null
  // `rgb(10, 20, 30)` / `rgb(10 20 30)` / `rgb(10 20 30 / 50%)` 都要认；
  // 斜杠后面是 alpha，图表用纯色，直接丢掉。
  const body = match[1].split('/')[0] ?? ''
  const parts = body
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length < 3) return null
  const channels = parts.slice(0, 3).map((part) => parseComponent(part, 1))
  if (channels.some((channel) => channel === null)) return null
  return toHex(channels[0] ?? 0, channels[1] ?? 0, channels[2] ?? 0)
}

/**
 * `color(srgb 0.97 0.98 0.99)` / `color(display-p3 ...)` / `color(srgb-linear ...)`。
 * display-p3 与 srgb-linear 的分量被当作 sRGB 直接换算，会有轻微色偏，但远好过
 * 让整张图渲染失败。
 */
function parseColorFunction(value: string): string | null {
  const match = COLOR_FUNCTION.exec(value)
  if (!match) return null
  const space = match[1].toLowerCase()
  if (space !== 'srgb' && space !== 'srgb-linear' && space !== 'display-p3') return null
  const parts = match[2]
    .split(/[,/\s]+/)
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length < 3) return null
  const channels = parts.slice(0, 3).map((part) => parseComponent(part, 255))
  if (channels.some((channel) => channel === null)) return null
  return toHex(channels[0] ?? 0, channels[1] ?? 0, channels[2] ?? 0)
}

/**
 * `oklch(L C H)` → sRGB。canvas 对 oklch 会原样返回，浏览器也不给 rgb 形式，
 * 所以只能自己转（OKLab → LMS → linear sRGB → gamma）。
 * 参考 CSS Color 4 的换算矩阵。
 */
function parseOklch(value: string): string | null {
  const match = /^oklch\(\s*([^)]+)\)$/i.exec(value)
  if (!match) return null
  const parts = match[1]
    .split('/')[0]
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length < 3) return null

  const lightnessToken = parts[0]
  const lightness = lightnessToken.endsWith('%')
    ? Number.parseFloat(lightnessToken.slice(0, -1)) / 100
    : Number.parseFloat(lightnessToken)
  const chroma = Number.parseFloat(parts[1])
  const hueToken = parts[2]
  const hue = hueToken.endsWith('deg')
    ? Number.parseFloat(hueToken.slice(0, -3))
    : Number.parseFloat(hueToken)
  if (![lightness, chroma, hue].every(Number.isFinite)) return null

  const radians = (hue * Math.PI) / 180
  const a = chroma * Math.cos(radians)
  const b = chroma * Math.sin(radians)

  const lPrime = lightness + 0.3963377774 * a + 0.2158037573 * b
  const mPrime = lightness - 0.1055613458 * a - 0.0638541728 * b
  const sPrime = lightness - 0.0894841775 * a - 1.291485548 * b

  const l = lPrime ** 3
  const m = mPrime ** 3
  const s = sPrime ** 3

  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
  const gamma = (channel: number): number => {
    const clamped = Math.max(0, Math.min(1, channel))
    return clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055
  }
  const [r, g, blue] = linear.map((channel) => gamma(channel) * 255)
  return toHex(r ?? 0, g ?? 0, blue ?? 0)
}

let probeContext: CanvasRenderingContext2D | null | undefined

/**
 * 浏览器能解析的颜色（color-mix、hsl、命名色……）用 canvas 转一次。
 * canvas 的 `fillStyle` 对不认识的写法会保持上一次的值，所以先用 `CSS.supports`
 * 判断，避免把非法值误判成黑色。
 *
 * 注意 canvas 对 `color-mix()` 会求值成 `color(srgb ...)`，对 `color(srgb ...)`
 * 则原样返回——这两种都要再走一遍 sRGB 解析，不能直接丢弃。
 */
function convertWithBrowser(value: string): string | null {
  if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') return null
  if (typeof document === 'undefined') return null
  if (!CSS.supports('color', value)) return null
  if (probeContext === undefined) {
    probeContext = document.createElement('canvas').getContext('2d')
  }
  if (!probeContext) return null
  probeContext.fillStyle = '#000000'
  probeContext.fillStyle = value
  const resolved = probeContext.fillStyle
  if (typeof resolved !== 'string') return null
  if (/^color\(/i.test(resolved)) return parseColorFunction(resolved)
  if (HEX6.test(resolved)) return resolved.toLowerCase()
  if (HEX8.test(resolved)) return resolved.slice(0, 7).toLowerCase()
  const rgb = parseRgbFunction(resolved)
  if (rgb) return rgb
  return null
}

/** 把任意 CSS 颜色写法归一化成 `#rrggbb`；无法识别时返回 `fallback`。 */
export function toMermaidColor(value: string | null | undefined, fallback: string): string {
  const raw = (value ?? '').trim()
  if (!raw) return fallback

  const hex6 = HEX6.exec(raw)
  if (hex6) return `#${hex6[1].toLowerCase()}`

  const hex3 = HEX3.exec(raw)
  if (hex3) {
    const [r, g, b] = hex3[1].toLowerCase()
    return `#${r}${r}${g}${g}${b}${b}`
  }

  const hex8 = HEX8.exec(raw)
  if (hex8) return `#${hex8[1].slice(0, 6).toLowerCase()}`

  const rgb = parseRgbFunction(raw)
  if (rgb) return rgb

  const colorFunction = parseColorFunction(raw)
  if (colorFunction) return colorFunction

  const oklch = parseOklch(raw)
  if (oklch) return oklch

  const browser = convertWithBrowser(raw)
  if (browser) return browser

  return fallback
}
