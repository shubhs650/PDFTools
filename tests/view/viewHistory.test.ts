import { describe, expect, it } from 'vitest';
import { ViewHistory, samePlace, type Place } from '../../src/features/view/history';

// Previous / Next View (M2-10), one history for the window (M13-04, D-70, owner choice P2):
// places are a tab and, for a document, its view; a comparison tab is a tab only.

const at = (page: number, tab = 'a', scrollTop = page * 1000): Place => ({
  tab,
  view: { page, scale: 1, scrollLeft: 0, scrollTop },
});
const tab = (id: string): Place => ({ tab: id });

describe('ViewHistory', () => {
  it('goes back and forward like a browser', () => {
    const h = new ViewHistory();
    expect(h.canBack).toBe(false);
    h.jump(at(0)); // 0 → 10
    h.jump(at(10)); // 10 → 20
    expect(h.goBack(at(20))).toEqual(at(10));
    expect(h.goBack(at(10))).toEqual(at(0));
    expect(h.goBack(at(0))).toBeNull();
    expect(h.goForward(at(0))).toEqual(at(10));
    expect(h.goForward(at(10))).toEqual(at(20));
    expect(h.canForward).toBe(false);
  });

  it('a jump after going back drops the forward entries (branching)', () => {
    const h = new ViewHistory();
    h.jump(at(0));
    h.jump(at(10));
    h.goBack(at(20)); // at 10, forward: 20
    h.jump(at(10)); // 10 → 30
    expect(h.canForward).toBe(false);
    expect(h.goBack(at(30))).toEqual(at(10));
  });

  it('ignores a repeated jump from the same place and keeps at most `cap` entries', () => {
    const h = new ViewHistory(3);
    h.jump(at(1));
    h.jump(at(1));
    for (let i = 2; i <= 6; i++) h.jump(at(i));
    const back: number[] = [];
    for (let e = h.goBack(at(7)); e; e = h.goBack(at(0))) back.push(e.view?.page ?? -1);
    expect(back).toEqual([6, 5, 4]);
  });

  it('one history across tabs: a tab switch is a step like any jump', () => {
    const h = new ViewHistory();
    h.jump(at(0, 'a')); // page box in A: 0 → 5
    h.jump(at(5, 'a')); // switch to B
    h.jump(at(2, 'b')); // switch to the comparison C
    expect(h.goBack(tab('c'))).toEqual(at(2, 'b'));
    expect(h.goBack(at(2, 'b'))).toEqual(at(5, 'a'));
    expect(h.goBack(at(5, 'a'))).toEqual(at(0, 'a'));
    expect(h.goForward(at(0, 'a'))).toEqual(at(5, 'a'));
    expect(h.goForward(at(5, 'a'))).toEqual(at(2, 'b'));
    expect(h.goForward(at(2, 'b'))).toEqual(tab('c'));
  });

  it('a comparison tab is a tab only: no view, equal to itself', () => {
    expect(samePlace(tab('c'), tab('c'))).toBe(true);
    expect(samePlace(tab('c'), tab('d'))).toBe(false);
    expect(samePlace(at(1, 'a'), at(1, 'b'))).toBe(false);
    expect(
      samePlace(at(1, 'a'), {
        tab: 'a',
        view: { page: 1, scale: 1, scrollLeft: 0.4, scrollTop: 1000.6 },
      }),
    ).toBe(true);
    expect(samePlace(at(1, 'a'), tab('a'))).toBe(false);
  });

  it('going back skips places equal to where the window is now', () => {
    const h = new ViewHistory();
    h.jump(at(3)); // 3 → 9
    h.jump(at(9)); // 9 → 12, then the person scrolls back to 9 by hand (not recorded)
    // Going back from 9 skips the entry for 9 and lands on 3.
    expect(h.goBack(at(9))).toEqual(at(3));
    expect(h.goForward(at(3))).toEqual(at(9));
  });

  it('nothing to go back to: the current place is not kept for Next View', () => {
    const h = new ViewHistory();
    h.jump(at(4));
    expect(h.goBack(at(4))).toBeNull();
    expect(h.canBack).toBe(false);
    expect(h.canForward).toBe(false);
  });

  it('forget: closing a document removes its entries; neighbours that meet merge', () => {
    const h = new ViewHistory();
    h.jump(at(1, 'a'));
    h.jump(at(2, 'b'));
    h.jump(at(1, 'a'));
    h.jump(tab('c'));
    expect(h.forget((t) => t !== 'b')).toBe(true);
    expect(h.goBack(at(0, 'd'))).toEqual(tab('c'));
    expect(h.goBack(tab('c'))).toEqual(at(1, 'a'));
    // The two "page 1 of A" entries became neighbours and merged into one.
    expect(h.goBack(at(1, 'a'))).toBeNull();
    expect(h.forget(() => true)).toBe(false);
  });

  it('forget reaches the forward entries too, and the place a step would land on', () => {
    const h = new ViewHistory();
    h.jump(at(1, 'a'));
    h.jump(at(2, 'b'));
    h.goBack(at(3, 'c')); // at b, forward: c
    h.goBack(at(2, 'b')); // at a, forward: b, c
    h.forget((t) => t !== 'c');
    expect(h.goForward(at(1, 'a'))).toEqual(at(2, 'b'));
    expect(h.canForward).toBe(false);
  });

  it('a document kept as its tab only: no empty step on its own tab', () => {
    const h = new ViewHistory();
    h.jump(tab('a')); // a was left before it was laid out
    h.jump(at(2, 'b')); // b → a, then a: page 1 → 9
    h.jump(at(1, 'a'));
    // From a's page 9: page 1 of a, then b; the tab-only entry for a would not move.
    expect(h.goBack(at(9, 'a'))).toEqual(at(1, 'a'));
    expect(h.goBack(at(1, 'a'))).toEqual(at(2, 'b'));
    expect(h.goBack(at(2, 'b'))).toEqual(tab('a'));
  });

  it('forget merges a tab-only place into its neighbour with a view', () => {
    const h = new ViewHistory();
    h.jump(tab('a'));
    h.jump(at(4, 'b'));
    h.jump(at(1, 'a'));
    h.forget((t) => t !== 'b');
    expect(h.goBack(at(9, 'a'))).toEqual(at(1, 'a'));
    expect(h.canBack).toBe(false);
  });
});
