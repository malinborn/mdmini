import { describe, it, expect } from 'vitest';
import {
  parseSvgSize,
  estimateFrameHeight,
  fitScale,
  minScale,
  computeFit,
  autoHeight,
  clampPan,
  panBy,
  zoomAt,
  wheelIntent,
  isAtFit,
  rubberBand,
  panLeftover,
  MAX_SCALE,
  MIN_FRAME_HEIGHT,
  OVERSCROLL_LIMIT,
} from './mermaid-viewport';

const frame = { width: 800, height: 400 };

describe('fitScale', () => {
  it('SmallContent_NeverUpscales', () => {
    expect(fitScale({ width: 200, height: 100 }, frame)).toBe(1);
  });

  it('WideContent_ConstrainedByWidth', () => {
    expect(fitScale({ width: 1600, height: 200 }, frame)).toBeCloseTo(0.5);
  });

  it('TallContent_ConstrainedByHeight', () => {
    expect(fitScale({ width: 400, height: 1600 }, frame)).toBeCloseTo(0.25);
  });

  it('BothOversized_TakesSmallerRatio', () => {
    // width ratio 0.5, height ratio 0.2 → 0.2 wins
    expect(fitScale({ width: 1600, height: 2000 }, frame)).toBeCloseTo(0.2);
  });

  it('ZeroContent_FallsBackToOne', () => {
    expect(fitScale({ width: 0, height: 0 }, frame)).toBe(1);
  });

  it('ZeroFrame_FallsBackToOne', () => {
    expect(fitScale({ width: 400, height: 400 }, { width: 0, height: 0 })).toBe(1);
  });
});

describe('minScale', () => {
  it('NormalContent_AllowsTenPercent', () => {
    expect(minScale({ width: 200, height: 100 }, frame)).toBeCloseTo(0.1);
  });

  it('HugeContent_AllowsZoomOutToFit', () => {
    // fit is 0.05, which is below the 0.1 floor — the floor must yield
    const content = { width: 16000, height: 2000 };
    expect(fitScale(content, frame)).toBeCloseTo(0.05);
    expect(minScale(content, frame)).toBeCloseTo(0.05);
  });
});

describe('computeFit', () => {
  it('SmallContent_CentersAtScaleOne', () => {
    const v = computeFit({ width: 200, height: 100 }, frame);
    expect(v.scale).toBe(1);
    expect(v.tx).toBeCloseTo(300); // (800 - 200) / 2
    expect(v.ty).toBeCloseTo(150); // (400 - 100) / 2
  });

  it('WideContent_ScalesDownAndCenters', () => {
    const v = computeFit({ width: 1600, height: 200 }, frame);
    expect(v.scale).toBeCloseTo(0.5);
    expect(v.tx).toBeCloseTo(0); // 1600 * 0.5 === frame width
    expect(v.ty).toBeCloseTo(150); // (400 - 100) / 2
  });
});

describe('autoHeight', () => {
  it('ShortContent_UsesScaledContentHeight', () => {
    // fits by width already, so height is unchanged
    expect(autoHeight({ width: 400, height: 200 }, 800, 600)).toBeCloseTo(200);
  });

  it('WideContent_UsesWidthScaledHeight', () => {
    // scaled by 800/1600 = 0.5 → height 300
    expect(autoHeight({ width: 1600, height: 600 }, 800, 600)).toBeCloseTo(300);
  });

  it('TallContent_ClampedToMax', () => {
    expect(autoHeight({ width: 400, height: 5000 }, 800, 600)).toBe(600);
  });

  it('TinyContent_ClampedToMinimum', () => {
    expect(autoHeight({ width: 20, height: 10 }, 800, 600)).toBe(MIN_FRAME_HEIGHT);
  });

  it('ZeroContent_ClampedToMinimum', () => {
    expect(autoHeight({ width: 0, height: 0 }, 800, 600)).toBe(MIN_FRAME_HEIGHT);
  });
});

