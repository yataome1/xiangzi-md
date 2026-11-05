import { describe, expect, it } from 'vitest'
import { MERMAID_VIEWPORT_PADDING, paddedViewBox } from './mermaidViewport'

describe('paddedViewBox', () => {
  it('expands the box by the padding on every side', () => {
    expect(paddedViewBox({ x: 8, y: 8, width: 1300, height: 615 }, 12)).toBe('-4 -4 1324 639')
  })

  it('keeps fractional precision without emitting float noise', () => {
    expect(paddedViewBox({ x: 0.5, y: 1.25, width: 10.3333, height: 20.6666 }, 12)).toBe(
      '-11.5 -10.75 34.333 44.667',
    )
  })

  it('uses the shared default padding when none is given', () => {
    expect(paddedViewBox({ x: 0, y: 0, width: 100, height: 50 })).toBe(
      `-${MERMAID_VIEWPORT_PADDING} -${MERMAID_VIEWPORT_PADDING} ${
        100 + MERMAID_VIEWPORT_PADDING * 2
      } ${50 + MERMAID_VIEWPORT_PADDING * 2}`,
    )
  })

  it('rejects empty or non-finite boxes so a failed measurement never rewrites the viewBox', () => {
    expect(paddedViewBox({ x: 0, y: 0, width: 0, height: 10 })).toBeNull()
    expect(paddedViewBox({ x: 0, y: 0, width: 10, height: 0 })).toBeNull()
    expect(paddedViewBox({ x: Number.NaN, y: 0, width: 10, height: 10 })).toBeNull()
    expect(paddedViewBox({ x: 0, y: 0, width: Number.POSITIVE_INFINITY, height: 10 })).toBeNull()
  })

  it('treats a negative padding as zero instead of shrinking the box', () => {
    expect(paddedViewBox({ x: 0, y: 0, width: 10, height: 10 }, -5)).toBe('0 0 10 10')
  })
})
