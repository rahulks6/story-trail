import React from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { DrawingCanvas } from "../src/components/DrawingCanvas";
import { DraggableCanvasObject } from "../src/components/DraggableCanvasObject";
import { filterSwipeStep, pinchPlacement, strokePath } from "../src/models/canvasGestures";
import type { DrawStroke, Overlay } from "../src/models/storyDraft";

/**
 * Touches as React Native delivers them to a PanResponder: page coordinates in nativeEvent.touches,
 * and the responder's touch history alongside.
 */
type Point = [number, number];
function touchEvent(points: Point[], at = Date.now(), origin: Point = [0, 0]) {
  const touches = points.map(([x, y], i) => ({ identifier: i, pageX: x, pageY: y, locationX: x - origin[0], locationY: y - origin[1], timestamp: at }));
  const touchBank = touches.map((t) => ({
    touchActive: true, startPageX: t.pageX, startPageY: t.pageY, startTimeStamp: at,
    currentPageX: t.pageX, currentPageY: t.pageY, currentTimeStamp: at,
    previousPageX: t.pageX, previousPageY: t.pageY, previousTimeStamp: at,
  }));
  return {
    nativeEvent: { ...touches[0], touches, changedTouches: touches },
    touchHistory: { numberActiveTouches: touches.length, indexOfSingleActiveTouch: 0, mostRecentTimeStamp: at, touchBank },
  };
}

function gesture(view: ReactTestInstance, steps: Point[][], origin: Point = [0, 0]) {
  const h = view.props;
  act(() => {
    h.onResponderGrant(touchEvent(steps[0]!, 1, origin));
    for (let i = 1; i < steps.length; i++) h.onResponderMove(touchEvent(steps[i]!, 1 + i, origin));
    h.onResponderRelease(touchEvent(steps[steps.length - 1]!, 99, origin));
  });
}

describe("gesture maths", () => {
  it("resizes, turns and moves with two fingers", () => {
    const start = { x: 0.5, y: 0.5, scale: 1, rotation: 10 };
    // Fingers spread to twice the distance, turn a quarter, and their middle moves 40 px right and 50 px down.
    const next = pinchPlacement(start, [{ pageX: 100, pageY: 100 }, { pageX: 200, pageY: 100 }], [{ pageX: 190, pageY: 50 }, { pageX: 190, pageY: 250 }], 400, 800);
    expect(next.scale).toBeCloseTo(2);
    expect(next.rotation).toBeCloseTo(100);
    expect(next.x).toBeCloseTo(0.5 + 40 / 400);
    expect(next.y).toBeCloseTo(0.5 + 50 / 800);
    // Never smaller than readable or larger than the screen allows.
    expect(pinchPlacement(start, [{ pageX: 0, pageY: 0 }, { pageX: 100, pageY: 0 }], [{ pageX: 0, pageY: 0 }, { pageX: 1, pageY: 0 }], 400, 800).scale).toBe(0.3);
  });

  it("draws a smooth path, and a dot for a tap", () => {
    expect(strokePath([{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 0 }], 100, 100)).toBe("M0 0Q50 50 75 25L100 0");
    expect(strokePath([{ x: 0.2, y: 0.2 }], 100, 100)).toMatch(/^M20 20L20\.1 20$/);
  });

  it("changes filter on a sideways swipe, never on a vertical one", () => {
    expect(filterSwipeStep(-60, 5)).toBe(-1);
    expect(filterSwipeStep(60, 5)).toBe(1);
    expect(filterSwipeStep(30, 0)).toBe(0);
    expect(filterSwipeStep(60, 80)).toBe(0);
  });
});

