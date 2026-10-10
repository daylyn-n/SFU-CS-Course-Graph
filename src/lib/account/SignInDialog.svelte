<!-- Sign in with a code sent by email (and optionally Google). Only mount it when isAuthConfigured(). -->
<script lang="ts">
  import { tick } from 'svelte';
  import { googleEnabled, sendCode, signInWithGoogle, verifyCode, type AuthUser } from './client';
  import { CODE_LENGTH, emailProblem, isSharedComputer, parseCode, RESEND_COOLDOWN_S, setSharedComputer } from './helpers';
  import ProgramPicker from './ProgramPicker.svelte';
  import type { ProgramOption } from './programs';

  interface SignedIn {
    sharedComputer: boolean;
    /** a brand-new account */
    firstSignIn: boolean;
  }

  interface Props {
    open: boolean;
    /** Called as soon as the code is accepted (before the program step). */
    onsignedin?: (user: AuthUser, opts: SignedIn) => void;
    /** Programs for the "Which program are you in?" step. Leave out to skip it. */
    programs?: ProgramOption[];
    /** The current program id (the app stores it). */
    program?: string;
    /**
     * Ask for the program after signing in? Default: on a (probably) new
     * account's first sign-in. May be async, e.g. "the account has no program saved yet".
     */
    askProgram?: boolean | ((user: AuthUser, opts: SignedIn) => boolean | Promise<boolean>);
    /** The program picked in that step (not called on skip). */
    onprogram?: (id: string) => void;
  }

  let {
    open = $bindable(false),
    onsignedin,
    programs = [],
    program = $bindable(''),
    askProgram = (_user: AuthUser, o: SignedIn) => o.firstSignIn,
    onprogram,
  }: Props = $props();

  const uid = $props.id();
  const google = googleEnabled();

  let dialog = $state<HTMLDialogElement>();
  let emailInput = $state<HTMLInputElement>();
  let codeInput = $state<HTMLInputElement>();

  let step = $state<'email' | 'code' | 'program'>('email');
  let email = $state('');
  let code = $state('');
  let shared = $state(isSharedComputer());
  let error = $state('');
  let busy = $state(false);
  let codeFocused = $state(false);
  let resendAt = $state(0);
  let now = $state(Date.now());
  let notice = $state('');

  const waitS = $derived(Math.max(0, Math.ceil((resendAt - now) / 1000)));

  // Open and close the native modal (it traps focus and handles Esc for us).
  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      focusStep();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  });

  // Tick the resend countdown while the code step is showing.
  $effect(() => {
    if (!open || step !== 'code' || waitS === 0) return;
    const t = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(t);
  });

  async function focusStep() {
    await tick();
    if (step === 'program') return; // the picker focuses its own search box
    (step === 'email' ? emailInput : codeInput)?.focus();
  }

  async function submitEmail(e?: SubmitEvent) {
    e?.preventDefault();
    if (busy) return;
    const problem = emailProblem(email);
    if (problem) {
      error = problem;
      emailInput?.focus();
      return;
    }
    busy = true;
    error = '';
    const res = await sendCode(email);
    busy = false;
    if (res.error) {
      error = res.error;
      return;
    }
    email = email.trim();
    code = '';
    notice = '';
    resendAt = Date.now() + RESEND_COOLDOWN_S * 1000;
    now = Date.now();
    step = 'code';
    focusStep();
  }

  async function resend() {
    if (busy || waitS > 0) return;
    busy = true;
    error = '';
    notice = '';
    const res = await sendCode(email);
    busy = false;
    code = '';
    if (res.error) error = res.error;
    else {
      resendAt = Date.now() + RESEND_COOLDOWN_S * 1000;
      now = Date.now();
      notice = 'New code sent. Use the newest email.';
    }
    codeInput?.focus();
  }

  async function submitCode(e?: SubmitEvent) {
    e?.preventDefault();
    if (busy) return;
    if (code.length !== CODE_LENGTH) {
      error = `Enter all ${CODE_LENGTH} digits.`;
      codeInput?.focus();
      return;
    }
    busy = true;
    error = '';
    notice = '';
    const res = await verifyCode(email, code);
    busy = false;
    if (res.error || !res.user) {
      error = res.error ?? 'Something went wrong. Try again.';
      code = '';
      await tick();
      codeInput?.focus();
      return;
    }
    setSharedComputer(shared);
    const user = res.user;
    const info: SignedIn = { sharedComputer: shared, firstSignIn: res.firstSignIn };
    onsignedin?.(user, info);
    let ask = false;
    if (programs.length) {
      busy = true;
      try {
        ask = typeof askProgram === 'function' ? await askProgram(user, info) : askProgram;
      } catch (err) {
        console.error(err);
      }
      busy = false;
    }
    if (ask) {
      step = 'program';
      error = '';
      return;
    }
    finish();
  }

  function finish() {
    open = false;
    reset();
  }

  function setCode(text: string) {
    code = parseCode(text);
    if (codeInput && codeInput.value !== code) codeInput.value = code;
    if (error && code.length) error = '';
    if (code.length === CODE_LENGTH) submitCode();
  }

  function onpaste(e: ClipboardEvent) {
    const text = e.clipboardData?.getData('text') ?? '';
    if (!/\d/.test(text)) return;
    e.preventDefault();
    setCode(text); // a pasted code replaces what was typed
  }

  function differentEmail() {
    step = 'email';
    code = '';
    error = '';
    notice = '';
    focusStep();
  }

  async function google_() {
    busy = true;
    error = '';
    const res = await signInWithGoogle({ sharedComputer: shared });
    // On success the browser is leaving for Google.
    if (res.error) {
      busy = false;
      error = res.error;
    }
  }

  function reset() {
    step = 'email';
    code = '';
    error = '';
    notice = '';
    resendAt = 0;
  }

  function onclose() {
    open = false;
    busy = false;
    if (step === 'program') reset(); // closing the program step skips it
  }

  // Click on the dimmed backdrop closes (the dialog box itself fills .panel).
  function onclick(e: MouseEvent) {
    if (e.target === dialog) dialog?.close();
  }