describe('clampPan', () => {
  it('ContentSmallerThanFrame_CentersBothAxes', () => {
    const v = clampPan({ scale: 1, tx: -999, ty: 999 }, { width: 200, height: 100 }, frame);
    expect(v.tx).toBeCloseTo(300);
    expect(v.ty).toBeCloseTo(150);
  });

  it('OversizedContent_LeftEdgeCannotMoveInside', () => {
    // scaled width 1600 > 800; tx must stay <= 0
    const v = clampPan({ scale: 1, tx: 50, ty: 0 }, { width: 1600, height: 400 }, frame);
    expect(v.tx).toBe(0);
  });

  it('OversizedContent_RightEdgeCannotMoveInside', () => {
    // tx must stay >= 800 - 1600 = -800
    const v = clampPan({ scale: 1, tx: -5000, ty: 0 }, { width: 1600, height: 400 }, frame);
    expect(v.tx).toBe(-800);
  });

  it('OversizedContent_WithinBounds_LeavesUnchanged', () => {
    const v = clampPan({ scale: 1, tx: -300, ty: 0 }, { width: 1600, height: 400 }, frame);
    expect(v.tx).toBe(-300);
  });

  it('ScaleFactoredIntoBounds', () => {
    // content 1600 at scale 2 → 3200 wide; min tx = 800 - 3200 = -2400
    const v = clampPan({ scale: 2, tx: -9999, ty: 0 }, { width: 1600, height: 200 }, frame);
    expect(v.tx).toBe(-2400);
  });
});

describe('panBy', () => {
  const content = { width: 1600, height: 1200 };

  it('PositiveDelta_MovesContentUpAndLeft', () => {
    // wheel down/right → content moves negative (like scrolling)
    const v = panBy({ scale: 1, tx: -100, ty: -100 }, 30, 40, content, frame);
    expect(v.tx).toBe(-130);
    expect(v.ty).toBe(-140);
  });

  it('AtEdge_ClampsInsteadOfOvershooting', () => {
    const v = panBy({ scale: 1, tx: -10, ty: 0 }, -50, -50, content, frame);
    expect(v.tx).toBe(0);
    expect(v.ty).toBe(0);
  });

  it('PreservesScale', () => {
    const v = panBy({ scale: 2.5, tx: -100, ty: -100 }, 10, 10, content, frame);
    expect(v.scale).toBe(2.5);
  });
});

describe('zoomAt', () => {
  const content = { width: 1600, height: 1200 };

  it('PointUnderCursor_StaysAnchored', () => {
    const before = { scale: 1, tx: -200, ty: -100 };
    const point = { x: 300, y: 200 };
    // content coordinate currently under the pointer
    const cx = (point.x - before.tx) / before.scale;
    const cy = (point.y - before.ty) / before.scale;

    const after = zoomAt(before, 2, point, content, frame);

    expect(after.tx + cx * after.scale).toBeCloseTo(point.x);
    expect(after.ty + cy * after.scale).toBeCloseTo(point.y);
  });

  it('ZoomOutThenIn_ReturnsToSameView', () => {
    const start = { scale: 2, tx: -400, ty: -300 };
    const point = { x: 400, y: 200 };
    const out = zoomAt(start, 0.5, point, content, frame);
    const back = zoomAt(out, 2, point, content, frame);
    expect(back.scale).toBeCloseTo(start.scale);
    expect(back.tx).toBeCloseTo(start.tx);
    expect(back.ty).toBeCloseTo(start.ty);
  });

  it('ExceedsMaxScale_ClampsToMax', () => {
    const v = zoomAt({ scale: 1, tx: 0, ty: 0 }, 1000, { x: 0, y: 0 }, content, frame);
    expect(v.scale).toBe(MAX_SCALE);
  });

  it('BelowMinScale_ClampsToMin', () => {
    const v = zoomAt({ scale: 1, tx: 0, ty: 0 }, 0.0001, { x: 0, y: 0 }, content, frame);
    expect(v.scale).toBeCloseTo(minScale(content, frame));
  });

  it('ZoomedOutBelowFrame_ResultIsCentered', () => {
    const v = zoomAt({ scale: 1, tx: -200, ty: -100 }, 0.1, { x: 400, y: 200 }, content, frame);
    // 1600 * 0.1 = 160 < 800 → centered
    expect(v.tx).toBeCloseTo((800 - 1600 * v.scale) / 2);
  });
});

describe('isAtFit', () => {
  const content = { width: 1600, height: 1200 };

  it('ExactFitScale_True', () => {
    expect(isAtFit(computeFit(content, frame), content, frame)).toBe(true);
  });

  it('ZoomedIn_False', () => {
    expect(isAtFit({ scale: 1, tx: 0, ty: 0 }, content, frame)).toBe(false);
  });

  it('ZoomedOutBeyondFit_True', () => {
    // more zoomed out than fit — nothing to pan, so treat as fit
    expect(isAtFit({ scale: 0.05, tx: 0, ty: 0 }, content, frame)).toBe(true);
  });
});

