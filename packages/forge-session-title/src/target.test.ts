import { describe, expect, test } from 'bun:test';
import { parseTarget, targetPrefix } from './target.ts';

describe('session targets', () => {
  test.each([
    ['https://gitlab.com/group/project/-/merge_requests/456', '[!456]'],
    ['https://gitlab.example.com/group/subgroup/project/-/merge_requests/456', '[!456]'],
    ['https://gitlab.com/group/project/-/issues/123', '[#123]'],
    ['https://gitlab.com/group/project/-/work_items/123', '[#123]'],
    ['https://github.com/owner/repo/pull/456', '[#456]'],
    ['https://github.com/owner/repo/issues/123', '[#123]'],
  ])('formats %s', (url, prefix) => {
    const target = parseTarget({ target: url });
    expect(target).toEqual({ url });
    expect(targetPrefix(target!)).toBe(prefix);
  });

  test('normalizes links and accepts an established related issue', () => {
    const target = parseTarget({
      target: 'https://gitlab.com/group/project/-/merge_requests/456/?tab=changes#note_1',
      issue_url: 'https://gitlab.com/group/other/-/issues/789',
    });
    expect(target?.url).toBe('https://gitlab.com/group/project/-/merge_requests/456');
    expect(targetPrefix(target!)).toBe('[#789, !456]');
  });

  test('supports returning to branch-based naming', () => {
    expect(parseTarget({ target: 'branch' })).toBeUndefined();
  });

  test.each([
    {},
    { target: '!456' },
    { target: 'file:///group/project/-/issues/123' },
    { target: 'https://user:password@gitlab.com/group/project/-/issues/123' },
    { target: 'https://github.com/owner/repo/pull/456/files' },
    { target: 'branch', issue_url: 'https://gitlab.com/group/project/-/issues/123' },
    {
      target: 'https://gitlab.com/group/project/-/issues/123',
      issue_url: 'https://gitlab.com/group/project/-/issues/789',
    },
    {
      target: 'https://gitlab.com/group/project/-/merge_requests/456',
      issue_url: 'https://gitlab.com/group/project/-/merge_requests/789',
    },
  ])('rejects invalid input %j', (input) => {
    expect(() => parseTarget(input)).toThrow();
  });
});
