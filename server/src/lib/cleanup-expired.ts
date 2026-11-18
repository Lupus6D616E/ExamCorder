import { unlink } from 'node:fs/promises';
import { and, eq, lt } from 'drizzle-orm';
import { db } from '../db/db';
import { exams, examLog } from '../db/schema';

function recordingSegment(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase()
    .slice(0, 60) || 'untitled';
}

function oneMonthAgo(from: Date) {
  const cutoff = new Date(from);
  const day = cutoff.getUTCDate();
  cutoff.setUTCDate(1);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - 1);
  const lastDayOfTargetMonth = new Date(Date.UTC(
    cutoff.getUTCFullYear(), cutoff.getUTCMonth() + 1, 0,
  )).getUTCDate();
  cutoff.setUTCDate(Math.min(day, lastDayOfTargetMonth));
  return cutoff;
}

async function removeIfPresent(path: string) {
  try {
    await unlink(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

export async function cleanupExpiredRecordings() {
  const cutoff = oneMonthAgo(new Date());

  await db.update(exams)
    .set({ expired: true, status: 'disabled' })
    .where(and(lt(exams.createdAt, cutoff), eq(exams.expired, false)));

  await db.update(examLog)
    .set({ expired: true })
    .where(and(lt(examLog.createdAt, cutoff), eq(examLog.expired, false)));

  const oldLogs = await db.select({
    id: examLog.id,
    name: examLog.name,
    code: examLog.code,
  })
    .from(examLog)
    .where(lt(examLog.createdAt, cutoff));

  for (const log of oldLogs) {
    const dir = `./recordings/${recordingSegment(log.code)}/${recordingSegment(log.name)}`;
    const metadataPath = `${dir}/log-${log.id}_meta.json`;
    const metadataFile = Bun.file(metadataPath);

    try {
      if (!await metadataFile.exists()) continue;
      const metadata = await metadataFile.json() as { timestamp?: unknown };
      if (typeof metadata.timestamp !== 'string'
        || !/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-\d{3}$/.test(metadata.timestamp)) {
        console.warn('[cleanup] invalid recording metadata', { logId: log.id });
        continue;
      }

      await Promise.all([
        removeIfPresent(`${dir}/display_${metadata.timestamp}.webm`),
        removeIfPresent(`${dir}/webcam_${metadata.timestamp}.webm`),
        removeIfPresent(metadataPath),
      ]);
      console.log('[cleanup] expired recording files deleted', { logId: log.id });
    } catch (error) {
      console.error('[cleanup] could not delete expired recording files', { logId: log.id, error });
    }
  }
}
