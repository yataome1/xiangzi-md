import { expect, test } from '@playwright/test'
import { openNewDocument } from './helpers'

test('clicking visible content after a thumb drag keeps the manual scroll position', async ({
  page,
}) => {
  await openNewDocument(page)
  await page.keyboard.insertText(
    Array.from({ length: 120 }, (_, index) => `## 标题 ${index + 1}\n正文 ${index + 1}`).join(
      '\n\n',
    ),
  )

  const scroller = page.locator('.cm-scroller')
  const thumb = page.locator(
    '.xmd-cm-editor .hover-scrollbar-track-vertical .hover-scrollbar-thumb',
  )
  await expect(thumb).toBeVisible()
  const thumbBox = await thumb.boundingBox()
  expect(thumbBox).not.toBeNull()

  await page.mouse.move(thumbBox!.x + thumbBox!.width / 2, thumbBox!.y + thumbBox!.height / 2)
  await page.mouse.down()
  await page.mouse.move(thumbBox!.x + thumbBox!.width / 2, thumbBox!.y - 220, { steps: 8 })
  await page.mouse.up()

  const scrollerBox = await scroller.boundingBox()
  expect(scrollerBox).not.toBeNull()
  const clickPoint = await page.evaluate(
    ({ top, bottom }) => {
      for (const line of document.querySelectorAll<HTMLElement>('.cm-line')) {
        const rect = line.getBoundingClientRect()
        if (line.textContent?.trim() && rect.top >= top + 24 && rect.bottom <= bottom - 24) {
          return { x: rect.left + Math.min(160, rect.width / 3), y: (rect.top + rect.bottom) / 2 }
        }
      }
      return null
    },
    {
      top: scrollerBox!.y,
      bottom: scrollerBox!.y + scrollerBox!.height,
    },
  )
  expect(clickPoint).not.toBeNull()

  const beforeClick = await scroller.evaluate((element) => element.scrollTop)
  await page.mouse.click(clickPoint!.x, clickPoint!.y)
  await page.waitForTimeout(220)
  const afterClick = await scroller.evaluate((element) => element.scrollTop)

  expect(afterClick).toBeCloseTo(beforeClick, 0)
})

/**
 * 回归：文档里有会改变高度的块（长文本表格）时，拖动拇指曾经会让内容忽快
 * 忽慢——旧实现每次 pointermove 都重读 scrollHeight，而 CodeMirror 正在把
 * 视口外的估算高度换成实测高度，同一个指针位移就映射出不同的滚动量。
 * 现在整段拖动用按下瞬间的快照，拇指应该和指针 1:1。
 */
test('dragging the thumb keeps the scroll monotonic and the thumb in lockstep', async ({
  page,
}) => {
  await openNewDocument(page)
  const blocks = Array.from(
    { length: 60 },
    (_, index) =>
      `## 章节 ${index + 1}\n\n| 项 | 说明 |\n| --- | --- |\n| ${index} | ${'较长的表格内容'.repeat(6)} |`,
  ).join('\n\n')
  await page.keyboard.insertText(blocks)

  const scroller = page.locator('.cm-scroller')
  // 插入后光标在文末，视口已经滚到底，拇指没有下行空间了。
  await scroller.evaluate((element) => {
    element.scrollTop = 0
  })
  await page.waitForTimeout(150)
  const thumb = page.locator(
    '.xmd-cm-editor .hover-scrollbar-track-vertical .hover-scrollbar-thumb',
  )
  await expect(thumb).toBeVisible()
  const box = await thumb.boundingBox()
  expect(box).not.toBeNull()

  const x = box!.x + box!.width / 2
  const startY = box!.y + box!.height / 2
  const stepPx = 10
  await page.mouse.move(x, startY)
  await page.mouse.down()

  const samples: Array<{ top: number; thumb: number }> = []
  for (let step = 1; step <= 20; step += 1) {
    await page.mouse.move(x, startY + step * stepPx)
    await page.waitForTimeout(40)
    samples.push(
      await page.evaluate(() => {
        const dom = document.querySelector('.cm-scroller') as HTMLElement
        const element = document.querySelector(
          '.xmd-cm-editor .hover-scrollbar-track-vertical .hover-scrollbar-thumb',
        ) as HTMLElement
        const match = /translateY\(([-\d.]+)px\)/.exec(element.style.transform)
        return { top: dom.scrollTop, thumb: match ? Number(match[1]) : Number.NaN }
      }),
    )
  }
  await page.mouse.up()

  for (let index = 1; index < samples.length; index += 1) {
    // 指针一直向下，滚动位置不允许回退。
    expect(samples[index].top).toBeGreaterThanOrEqual(samples[index - 1].top - 1)
    // 拇指的可移动距离等于拖动映射的分母，所以它应该跟着指针走同样多的像素。
    const thumbDelta = samples[index].thumb - samples[index - 1].thumb
    expect(Math.abs(thumbDelta - stepPx)).toBeLessThanOrEqual(2)
  }

  const scrolled = samples[samples.length - 1].top
  const maxScroll = await scroller.evaluate(
    (element) => element.scrollHeight - element.clientHeight,
  )
  expect(scrolled).toBeGreaterThan(maxScroll * 0.2)
})
