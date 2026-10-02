import type { Forge } from './title.ts';

export type Target = { url: string; issueUrl?: string; branchIssue?: string };
export type Request = { forge: Forge; host: string; project: string; iid: string };

function parseReference(value: string) {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Use a full HTTP(S) issue, pull request, or merge request URL.');
  }
  const github = url.hostname === 'github.com';
  const match = github
    ? url.pathname.match(/^\/([^/]+\/[^/]+)\/(pull|issues)\/([1-9]\d*)\/?$/)
    : url.pathname.match(/^\/(.+)\/-\/(merge_requests|issues|work_items)\/([1-9]\d*)\/?$/);
  if (!match) throw new Error('Use a GitHub or GitLab issue, pull request, or merge request URL.');
  const [, project, kind, iid] = match as unknown as [string, string, string, string];
  const forge: Forge = github ? 'github' : 'gitlab';
  const issue = kind === 'issues' || kind === 'work_items';
  url.search = '';
  url.hash = '';
  url.pathname = url.pathname.replace(/\/$/, '');
  return {
    url: url.href,
    forge,
    host: url.host,
    project,
    iid,
    issue,
    ref: `${!issue && forge === 'gitlab' ? '!' : '#'}${iid}`,
  };
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

export function targetRequest(target: Target): Request | undefined {
  const { forge, host, project, iid, issue } = parseReference(target.url);
  return issue ? undefined : { forge, host, project, iid };
}

export function sourceBranchFromResponse(request: Request, stdout: string): string | undefined {
  try {
    const data = JSON.parse(stdout) as { source_branch?: unknown; head?: { ref?: unknown } };
    const branch = request.forge === 'github' ? data.head?.ref : data.source_branch;
    return typeof branch === 'string' && branch ? branch : undefined;
  } catch {
    return undefined;
  }
}

export function targetPrefix(target: Target): string {
  const reference = parseReference(target.url);
  const issue = target.issueUrl
    ? parseReference(target.issueUrl).ref
    : !reference.issue && target.branchIssue
      ? `#${target.branchIssue}`
      : undefined;
  return `[${issue ? `${issue}, ` : ''}${reference.ref}]`;
}