describe('wheelIntent', () => {
  const content = { width: 1600, height: 1200 };
  const fit = computeFit(content, frame);

  it('CtrlKey_IsPinchZoom', () => {
    expect(wheelIntent({ ctrlKey: true, metaKey: false, deltaX: 0, deltaY: -5 }, fit, content, frame)).toBe('zoom');
  });

  it('MetaKey_IsZoom', () => {
    expect(wheelIntent({ ctrlKey: false, metaKey: true, deltaX: 0, deltaY: -5 }, fit, content, frame)).toBe('zoom');
  });

  it('AtFit_PassesThroughToDocument', () => {
    expect(wheelIntent({ ctrlKey: false, metaKey: false, deltaX: 0, deltaY: 40 }, fit, content, frame)).toBe('passthrough');
  });

  it('ZoomedIn_Pans', () => {
    const zoomed = clampPan({ scale: 2, tx: -400, ty: -300 }, content, frame);
    expect(wheelIntent({ ctrlKey: false, metaKey: false, deltaX: 0, deltaY: 40 }, zoomed, content, frame)).toBe('pan');
  });

  it('ZoomedInAtBottomEdge_ScrollingDownPassesThrough', () => {
    const atBottom = clampPan({ scale: 2, tx: -400, ty: -99999 }, content, frame);
    expect(wheelIntent({ ctrlKey: false, metaKey: false, deltaX: 0, deltaY: 40 }, atBottom, content, frame)).toBe('passthrough');
  });

  it('ZoomedInAtBottomEdge_ScrollingUpStillPans', () => {
    const atBottom = clampPan({ scale: 2, tx: -400, ty: -99999 }, content, frame);
    expect(wheelIntent({ ctrlKey: false, metaKey: false, deltaX: 0, deltaY: -40 }, atBottom, content, frame)).toBe('pan');
  });

  it('ZoomedInAtBottomEdge_HorizontalRoomStillPans', () => {
    const atBottom = clampPan({ scale: 2, tx: -400, ty: -99999 }, content, frame);
    expect(wheelIntent({ ctrlKey: false, metaKey: false, deltaX: 30, deltaY: 40 }, atBottom, content, frame)).toBe('pan');
  });

  it('ZoomedInAtTopEdge_ScrollingUpPassesThrough', () => {
    const atTop = clampPan({ scale: 2, tx: -400, ty: 99999 }, content, frame);
    expect(wheelIntent({ ctrlKey: false, metaKey: false, deltaX: 0, deltaY: -40 }, atTop, content, frame)).toBe('passthrough');
  });

  it('NotUserZoomed_PassesThroughEvenWhenScaleExceedsFit', () => {
    // A frame that just shrank leaves scale above fit without the user zooming;
    // the document must still own the gesture.
    const zoomed = clampPan({ scale: 2, tx: -400, ty: -300 }, content, frame);
    expect(wheelIntent({ ctrlKey: false, metaKey: false, deltaX: 0, deltaY: 40 }, zoomed, content, frame, false))
      .toBe('passthrough');
  });

  it('UserZoomed_PansEvenWhenScaleLooksLikeFit', () => {
    const fitView = computeFit(content, frame);
    // scale === fit, but nothing to pan → still passthrough
    expect(wheelIntent({ ctrlKey: false, metaKey: false, deltaX: 0, deltaY: 40 }, fitView, content, frame, true))
      .toBe('passthrough');
  });

  it('CtrlKeyZoomsRegardlessOfUserZoomed', () => {
    const fitView = computeFit(content, frame);
    expect(wheelIntent({ ctrlKey: true, metaKey: false, deltaX: 0, deltaY: -5 }, fitView, content, frame, false))
      .toBe('zoom');
  });
});

describe('rubberBand', () => {
  it('ZeroOverscroll_ZeroOffset', () => {
    expect(rubberBand(0)).toBe(0);
  });

  it('NeverReachesTheLimit', () => {
    for (const raw of [10, 100, 1000, 100000]) {
      expect(Math.abs(rubberBand(raw, OVERSCROLL_LIMIT))).toBeLessThan(OVERSCROLL_LIMIT);
    }
  });

  it('MonotonicallyIncreasing', () => {
    let prev = 0;
    for (let raw = 5; raw <= 500; raw += 5) {
      const cur = rubberBand(raw);
      expect(cur).toBeGreaterThan(prev);
      prev = cur;
    }
  });

  it('Antisymmetric', () => {
    expect(rubberBand(-120)).toBeCloseTo(-rubberBand(120));
  });

  it('SmallOverscrollBarelyDamped', () => {
    // the first few pixels should still feel responsive
    expect(rubberBand(8)).toBeGreaterThan(4);
  });

  it('ZeroLimit_NoOffset', () => {
    expect(rubberBand(500, 0)).toBe(0);
  });
});

