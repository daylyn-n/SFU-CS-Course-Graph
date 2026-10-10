// supabase/schema.sql (for the dashboard SQL editor) must stay the same as
// the CLI migrations, in order.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

const dir = join(import.meta.dirname, '../../../supabase');

it('schema.sql contains every migration, in order', () => {
  const combined = readFileSync(join(dir, 'schema.sql'), 'utf8');
  const files = readdirSync(join(dir, 'migrations')).filter((f) => f.endsWith('.sql')).sort();
  expect(files.length).toBeGreaterThanOrEqual(2);
  let from = 0;
  for (const f of files) {
    const at = combined.indexOf(readFileSync(join(dir, 'migrations', f), 'utf8'), from);
    expect(at, `${f} is missing from schema.sql or out of order (regenerate it)`).toBeGreaterThanOrEqual(from);
    from = at + 1;
  }
});
