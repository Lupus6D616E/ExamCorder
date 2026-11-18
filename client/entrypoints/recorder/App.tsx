import { useEffect, useRef, useState } from 'react';
import '@/assets/tailwind.css';

const TRACK = { screen: 0, webcam: 1 } as const;
const WS_URL = import.meta.env.WXT_WS_URL as string;
const recordingTitle = new URLSearchParams(location.search).get('title') || 'untitled';

type RecordingStatus = 'ready' | 'starting' | 'recording' | 'stopping' | 'stopped';

export default function App() {
  const [status, setStatus] = useState<RecordingStatus>('ready');
  const [error, setError] = useState('');
  const streamsRef = useRef<MediaStream[]>([]);
  const recordersRef = useRef<MediaRecorder[]>([]);
  const socketRef = useRef<WebSocket | undefined>(undefined);
  const sendQueueRef = useRef<Promise<void>>(Promise.resolve());
  const stoppingRef = useRef(false);

  useEffect(() => {
    const onMessage = async (msg: { target?: string; type?: string }) => {
      if (msg.target !== 'recorder' || msg.type !== 'stop') return;
      await stop();
      return { ok: true };
    };

    browser.runtime.onMessage.addListener(onMessage);
    return () => browser.runtime.onMessage.removeListener(onMessage);
  }, []);

  // This call must stay directly in the click handler to retain user activation.
  async function start() {
    setStatus('starting');
    setError('');
    stoppingRef.current = false;
    sendQueueRef.current = Promise.resolve();

    try {
      const screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      streamsRef.current = [screen];
      console.log('[recording] display capture acquired', {
        videoTracks: screen.getVideoTracks().length,
        audioTracks: screen.getAudioTracks().length,
      });

      const webcam = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      streamsRef.current.push(webcam);
      console.log('[recording] webcam capture acquired', {
        videoTracks: webcam.getVideoTracks().length,
        audioTracks: webcam.getAudioTracks().length,
      });

      await connect();
      recordersRef.current = [attach(screen, TRACK.screen), attach(webcam, TRACK.webcam)];
      screen.getVideoTracks()[0]?.addEventListener('ended', () => void stop(), { once: true });
      setStatus('recording');
      await browser.runtime.sendMessage({ type: 'recording-started' });
      console.log('[recording] recording started');
    } catch (cause) {
      console.error('[recording] could not start:', cause);
      setError(cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause));
      setStatus('stopped');
      await releaseResources();
      await notifyStopped();
    }
  }

  async function connect() {
    const sessionId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    const query = new URLSearchParams({ title: recordingTitle, startedAt, token: '...' });
    const socket = new WebSocket(`${WS_URL}/record/${sessionId}?${query}`);
    socketRef.current = socket;
    socket.binaryType = 'arraybuffer';
    console.log('[recording] connecting websocket', { sessionId, url: WS_URL });
    socket.addEventListener('error', (event) => console.error('[recording] websocket error', event));
    socket.addEventListener('close', (event) => console.log('[recording] websocket closed', {
      sessionId, code: event.code, reason: event.reason, clean: event.wasClean,
    }));

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('WebSocket connection timed out')), 10000);
      socket.addEventListener('open', () => {
        clearTimeout(timeout);
        console.log('[recording] websocket connected', { sessionId });
        resolve();
      }, { once: true });
      socket.addEventListener('error', () => {
        clearTimeout(timeout);
        reject(new Error('WebSocket connection failed'));
      }, { once: true });
    });
  }

  function attach(stream: MediaStream, trackId: number) {
    const recorder = new MediaRecorder(stream, {
      mimeType: 'video/webm;codecs=vp9,opus',
      videoBitsPerSecond: 2_500_000,
    });
    recorder.addEventListener('dataavailable', (event) => {
      if (!event.data.size) {
        console.warn('[recording] empty recorder chunk', { trackId });
        return;
      }
      sendQueueRef.current = sendQueueRef.current.then(async () => {
        const socket = socketRef.current;
        if (!socket || socket.readyState !== WebSocket.OPEN) {
          console.warn('[recording] dropped chunk: websocket is not open', {
            trackId, readyState: socket?.readyState,
          });
          return;
        }
        const chunk = new Uint8Array(await event.data.arrayBuffer());
        const framed = new Uint8Array(chunk.byteLength + 1);
        framed[0] = trackId;
        framed.set(chunk, 1);
        socket.send(framed);
        console.log('[recording] chunk sent', { trackId, bytes: chunk.byteLength });
      }).catch((cause) => console.error('[recording] chunk send failed:', cause));
    });
    recorder.start(1000);
    console.log('[recording] MediaRecorder started', { trackId, mimeType: recorder.mimeType });
    return recorder;
  }

  async function stop() {
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    setStatus('stopping');
    console.log('[recording] stopping recorders', { count: recordersRef.current.length });

    try {
      await Promise.all(recordersRef.current.map((recorder) => new Promise<void>((resolve) => {
        if (recorder.state === 'inactive') return resolve();
        recorder.addEventListener('stop', () => resolve(), { once: true });
        recorder.stop();
      })));
      await sendQueueRef.current;
    } catch (cause) {
      console.error('[recording] error while stopping:', cause);
    } finally {
      await releaseResources();
      recordersRef.current = [];
      setStatus('stopped');
      await notifyStopped();
    }
  }

  async function releaseResources() {
    streamsRef.current.forEach((stream) => stream.getTracks().forEach((track) => track.stop()));
    streamsRef.current = [];
    const socket = socketRef.current;
    socketRef.current = undefined;
    if (socket && socket.readyState < WebSocket.CLOSING) {
      await new Promise<void>((resolve) => {
        socket.addEventListener('close', () => resolve(), { once: true });
        socket.close(1000, 'done');
        setTimeout(resolve, 2000);
      });
    }
  }

  async function notifyStopped() {
    try {
      await browser.runtime.sendMessage({ type: 'stopped' });
    } catch (cause) {
      console.error('[recording] could not report stopped state:', cause);
    }
  }

  const isActive = status === 'recording' || status === 'stopping';
  const isBusy = status === 'starting' || status === 'stopping';

  return (
    <main className="min-h-screen bg-base-200 flex items-center justify-center p-6">
      <section className="card bg-base-100 shadow-xl w-full max-w-lg">
        <div className="card-body items-center text-center p-8">
          <div className="text-5xl mb-2">{isActive ? '🔴' : '🎥'}</div>
          <h1 className="text-3xl font-bold">ExamCorder</h1>
          <p className="text-base-content/60 mt-2 break-all">Recording: {recordingTitle}</p>

          <div className="alert mt-6" role="status">
            <span>
              {status === 'ready' && 'Choose a screen or window to share, then recording will begin.'}
              {status === 'starting' && 'Waiting for screen, camera, and microphone access…'}
              {status === 'recording' && 'Recording in progress.'}
              {status === 'stopping' && 'Finishing the recording…'}
              {status === 'stopped' && (error ? 'Recording did not start.' : 'Recording stopped.')}
            </span>
          </div>

          {error && <div className="alert alert-error mt-3 text-left"><span>{error}</span></div>}

          <div className="w-full mt-6">
            {isActive ? (
              <button className="btn btn-error w-full" onClick={() => void stop()} disabled={isBusy}>
                {isBusy ? <><span className="loading loading-spinner loading-sm" /> Finishing…</> : 'Stop recording'}
              </button>
            ) : (
              <button className="btn btn-primary w-full" onClick={() => void start()} disabled={isBusy}>
                {isBusy ? <><span className="loading loading-spinner loading-sm" /> Starting…</> : 'Choose screen and start'}
              </button>
            )}
          </div>

          <p className="text-xs text-base-content/50 mt-4">
            Screen sharing starts only after you choose a source in the browser prompt.
          </p>
        </div>
      </section>
    </main>
  );
}
