import type { Forge } from './title.ts';

export type Target = { url: string; issueUrl?: string };

function parseReference(value: string) {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Use a full HTTP(S) issue, pull request, or merge request URL.');
  }
  const github = url.hostname === 'github.com';
  const match = github
    ? url.pathname.match(/^\/[^/]+\/[^/]+\/(pull|issues)\/([1-9]\d*)\/?$/)
    : url.pathname.match(/^\/(.+)\/-\/(merge_requests|issues|work_items)\/([1-9]\d*)\/?$/);
  if (!match) throw new Error('Use a GitHub or GitLab issue, pull request, or merge request URL.');
  const kind = github ? match[1] : match[2];
  const iid = github ? match[2] : match[3];
  const forge: Forge = github ? 'github' : 'gitlab';
  const issue = kind === 'issues' || kind === 'work_items';
  url.search = '';
  url.hash = '';
  url.pathname = url.pathname.replace(/\/$/, '');
  return { url: url.href, forge, issue, ref: `${!issue && forge === 'gitlab' ? '!' : '#'}${iid}` };
}

export function parseTarget(input: unknown): Target | undefined {
  if (
    !input ||
    typeof input !== 'object' ||
    !('target' in input) ||
    typeof input.target !== 'string'
  ) {
    throw new Error('Provide a target URL or "branch".');
  }
  const issueUrl = 'issue_url' in input ? input.issue_url : undefined;
  if (input.target === 'branch') {
    if (issueUrl !== undefined) throw new Error('Branch mode does not accept issue_url.');
    return undefined;
  }
  const target = parseReference(input.target);
  if (issueUrl === undefined) return { url: target.url };
  if (typeof issueUrl !== 'string') throw new Error('issue_url must be a full issue URL.');
  const issue = parseReference(issueUrl);
  if (target.issue || !issue.issue || target.forge !== issue.forge) {
    throw new Error('Only a pull or merge request can have a related issue from the same forge.');
  }
  return { url: target.url, issueUrl: issue.url };
}

export function targetPrefix(target: Target): string {
  const reference = parseReference(target.url);
  const issue = target.issueUrl ? parseReference(target.issueUrl) : undefined;
  return `[${issue ? `${issue.ref}, ` : ''}${reference.ref}]`;
}
