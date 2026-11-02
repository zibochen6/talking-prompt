import { valid, gt } from 'semver';

export type UpdateResult =
  | { kind: 'available'; version: string; url: string }
  | { kind: 'current' }
  | { kind: 'error' };

// Only the fixed GitHub repository is queried, and the returned URL is constructed locally.
export async function checkLatestRelease(currentVersion: string, fetcher: typeof fetch = fetch): Promise<UpdateResult> {
  try {
    const response = await fetcher('https://api.github.com/repos/zibochen6/talking-prompt/releases/latest', {
      headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(8000),
    });
    if (response.status === 404) return { kind: 'current' };
    if (!response.ok) return { kind: 'error' };
    const release = await response.json() as { tag_name?: unknown; draft?: unknown; prerelease?: unknown };
    if (release.draft || release.prerelease || typeof release.tag_name !== 'string') return { kind: 'error' };
    const version = valid(release.tag_name);
    if (!version || !valid(currentVersion)) return { kind: 'error' };
    if (!gt(version, currentVersion)) return { kind: 'current' };
    return { kind: 'available', version, url: `https://github.com/zibochen6/talking-prompt/releases/tag/${encodeURIComponent(release.tag_name)}` };
  } catch { return { kind: 'error' }; }
}
