import { useCallback, useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react'

type ScrollAxis = 'horizontal' | 'vertical'

interface Props {
  targetRef: RefObject<HTMLElement | null>
  axes?: 'both' | 'horizontal' | 'vertical'
  onInteractionStart?: () => void
  onInteractionEnd?: () => void
}

interface Metrics {
  clientWidth: number
  clientHeight: number
  scrollWidth: number
  scrollHeight: number
  scrollLeft: number
  scrollTop: number
}

interface DragState {
  axis: ScrollAxis
  pointerPosition: number
  scrollPosition: number
  /**
   * 拖动开始时冻结的映射参数。
   *
   * 文档高度在拖动过程中会变（CodeMirror 用实测值修正视口外块的高度估算，
   * 长表格尤其明显）。如果每次 pointermove 都重读 scrollHeight，同一个指针
   * 位移就会映射出不同的滚动量：指针匀速下移、内容却忽快忽慢，拇指也跟着
   * 跳。整段拖动只用快照，拇指严格跟随指针。
   */
  maxScroll: number
  maxThumbOffset: number
  /** 拇指在轨道内的可移动距离，与 maxThumbOffset 同值，单独留着便于阅读。 */
  travel: number
}

function readMetrics(element: HTMLElement): Metrics {
  return {
    clientWidth: element.clientWidth,
    clientHeight: element.clientHeight,
    scrollWidth: element.scrollWidth,
    scrollHeight: element.scrollHeight,
    scrollLeft: element.scrollLeft,
    scrollTop: element.scrollTop,
  }
}

function pointerPosition(axis: ScrollAxis, event: PointerEvent<HTMLDivElement>): number {
  return axis === 'horizontal' ? event.clientX : event.clientY
}

function clamp(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(max, value))
}

