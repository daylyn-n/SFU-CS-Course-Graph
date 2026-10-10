<!-- First-visit welcome: what the site is for, then "Let's get started". -->
<script lang="ts">
  import type { Term } from './types';

  interface Props {
    courseCount: number;
    programCount?: number;
    terms: Term[];
    /** accounts are set up, so offer signing in too */
    accounts: boolean;
    onstart: () => void;
    onsignin?: () => void;
  }

  let { courseCount, programCount = 368, terms, accounts, onstart, onsignin }: Props = $props();

  const termText = $derived(terms.map((t) => t.label).join(' and '));
  const fmt = (n: number) => n.toLocaleString('en-CA');

  let start = $state<HTMLButtonElement>();
  $effect(() => start?.focus());
</script>

<main class="welcome" aria-labelledby="welcome-title">
  <svg class="pattern" aria-hidden="true">
    <defs>
      <pattern id="welcome-net" width="140" height="90" patternUnits="userSpaceOnUse">
        <path d="M10 20 C45 20 45 60 80 60 S115 25 150 25 M80 60 L80 100 M-10 70 C20 70 30 20 10 20" />
        <circle cx="10" cy="20" r="3.5" />
        <circle cx="80" cy="60" r="4.5" />
        <circle cx="140" cy="25" r="3" />
      </pattern>
    </defs>
    <rect width="100%" height="100%" fill="url(#welcome-net)" />
  </svg>

  <div class="inner">
    <div class="brand">
      <svg class="mark" viewBox="0 0 32 32" aria-hidden="true">
        <path d="M9 10 C15 10 15 16 22 16 M9 22 C15 22 15 16 22 16" />
        <circle cx="8" cy="10" r="3" /><circle cx="8" cy="22" r="3" /><circle cx="23" cy="16" r="3.5" />
      </svg>
      <span>SFU Prerequisite Map</span>
    </div>

    <h1 id="welcome-title">Plan your path through SFU</h1>
    <p class="lede">
      See what you need before any course, build a timetable without clashes, and track your degree, all from SFU’s
      own course data.
    </p>

    <ul class="features">
      <li>
        <span class="icon" aria-hidden="true">
          <svg viewBox="0 0 24 24"><circle cx="5" cy="6" r="2.2" /><circle cx="5" cy="18" r="2.2" /><circle cx="19" cy="12" r="2.6" /><path d="M7 6c5 0 5 6 9.5 6M7 18c5 0 5-6 9.5-6" /></svg>
        </span>
        <h2>Map prerequisites</h2>
        <p>Pick any of {fmt(courseCount)} courses and see everything that leads to it. Tick what you’ve taken and the rest fills in.</p>
      </li>
      <li>
        <span class="icon" aria-hidden="true">
          <svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4M8 14h3M13 14h3M8 17h3" /></svg>
        </span>
        <h2>Build your schedule</h2>
        <p>Real sections and times for {termText}. Clashes are flagged, and auto-arrange finds a timetable that fits.</p>
      </li>
      <li>
        <span class="icon" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>
        </span>
        <h2>Track your degree</h2>
        <p>Every one of {programCount} undergraduate programs: what you’ve finished, what’s left, and your concentrations.</p>
      </li>
      <li>
        <span class="icon" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6z" /><path d="M8.5 12l2.5 2.5 4.5-5" /></svg>
        </span>
        <h2>Never lose progress</h2>
        <p>
          Saved as you go, with undo and version history.{#if accounts}{' '}Sign in to keep it on every device.{/if}
        </p>
      </li>
    </ul>

    <div class="actions">
      <button bind:this={start} class="start" onclick={onstart}>
        Let’s get started
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h11M11 5.5 15.5 10 11 14.5" /></svg>
      </button>
      {#if accounts && onsignin}
        <button class="secondary" onclick={onsignin}>I have an account · Sign in</button>
      {/if}
    </div>

    <p class="fine">
      An unofficial student project, not affiliated with Simon Fraser University. Course data comes from SFU’s public
      calendar and course outlines; always confirm with an advisor and goSFU.
    </p>
  </div>
</main>

<style>
  .welcome {
    position: relative;
    flex: 1;
    min-height: 100%;
    display: grid;
    place-items: center;
    padding: 48px 20px;
    overflow: hidden;
    color: #fff;
    background:
      radial-gradient(120% 90% at 100% 0%, rgb(255 255 255 / 0.14), transparent 55%),
      radial-gradient(90% 80% at 0% 100%, rgb(0 0 0 / 0.3), transparent 60%),
      linear-gradient(135deg, var(--sfu-red-dark), var(--header-bg) 45%, #c42a40);
  }
  .pattern {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0.1;
    pointer-events: none;
  }
  .pattern :global(path) {
    fill: none;
    stroke: #fff;
    stroke-width: 1.5;
  }
  .pattern :global(circle) {
    fill: #fff;
  }

  .inner {
    position: relative;
    width: 100%;
    max-width: 980px;
    animation: rise 0.5s ease-out both;
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(12px);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .inner {
      animation: none;
    }
  }

  .brand {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    font-weight: 700;
    font-size: 15px;
    opacity: 0.95;
  }
  .mark {
    width: 34px;
    height: 34px;
    padding: 6px;
    border-radius: 10px;
    background: rgb(255 255 255 / 0.14);
    border: 1px solid rgb(255 255 255 / 0.3);
  }
  .mark path {
    fill: none;
    stroke: #fff;
    stroke-width: 2;
  }
  .mark circle {
    fill: #fff;
  }

  h1 {
    margin: 22px 0 10px;
    font-size: clamp(32px, 6vw, 52px);
    font-weight: 800;
    line-height: 1.05;
    letter-spacing: -0.02em;
  }
  .lede {
    max-width: 640px;
    margin: 0;
    font-size: clamp(16px, 2.2vw, 19px);
    line-height: 1.5;
    opacity: 0.92;
  }

  .features {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
    gap: 14px;
    margin: 34px 0 30px;
    padding: 0;
    list-style: none;
  }
  .features li {
    padding: 16px;
    border-radius: 14px;
    background: rgb(255 255 255 / 0.1);
    border: 1px solid rgb(255 255 255 / 0.22);
    backdrop-filter: blur(4px);
  }
  .icon {
    display: grid;
    place-items: center;
    width: 38px;
    height: 38px;
    border-radius: 10px;
    background: #fff;
  }
  .icon svg {
    width: 22px;
    height: 22px;
    fill: none;
    stroke: var(--sfu-red);
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .icon circle {
    fill: var(--sfu-red);
    stroke: none;
  }
  .features h2 {
    margin: 12px 0 4px;
    font-size: 16px;
  }
  .features p {
    margin: 0;
    font-size: 13.5px;
    line-height: 1.45;
    opacity: 0.9;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
  }
  .start {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    padding: 14px 26px;
    border: none;
    border-radius: 999px;
    background: #fff;
    color: var(--sfu-red);
    font-size: 17px;
    font-weight: 800;
    cursor: pointer;
    box-shadow: 0 8px 24px rgb(60 0 10 / 0.35);
    transition:
      transform 0.15s,
      box-shadow 0.15s;
  }
  .start:hover {
    transform: translateY(-2px);
    box-shadow: 0 12px 28px rgb(60 0 10 / 0.4);
  }
  .start:focus-visible,
  .secondary:focus-visible {
    outline: 3px solid #fff;
    outline-offset: 3px;
  }
  .start svg {
    width: 20px;
    height: 20px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.4;
    stroke-linecap: round;
    stroke-linejoin: round;
    transition: transform 0.15s;
  }
  .start:hover svg {
    transform: translateX(3px);
  }
  .secondary {
    padding: 12px 20px;
    border-radius: 999px;
    border: 1.5px solid rgb(255 255 255 / 0.6);
    background: transparent;
    color: #fff;
    font-size: 15px;
    font-weight: 650;
    cursor: pointer;
  }
  .secondary:hover {
    background: rgb(255 255 255 / 0.12);
  }

  .fine {
    max-width: 640px;
    margin: 26px 0 0;
    font-size: 12px;
    line-height: 1.5;
    opacity: 0.75;
  }

  @media (max-width: 560px) {
    .welcome {
      padding: 32px 16px;
      place-items: start;
    }
    .features {
      gap: 10px;
      margin: 24px 0;
    }
    .start,
    .secondary {
      width: 100%;
      justify-content: center;
    }
  }
</style>
