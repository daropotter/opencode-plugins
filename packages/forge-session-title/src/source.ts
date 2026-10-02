import { exec } from '../../_shared/src/index.ts';
import { sourceBranchFromResponse, type Request } from './target.ts';

export async function sourceBranch(
  request: Request,
  directory: string,
): Promise<string | undefined> {
  const [cli, path] =
    request.forge === 'github'
      ? ['gh', `repos/${request.project}/pulls/${request.iid}`]
      : ['glab', `projects/${encodeURIComponent(request.project)}/merge_requests/${request.iid}`];
  const result = await exec(cli, ['api', '--hostname', request.host, path], {
    cwd: directory,
    timeout: 15_000,
  });
  return result.code === 0 ? sourceBranchFromResponse(request, result.stdout) : undefined;
}