export default function HoverScrollbars({
  targetRef,
  axes = 'both',
  onInteractionStart,
  onInteractionEnd,
}: Props): JSX.Element | null {
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  /** 拖动期间拇指位置由快照映射直接给出，不再从实时 scrollTop 反算。 */
  const [dragOffset, setDragOffset] = useState<{ axis: ScrollAxis; offset: number } | null>(null)
  const dragRef = useRef<DragState | null>(null)
  /**
   * 滚动进行中（滚轮、方向键、拖动）文档高度会变：CodeMirror 把视口外块从估算
   * 高度换成实测高度。若每次都按新的 scrollHeight 重算拇指位置和长度，拇指就会
   * 在滚动过程中反复伸缩。滚动期间只跟随位置，尺寸等停下来再收敛。
   */
  const scrollingRef = useRef(false)
  const scrollEndTimerRef = useRef(0)
  const onInteractionStartRef = useRef(onInteractionStart)
  const onInteractionEndRef = useRef(onInteractionEnd)
  onInteractionStartRef.current = onInteractionStart
  onInteractionEndRef.current = onInteractionEnd

  const refresh = useCallback(() => {
    const target = targetRef.current
    if (!target) return
    // 拖动期间几何在变，此刻回写 metrics 只会让拇指抖一下。
    if (dragRef.current) return
    const next = readMetrics(target)
    setMetrics((previous) => {
      if (!previous || !scrollingRef.current) return next
      return { ...previous, scrollTop: next.scrollTop, scrollLeft: next.scrollLeft }
    })
  }, [targetRef])

  useEffect(() => {
    const target = targetRef.current
    if (!target) return

    let frame: number | null = null
    const scheduleRefresh = (): void => {
      if (frame !== null) return
      frame = window.requestAnimationFrame(() => {
        frame = null
        refresh()
      })
    }
    const resizeObserver = new ResizeObserver(scheduleRefresh)
    const mutationObserver = new MutationObserver(scheduleRefresh)

    const handleScroll = (): void => {
      scrollingRef.current = true
      window.clearTimeout(scrollEndTimerRef.current)
      scrollEndTimerRef.current = window.setTimeout(() => {
        scrollingRef.current = false
        refresh()
      }, 200)
      scheduleRefresh()
    }

    resizeObserver.observe(target)
    // 只观察结构性变化。`attributes: true` 会让 CodeMirror 每次滚动重建装饰时
    // 都回调一遍，而每次回调都要读 scrollHeight（强制同步布局）。
    mutationObserver.observe(target, { childList: true, subtree: true })
    target.addEventListener('scroll', handleScroll, { passive: true })
    window.addEventListener('resize', scheduleRefresh)
    scheduleRefresh()

    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame)
      window.clearTimeout(scrollEndTimerRef.current)
      resizeObserver.disconnect()
      mutationObserver.disconnect()
      target.removeEventListener('scroll', handleScroll)
      window.removeEventListener('resize', scheduleRefresh)
    }
  }, [refresh, targetRef])

  const finishDrag = useCallback((): void => {
    if (!dragRef.current) return
    dragRef.current = null
    setDragOffset(null)
    // 松手后用真实几何收敛一次：拖动期间文档高度可能已经变化，拇指长度和位置
    // 需要按最终 scrollHeight 重新计算。
    const target = targetRef.current
    if (target) setMetrics(readMetrics(target))
    onInteractionEndRef.current?.()
  }, [targetRef])

  useEffect(() => {
    window.addEventListener('pointerup', finishDrag)
    window.addEventListener('pointercancel', finishDrag)
    window.addEventListener('blur', finishDrag)
    return () => {
      window.removeEventListener('pointerup', finishDrag)
      window.removeEventListener('pointercancel', finishDrag)
      window.removeEventListener('blur', finishDrag)
    }
  }, [finishDrag])

  if (!metrics) return null

  const hasHorizontal = axes !== 'vertical' && metrics.scrollWidth > metrics.clientWidth
  const hasVertical = axes !== 'horizontal' && metrics.scrollHeight > metrics.clientHeight
  if (!hasHorizontal && !hasVertical) return null

  const scrollAxis = (
    axis: ScrollAxis,
    event: PointerEvent<HTMLDivElement>,
    track: HTMLDivElement,
  ): void => {
    const target = targetRef.current
    if (!target) return

    const rect = track.getBoundingClientRect()
    const position = pointerPosition(axis, event)
    const offset = axis === 'horizontal' ? position - rect.left : position - rect.top
    const length = axis === 'horizontal' ? rect.width : rect.height
    const maxScroll =
      axis === 'horizontal'
        ? Math.max(0, target.scrollWidth - target.clientWidth)
        : Math.max(0, target.scrollHeight - target.clientHeight)
    const nextPosition = Math.max(0, Math.min(1, offset / length))
    if (axis === 'horizontal') target.scrollLeft = nextPosition * maxScroll
    else target.scrollTop = nextPosition * maxScroll
  }

  const handleTrackPointerDown = (axis: ScrollAxis, event: PointerEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget) return
    event.preventDefault()
    onInteractionStartRef.current?.()
    try {
      scrollAxis(axis, event, event.currentTarget)
    } finally {
      onInteractionEndRef.current?.()
    }
  }

  const handleThumbPointerDown = (axis: ScrollAxis, event: PointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    const target = targetRef.current
    const track = event.currentTarget.parentElement
    if (!target || !track) return
    onInteractionStartRef.current?.()

    // Freeze the whole scroll→thumb mapping for the duration of the drag. See
    // `DragState.maxScroll` for why re-reading scrollHeight per move is the bug.
    const trackRect = track.getBoundingClientRect()
    const trackLength = axis === 'horizontal' ? trackRect.width : trackRect.height
    const viewportLength = axis === 'horizontal' ? target.clientWidth : target.clientHeight
    const contentLength = axis === 'horizontal' ? target.scrollWidth : target.scrollHeight
    const thumbLength = Math.max(18, trackLength * (viewportLength / Math.max(1, contentLength)))
    const maxThumbOffset = Math.max(1, trackLength - thumbLength)
    const maxScroll = Math.max(0, contentLength - viewportLength)
    const scrollPosition = axis === 'horizontal' ? target.scrollLeft : target.scrollTop

    dragRef.current = {
      axis,
      pointerPosition: pointerPosition(axis, event),
      scrollPosition,
      maxScroll,
      maxThumbOffset,
      travel: maxThumbOffset,
    }
    const ratio = maxScroll > 0 ? scrollPosition / maxScroll : 0
    setDragOffset({ axis, offset: Math.max(0, Math.min(maxThumbOffset, ratio * maxThumbOffset)) })
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handleThumbPointerMove = (axis: ScrollAxis, event: PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    const target = targetRef.current
    if (!drag || drag.axis !== axis || !target) return

    const delta = pointerPosition(axis, event) - drag.pointerPosition
    const nextScroll = Math.max(
      0,
      Math.min(
        drag.maxScroll,
        drag.scrollPosition + (delta / drag.maxThumbOffset) * drag.maxScroll,
      ),
    )
    if (axis === 'horizontal') target.scrollLeft = nextScroll
    else target.scrollTop = nextScroll

    const ratio = drag.maxScroll > 0 ? nextScroll / drag.maxScroll : 0
    setDragOffset({ axis, offset: Math.max(0, Math.min(drag.travel, ratio * drag.travel)) })
  }

  const horizontalTrackLength = Math.max(0, metrics.clientWidth - (hasVertical ? 14 : 4))
  const verticalTrackLength = Math.max(0, metrics.clientHeight - (hasHorizontal ? 14 : 4))
  const horizontalThumbLength = Math.max(
    18,
    horizontalTrackLength * (metrics.clientWidth / metrics.scrollWidth),
  )
  const verticalThumbLength = Math.max(
    18,
    verticalTrackLength * (metrics.clientHeight / metrics.scrollHeight),
  )
  const horizontalTravel = Math.max(0, horizontalTrackLength - horizontalThumbLength)
  const verticalTravel = Math.max(0, verticalTrackLength - verticalThumbLength)
  // While dragging, the thumb follows the frozen snapshot ratio instead of the live
  // scrollTop: document height changes mid-drag would otherwise move it under the
  // pointer.
  const verticalOffset =
    dragOffset?.axis === 'vertical'
      ? dragOffset.offset
      : clamp(
          (metrics.scrollTop / Math.max(1, metrics.scrollHeight - metrics.clientHeight)) *
            verticalTravel,
          verticalTravel,
        )
  const horizontalOffset =
    dragOffset?.axis === 'horizontal'
      ? dragOffset.offset
      : clamp(
          (metrics.scrollLeft / Math.max(1, metrics.scrollWidth - metrics.clientWidth)) *
            horizontalTravel,
          horizontalTravel,
        )

  return (
    <div
      className={[
        'hover-scrollbars',
        hasHorizontal ? 'has-horizontal' : '',
        hasVertical ? 'has-vertical' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-window-drag-interactive
      aria-hidden="true"
    >
      {hasVertical && (
        <div
          className="hover-scrollbar-track hover-scrollbar-track-vertical"
          onPointerDown={(event) => handleTrackPointerDown('vertical', event)}
        >
          <div
            className="hover-scrollbar-thumb"
            style={{
              height: `${verticalThumbLength}px`,
              transform: `translateY(${verticalOffset}px)`,
            }}
            onPointerDown={(event) => handleThumbPointerDown('vertical', event)}
            onPointerMove={(event) => handleThumbPointerMove('vertical', event)}
            onLostPointerCapture={finishDrag}
          />
        </div>
      )}
      {hasHorizontal && (
        <div
          className="hover-scrollbar-track hover-scrollbar-track-horizontal"
          onPointerDown={(event) => handleTrackPointerDown('horizontal', event)}
        >
          <div
            className="hover-scrollbar-thumb"
            style={{
              width: `${horizontalThumbLength}px`,
              transform: `translateX(${horizontalOffset}px)`,
            }}
            onPointerDown={(event) => handleThumbPointerDown('horizontal', event)}
            onPointerMove={(event) => handleThumbPointerMove('horizontal', event)}
            onLostPointerCapture={finishDrag}
          />
        </div>
      )}
    </div>
  )
}