describe("drawing", () => {
  let tree: ReactTestRenderer;
  const canvas = () => tree.root.find((n: ReactTestInstance) => n.props.accessibilityLabel === "Drawing canvas" && typeof n.type === "string");
  // Drawn strokes (the toolbar's icons are paths too).
  const paths = () => tree.root.findAll((n: ReactTestInstance) => (n.type as unknown) === "Path" && n.props.strokeLinecap === "round");

  it("keeps the touch layer on Android and draws where the finger goes, even off the layer's origin", () => {
    let strokes: DrawStroke[] = [];
    const onChange = jest.fn((next: DrawStroke[]) => { strokes = next; });
    act(() => { tree = create(<DrawingCanvas containerWidth={400} containerHeight={800} strokes={strokes} onChangeStrokes={onChange} onDone={jest.fn()} />); });
    expect(canvas().props.collapsable).toBe(false);
    // The layer starts 30 px down the screen.
    gesture(canvas(), [[[100, 130]], [[150, 230]], [[200, 330]]], [0, 30]);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(strokes[0]!.points).toEqual([{ x: 0.25, y: 0.125 }, { x: 0.375, y: 0.25 }, { x: 0.5, y: 0.375 }]);
    act(() => tree.update(<DrawingCanvas containerWidth={400} containerHeight={800} strokes={strokes} onChangeStrokes={onChange} onDone={jest.fn()} />));
    expect(paths()).toHaveLength(1);
    expect(paths()[0]!.props).toMatchObject({ strokeLinecap: "round", strokeLinejoin: "round", stroke: "#FFFFFF" });
  });

  it("hides the tools while drawing, and undoes and erases", () => {
    let strokes: DrawStroke[] = [{ id: "s1", tool: "pen", color: "#000000", width: 0.01, points: [{ x: 0.5, y: 0.5 }, { x: 0.6, y: 0.5 }] }];
    const onChange = jest.fn((next: DrawStroke[]) => { strokes = next; });
    const render = () => <DrawingCanvas containerWidth={400} containerHeight={800} strokes={strokes} onChangeStrokes={onChange} onDone={jest.fn()} />;
    act(() => { tree = create(render()); });
    const toolsShown = () => tree.root.findAll((n: ReactTestInstance) => n.props.accessibilityLabel === "Done drawing" && typeof n.type === "string").length > 0;
    act(() => canvas().props.onResponderGrant(touchEvent([[10, 10]], 1)));
    expect(toolsShown()).toBe(false);
    act(() => canvas().props.onResponderRelease(touchEvent([[10, 10]], 2)));
    expect(toolsShown()).toBe(true);
    // The tap left a dot.
    expect(strokes).toHaveLength(2);
    act(() => tree.update(render()));
    const press = (label: string) => act(() => tree.root.find((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.props.accessibilityLabel === label).props.onPress());
    press("Undo");
    expect(strokes).toHaveLength(1);
    act(() => tree.update(render()));
    press("eraser tool");
    gesture(canvas(), [[[200, 400]], [[240, 400]]]);
    expect(strokes).toEqual([]);
  });
});

describe("moving text and stickers", () => {
  let tree: ReactTestRenderer;
  let overlay: Overlay;
  const handlers = {
    onChange: jest.fn((id: string, patch: Partial<Overlay>) => { overlay = { ...overlay, ...patch } as Overlay; }),
    onTouchStart: jest.fn(), onTap: jest.fn(), onOpenControls: jest.fn(), onDragStateChange: jest.fn(), onOverTrashChange: jest.fn(), onDeleted: jest.fn(),
  };
  const render = () => (
    <DraggableCanvasObject overlay={overlay} containerWidth={400} containerHeight={800} isOverTrash={(x, y) => y > 700 && x > 150 && x < 250} {...handlers} />
  );
  const view = () => tree.root.find((n: ReactTestInstance) => typeof n.type === "string" && typeof n.props.onResponderGrant === "function");

  beforeEach(() => {
    Object.values(handlers).forEach((h) => h.mockClear());
    overlay = { id: "t1", type: "text", x: 0.4, y: 0.4, scale: 1, rotation: 0, zIndex: 1, properties: { text: "Hello", font: "classic", color: "#FFFFFF", background: "none", align: "center" } } as unknown as Overlay;
    act(() => { tree = create(render()); });
  });

  it("follows the finger the whole way, even as the screen redraws mid-drag", () => {
    const v = view();
    expect(v.props.collapsable).toBe(false);
    act(() => v.props.onResponderGrant(touchEvent([[100, 100]], 1)));
    expect(handlers.onTouchStart).toHaveBeenCalledWith("t1");
    for (const [i, x] of [140, 180, 220].entries()) {
      act(() => view().props.onResponderMove(touchEvent([[x, 100 + 40 * (i + 1)]], 2 + i)));
      act(() => tree.update(render()));
    }
    act(() => view().props.onResponderRelease(touchEvent([[220, 220]], 9)));
    // 120 px right of 400 and 120 px down of 800, from where it started — not compounded.
    expect(overlay.x).toBeCloseTo(0.4 + 120 / 400);
    expect(overlay.y).toBeCloseTo(0.4 + 120 / 800);
    expect(handlers.onDragStateChange.mock.calls).toEqual([[true], [false]]);
    expect(handlers.onTap).not.toHaveBeenCalled();
  });

  it("resizes and turns when a second finger joins", () => {
    act(() => view().props.onResponderGrant(touchEvent([[100, 100]], 1)));
    act(() => view().props.onResponderMove(touchEvent([[100, 100], [200, 100]], 2)));
    act(() => view().props.onResponderMove(touchEvent([[100, 100], [100, 300]], 3)));
    act(() => view().props.onResponderRelease(touchEvent([[100, 100]], 4)));
    // The fingers went from 100 px apart, side by side, to 200 px apart, one above the other.
    expect(overlay.scale).toBeCloseTo(2);
    expect(overlay.rotation).toBeCloseTo(90);
    expect(handlers.onTap).not.toHaveBeenCalled();
  });

  it("opens on a tap, and is deleted when dropped on the trash", () => {
    gesture(view(), [[[100, 100]], [[102, 101]]]);
    expect(handlers.onTap).toHaveBeenCalledWith("t1");
    gesture(view(), [[[100, 100]], [[200, 750]]]);
    expect(handlers.onOverTrashChange).toHaveBeenCalledWith(true);
    expect(handlers.onDeleted).toHaveBeenCalledWith("t1");
  });

  it("offers button controls to a screen reader", () => {
    act(() => view().props.onAccessibilityAction({ nativeEvent: { actionName: "activate" } }));
    expect(handlers.onOpenControls).toHaveBeenCalledWith("t1");
  });
});
