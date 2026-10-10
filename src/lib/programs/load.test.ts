import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearProgramCache, curatedProgram, loadProgram, loadProgramIndex, pickerOptions, programLabel, resolveProgramId } from './load';

const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
const notFound = () => Promise.resolve(new Response('', { status: 404 }));

describe('program loading', () => {
  beforeEach(() => clearProgramCache());

  it('maps saved hand-written ids to calendar ids, and calendar ids to the curated program', () => {
    expect(resolveProgramId('cmpt-major-bsc')).toBe('computing-science~major~bachelor-of-science-or-bachelor-of-arts');
    expect(resolveProgramId('biological-sciences~minor')).toBe('biological-sciences~minor');
    expect(curatedProgram('computing-science~minor')?.id).toBe('cmpt-minor');
    expect(curatedProgram('biological-sciences~minor')).toBeUndefined();
  });

  it('serves curated programs without fetching', async () => {
    const fetcher = vi.fn();
    const p = await loadProgram('software-systems~major~bachelor-of-science', fetcher as unknown as typeof fetch);
    expect(p?.id).toBe('sosy-major-bsc');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('fetches one program file, once, and rejects unsafe ids', async () => {
    const fetcher = vi.fn((url: string) => (url.endsWith('/biological-sciences~minor.json') ? ok({ id: 'biological-sciences~minor' }) : notFound()));
    const f = fetcher as unknown as typeof fetch;
    expect((await loadProgram('biological-sciences~minor', f))?.id).toBe('biological-sciences~minor');
    await loadProgram('biological-sciences~minor', f);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await loadProgram('no-such-program', f)).toBeNull();
    expect(await loadProgram('../secrets', f)).toBeNull();
    expect(await loadProgram('', f)).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('retries after a failed load', async () => {
    let fail = true;
    const fetcher = vi.fn(() => (fail ? Promise.reject(new Error('offline')) : ok([{ id: 'x' }])));
    const f = fetcher as unknown as typeof fetch;
    expect(await loadProgramIndex(f)).toEqual([]);
    fail = false;
    expect(await loadProgramIndex(f)).toEqual([{ id: 'x' }]);
    await loadProgramIndex(f);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('labels programs for the picker', () => {
    expect(programLabel({ fullTitle: 'Biological Sciences Major', credential: 'BSc', awardType: 'Major' })).toBe('Biological Sciences Major (BSc)');
    expect(programLabel({ fullTitle: 'Biological Sciences Minor', credential: 'Minor', awardType: 'Minor' })).toBe('Biological Sciences Minor');
    expect(
      pickerOptions([{ id: 'a', title: 'A', fullTitle: 'A Certificate', credential: 'Certificate', awardType: '', faculty: 'Faculty of Science', area: 'a' }]),
    ).toEqual([{ id: 'a', name: 'A Certificate', faculty: 'Faculty of Science' }]);
  });
});
