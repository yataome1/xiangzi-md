import { describe, expect, it } from 'vitest'
import { estimateTableHeight } from './tablePreview'
import type { MarkdownTableCell } from './tableModel'

function cell(text: string): MarkdownTableCell {
  return { from: 0, to: text.length, text }
}

/** 只构造估算函数用到的两个字段（header / rows）。 */
function table(
  header: string[],
  rows: string[][],
): { header: MarkdownTableCell[]; rows: MarkdownTableCell[][] } {
  return {
    header: header.map(cell),
    rows: rows.map((row) => row.map(cell)),
  }
}

describe('estimateTableHeight', () => {
  it('matches the measured single-line row (42px = 14px padding + 28px line)', () => {
    // 3 columns at 900px → 300px per cell → 21 chars per line.
    const height = estimateTableHeight(table(['A', 'B', 'C'], [['1', '2', '3']]), 900, 38)
    // header 42 + one row 42 + 2px border
    expect(height).toBe(86)
  })

  it('grows by one line height for every wrapped line', () => {
    const single = estimateTableHeight(table(['A'], [['x']]), 900, 38)
    const wrapped = estimateTableHeight(table(['A'], [['x'.repeat(80)]]), 900, 38)
    // A single 900px column fits 64 chars per line → 80 chars wraps to 2 lines → +28px
    expect(wrapped - single).toBe(28)
  })

  it('counts the tallest cell in a row, not the sum of cells', () => {
    const height = estimateTableHeight(table(['A', 'B'], [['short', 'x'.repeat(60)]]), 900, 38)
    // 2 columns at 900px → 450px per cell → 32 chars per line → 60 chars wraps to 2 lines.
    expect(height).toBe(42 + 70 + 2)
  })

  it('wraps more when the table is narrow', () => {
    const wide = estimateTableHeight(table(['A'], [['x'.repeat(40)]]), 1200, 38)
    const narrow = estimateTableHeight(table(['A'], [['x'.repeat(40)]]), 200, 38)
    expect(narrow).toBeGreaterThan(wide)
  })

  it('never goes below one rendered line, and honours a larger base row height', () => {
    // A single line already needs 14px padding + 28px line height, so the 38px
    // base is only a floor for unusual configurations.
    expect(estimateTableHeight(table(['A'], [['']]), 2000, 38)).toBe(42 * 2 + 2)
    expect(estimateTableHeight(table(['A'], [['']]), 2000, 60)).toBe(60 * 2 + 2)
  })

  it('falls back to a readable width when the measurement is not available yet', () => {
    const height = estimateTableHeight(table(['A', 'B', 'C'], [['x'.repeat(40)]]), 0, 38)
    expect(Number.isFinite(height)).toBe(true)
    expect(height).toBeGreaterThan(38)
  })

  it('handles a table with no data rows and a row with no cells', () => {
    expect(estimateTableHeight(table(['A'], []), 900, 38)).toBe(42 + 2)
    expect(estimateTableHeight({ header: [cell('A')], rows: [[]] }, 900, 38)).toBe(42 + 42 + 2)
  })
})
