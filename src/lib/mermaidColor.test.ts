import { describe, expect, it } from 'vitest'
import { toMermaidColor } from './mermaidColor'

describe('toMermaidColor', () => {
  it('keeps a plain hex colour and lowercases it', () => {
    expect(toMermaidColor('#ECECFF', '#000000')).toBe('#ececff')
  })

  it('expands the 3-digit form and drops alpha from the 8-digit form', () => {
    expect(toMermaidColor('#ABC', '#000000')).toBe('#aabbcc')
    expect(toMermaidColor('#11223344', '#000000')).toBe('#112233')
  })

  it('converts rgb()/rgba() to hex', () => {
    expect(toMermaidColor('rgb(10, 20, 30)', '#000000')).toBe('#0a141e')
    expect(toMermaidColor('rgba(255, 0, 128, 0.4)', '#000000')).toBe('#ff0080')
    expect(toMermaidColor('rgb(10 20 30 / 50%)', '#000000')).toBe('#0a141e')
  })

  it('converts the color(srgb ...) form browsers produce for color-mix', () => {
    // 这就是用户报告的那个值（0.978431 × 255 = 249.5，向下取到 249）。
    expect(toMermaidColor('color(srgb 0.978431 0.984314 0.992157)', '#000000')).toBe('#f9fbfd')
  })

  it('accepts percentage components and display-p3', () => {
    expect(toMermaidColor('color(srgb 100% 0% 0%)', '#000000')).toBe('#ff0000')
    expect(toMermaidColor('color(display-p3 0 0.5 1)', '#000000')).toBe('#0080ff')
  })

  it('converts oklch to hex (canvas hands it back unchanged)', () => {
    expect(toMermaidColor('oklch(1 0 0)', '#000000')).toBe('#ffffff')
    const accent = toMermaidColor('oklch(0.62 0.19 264)', '#000000')
    expect(accent).toMatch(/^#[0-9a-f]{6}$/)
    expect(accent).not.toBe('#000000')
  })

  it('falls back for empty or unparsable values instead of failing the diagram', () => {
    expect(toMermaidColor('', '#ececff')).toBe('#ececff')
    expect(toMermaidColor(undefined, '#ececff')).toBe('#ececff')
    expect(toMermaidColor('not-a-color', '#ececff')).toBe('#ececff')
    expect(toMermaidColor('color(unknown-space 1 2 3)', '#ececff')).toBe('#ececff')
  })

  it('clamps out-of-range components', () => {
    expect(toMermaidColor('rgb(300, -20, 128)', '#000000')).toBe('#ff0080')
  })
})
