import { closeSync, openSync, readlinkSync, writeSync } from 'node:fs';
import type { Plugin } from '@opencode/plugin/tui';
import { createAgentStateTracker, createViewFilter, exec } from '../../_shared/src/index.ts';

type Terminal = 'iterm2' | 'wezterm' | 'windows-terminal' | 'ghostty' | 'kitty';

// kitty renders an in-window progress bar only since 0.47 ("progress_bar" option).
// Older versions (0.39-0.46) only showed a percentage in the tab title, and before
// 0.38 OSC 9;4 was treated as a notification. We only enable kitty when we can
// confirm the version is at least this.
const KITTY_MIN_SUPPORTED = [0, 47, 0] as const;

function parseKittyVersion(value: string): readonly number[] | undefined {
  const match = value.match(/(?:^|\s)(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
}

async function detectKittyVersion(): Promise<readonly number[] | undefined> {
  const env = process.env;
  const programVersion = env['TERM_PROGRAM_VERSION'];
  if (programVersion) {
    const parsed = parseKittyVersion(programVersion);
    if (parsed) return parsed;
  }
  // The shell integration may not be active, so fall back to querying the running
  // kitty binary itself (Linux): /proc/<KITTY_PID>/exe points at the emulator that
  // is actually writing to this terminal.
  const kittyPid = env['KITTY_PID'];
  if (kittyPid) {
    try {
      const exe = readlinkSync(`/proc/${kittyPid}/exe`);
      const result = await exec(exe, ['--version']);
      if (result.code === 0) {
        const parsed = parseKittyVersion(result.stdout);
        if (parsed) return parsed;
      }
    } catch {
      // no /proc (e.g. macOS) or the process is gone
    }
  }
  return undefined;
}

function isSupportedKitty(version: readonly number[]): boolean {
  for (let i = 0; i < KITTY_MIN_SUPPORTED.length; i++) {
    if ((version[i] ?? 0) > KITTY_MIN_SUPPORTED[i]) return true;
    if ((version[i] ?? 0) < KITTY_MIN_SUPPORTED[i]) return false;
  }
  return true;
}

async function detectTerminal(): Promise<Terminal | undefined> {
  const env = process.env;
  if (env['KITTY_WINDOW_ID'] || env['TERM_PROGRAM'] === 'kitty') {
    const version = await detectKittyVersion();
    if (version && isSupportedKitty(version)) {
      return 'kitty';
    }
    return undefined;
  }
  if (env['TERM_PROGRAM'] === 'ghostty') {
    return 'ghostty';
  }
  if (
    env['TERM_PROGRAM'] === 'iTerm.app' ||
    env['LC_TERMINAL'] === 'iTerm2' ||
    env['ITERM_SESSION_ID']
  ) {
    return 'iterm2';
  }
  if (env['TERM_PROGRAM'] === 'WezTerm' || env['WEZTERM_EXECUTABLE']) {
    return 'wezterm';
  }
  if (env['WT_SESSION']) {
    return 'windows-terminal';
  }
  return undefined;
}

interface Osc {
  write(payload: string): void;
  close(): void;
}

function createOsc(): Osc | undefined {
  const inTmux = !!process.env['TMUX'];
  let fd: number;
  try {
    fd = openSync('/dev/tty', 'w');
  } catch {
    return undefined;
  }
  return {
    write(payload) {
      const esc = inTmux ? `\x1bPtmux;\x1b\x1b]${payload}\x07\x1b\\` : `\x1b]${payload}\x07`;
      try {
        writeSync(fd, esc);
      } catch {
        return;
      }
    },
    close() {
      try {
        closeSync(fd);
      } catch {
        return;
      }
    },
  };
}

export default {
  id: 'opencode-terminal-progress',
  async setup(context) {
    const progressEnv = process.env['OPENCODE_TERMINAL_PROGRESS'];
    if (progressEnv && /^(0|false|no)$/i.test(progressEnv)) return;
    const terminal = await detectTerminal();
    if (!terminal) return;

    const osc = createOsc();
    if (!osc) return;

    const progress = (code: string): void => osc.write(`9;4;${code}`);
    const isKitty = terminal === 'kitty';

    let stateTimer: ReturnType<typeof setInterval> | undefined;
    const clearStateTimer = (): void => {
      if (stateTimer) {
        clearInterval(stateTimer);
        stateTimer = undefined;
      }
    };

    const setState = (code: string): void => {
      clearStateTimer();
      progress(code);
      // kitty clears any progress ~60 s after the last OSC 9;4 report, so while a
      // state is active we re-report it periodically to keep the indicator alive.
      // Other terminals keep the progress state until told otherwise.
      if (isKitty) {
        stateTimer = setInterval(() => progress(code), 30_000);
      }
    };

    const tracker = createAgentStateTracker({
      onWaiting: () => setState('4;50'),
      onBusy: () => setState('3'),
      onIdle: () => {
        clearStateTimer();
        progress('0');
      },
      onError: () => setState('2'),
    });

    const shows = createViewFilter(context, tracker.tracks);
    const stop = context.data.listen(({ details }) => {
      if (shows(details)) void tracker.handle(details);
    });

    return () => {
      stop();
      clearStateTimer();
      progress('0');
      osc.close();
    };
  },
} satisfies Plugin.Definition;
