export type Forge = 'github' | 'gitlab';

const LEGACY_PREFIX_RE = /^\[[^[\],]+, [!#](?:\d+|N\/A)\] /;
const MAX_TITLE_LENGTH = 100;

const ISSUE_PATTERNS: RegExp[] = [
  /(?:^|[/])(\d+)[-/]/,
  /[-/](\d+)$/,
  /^(?:issue|gh|bug|fix|feat|feature|hotfix)[-/](\d+)\b/i,
];

export function detectForge(remoteUrl: string): Forge | undefined {
  if (remoteUrl.includes('github.com')) return 'github';
  if (remoteUrl.includes('gitlab')) return 'gitlab';
  return undefined;
}

export function extractIssueNumber(branch: string): string | undefined {
  for (const pattern of ISSUE_PATTERNS) {
    const match = branch.match(pattern);
    if (match) return match[1];
  }
  return undefined;
}

function naRef(forge: Forge): string {
  return forge === 'github' ? '#N/A' : '!N/A';
}

function formatRef(forge: Forge, iid: string): string {
  return forge === 'github' ? `#${iid}` : `!${iid}`;
}

export function reconcileTitle(title: string, prefix?: string, previousPrefix?: string): string {
  const rest =
    previousPrefix && title.startsWith(`${previousPrefix} `)
      ? title.slice(previousPrefix.length + 1)
      : title.replace(LEGACY_PREFIX_RE, '');
  return (prefix ? `${prefix} ${rest}` : rest).slice(0, MAX_TITLE_LENGTH);
}

export async function branchPrefix(
  forge: Forge,
  branch: string,
  lookupRef: () => Promise<string | undefined>,
): Promise<string> {
  const issueNumber = extractIssueNumber(branch);
  const iid = await lookupRef();
  const parts = [
    issueNumber ? `#${issueNumber}` : branch,
    iid ? formatRef(forge, iid) : naRef(forge),
  ];
  return `[${parts.join(', ')}]`;
}
