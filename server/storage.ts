import { constants, copyFileSync, existsSync, linkSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { restoreState } from '../shared/state.ts';

export function defaultDataDir() {
  return process.platform === 'darwin'
    ? resolve(homedir(), 'Library/Application Support/Tongpin')
    : resolve(homedir(), '.local/share/tongpin');
}

/** Copy the first existing legacy file only if no canonical session exists. */
export function prepareDataDir(dataDir: string, legacyDirs: string[]) {
  mkdirSync(dataDir, { recursive: true });
  const destination = resolve(dataDir, 'session.json');
  if (existsSync(destination)) return { migrated: false };
  for (const directory of legacyDirs) {
    const source = resolve(directory, 'session.json');
    if (source === destination || !existsSync(source)) continue;
    // Never overwrite or silently discard a corrupt legacy file.
    try { restoreState(JSON.parse(readFileSync(source, 'utf8')), Date.now()); }
    catch (cause) { throw new Error(`原文稿无法读取，已保留原文件：${source}`, { cause }); }
    const temporary = resolve(dataDir, `.migration-${randomUUID()}.tmp`);
    try {
      copyFileSync(source, temporary, constants.COPYFILE_EXCL);
      linkSync(temporary, destination);
    }
    catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'EEXIST') return { migrated: false };
      throw new Error(`无法迁移文稿，请检查应用数据目录的权限。原文件仍保留在：${source}`, { cause });
    }
    finally { if (existsSync(temporary)) unlinkSync(temporary); }
    return { migrated: true, source };
  }
  return { migrated: false };
}

/** Reserve the port while preparing data to avoid migrating a running session. */
export async function withReservedPort<T>(port: number, work: () => T): Promise<T> {
  const reservation = createServer();
  await new Promise<void>((resolveListen, reject) => {
    reservation.once('error', reject);
    reservation.listen(port, '0.0.0.0', () => resolveListen());
  });
  try { return work(); }
  finally { await new Promise<void>((resolveClose, reject) => reservation.close(error => error ? reject(error) : resolveClose())); }
}

export function legacyDataDirs(projectRoot?: string) {
  return [process.env.PROMPT_LEGACY_DATA_DIR, projectRoot && resolve(projectRoot, '.local-data'),
    resolve(homedir(), 'data/project/talking_prompt/.local-data')].filter((path): path is string => !!path);
}
