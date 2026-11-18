import { useState } from "react";

type PermissionStatus = "idle" | "loading" | "granted" | "denied";

export default function App() {
  const [status, setStatus] = useState<PermissionStatus>("idle");
  const [error, setError] = useState("");
  const [stream, setStream] = useState<MediaStream | null>(null);

  async function requestPermissions() {
    setStatus("loading");
    setError("");

    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });

      setStream(mediaStream);
      setStatus("granted");
    } catch (err) {
      console.error("Permission error:", err);

      setStatus("denied");

      if (err instanceof DOMException) {
        if (err.name === "NotAllowedError") {
          setError(
            "Camera and microphone access was denied. Please allow access in your browser settings."
          );
        } else if (err.name === "NotFoundError") {
          setError(
            "No camera or microphone was found on your device."
          );
        } else if (err.name === "NotReadableError") {
          setError(
            "Your camera or microphone is already being used by another application."
          );
        } else {
          setError(err.message);
        }
      } else {
        setError("Something went wrong while requesting permissions.");
      }
    }
  }

  function handleContinue() {
    // Stop preview tracks if you don't need them anymore.
    stream?.getTracks().forEach((track) => track.stop());

    // Your post-install logic here.
    window.close();
  }

  return (
    <div className="min-h-screen bg-base-200 flex items-center justify-center p-6">
      <div className="card bg-base-100 shadow-xl w-full max-w-lg">
        <div className="card-body items-center text-center p-8">

          <div className="text-5xl mb-2">
            {status === "granted" ? "🎉" : "🎥"}
          </div>

          <h1 className="text-3xl font-bold">
            {status === "granted"
              ? "You're all set!"
              : "Welcome aboard!"}
          </h1>

          <p className="text-base-content/60 mt-2">
            {status === "granted"
              ? "Your camera and microphone are ready to use."
              : "Before getting started, we need access to your camera and microphone."}
          </p>

          <div className="w-full space-y-3 mt-6">

            <div className="flex items-center gap-4 p-4 rounded-xl bg-base-200">
              <div className="text-2xl">📷</div>
              <div className="text-left flex-1">
                <p className="font-semibold">Camera access</p>
                <p className="text-sm text-base-content/60">
                  Required for video capture
                </p>
              </div>
              {status === "granted" && (
                <span className="badge badge-success">Granted</span>
              )}
            </div>

            <div className="flex items-center gap-4 p-4 rounded-xl bg-base-200">
              <div className="text-2xl">🎙️</div>
              <div className="text-left flex-1">
                <p className="font-semibold">Microphone access</p>
                <p className="text-sm text-base-content/60">
                  Required for audio capture
                </p>
              </div>
              {status === "granted" && (
                <span className="badge badge-success">Granted</span>
              )}
            </div>

          </div>

          {status === "denied" && (
            <div className="alert alert-error mt-5 text-left">
              <span>{error}</span>
            </div>
          )}

          {status === "granted" && stream && (
            <div className="w-full mt-5">
              <video
                autoPlay
                muted
                playsInline
                ref={(video) => {
                  if (video && video.srcObject !== stream) {
                    video.srcObject = stream;
                  }
                }}
                className="w-full rounded-xl bg-black aspect-video object-cover"
              />
            </div>
          )}

          <div className="w-full mt-6">
            {status === "granted" ? (
              <button
                className="btn btn-primary w-full"
                onClick={handleContinue}
              >
                Continue
              </button>
            ) : (
              <button
                className="btn btn-primary w-full"
                onClick={requestPermissions}
                disabled={status === "loading"}
              >
                {status === "loading" ? (
                  <>
                    <span className="loading loading-spinner loading-sm" />
                    Requesting permissions...
                  </>
                ) : (
                  "Grant camera & microphone access"
                )}
              </button>
            )}
          </div>

          <p className="text-xs text-base-content/50 mt-4">
            Your camera and microphone will only be accessed when
            you use features that require them.
          </p>

        </div>
      </div>
    </div>
  );
}