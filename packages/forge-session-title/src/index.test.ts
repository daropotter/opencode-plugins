import { describe, expect, test } from 'bun:test';
import type { Plugin } from '@opencode/plugin';
import plugin from './index.ts';

type Tool = {
  execute: (input: unknown, context: { sessionID: string }) => Promise<unknown>;
};
type Hook = (event: {
  sessionID: string;
  system: { type: string; text: string }[];
}) => Promise<void>;

async function harness(storage = new Map<string, unknown>()) {
  const sessions = new Map([
    [
      'one',
      {
        title: '[#123, !45] Review changes',
        location: { directory: process.cwd() },
        parentID: undefined as string | undefined,
      },
    ],
    [
      'two',
      {
        title: 'Other session',
        location: { directory: process.cwd() },
        parentID: undefined as string | undefined,
      },
    ],
  ]);
  let tool: Tool;
  let hook: Hook;
  let renames = 0;
  const ctx = {
    location: { directory: process.cwd() },
    storage: {
      get: async (key: string) => storage.get(key),
      set: async (key: string, value: unknown) => {
        storage.set(key, value);
      },
    },
    session: {
      get: async ({ sessionID }: { sessionID: string }) => sessions.get(sessionID),
      update: async ({ sessionID, title }: { sessionID: string; title: string }) => {
        sessions.get(sessionID)!.title = title;
        renames++;
      },
      hook: async (_name: string, callback: Hook) => {
        hook = callback;
      },
    },
    tool: {
      transform: async (callback: (editor: { add: (value: Tool) => void }) => void) => {
        callback({
          add: (value) => {
            tool = value;
          },
        });
      },
    },
    vcs: { get: async () => ({ data: { branch: { current: 'main', default: 'main' } } }) },
    event: { subscribe: async function* () {} },
  };
  const cleanup = await plugin.setup(ctx as unknown as Plugin.Context);
  return {
    sessions,
    cleanup,
    renames: () => renames,
    set: (input: unknown, sessionID = 'one') => tool.execute(input, { sessionID }),
    context: async (sessionID = 'one') => {
      const event = { sessionID, system: [] as { type: string; text: string }[] };
      await hook(event);
      return event.system.map((part) => part.text).join('\n');
    },
  };
}

describe('session target integration', () => {
  const mr = 'https://gitlab.com/group/project/-/merge_requests/456';
  const nextMr = 'https://gitlab.com/group/project/-/merge_requests/789';

  test('registers guidance and replaces branch references even on main', async () => {
    const app = await harness();
    expect(await app.context()).toContain('call set_session_target');
    await app.set({ target: mr });
    expect(app.sessions.get('one')?.title).toBe('[!456] Review changes');
    expect(await app.context()).toContain(mr);
    expect(await app.context('two')).not.toContain(mr);
    expect(app.sessions.get('two')?.title).toBe('Other session');
    await app.cleanup();
  });

  test('persists the target and owned prefix across plugin reloads', async () => {
    const storage = new Map<string, unknown>();
    const first = await harness(storage);
    await first.set({ target: mr, issue_url: 'https://gitlab.com/group/project/-/issues/42' });
    const title = first.sessions.get('one')!.title;
    await first.cleanup();

    const second = await harness(storage);
    second.sessions.get('one')!.title = title;
    expect(await second.context()).toContain(mr);
    await second.set({ target: nextMr });
    expect(second.sessions.get('one')?.title).toBe('[!789] Review changes');
    await second.set({ target: nextMr });
    expect(second.renames()).toBe(1);
    await second.cleanup();
  });

  test('reset removes the prefix on main and restores automatic context', async () => {
    const app = await harness();
    await app.set({ target: mr });
    await app.set({ target: 'branch' });
    expect(app.sessions.get('one')?.title).toBe('Review changes');
    expect(await app.context()).toContain('checked-out branch (automatic)');
    await app.cleanup();
  });

  test('serializes concurrent switches and drops the previous related issue', async () => {
    const app = await harness();
    await Promise.all([
      app.set({ target: mr, issue_url: 'https://gitlab.com/group/project/-/issues/42' }),
      app.set({ target: nextMr }),
    ]);
    expect(app.sessions.get('one')?.title).toBe('[!789] Review changes');
    await app.cleanup();
  });

  test('rejects invalid targets without changing the current target', async () => {
    const app = await harness();
    await app.set({ target: mr });
    await expect(app.set({ target: '!789' })).rejects.toThrow();
    expect(app.sessions.get('one')?.title).toBe('[!456] Review changes');
    expect(await app.context()).toContain(mr);
    await app.cleanup();
  });

  test('skips child sessions and sessions in another location', async () => {
    const app = await harness();
    app.sessions.get('one')!.parentID = 'parent';
    expect(await app.context()).toBe('');
    await expect(app.set({ target: mr })).rejects.toThrow('root session');
    app.sessions.get('two')!.location.directory = '/another/location';
    expect(await app.context('two')).toBe('');
    await expect(app.set({ target: mr }, 'two')).rejects.toThrow('root session');
    await app.cleanup();
  });
});
