<!-- Week calendar: one column per day, overlapping meetings side by side.
     With `fit`, it fills its container's height (hours compress to fit). -->
<script>
  import { layoutDay, fmtMin, DAY_NAMES } from './schedule.js';

  // events: [{ key, day, start, end, code, section, type, campus, hue }]
  let { events, range, onpick, fit = false } = $props();

  const hours = $derived(
    Array.from({ length: (range.to - range.from) / 60 }, (_, i) => range.from / 60 + i),
  );
  const byDay = $derived(
    Object.fromEntries(range.days.map((d) => [d, layoutDay(events.filter((e) => e.day === d))])),
  );
  // Position as a fraction of the day so the column height can be set in CSS.
  const pct = (min) => ((min - range.from) / (range.to - range.from)) * 100;
</script>

<div class="wrap" class:fit>
<div class="grid" style:--cols={range.days.length} style:--hours={hours.length}>
  <div class="corner"></div>
  {#each range.days as d (d)}
    <div class="dayhead"><span class="long">{DAY_NAMES[d]}</span><span class="short">{d}</span></div>
  {/each}

  <div class="gutter">
    {#each hours as h, i (h)}
      <span style:top="{(i / hours.length) * 100}%">{h}:00</span>
    {/each}
  </div>
  {#each range.days as d (d)}
    <div class="day">
      {#each byDay[d] as ev (ev.key)}
        <button
          class="ev"
          class:conflict={ev.conflict}
          class:narrow={ev.cols > 1}
          style:--h={ev.hue}
          style:top="{pct(ev.start)}%"
          style:height="{pct(ev.end) - pct(ev.start)}%"
          style:left="calc({(ev.col / ev.cols) * 100}% + 2px)"
          style:width="calc({100 / ev.cols}% - 4px)"
          title="{ev.code} {ev.section} {ev.type} · {DAY_NAMES[d]} {fmtMin(ev.start)}–{fmtMin(ev.end)}{ev.campus
            ? ` · ${ev.campus}`
            : ''}{ev.conflict ? ' · overlaps another class' : ''}"
          aria-label="{ev.code} {ev.section} {ev.type}, {DAY_NAMES[d]} {fmtMin(ev.start)} to {fmtMin(ev.end)}{ev.conflict
            ? ', overlaps another class'
            : ''}. Show course details"
          onclick={() => onpick?.(ev.code)}
        >
          <b><span class="dept">{ev.code.split(' ')[0]}&nbsp;</span>{ev.code.split(' ')[1] ?? ''}</b>
          <span class="meta">{ev.section} {ev.type}<span class="time">&nbsp;· {fmtMin(ev.start)}–{fmtMin(ev.end)}</span></span>
        </button>
      {/each}
    </div>
  {/each}
</div>
</div>

<style>
  /* Sized by its own width, so it compacts on phones and in narrow drawers. */
  .wrap {
    container: weekgrid / inline-size;
  }
  .wrap.fit,
  .fit .grid {
    height: 100%;
  }
  .fit .grid {
    grid-template-rows: auto minmax(calc(var(--hours) * 17px), 1fr);
  }
  .fit .corner,
  .fit .dayhead {
    padding: 4px;
  }
  .fit .day {
    background: linear-gradient(
        to bottom,
        var(--border) 0 1px,
        transparent 1px 50%,
        color-mix(in srgb, var(--border) 45%, transparent) 50% calc(50% + 1px),
        transparent calc(50% + 1px)
      )
      0 0 / 100% calc(100% / var(--hours));
  }
  .fit .ev {
    container-type: size;
    padding: 1px 5px;
    font-size: 11px;
    line-height: 1.2;
  }
  .fit .ev b {
    font-size: 11px;
  }
  /* Short blocks: just the course code. */
  @container (max-height: 26px) {
    .fit .ev .meta {
      display: none;
    }
  }
  .grid {
    --hour: 48px;
    display: grid;
    grid-template-columns: 46px repeat(var(--cols), minmax(0, 1fr));
    grid-template-rows: auto calc(var(--hour) * var(--hours));
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface);
    overflow: hidden;
  }

  .corner,
  .dayhead {
    padding: 8px 4px;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
  }
  .dayhead {
    text-align: center;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--muted);
    border-left: 1px solid var(--border);
  }
  .short {
    display: none;
  }

  .gutter {
    position: relative;
  }
  .gutter span {
    position: absolute;
    right: 6px;
    margin-top: 2px;
    font-size: 11px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }

  .day {
    position: relative;
    border-left: 1px solid var(--border);
    /* Hour lines, with a fainter half-hour line between. */
    background:
      repeating-linear-gradient(
        to bottom,
        var(--border) 0 1px,
        transparent 1px calc(var(--hour) / 2),
        color-mix(in srgb, var(--border) 45%, transparent) calc(var(--hour) / 2) calc(var(--hour) / 2 + 1px),
        transparent calc(var(--hour) / 2 + 1px) var(--hour)
      );
  }

  .ev {
    position: absolute;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0;
    overflow: hidden;
    padding: 3px 6px;
    border: none;
    border-left: 3px solid var(--ev-line);
    border-radius: 6px;
    background: var(--ev-bg);
    color: var(--ev-text);
    font-size: 11.5px;
    line-height: 1.25;
    text-align: left;
    cursor: pointer;
    transition: transform 0.12s, box-shadow 0.12s;
    --ev-bg: oklch(93% 0.045 var(--h));
    --ev-line: oklch(58% 0.14 var(--h));
    --ev-text: oklch(32% 0.09 var(--h));
  }
  .ev:hover {
    transform: translateY(-1px);
    box-shadow: 0 3px 10px rgb(0 0 0 / 0.12);
    z-index: 2;
  }
  .ev b {
    font-size: 12px;
    white-space: nowrap;
  }
  .ev .meta {
    max-width: 100%;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    opacity: 0.85;
  }
  .ev .time {
    font-variant-numeric: tabular-nums;
  }
  .ev.narrow .time {
    display: none;
  }
  .ev.conflict {
    outline: 2px solid var(--conflict);
    outline-offset: -2px;
    background:
      repeating-linear-gradient(135deg, transparent 0 6px, color-mix(in srgb, var(--conflict) 12%, transparent) 6px 12px),
      var(--ev-bg);
  }

  @media (prefers-color-scheme: dark) {
    .ev {
      --ev-bg: oklch(33% 0.06 var(--h));
      --ev-line: oklch(72% 0.13 var(--h));
      --ev-text: oklch(92% 0.04 var(--h));
    }
  }

  @container weekgrid (max-width: 600px) {
    .grid {
      --hour: 40px;
      grid-template-columns: 30px repeat(var(--cols), minmax(0, 1fr));
    }
    .long {
      display: none;
    }
    .short {
      display: inline;
    }
    .gutter span {
      right: 3px;
      font-size: 10px;
    }
    .ev {
      padding: 2px 3px;
      border-left-width: 2px;
      border-radius: 4px;
      font-size: 10px;
    }
    .ev b {
      font-size: 10px;
      white-space: normal;
      line-height: 1.1;
    }
    .ev .time {
      display: none;
    }
    .ev.narrow .meta,
    .ev.narrow .dept {
      display: none;
    }
  }
</style>
