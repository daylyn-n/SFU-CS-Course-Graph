import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';

// Course data is large (every SFU course), so it's fetched at startup rather
// than bundled into the JavaScript.
const target = document.getElementById('app');
try {
  const load = (name) =>
    fetch(`${import.meta.env.BASE_URL}data/${name}.json`).then((r) => {
      if (!r.ok) throw new Error(`${name}.json: HTTP ${r.status}`);
      return r.json();
    });
  const [data, offeringData] = await Promise.all([load('courses'), load('offerings')]);
  target.textContent = '';
  mount(App, { target, props: { data, offeringData } });
} catch (err) {
  target.querySelector('.boot').textContent = `Couldn't load course data (${err.message}).`;
}
