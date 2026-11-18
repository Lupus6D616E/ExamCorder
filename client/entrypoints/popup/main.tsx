import React from 'react';
import { createRoot } from 'react-dom/client';
import { browser } from 'wxt/browser';
import '../../assets/tailwind.css';

import { useEffect, useState } from 'react';

export default function App() {
  const [title, setTitle] = useState('');
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [windowId, setWindowId] = useState<number | null>(null);

  // Restore saved title + current recording state, and stay in sync with changes
  useEffect(() => {
    browser.windows.getCurrent().then((currentWindow) => {
      if (typeof currentWindow.id === 'number') setWindowId(currentWindow.id);
    });
    browser.storage.local.get('lastTitle').then(({ lastTitle }) => {
      if (typeof lastTitle === "string") setTitle(lastTitle);
    });
    browser.storage.session.get('recording').then(({ recording }) => {
      setRecording(!!recording);
    });

    const onChange = (changes: Record<string, any>, area: string) => {
      if (area === 'session' && 'recording' in changes) {
        setRecording(!!changes.recording.newValue);
        setBusy(false);
      }
    };
    browser.storage.onChanged.addListener(onChange);
    return () => browser.storage.onChanged.removeListener(onChange);
  }, []);

  const start = async () => {
    const finalTitle = title.trim() || 'untitled';
    setBusy(true);
    setError('');
    setNotice('Opening the recorder in the side panel…');
    try {
      if (windowId === null) throw new Error('Could not determine the current browser window.');
      // Call immediately from this click handler to satisfy sidePanel.open's user-gesture requirement.
      const opening = browser.sidePanel.open({ windowId });
      await browser.storage.local.set({ lastTitle: finalTitle });
      await opening;
      setNotice('Choose screen and start from the recorder panel.');
    } catch (startError) {
      setError(String(startError));
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    setBusy(true);
    setError('');
    try {
      await browser.runtime.sendMessage({ type: 'stop' });
    } catch (stopError) {
      setError(String(stopError));
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-3 w-full max-w-lg">
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Recording title"
          maxLength={80}
          disabled={recording || busy}
          className="input input-bordered w-full"
        />

        <button
          onClick={recording ? stop : start}
          disabled={busy || (!recording && windowId === null)}
          className={`btn ${recording ? 'btn-error' : 'btn-primary'
            } min-w-44`}
        >
          {busy ? (
            <span className="loading loading-spinner loading-sm" />
          ) : recording ? (
            '⏹ Stop recording'
          ) : (
            '⏺ Start recording'
          )}
        </button>
      </div>

      {recording && (
        <div className="alert alert-error py-2">
          <span className="w-2 h-2 rounded-full bg-error-content animate-pulse" />
          <span className="text-sm font-medium">
            Recording in progress
          </span>
        </div>
      )}
      {error && <p className="text-sm text-error">{error}</p>}
      {notice && <p className="text-sm">{notice}</p>}
    </div>
  );
}

function Popup() {
  const openLogin = () => {
    browser.tabs.create({ url: browser.runtime.getURL("/login.html") })
  };

  return (
    <main className="hero min-h-64 bg-base-200">
      <section className="hero-content flex-col text-center">
        <div>
          <App />
          <h1 className="text-2xl font-bold">ExamCorder</h1>
          <p className="py-4">Your extension is ready for development.</p>
          <button className="btn btn-primary" onClick={openLogin}>
            Log in
          </button>
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Popup />
  </React.StrictMode>,
);
