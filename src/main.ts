import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import type { CourseData, OfferingData } from './lib/types';
import { restoreSessionIfPresent } from './lib/account/client';
import { initSync } from './lib/sync/controller.svelte';

// Course data is large (every SFU course), so it's fetched at startup rather
// than bundled into the JavaScript.
const target = document.getElementById('app')!;

function load<T>(name: string): Promise<T> {
  return fetch(`${import.meta.env.BASE_URL}data/${name}.json`).then((r) => {
    if (!r.ok) throw new Error(`${name}.json: HTTP ${r.status}`);
    return r.json() as Promise<T>;
  });
}

try {
  // A saved sign-in session is restored first (it only loads supabase-js if
  // there is one), so sync can start as soon as the app is up.
  const [data, offeringData] = await Promise.all([
    load<CourseData>('courses'),
    load<OfferingData>('offerings'),
    restoreSessionIfPresent().catch(() => {}),
  ]);
  target.textContent = '';
  mount(App, { target, props: { data, offeringData } });
  initSync();
} catch (err) {
  const boot = target.querySelector('.boot');
  if (boot) boot.textContent = `Couldn't load course data (${(err as Error).message}).`;
}
