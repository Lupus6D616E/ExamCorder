import { Elysia } from 'elysia';
import { betterAuthPlugin } from './auth';
import {cors} from "@elysiajs/cors"
import { mkdir } from 'node:fs/promises';

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
  // 2026-11-16_09-30-15 (no colons, which are illegal on Windows)
  return date.toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-');
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
      const { title = '', startedAt = '' } = ws.data.query as Record<string, string>;
      console.log('[recording] websocket opened', { sessionId, wsId: ws.id });
      const base = `${fileStamp(startedAt)}_${slugify(title)}`;
      // short id suffix guarantees uniqueness if two recordings share a title and second
      const dir = `./recordings/${base}_${sessionId.slice(0, 8)}`;
      await mkdir(dir, { recursive: true });

      await Bun.write(
        `${dir}/meta.json`,
        JSON.stringify({ sessionId, title, startedAt }, null, 2),
      );
      console.log('[recording] recording files initialized', { sessionId, dir });

      sessions.set(ws.id, {
        screen: Bun.file(`${dir}/${base}_screen.webm`).writer(),
        webcam: Bun.file(`${dir}/${base}_webcam.webm`).writer(),
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
  .get('/', () => ({ message: 'ExamCorder API is running' }))
  .get("/me", ({ user }) => user, { auth: true })
  .listen(port);
export type ExamcorderServer = typeof app 

console.log(`ExamCorder API listening at ${app.server?.url}`);
