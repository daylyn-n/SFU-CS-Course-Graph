import { describe as group, expect, it } from 'vitest';
import { UndoStack, COALESCE_MS, MAX_STEPS } from './undoStack';
import { describe } from './describe';
import type { Values } from './doc';
import { validateState } from '../schedule/schedule';

const base = (): Values => ({
  taken: [],
  notTaken: [],
  slots: validateState(null).slots,
  settings: { assumePrereqs: true, program: '', planPerTerm: 4 },
});
const withTaken = (...taken: string[]): Values => ({ ...base(), taken });
const withSlot = (i: number, courses: { code: string; picks?: Record<string, string> }[], patch: object = {}): Values => {
  const v = base();
  v.slots[i] = { ...v.slots[i], ...patch, courses: courses.map((c) => ({ code: c.code, picks: c.picks ?? {} })) };
  return v;
};

function clocked() {
  let t = 1000;
  const stack = new UndoStack(() => t);
  return { stack, advance: (ms: number) => (t += ms) };
}

group('UndoStack', () => {
  it('coalesces quick local edits into one step', () => {
    const { stack, advance } = clocked();
    stack.record('local', base(), withTaken('A 100'));
    advance(COALESCE_MS - 100);
    stack.record('local', withTaken('A 100'), withTaken('A 100', 'B 100'));
    expect(stack.past).toHaveLength(1);
    expect(stack.past[0].before).toEqual(base());
    expect(stack.past[0].after).toEqual(withTaken('A 100', 'B 100'));
    advance(COALESCE_MS + 1);
    stack.record('local', withTaken('A 100', 'B 100'), withTaken('A 100'));
    expect(stack.past).toHaveLength(2);
  });

  it('undo then redo moves the step between the stacks', () => {
    const { stack } = clocked();
    stack.record('local', base(), withTaken('A 100'));
    const step = stack.undo()!;
    expect(step.before).toEqual(base());
    stack.record('undo', withTaken('A 100'), base()); // our own echo: ignored
    expect(stack.past).toHaveLength(0);
    expect(stack.future).toHaveLength(1);
    expect(stack.redo()).toBe(step);
    expect(stack.past).toHaveLength(1);
    expect(stack.redo()).toBeNull();
  });

  it('a new edit clears redo', () => {
    const { stack, advance } = clocked();
    stack.record('local', base(), withTaken('A 100'));
    stack.undo();
    advance(10);
    stack.record('local', base(), withTaken('C 100'));
    expect(stack.future).toHaveLength(0);
    // ...and doesn't join the undone step even though it came quickly.
    expect(stack.past).toHaveLength(1);
    expect(stack.past[0].after).toEqual(withTaken('C 100'));
  });

  it.each(['tab', 'remote', 'load'] as const)('a %s change is a barrier: clears undo and redo', (source) => {
    const { stack, advance } = clocked();
    stack.record('local', base(), withTaken('A 100'));
    advance(2000);
    stack.record('local', withTaken('A 100'), withTaken('A 100', 'B 100'));
    stack.undo();
    stack.record(source, withTaken('A 100'), withTaken('A 100', 'Z 100'));
    expect(stack.past).toHaveLength(0);
    expect(stack.future).toHaveLength(0);
    expect(stack.undo()).toBeNull();
    // Edits after the barrier can be undone, but only back to it.
    stack.record('local', withTaken('A 100', 'Z 100'), withTaken('Z 100'));
    expect(stack.undo()!.before).toEqual(withTaken('A 100', 'Z 100'));
    expect(stack.undo()).toBeNull();
  });

  it('restores, imports and sealed (bulk) changes are steps of their own', () => {
    const { stack } = clocked();
    stack.record('local', base(), withTaken('A 100'));
    stack.record('import', withTaken('A 100'), withTaken('B 100'));
    stack.record('local', withTaken('B 100'), withTaken('B 100', 'C 100'));
    expect(stack.past).toHaveLength(3);
    stack.seal();
    stack.record('local', withTaken('B 100', 'C 100'), withTaken('C 100'));
    expect(stack.past).toHaveLength(4);
  });

  it(`keeps at most ${MAX_STEPS} steps`, () => {
    const { stack, advance } = clocked();
    for (let i = 0; i < MAX_STEPS + 10; i++) {
      stack.record('local', withTaken(`A ${i}`), withTaken(`A ${i + 1}`));
      advance(COALESCE_MS * 2);
    }
    expect(stack.past).toHaveLength(MAX_STEPS);
    expect(stack.past[0].before).toEqual(withTaken('A 10'));
  });
});

group('describe', () => {
  it('names single changes', () => {
    expect(describe(base(), withTaken('CMPT 120'))).toEqual({ text: 'ticked CMPT 120', slot: null });
    expect(describe(withTaken('CMPT 120'), base()).text).toBe('unticked CMPT 120');
    expect(describe(base(), withTaken('A 100', 'B 100', 'C 100')).text).toBe('ticked 3 courses');
    expect(describe(base(), { ...base(), notTaken: ['MACM 101'] }).text).toBe('marked MACM 101 as not taken');
  });

  it('names schedule changes and the slot they were in', () => {
    const one = withSlot(1, [{ code: 'CMPT 225' }, { code: 'CMPT 120' }]);
    const two = withSlot(1, [{ code: 'CMPT 120' }]);
    expect(describe(one, two)).toEqual({ text: 'removed CMPT 225 from Schedule 2', slot: 1 });
    expect(describe(two, one)).toEqual({ text: 'added CMPT 225 to Schedule 2', slot: 1 });
    expect(describe(one, withSlot(1, []))).toEqual({ text: 'cleared Schedule 2', slot: 1 });
    const picked = withSlot(1, [{ code: 'CMPT 225', picks: { enrol: 'D200' } }, { code: 'CMPT 120' }]);
    expect(describe(one, picked).text).toBe('changed sections for CMPT 225');
    const arranged = withSlot(1, [
      { code: 'CMPT 225', picks: { enrol: 'D200' } },
      { code: 'CMPT 120', picks: { enrol: 'D100' } },
    ]);
    expect(describe(one, arranged).text).toBe('changed sections in Schedule 2');
    expect(describe(one, withSlot(1, [{ code: 'CMPT 225' }, { code: 'CMPT 120' }], { term: '1267' })).text).toBe(
      'changed the term of Schedule 2',
    );
    expect(describe(base(), withSlot(2, [{ code: 'CMPT 120' }], { name: 'Plan B copy' })).text).toBe(
      'replaced Schedule 3 with Plan B copy',
    );
    expect(describe(base(), withSlot(0, [], { name: 'Fall' })).text).toBe('renamed Schedule 1 to Fall');
  });

  it('counts mixed changes', () => {
    const after = withSlot(0, [{ code: 'CMPT 225' }]);
    after.taken = ['CMPT 120'];
    after.settings = { ...after.settings, planPerTerm: 5 };
    expect(describe(base(), after)).toEqual({ text: '3 changes', slot: 0 });
    expect(describe(base(), base()).text).toBe('no changes');
  });
});