describe('panLeftover', () => {
  const content = { width: 1600, height: 1200 };

  it('MidRange_NothingRefused', () => {
    const v = clampPan({ scale: 2, tx: -400, ty: -300 }, content, frame);
    const left = panLeftover(v, 40, 40, content, frame);
    expect(left.x).toBeCloseTo(0);
    expect(left.y).toBeCloseTo(0);
  });

  it('AtBottomEdge_VerticalRefused', () => {
    const atBottom = clampPan({ scale: 2, tx: -400, ty: -99999 }, content, frame);
    const left = panLeftover(atBottom, 0, 50, content, frame);
    expect(left.y).toBeCloseTo(-50); // content wanted to keep moving up
    expect(left.x).toBeCloseTo(0);
  });

  it('AtTopEdge_VerticalRefusedTheOtherWay', () => {
    const atTop = clampPan({ scale: 2, tx: -400, ty: 99999 }, content, frame);
    const left = panLeftover(atTop, 0, -50, content, frame);
    expect(left.y).toBeCloseTo(50);
  });

  it('ContentSmallerThanFrame_EverythingRefused', () => {
    const small = { width: 200, height: 100 };
    const v = computeFit(small, frame);
    const left = panLeftover(v, 30, 30, small, frame);
    expect(left.x).toBeCloseTo(-30);
    expect(left.y).toBeCloseTo(-30);
  });
});

describe('parseSvgSize', () => {
  // Shape mermaid actually emits: a natural-size width plus an authoritative viewBox.
  const real =
    '<svg id="mermaid-render-0" width="1125.26953125" xmlns="http://www.w3.org/2000/svg"' +
    ' class="flowchart" style="max-width: none;" viewBox="0 0 1125.26953125 2055.5841064453125">';

  it('PrefersViewBox', () => {
    expect(parseSvgSize(real)).toEqual({ width: 1125.26953125, height: 2055.5841064453125 });
  });

  it('FallsBackToWidthHeightAttributes', () => {
    expect(parseSvgSize('<svg width="300" height="150">')).toEqual({ width: 300, height: 150 });
  });

  it('IgnoresPercentageSizes', () => {
    expect(parseSvgSize('<svg width="100%" height="100%">')).toBeNull();
  });

  it('ReturnsNullWhenNothingUsable', () => {
    expect(parseSvgSize('<svg>')).toBeNull();
    expect(parseSvgSize('')).toBeNull();
  });

  it('AcceptsCommaSeparatedViewBox', () => {
    expect(parseSvgSize('<svg viewBox="0,0,200,100">')).toEqual({ width: 200, height: 100 });
  });
});

describe('estimateFrameHeight', () => {
  const tall = '<svg viewBox="0 0 1000 4000">';

  it('StoredHeightWins', () => {
    expect(estimateFrameHeight(tall, 250, 800, 500)).toBe(250);
  });

  it('TallDiagramIsCappedNotNatural', () => {
    // The whole point: never return the SVG's natural height, which would let a
    // 4000px diagram dictate the line height.
    const h = estimateFrameHeight(tall, null, 800, 500);
    expect(h).toBeLessThan(4000);
    expect(h).toBeGreaterThanOrEqual(MIN_FRAME_HEIGHT);
  });

  it('WidthConstrainedDiagramScalesDown', () => {
    // 400x200 at 200px wide → half scale → 100px tall.
    expect(estimateFrameHeight('<svg viewBox="0 0 400 200">', null, 200, 500)).toBeCloseTo(100);
  });

  it('UnparseableMarkupFallsBackToMinimum', () => {
    expect(estimateFrameHeight('<svg width="100%">', null, 800, 500)).toBe(MIN_FRAME_HEIGHT);
  });

  it('NoMarkupFallsBackToMinimum', () => {
    expect(estimateFrameHeight(null, null, 800, 500)).toBe(MIN_FRAME_HEIGHT);
  });
});