</script>

<dialog bind:this={dialog} class="dialog" aria-labelledby="{uid}-title" aria-describedby="{uid}-desc" {onclose} {onclick}>
  <div class="panel" class:program-step={step === 'program'}>
    <button type="button" class="close" aria-label="Close" onclick={() => dialog?.close()}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
    </button>

    <div class="step-icon" aria-hidden="true">
      {#if step === 'program'}
        <svg viewBox="0 0 24 24"><path d="M2 9l10-5 10 5-10 5-10-5z" /><path d="M6 11v5c3 2.5 9 2.5 12 0v-5" /></svg>
      {:else if step === 'email'}
        <svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" /></svg>
      {:else}
        <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></svg>
      {/if}
    </div>

    {#if step === 'program'}
      <span class="sr" id="{uid}-title">Signed in. Choose your program</span>
      <p class="ok" id="{uid}-desc">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
        Signed in as <b>{email}</b>
      </p>
      <ProgramPicker
        {programs}
        bind:value={program}
        onpick={(id) => {
          onprogram?.(id);
          finish();
        }}
        onskip={finish}
      />
    {:else if step === 'email'}
      <h2 id="{uid}-title">Sign in to sync</h2>
      <p id="{uid}-desc" class="lead">
        Keep your courses, schedules and plan on every device. We’ll email you a {CODE_LENGTH}-digit code; no password
        needed.
      </p>

      <form onsubmit={submitEmail} novalidate>
        <label class="field-label" for="{uid}-email">Email</label>
        <input
          bind:this={emailInput}
          bind:value={email}
          id="{uid}-email"
          class="text"
          type="email"
          inputmode="email"
          autocomplete="email"
          autocapitalize="off"
          spellcheck="false"
          placeholder="jdoe@sfu.ca"
          aria-invalid={error ? 'true' : undefined}
          aria-describedby="{uid}-hint {uid}-err"
          oninput={() => (error = '')}
        />
        <p class="field-hint" id="{uid}-hint">Your @sfu.ca address works, or any other email.</p>
        <p class="err-msg" id="{uid}-err" role="alert">{error}</p>

        <label class="check">
          <input type="checkbox" bind:checked={shared} />
          <span>
            This is a shared or public computer
            <small>Signing out will erase your progress from this device.</small>
          </span>
        </label>

        <button class="primary wide" type="submit" disabled={busy}>
          {#if busy}<span class="spinner" aria-hidden="true"></span>Sending…{:else}Email me a code{/if}
        </button>
      </form>

      {#if google}
        <div class="or" aria-hidden="true"><span>or</span></div>
        <button type="button" class="google wide" onclick={google_} disabled={busy}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#4285F4" d="M22.6 12.2c0-.8-.1-1.5-.2-2.2H12v4.2h5.9a5 5 0 0 1-2.2 3.3v2.7h3.6c2.1-1.9 3.3-4.8 3.3-8z" />
            <path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.7c-1 .7-2.2 1-3.7 1-2.9 0-5.3-1.9-6.2-4.5H2.1v2.8A11 11 0 0 0 12 23z" />
            <path fill="#FBBC05" d="M5.8 14.1a6.6 6.6 0 0 1 0-4.2V7.1H2.1a11 11 0 0 0 0 9.8l3.7-2.8z" />
            <path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2A11 11 0 0 0 2.1 7.1l3.7 2.8C6.7 7.3 9.1 5.4 12 5.4z" />
          </svg>
          Continue with Google
        </button>
      {/if}

      <p class="foot">Your progress is always kept on this device too.</p>
    {:else}
      <h2 id="{uid}-title">Check your email</h2>
      <p id="{uid}-desc" class="lead">
        Enter the {CODE_LENGTH}-digit code we sent to <b class="addr">{email}</b>
      </p>

      <form onsubmit={submitCode} novalidate>
        <div class="code" class:focused={codeFocused} class:invalid={!!error}>
          <input
            bind:this={codeInput}
            id="{uid}-code"
            value={code}
            type="text"
            inputmode="numeric"
            autocomplete="one-time-code"
            pattern="[0-9]*"
            aria-label="{CODE_LENGTH}-digit code"
            aria-invalid={error ? 'true' : undefined}
            aria-describedby="{uid}-err"
            disabled={busy}
            oninput={(e) => setCode(e.currentTarget.value)}
            {onpaste}
            onfocus={() => (codeFocused = true)}
            onblur={() => (codeFocused = false)}
          />
          {#each { length: CODE_LENGTH } as _, i}
            <span
              class="box"
              class:filled={i < code.length}
              class:active={codeFocused && !busy && i === Math.min(code.length, CODE_LENGTH - 1)}
              aria-hidden="true">{code[i] ?? ''}</span
            >
            {#if i === CODE_LENGTH / 2 - 1}<span class="sep" aria-hidden="true"></span>{/if}
          {/each}
        </div>
        <p class="err-msg center" id="{uid}-err" role="alert">{error}</p>
        <p class="sent-note center" role="status">{notice}</p>

        <button class="primary wide" type="submit" disabled={busy || code.length !== CODE_LENGTH}>
          {#if busy}<span class="spinner" aria-hidden="true"></span>Checking…{:else}Sign in{/if}
        </button>
      </form>

      <div class="links">
        <button type="button" class="link" onclick={resend} disabled={busy || waitS > 0}>
          {waitS > 0 ? `Resend code in ${waitS}s` : 'Resend code'}
        </button>
        <span aria-hidden="true">·</span>
        <button type="button" class="link" onclick={differentEmail} disabled={busy}>Use a different email</button>
      </div>
      <p class="foot">Can’t find it? Check Junk, or Quarantine in SFU Outlook. The code expires after an hour.</p>
    {/if}
  </div>
</dialog>

<style>
  .dialog {
    width: min(400px, calc(100% - 32px));
    transition: width 0.2s;
    max-height: calc(100% - 32px);
    padding: 0;
    border: none;
    border-radius: 16px;
    background: var(--surface);
    color: var(--text);
    box-shadow: 0 24px 60px rgb(0 0 0 / 0.3);
    overflow: auto;
  }
  .dialog[open] {
    animation: pop 0.18s ease-out;
  }
  .dialog::backdrop {
    background: rgb(20 8 10 / 0.5);
    backdrop-filter: blur(2px);
  }
  @keyframes pop {
    from {
      opacity: 0;
      transform: translateY(8px) scale(0.98);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .dialog[open] {
      animation: none;
    }
  }

  .panel {
    position: relative;
    padding: 26px 24px 20px;
  }
  .dialog:has(.program-step) {
    width: min(480px, calc(100% - 32px));
  }
  .ok {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: -4px 0 12px;
    font-size: 13px;
    color: var(--muted);
    min-width: 0;
  }
  .ok b {
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ok svg {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
    fill: none;
    stroke: var(--done);
    stroke-width: 3;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  .close {
    position: absolute;
    top: 10px;
    right: 10px;
    width: 34px;
    height: 34px;
    padding: 0;
    display: grid;
    place-items: center;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--muted);
  }
  .close:hover {
    background: color-mix(in srgb, var(--text) 8%, transparent);
    color: var(--text);
  }
  .close svg {
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.2;
    stroke-linecap: round;
  }

  .step-icon {
    width: 44px;
    height: 44px;
    display: grid;
    place-items: center;
    border-radius: 12px;
    background: linear-gradient(135deg, var(--sfu-red-dark), var(--sfu-red) 60%, #c42a40);
    box-shadow: 0 4px 12px rgb(127 19 35 / 0.3);
    margin-bottom: 14px;
  }
  .step-icon svg {
    width: 24px;
    height: 24px;
    fill: none;
    stroke: #fff;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  h2 {
    margin: 0;
    font-size: 20px;
    font-weight: 800;
    letter-spacing: -0.01em;
  }
  .lead {
    margin: 6px 0 18px;
    color: var(--muted);
    font-size: 14px;
  }
  .addr {
    display: block;
    color: var(--text);
    overflow-wrap: anywhere;
  }

  .field-label {
    display: block;
    font-weight: 600;
    font-size: 13px;
    margin-bottom: 6px;
  }
  .text {
    width: 100%;
    padding: 10px 12px;
    font-size: 16px; /* no zoom on iOS */
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--bg);
    outline: none;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .text:focus-visible {
    outline: none;
  }
  .text:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent);
  }
  .text[aria-invalid='true'] {
    border-color: var(--accent);
  }
  .field-hint {
    margin: 6px 0 0;
    font-size: 12.5px;
    color: var(--muted);
  }
  .err-msg {
    margin: 4px 0 0;
    min-height: 1.45em;
    font-size: 13px;
    font-weight: 600;
    color: var(--accent-text);
  }
  .sent-note {
    margin: 0;
    font-size: 13px;
    color: var(--done);
  }
  .sent-note:empty {
    display: none;
  }
  .center {
    text-align: center;
  }

  .check {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    margin: 6px 0 16px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 10px;
    cursor: pointer;
    font-size: 13.5px;
    font-weight: 600;
  }
  .check:hover {
    border-color: var(--muted);
  }
  .check input {
    width: 17px;
    height: 17px;
    margin: 1px 0 0;
    flex-shrink: 0;
    accent-color: var(--accent);
  }
  .check small {
    display: block;
    margin-top: 2px;
    font-weight: 400;
    font-size: 12.5px;
    color: var(--muted);
  }

  .wide {
    width: 100%;
  }
  .primary {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 11px 16px;
    border: none;
    border-radius: 999px;
    background: var(--sfu-red);
    color: #fff;
    font-weight: 700;
    font-size: 15px;
    transition: background 0.15s, transform 0.1s;
  }
  .primary:hover:not(:disabled) {
    background: var(--sfu-red-dark);
  }
  .primary:active:not(:disabled) {
    transform: scale(0.98);
  }
  .primary:disabled {
    opacity: 0.55;
    cursor: default;
  }
  .google {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 10px 16px;
    border-radius: 999px;
    font-weight: 600;
  }
  .google svg {
    width: 18px;
    height: 18px;
  }
  .or {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 14px 0;
    color: var(--muted);
    font-size: 12px;
  }
  .or::before,
  .or::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--border);
  }

  .spinner {
    width: 14px;
    height: 14px;
    border: 2px solid rgb(255 255 255 / 0.4);
    border-top-color: #fff;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  :focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  /* The code: one real input laid over six boxes, so typing, pasting and
     SMS/email autofill all go to a single field. */
  .code {
    position: relative;
    display: flex;
    justify-content: center;
    gap: 8px;
    margin: 4px 0 2px;
  }
  .code input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    border: none;
    font-size: 16px;
    caret-color: transparent;
    cursor: text;
  }
  .box {
    width: 44px;
    height: 54px;
    display: grid;
    place-items: center;
    border: 1.5px solid var(--border);
    border-radius: 10px;
    background: var(--bg);
    font: 700 24px/1 ui-monospace, 'SF Mono', Menlo, monospace;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .box.filled {
    border-color: var(--muted);
  }
  .box.active {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent);
  }
  .box.active:not(.filled)::after {
    content: '';
    width: 2px;
    height: 24px;
    background: var(--accent);
    animation: blink 1s steps(1) infinite;
  }
  .code.invalid .box {
    border-color: var(--accent);
  }
  .sep {
    width: 6px;
    align-self: center;
    height: 2px;
    background: var(--border);
  }
  @keyframes blink {
    50% {
      opacity: 0;
    }
  }

  .links {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: center;
    gap: 4px 8px;
    margin-top: 12px;
    color: var(--muted);
    font-size: 13.5px;
  }
  .link {
    padding: 4px 2px;
    border: none;
    background: none;
    color: var(--accent-text);
    font-weight: 600;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .link:disabled {
    color: var(--muted);
    text-decoration: none;
    cursor: default;
    font-variant-numeric: tabular-nums;
  }
  .foot {
    margin: 14px 0 0;
    font-size: 12.5px;
    color: var(--muted);
    text-align: center;
  }

  @media (max-width: 420px) {
    .panel {
      padding: 22px 18px 16px;
    }
    .box {
      width: 40px;
      height: 50px;
    }
    .code {
      gap: 6px;
    }
  }
</style>
