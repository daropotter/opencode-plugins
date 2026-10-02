import { describe, expect, test } from 'bun:test';
import { parseTarget, sourceBranchFromResponse, targetPrefix, targetRequest } from './target.ts';

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

  test('identifies pull and merge requests for source branch lookups', () => {
    expect(
      targetRequest({ url: 'https://gitlab.example.com/group/sub/project/-/merge_requests/456' }),
    ).toEqual({
      forge: 'gitlab',
      host: 'gitlab.example.com',
      project: 'group/sub/project',
      iid: '456',
    });
    expect(targetRequest({ url: 'https://github.com/owner/repo/pull/7' })).toEqual({
      forge: 'github',
      host: 'github.com',
      project: 'owner/repo',
      iid: '7',
    });
    expect(targetRequest({ url: 'https://gitlab.com/group/project/-/issues/1' })).toBeUndefined();
  });

  test('uses a branch-derived issue unless an explicit issue is set', () => {
    const url = 'https://gitlab.com/group/project/-/merge_requests/456';
    expect(targetPrefix({ url, branchIssue: '123' })).toBe('[#123, !456]');
    expect(
      targetPrefix({
        url,
        branchIssue: '123',
        issueUrl: 'https://gitlab.com/group/project/-/issues/9',
      }),
    ).toBe('[#9, !456]');
    expect(
      targetPrefix({ url: 'https://gitlab.com/group/project/-/issues/5', branchIssue: '123' }),
    ).toBe('[#5]');
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

describe('source branch responses', () => {
  const gitlab = { forge: 'gitlab', host: 'gitlab.com', project: 'g/p', iid: '1' } as const;
  const github = { forge: 'github', host: 'github.com', project: 'o/r', iid: '1' } as const;

  test('reads the forge-specific source branch field', () => {
    expect(sourceBranchFromResponse(gitlab, '{"source_branch":"12-fix"}')).toBe('12-fix');
    expect(sourceBranchFromResponse(github, '{"head":{"ref":"34-fix"}}')).toBe('34-fix');
  });

  test.each(['', 'not json', '{}', '{"source_branch":""}', '{"source_branch":3}'])(
    'ignores unusable response %j',
    (stdout) => {
      expect(sourceBranchFromResponse(gitlab, stdout)).toBeUndefined();
    },
  );
});
