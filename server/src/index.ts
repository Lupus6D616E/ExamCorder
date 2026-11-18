import { Elysia } from 'elysia';
import { betterAuthPlugin } from './auth';
import { cors } from "@elysiajs/cors"
import { mkdir } from 'node:fs/promises';
import { hostPlugin } from './modules/host/controller';
import { db } from './db/db';
import { exams, examLog } from './db/schema';
import { eq } from 'drizzle-orm';
import { cleanupExpiredRecordings } from './lib/cleanup-expired';

const sessions = new Map<string, {
  screen: any;
  webcam: any;
  screenFrames: number;
  webcamFrames: number;
  screenBytes: number;
  webcamBytes: number;
}>();
const port = Number(Bun.env.PORT ?? 3000);


function slugify(input: string) {
  return (
    input
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')   // drop anything that isn't word chars, space, hyphen
      .trim()
      .replace(/\s+/g, '-')       // spaces to hyphens
      .toLowerCase()
      .slice(0, 60) || 'untitled'
  );
}

function fileStamp(iso: string) {
  const d = new Date(iso);
  const date = isNaN(d.getTime()) ? new Date() : d; // fall back if the client sent junk
  // Include milliseconds so repeated recordings in one second get distinct filenames.
  return date.toISOString().replace('T', '_').replace(/:/g, '-').replace(/\.(\d{3})Z$/, '-$1');
}


const app = new Elysia()
  .use(
    cors({
      origin: "chrome-extension://jokdphedbajhckchmojbgnnbmkoecnec",
      credentials: true,
      allowedHeaders: ["Content-Type", "Authorization"],
      exposeHeaders: ["set-auth-token"],
    })
  )
  .use(betterAuthPlugin)
  .ws('/record/:sessionId', {
    async open(ws) {
      const { sessionId } = ws.data.params;
      const { name = '', examCode = '', startedAt = '' } = ws.data.query as Record<string, string>;
      if (!examCode.trim()) {
        ws.close(1008, 'Exam code required');
        return;
      }
      const [exam] = await db
        .select({ status: exams.status, expired: exams.expired })
        .from(exams)
        .where(eq(exams.code, examCode.trim()))
        .limit(1);
      if (exam?.status !== 'enabled' || exam.expired) {
        ws.close(1008, exam ? (exam.expired ? 'Exam expired' : 'Exam disabled') : 'Exam code not found');
        return;
      }

      const ip = ws.data.request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
        || ws.data.request.headers.get('x-real-ip')
        || 'unknown';
      const [logEntry] = await db.insert(examLog).values({
        name: name.trim() || 'unknown',
        code: examCode.trim(),
        ip,
      }).returning({ id: examLog.id });

      console.log('[recording] websocket opened', { sessionId, wsId: ws.id });
      const timestamp = fileStamp(startedAt);
      const dir = `./recordings/${slugify(examCode)}/${slugify(name)}`;
      await mkdir(dir, { recursive: true });

      await Bun.write(
        `${dir}/log-${logEntry.id}_meta.json`,
        JSON.stringify({ sessionId, name, examCode, startedAt, timestamp }, null, 2),
      );
      console.log('[recording] recording files initialized', { sessionId, dir });

      sessions.set(ws.id, {
        screen: Bun.file(`${dir}/display_${timestamp}.webm`).writer(),
        webcam: Bun.file(`${dir}/webcam_${timestamp}.webm`).writer(),
        screenFrames: 0,
        webcamFrames: 0,
        screenBytes: 0,
        webcamBytes: 0,
      });
    },
    message(ws, message) {
      const s = sessions.get(ws.id);
      if (!s) {
        console.error('[recording] received frame without an initialized session', { wsId: ws.id });
        return;
      }
      const bytes = new Uint8Array(message as ArrayBuffer);
      if (bytes.byteLength < 2) {
        console.warn('[recording] received undersized frame', {
          wsId: ws.id, messageType: typeof message, bytes: bytes.byteLength,
        });
        return;
      }
      const trackId = bytes[0];
      const chunk = bytes.subarray(1);
      if (trackId === 0) {
        s.screen.write(chunk);
        s.screenFrames++;
        s.screenBytes += chunk.byteLength;
      } else if (trackId === 1) {
        s.webcam.write(chunk);
        s.webcamFrames++;
        s.webcamBytes += chunk.byteLength;
      } else {
        console.warn('[recording] received frame with invalid track id', { wsId: ws.id, trackId });
        return;
      }
      console.log('[recording] frame written', {
        wsId: ws.id, trackId, bytes: chunk.byteLength,
        screenFrames: s.screenFrames, screenBytes: s.screenBytes,
        webcamFrames: s.webcamFrames, webcamBytes: s.webcamBytes,
      });
    },
    async close(ws) {
      const s = sessions.get(ws.id);
      if (!s) {
        console.warn('[recording] websocket closed without an initialized session', { wsId: ws.id });
        return;
      }
      await s.screen.end();
      await s.webcam.end();
      sessions.delete(ws.id);
      console.log('[recording] websocket closed and files finalized', {
        wsId: ws.id,
        screenFrames: s.screenFrames, screenBytes: s.screenBytes,
        webcamFrames: s.webcamFrames, webcamBytes: s.webcamBytes,
      });
      // queue post-processing here (see below)
    },
    error({ error, code }) {
      console.error('[recording] websocket error', { code, error });
    },
  })
  .use(hostPlugin)
  .get('/', () => ({ message: 'ExamCorder API is running' }))
  .get("/me", ({user}) =>{
  
    return  user
  }, { auth: true })
  .listen(port);
export type ExamcorderServer = typeof app

console.log(`ExamCorder API listening at ${app.server?.url}`);

async function runExpiredCleanup() {
  try {
    await cleanupExpiredRecordings();
  } catch (error) {
    console.error('[cleanup] expired recording cleanup failed', error);
  }
}

void runExpiredCleanup();
Bun.cron('0 1 * * *', runExpiredCleanup);
