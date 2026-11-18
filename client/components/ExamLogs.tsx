import { useEffect, useState } from 'react';
import { server } from '@/lib/server-client';
import { tokenItem } from '@/lib/auth-client';

const API_URL = import.meta.env.WXT_API_URL as string;

type ExamLog = {
  id: number;
  name: string;
  code: string;
  ip: string;
  createdAt: Date | string;
  expired: boolean;
};

export default function ExamLogs({
  examId,
  status,
  expired,
  onStatusChange,
}: {
  examId: number;
  status: 'enabled' | 'disabled';
  expired: boolean;
  onStatusChange: (status: 'enabled' | 'disabled') => void;
}) {
  const [logs, setLogs] = useState<ExamLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [downloadError, setDownloadError] = useState('');
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [statusError, setStatusError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');

    server.host.exams.logs({ id: String(examId) }).get().then((res) => {
      if (cancelled) return;
      if (res.error || !res.data) {
        setError(res.status === 401 ? 'You are not authorized to view these logs.' : 'Could not load exam logs.');
        setLogs([]);
      } else {
        setLogs(res.data);
      }
    }).catch(() => {
      if (!cancelled) setError('Could not load exam logs.');
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, [examId]);

  async function downloadVideos(logId: number) {
    setDownloadingId(logId);
    setDownloadError('');
    try {
      const token = await tokenItem.getValue();
      const response = await fetch(`${API_URL}/host/exams/logs/${logId}/videos`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) {
        throw new Error(response.status === 401 ? 'You are not authorized to download these videos.' : 'Could not download the videos.');
      }

      const form = await response.formData();
      const videos = ['display', 'webcam']
        .map((field) => form.get(field))
        .filter((value): value is File => value instanceof File);
      if (videos.length !== 2) throw new Error('The server did not return both video files.');

      for (const video of videos) {
        const objectUrl = URL.createObjectURL(video);
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = video.name;
        link.click();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      }
    } catch (cause) {
      setDownloadError(cause instanceof Error ? cause.message : 'Could not download the videos.');
    } finally {
      setDownloadingId(null);
    }
  }

  async function toggleExamStatus() {
    const nextStatus = status === 'enabled' ? 'disabled' : 'enabled';
    setUpdatingStatus(true);
    setStatusError('');
    try {
      const result = await server.host.exams.status({ id: String(examId) }).patch({ status: nextStatus });
      if (result.error || !result.data) {
        throw new Error(result.status === 401 ? 'You are not authorized to change this exam.' : 'Could not update exam status.');
      }
      onStatusChange(result.data.status);
    } catch (cause) {
      setStatusError(cause instanceof Error ? cause.message : 'Could not update exam status.');
    } finally {
      setUpdatingStatus(false);
    }
  }

  return (
    <section className="p-6">
      <div className="flex items-center justify-between gap-4 mb-4">
        <h1 className="text-2xl font-bold">Exam logs</h1>
        <button className="btn btn-outline" onClick={() => void toggleExamStatus()} disabled={updatingStatus || expired}>
          {expired ? 'Exam expired' : updatingStatus ? 'Updating…' : status === 'enabled' ? 'Disable exam' : 'Enable exam'}
        </button>
      </div>
      {statusError && <p className="text-error mb-3" role="alert">{statusError}</p>}
      {loading && <p role="status">Loading logs…</p>}
      {!loading && error && <p className="text-error" role="alert">{error}</p>}
      {!loading && !error && logs.length === 0 && <p className="opacity-70">No logs for this exam yet.</p>}
      {!loading && !error && logs.length > 0 && (
        <div className="overflow-x-auto">
          <table className="table table-zebra">
            <thead>
              <tr><th>Participant</th><th>IP address</th><th>Recorded at</th><th>Videos</th></tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id}>
                  <td>{log.name}</td>
                  <td>{log.ip}</td>
                  <td>{new Date(log.createdAt).toLocaleString()}</td>
                  <td>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => void downloadVideos(log.id)}
                      disabled={downloadingId !== null || log.expired}
                    >
                      {downloadingId === log.id ? 'Downloading…' : 'Download'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {downloadError && <p className="text-error mt-3" role="alert">{downloadError}</p>}
    </section>
  );
}
