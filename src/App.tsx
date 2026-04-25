import React, { useState, useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { motion, AnimatePresence } from "motion/react";

export default function App() {
  const [mode, setMode] = useState<"home" | "host" | "viewer">("home");

  return (
    <div className="min-h-screen bg-background text-on-background font-body-reg selection:bg-primary-container selection:text-on-primary-container overflow-hidden">
      <AnimatePresence mode="wait">
        {mode === "home" && (
          <motion.div
            key="home"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="h-screen flex flex-col items-center justify-center p-6 max-w-sm mx-auto relative z-10"
          >
            <div className="absolute inset-0 grid-bg z-0 opacity-50"></div>
            <div className="absolute inset-0 scanlines z-0 opacity-50"></div>

            <div className="relative z-10 glass-panel p-8 w-full flex flex-col items-center border-t border-l border-white/10 border-b border-r border-black/60 shadow-[0_24px_48px_-12px_rgba(0,0,0,0.5)]">
              <span
                className="material-symbols-outlined text-primary text-4xl mb-2"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                terminal
              </span>
              <h1 className="font-display-lg text-4xl text-on-surface uppercase tracking-tighter mb-1">
                OS-CORE
              </h1>
              <p className="font-data-mono text-[10px] text-outline-variant tracking-widest mb-10 text-center">
                SECURE_TERMINAL_HANDSHAKE
              </p>

              <div className="w-full space-y-4">
                <button
                  onClick={() => setMode("host")}
                  className="w-full py-4 bg-primary-container text-on-primary-container font-label-caps text-label-caps uppercase tracking-widest border border-primary transition-all duration-300 btn-glow relative overflow-hidden group"
                >
                  <span className="relative z-10 flex items-center justify-center gap-2">
                    <span className="material-symbols-outlined text-sm">
                      videocam
                    </span>
                    INIT CAM_ARRAY (PHONE)
                  </span>
                </button>

                <button
                  onClick={() => setMode("viewer")}
                  className="w-full py-4 bg-transparent text-primary font-label-caps text-label-caps uppercase tracking-widest border border-primary transition-all duration-300 hover:bg-primary/10 relative overflow-hidden group"
                >
                  <span className="relative z-10 flex items-center justify-center gap-2">
                    <span className="material-symbols-outlined text-sm">
                      monitor
                    </span>
                    MONITOR UPLINK (LAPTOP)
                  </span>
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {mode === "host" && (
          <motion.div
            key="host"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="h-screen"
          >
            <HostView onBack={() => setMode("home")} />
          </motion.div>
        )}

        {mode === "viewer" && (
          <motion.div
            key="viewer"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="h-screen"
          >
            <ViewerView onBack={() => setMode("home")} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function HostView({ onBack }: { onBack: () => void }) {
  const [code, setCode] = useState<string>("");
  const [status, setStatus] = useState<string>("INITIALIZING...");
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  
  const [isMuted, setIsMuted] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("environment");
  const [resolution, setResolution] = useState<{w: number, h: number}>({w: 1280, h: 720});
  const [fps, setFps] = useState<number>(30);

  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pendingCandidates = useRef<RTCIceCandidateInit[]>([]);

  const requestMedia = async (facing: string, width: number, height: number, frameRate: number) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: facing,
          width: { ideal: width },
          height: { ideal: height },
          frameRate: { ideal: frameRate },
        },
        audio: true,
      });
      
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = stream;
      setLocalStream(stream);

      if (pcRef.current) {
        const senders = pcRef.current.getSenders();
        stream.getTracks().forEach((track) => {
          const sender = senders.find(s => s.track?.kind === track.kind);
          if (sender) {
            sender.replaceTrack(track);
          } else {
            pcRef.current!.addTrack(track, stream);
          }
        });
      }
    } catch (err) {
      console.error("Camera error:", err);
      setError("CAM_ARRAY FAILURE: CHECK PERMISSIONS");
    }
  };

  const toggleMute = () => {
    if (localStream) {
      let nowMuted = false;
      localStream.getAudioTracks().forEach((track) => {
        track.enabled = !track.enabled;
        nowMuted = !track.enabled;
      });
      setIsMuted(nowMuted);
    }
  };

  const applySettings = () => {
    setShowSettings(false);
    requestMedia(facingMode, resolution.w, resolution.h, fps);
  };

  useEffect(() => {
    if (videoRef.current && localStream) {
      videoRef.current.srcObject = localStream;
    }
  }, [isConnected, localStream]);

  const generateCode = () => {
    const newCode = Math.floor(100000 + Math.random() * 900000).toString();
    setCode(newCode);
    if (socketRef.current) {
      socketRef.current.emit("join-room", newCode);
    }
  };

  useEffect(() => {
    const newCode = Math.floor(100000 + Math.random() * 900000).toString();
    setCode(newCode);

    const socket = io();
    socketRef.current = socket;

    socket.on("connect", () => {
      socket.emit("join-room", newCode);
      setStatus("AWAITING DEVICE CONNECTION");
    });

    const initPeerConnection = async () => {
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
        bundlePolicy: "max-bundle",
        rtcpMuxPolicy: "require"
      });
      pcRef.current = pc;

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => {
          pc.addTrack(track, streamRef.current!);
        });
      }

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit("ice-candidate", {
            candidate: event.candidate,
            roomId: newCode,
          });
        }
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "connected") {
          setIsConnected(true);
          setStatus("UPLINK SECURED");
        } else if (
          pc.connectionState === "disconnected" ||
          pc.connectionState === "failed"
        ) {
          setIsConnected(false);
          setStatus("UPLINK LOST. RECONNECTING...");
        }
      };

      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit("offer", { offer, roomId: newCode });
      } catch (err: any) {
        console.error("Failed to create offer", err);
        setError(`Failed to create offer: ${err?.message || 'Unknown Error'}`);
      }
    };

    let hasViewer = false;

    socket.on("user-joined", async () => {
      hasViewer = true;
      setStatus("VIEWER DETECTED. NEGOTIATING...");
      if (streamRef.current) {
        initPeerConnection();
      } else {
        setStatus("WAITING FOR CAM_ARRAY...");
      }
    });

    socket.on("answer", async ({ answer }) => {
      if (pcRef.current) {
        try {
          await pcRef.current.setRemoteDescription(
            new RTCSessionDescription(answer),
          );
          for (const c of pendingCandidates.current) {
            await pcRef.current.addIceCandidate(new RTCIceCandidate(c));
          }
          pendingCandidates.current = [];
        } catch (err) {
          console.error("Failed to set remote description", err);
        }
      }
    });

    socket.on("ice-candidate", async ({ candidate }) => {
      if (pcRef.current && pcRef.current.remoteDescription) {
        try {
          await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err: any) {
          console.error("Failed to add ICE candidate", err);
          setError(`ICE Candidate Error: ${err?.message || 'Unknown'}`);
        }
      } else {
        pendingCandidates.current.push(candidate);
      }
    });

    requestMedia(facingMode, resolution.w, resolution.h, fps)
      .then(() => {
        if (hasViewer && !pcRef.current) {
          initPeerConnection();
        }
      });

    return () => {
      socket.disconnect();
      pcRef.current?.close();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  if (!isConnected) {
    return (
      <div className="flex-grow flex items-center justify-center p-6 relative h-full">
        <button
          onClick={onBack}
          className="absolute top-6 left-6 text-outline-variant hover:text-primary z-50"
        >
          <span className="material-symbols-outlined">arrow_back</span>
        </button>
        <div className="absolute top-6 left-6 w-4 h-4 border-t-2 border-l-2 border-primary-fixed-dim/50"></div>
        <div className="absolute top-6 right-6 w-4 h-4 border-t-2 border-r-2 border-primary-fixed-dim/50"></div>
        <div className="absolute bottom-6 left-6 w-4 h-4 border-b-2 border-l-2 border-primary-fixed-dim/50"></div>
        <div className="absolute bottom-6 right-6 w-4 h-4 border-b-2 border-r-2 border-primary-fixed-dim/50"></div>

        <div className="w-full max-w-lg glass-panel relative p-8 scanline">
          <div className="absolute top-0 left-0 w-16 h-1 bg-secondary-container"></div>

          <div className="flex items-center space-x-3 mb-8">
            <span
              className="material-symbols-outlined text-secondary-container text-2xl"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              phonelink_lock
            </span>
            <h1 className="font-header-md text-xl sm:text-2xl text-on-surface uppercase tracking-widest">
              Secure Pairing Protocol
            </h1>
          </div>

          <div className="space-y-6">
            <div className="inline-flex items-center border border-primary/30 bg-primary/10 px-3 py-1.5 rounded-sm">
              <div className="w-2 h-2 rounded-full bg-primary animate-pulse mr-2"></div>
              <span className="font-data-mono text-[10px] sm:text-xs text-primary uppercase">
                Status: {status}
              </span>
            </div>

            <div className="font-body-reg text-sm text-on-surface-variant space-y-2">
              <p>&gt; INITIATE PAIRING SEQUENCE ON TARGET DEVICE.</p>
              <p>&gt; ENTER THE FOLLOWING 6-DIGIT AUTHORIZATION CODE.</p>
              {error && (
                <p className="text-error-container">&gt; ERROR: {error}</p>
              )}
            </div>

            <div className="code-box border border-surface-bright bg-surface-container-low p-4 sm:p-6 flex justify-center items-center relative group">
              <div className="absolute inset-0 bg-primary-fixed-dim/5 opacity-0 group-hover:opacity-100 transition-opacity"></div>
              <div className="flex space-x-2 sm:space-x-4">
                {code.split("").map((char, i) => (
                  <React.Fragment key={i}>
                    <div className="w-8 h-12 sm:w-12 sm:h-16 border-b-2 border-primary-fixed-dim flex items-center justify-center bg-surface-dim">
                      <span className="font-data-mono text-2xl sm:text-[40px] text-primary-fixed font-bold">
                        {char}
                      </span>
                    </div>
                    {i === 2 && (
                      <div className="w-2 sm:w-4 flex items-center justify-center">
                        <span className="font-data-mono text-xl sm:text-2xl text-outline-variant">
                          -
                        </span>
                      </div>
                    )}
                  </React.Fragment>
                ))}
              </div>
            </div>

            <div className="pt-6 border-t border-surface-bright flex flex-col sm:flex-row gap-4 mt-8">
              <button
                onClick={generateCode}
                className="cyber-btn flex-1 bg-primary text-on-primary font-label-caps text-[10px] sm:text-[11px] uppercase py-4 px-6 border border-primary flex items-center justify-center space-x-2 hover:bg-primary-fixed transition-colors"
              >
                <span className="material-symbols-outlined text-[16px]">
                  refresh
                </span>
                <span>Generate New Code</span>
              </button>
              <button
                onClick={onBack}
                className="cyber-btn flex-1 bg-transparent text-primary font-label-caps text-[10px] sm:text-[11px] uppercase py-4 px-6 border border-primary flex items-center justify-center space-x-2 hover:bg-primary/10 transition-colors"
              >
                <span className="material-symbols-outlined text-[16px]">
                  cancel
                </span>
                <span>Abort Sequence</span>
              </button>
            </div>
          </div>

          <div className="absolute bottom-2 right-2 flex items-center space-x-2 opacity-50">
            <span className="font-data-mono text-[10px] text-on-surface-variant">
              NODE: TERMINAL-X9
            </span>
            <span className="w-1 h-1 bg-primary-fixed-dim rounded-full animate-ping"></span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-col h-full items-center justify-center overflow-hidden flex relative bg-black">
      <div className="absolute inset-0 w-full h-full">
        <div className="w-full h-full bg-gradient-to-br from-[#0a1118] via-[#05131a] to-[#02080a] tech-grid"></div>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="absolute inset-0 w-full h-full object-cover mix-blend-screen opacity-60"
        />
      </div>

      <div className="absolute inset-0 scanlines pointer-events-none z-10 opacity-30"></div>
      <div className="absolute inset-0 shadow-[inset_0_0_120px_rgba(0,0,0,0.9)] pointer-events-none z-10"></div>

      <div className="absolute inset-0 p-6 flex flex-col justify-between z-20 pointer-events-none">
          <div className="flex justify-between items-start w-full pointer-events-auto">
            <div className="hud-glass p-3 flex items-start gap-4">
              <div className="w-1 h-12 bg-primary-container"></div>
              <div className="flex flex-col">
                <div className="font-data-mono text-[10px] text-on-surface-variant mb-1">
                  CAM_ARRAY // 04
                </div>
                <div className="font-header-md text-lg text-primary-container leading-none">
                  MAINFRAME_INT
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2 items-end">
              <div className="flex items-center gap-2 px-3 py-1 border border-error text-error bg-error/10 animate-pulse">
                <span className="w-2 h-2 rounded-full bg-error"></span>
                <span className="font-data-mono text-[10px]">REC</span>
              </div>
              <button 
                onClick={toggleMute}
                className={`bg-surface-dim/80 backdrop-blur-md border ${isMuted ? 'border-error text-error' : 'border-primary text-primary'} px-3 py-1 font-label-caps text-[10px] tracking-widest hover:bg-primary/20 transition-all flex items-center gap-1`}
              >
                <span className="material-symbols-outlined text-[14px]">{isMuted ? 'mic_off' : 'mic'}</span>
                {isMuted ? 'MUTED' : 'MIC ON'}
              </button>
              <button 
                onClick={() => {
                  const newMode = facingMode === "environment" ? "user" : "environment";
                  setFacingMode(newMode);
                  requestMedia(newMode, resolution.w, resolution.h, fps);
                }}
                className="bg-surface-dim/80 backdrop-blur-md border border-primary text-primary px-3 py-1 font-label-caps text-[10px] tracking-widest hover:bg-primary/20 transition-all flex items-center gap-1"
              >
                <span className="material-symbols-outlined text-[14px]">cameraswitch</span>
                FLIP CAM
              </button>
              <button 
                onClick={() => setShowSettings(!showSettings)}
                className="bg-surface-dim/80 backdrop-blur-md border border-primary text-primary px-3 py-1 font-label-caps text-[10px] tracking-widest hover:bg-primary/20 transition-all flex items-center gap-1"
              >
                <span className="material-symbols-outlined text-[14px]">settings</span>
                SETTINGS
              </button>
            </div>
          </div>

          <AnimatePresence>
            {showSettings && (
              <motion.div 
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="absolute top-20 right-6 w-64 bg-surface-container-high/90 backdrop-blur-xl border border-primary/30 p-4 pointer-events-auto z-50 flex flex-col gap-4 shadow-2xl"
              >
                <div className="flex justify-between items-center border-b border-primary/20 pb-2">
                  <h3 className="font-label-caps text-primary text-[11px] tracking-widest">CAM CONFIG</h3>
                  <button onClick={() => setShowSettings(false)} className="text-on-surface-variant hover:text-primary">
                    <span className="material-symbols-outlined text-[16px]">close</span>
                  </button>
                </div>
                
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="font-data-mono text-[9px] text-on-surface-variant">FACING MODE</label>
                    <select 
                      className="bg-surface-dim border border-outline-variant text-[11px] font-data-mono text-on-surface p-1 focus:border-primary outline-none"
                      value={facingMode}
                      onChange={(e) => setFacingMode(e.target.value as any)}
                    >
                      <option value="environment">ENVIRONMENT</option>
                      <option value="user">USER</option>
                    </select>
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="font-data-mono text-[9px] text-on-surface-variant">RESOLUTION</label>
                    <select 
                      className="bg-surface-dim border border-outline-variant text-[11px] font-data-mono text-on-surface p-1 focus:border-primary outline-none"
                      value={`${resolution.w}x${resolution.h}`}
                      onChange={(e) => {
                        const [w, h] = e.target.value.split("x").map(Number);
                        setResolution({w, h});
                      }}
                    >
                      <option value="1280x720">720p (HD)</option>
                      <option value="1920x1080">1080p (FHD)</option>
                      <option value="3840x2160">2160p (4K)</option>
                    </select>
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="font-data-mono text-[9px] text-on-surface-variant">FRAME RATE</label>
                    <select 
                      className="bg-surface-dim border border-outline-variant text-[11px] font-data-mono text-on-surface p-1 focus:border-primary outline-none"
                      value={fps}
                      onChange={(e) => setFps(Number(e.target.value))}
                    >
                      <option value="30">30 FPS</option>
                      <option value="60">60 FPS</option>
                    </select>
                  </div>
                </div>

                <button 
                  onClick={applySettings}
                  className="mt-2 w-full bg-primary text-on-primary font-label-caps text-[10px] py-2 hover:bg-primary-fixed transition-colors"
                >
                  APPLY CHANGES
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex-1 flex items-center justify-between py-8 pointer-events-none">
          <div className="flex flex-col gap-4 hidden sm:flex">
            <div className="hud-glass p-2 w-32">
              <div className="font-label-caps text-[10px] text-on-surface-variant mb-1 border-b border-white/10 pb-1">
                BITRATE
              </div>
              <div className="font-data-mono text-[11px] text-primary-container flex justify-between">
                <span>TX</span>
                <span>4.2 Mb/s</span>
              </div>
              <div className="w-full h-[2px] bg-white/10 mt-2">
                <div className="h-full bg-primary-container w-[75%]"></div>
              </div>
            </div>
          </div>

          <div className="w-48 h-48 sm:w-64 sm:h-64 border border-white/5 relative flex items-center justify-center opacity-30 mx-auto">
            <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-primary-container"></div>
            <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-primary-container"></div>
            <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-primary-container"></div>
            <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-primary-container"></div>
            <div className="w-1 h-1 bg-primary-container"></div>
          </div>

          <div className="hud-glass p-2 flex gap-1 h-32 items-end hidden sm:flex justify-end">
            {/* decorative audio meter empty for now as requested by user mockup */}
          </div>
        </div>

        <div className="flex justify-center w-full pb-16 md:pb-0 pointer-events-auto">
          <button
            onClick={onBack}
            className="bg-surface-dim/80 backdrop-blur-md border border-error text-error px-8 py-3 font-label-caps text-[11px] tracking-widest hover:bg-error hover:text-on-error transition-all flex items-center gap-2"
          >
            <span
              className="material-symbols-outlined text-[16px]"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              stop_circle
            </span>
            TERMINATE_STREAM
          </button>
        </div>
      </div>
    </div>
  );
}

function ViewerView({ onBack }: { onBack: () => void }) {
  const [code, setCode] = useState("");
  const [isJoining, setIsJoining] = useState(false);
  const [status, setStatus] = useState("Awaiting Input...");
  const [isConnected, setIsConnected] = useState(false);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [logs, setLogs] = useState<
    { time: string; level: string; msg: string }[]
  >([]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const socketRef = useRef<Socket | null>(null);

  const [stats, setStats] = useState({ bitrate: "0", packetLoss: "0", latency: "0" });
  const lastBytesRef = useRef<{ bytes: number; timestamp: number } | null>(null);

  useEffect(() => {
    if (videoRef.current && remoteStream) {
      videoRef.current.srcObject = remoteStream;
      videoRef.current.muted = isMuted;
      videoRef.current.play().catch((e) => console.error("Could not auto-play", e));
    }
  }, [isConnected, remoteStream, isMuted]);

  useEffect(() => {
    if (!isConnected || !pcRef.current) return;
    const interval = setInterval(async () => {
      if (!pcRef.current) return;
      try {
        const statsReport = await pcRef.current.getStats();
        let currentBytes = 0;
        let fractionLost = 0;
        let currentRTT = 0;

        statsReport.forEach(report => {
          if (report.type === "inbound-rtp" && report.kind === "video") {
            currentBytes = report.bytesReceived;
            fractionLost = report.fractionLost ?? 0;
          }
          if (report.type === "candidate-pair" && report.state === "succeeded") {
            currentRTT = report.currentRoundTripTime ?? 0;
          }
        });

        const now = performance.now();
        let bitrateStr = "0.0";
        if (lastBytesRef.current) {
          const deltaBytes = currentBytes - lastBytesRef.current.bytes;
          const deltaTime = now - lastBytesRef.current.timestamp;
          if (deltaTime > 0 && deltaBytes > 0) {
            const bitrateMbps = (deltaBytes * 8) / (deltaTime * 1000);
            bitrateStr = bitrateMbps.toFixed(2);
          }
        }
        lastBytesRef.current = { bytes: currentBytes, timestamp: now };

        setStats({
          bitrate: bitrateStr,
          packetLoss: (fractionLost * 100).toFixed(2),
          latency: (currentRTT * 1000).toFixed(0),
        });
      } catch (e) {
        console.error("Stats error", e);
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [isConnected]);

  const addLog = (level: string, msg: string) => {
    const time = new Date().toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    setLogs((prev) => [...prev.slice(-30), { time, level, msg }]);
  };

  useEffect(() => {
    return () => {
      socketRef.current?.disconnect();
      pcRef.current?.close();
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length !== 6) return;

    setIsJoining(true);
    setStatus("INITIATING HANDSHAKE...");
    addLog("INFO", "Handshake initiated with Code: " + code);

    const socket = io();
    socketRef.current = socket;
    const pendingCandidates: RTCIceCandidateInit[] = [];

    socket.on("connect", () => {
      socket.emit("join-room", code);
      setStatus("AWAITING HOST NEGOTIATION...");
      addLog("INFO", "Connected to relay. Awaiting host.");
    });

    socket.on("offer", async ({ offer }) => {
      setStatus("HOST DETECTED. ESTABLISHING P2P...");
      addLog("INFO", "Received host offer. Establishing Peer-to-Peer.");
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
        bundlePolicy: "max-bundle",
        rtcpMuxPolicy: "require"
      });
      pcRef.current = pc;

      pc.ontrack = (event) => {
        if (event.streams[0]) {
          setRemoteStream(event.streams[0]);
        }
      };

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit("ice-candidate", {
            candidate: event.candidate,
            roomId: code,
          });
        }
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "connected") {
          setIsConnected(true);
          setStatus("UPLINK SECURED");
          addLog("INFO", "Uplink secured. Receiving stream.");
        } else if (
          pc.connectionState === "disconnected" ||
          pc.connectionState === "failed"
        ) {
          setIsConnected(false);
          setStatus("UPLINK LOST.");
          addLog("CRIT", "Uplink disconnected or failed.");
        }
      };

      try {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        for (const c of pendingCandidates) {
          await pc.addIceCandidate(new RTCIceCandidate(c));
        }
        pendingCandidates.length = 0;

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit("answer", { answer, roomId: code });
      } catch (err: any) {
        console.error("Failed to handle offer", err);
        addLog("CRIT", `Failed to negotiate stream: ${err?.message || 'Unknown Error'}`);
      }
    });

    socket.on("ice-candidate", async ({ candidate }) => {
      if (pcRef.current && pcRef.current.remoteDescription) {
        try {
          await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err: any) {
          console.error("Failed to add ICE candidate", err);
          addLog("ERROR", `Failed to add ICE candidate: ${err?.message || 'Unknown Error'}`);
        }
      } else {
        pendingCandidates.push(candidate);
      }
    });
  };

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement>,
    idx: number,
  ) => {
    const val = e.target.value.replace(/[^0-9]/g, "");
    let newCode = code.split("");
    newCode[idx] = val.slice(-1);

    const finalCode = newCode.join("");
    setCode(finalCode.substring(0, 6));

    if (val && idx < 5) {
      const nextInput = document.getElementById(`code-input-${idx + 1}`);
      nextInput?.focus();
    }
  };

  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    idx: number,
  ) => {
    if (e.key === "Backspace" && !code[idx] && idx > 0) {
      const prevInput = document.getElementById(`code-input-${idx - 1}`);
      prevInput?.focus();
    }
  };

  const handleToggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen().catch((err) => {
        addLog("ERROR", `Error attempting to enable fullscreen: ${err.message}`);
      });
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  const handleRecord = () => {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
      addLog("INFO", "Recording stopped and saved.");
    } else {
      if (!remoteStream) {
        addLog("WARN", "No stream available to record.");
        return;
      }
      recordedChunksRef.current = [];
      const options = { mimeType: "video/webm; codecs=vp9" };
      try {
        const mediaRecorder = new MediaRecorder(remoteStream, options);
        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) {
            recordedChunksRef.current.push(e.data);
          }
        };
        mediaRecorder.onstop = () => {
          const blob = new Blob(recordedChunksRef.current, { type: "video/webm" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          document.body.appendChild(a);
          a.style.display = "none";
          a.href = url;
          a.download = `OS-CORE_RECORDING_${new Date().getTime()}.webm`;
          a.click();
          window.URL.revokeObjectURL(url);
        };
        mediaRecorderRef.current = mediaRecorder;
        mediaRecorder.start();
        setIsRecording(true);
        addLog("INFO", "Recording started.");
      } catch (e) {
        addLog("ERROR", "Failed to start recording.");
      }
    }
  };

  const handleSnapshot = () => {
    if (videoRef.current) {
      const canvas = document.createElement("canvas");
      canvas.width = videoRef.current.videoWidth || 1280;
      canvas.height = videoRef.current.videoHeight || 720;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/png");
        const a = document.createElement("a");
        a.href = dataUrl;
        a.download = `OS-CORE_SNAPSHOT_${new Date().getTime()}.png`;
        a.click();
        addLog("INFO", "Snapshot captured.");
      }
    } else {
      addLog("WARN", "Video not ready for snapshot.");
    }
  };

  const handlePanTilt = (dir: string) => {
    addLog("INFO", `PTZ Command Sent: ${dir.toUpperCase()}`);
    // In a real scenario, we would send this over socket or data channel
    // socketRef.current?.emit("ptz-command", dir);
  };

  if (!isConnected) {
    return (
      <main className="relative z-10 w-full min-h-screen flex items-center justify-center p-6 bg-surface-dim">
        <div className="absolute inset-0 grid-bg z-0"></div>
        <div className="absolute inset-0 scanlines z-0"></div>
        <button
          onClick={onBack}
          className="absolute top-6 left-6 text-outline-variant hover:text-primary z-50"
        >
          <span className="material-symbols-outlined">arrow_back</span>
        </button>

        <div className="bg-surface-container/60 backdrop-blur-xl border-t border-l border-white/10 border-b border-r border-black/60 p-8 flex flex-col gap-10 shadow-[0_24px_48px_-12px_rgba(0,0,0,0.5)] max-w-lg w-full relative z-10">
          <div className="flex flex-col items-center gap-2 text-center">
            <span
              className="material-symbols-outlined text-primary text-4xl mb-2"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              link
            </span>
            <h1 className="font-display-lg text-4xl text-on-surface uppercase tracking-tighter">
              Pairing
            </h1>
            <p className="font-data-mono text-outline-variant tracking-widest text-[10px]">
              SECURE_TERMINAL_HANDSHAKE
            </p>
          </div>

          <div className="flex justify-center">
            <div className="border border-secondary-fixed-dim/50 bg-secondary-fixed-dim/10 py-2 px-4 flex items-center gap-2">
              <span className="material-symbols-outlined text-secondary-fixed-dim text-sm animate-pulse">
                hourglass_bottom
              </span>
              <span className="font-data-mono text-[10px] text-secondary-fixed-dim uppercase">
                Status: {status}
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <div className="flex justify-between gap-2 sm:gap-4">
              {[0, 1, 2, 3, 4, 5].map((idx) => (
                <input
                  key={idx}
                  id={`code-input-${idx}`}
                  className="w-10 h-14 sm:w-14 sm:h-20 bg-surface-container-lowest border-0 border-b-2 border-outline-variant text-center font-display-lg text-2xl text-primary glow-input transition-all duration-200 outline-none focus:bg-surface-container focus:ring-0"
                  maxLength={1}
                  type="text"
                  value={code[idx] || ""}
                  onChange={(e) => handleInputChange(e, idx)}
                  onKeyDown={(e) => handleKeyDown(e, idx)}
                  disabled={isJoining}
                />
              ))}
            </div>
            <div className="flex justify-between px-2">
              <span className="font-data-mono text-[10px] text-outline-variant">
                POS_01
              </span>
              <span className="font-data-mono text-[10px] text-outline-variant">
                POS_06
              </span>
            </div>
          </div>

          <button
            onClick={handleJoin}
            disabled={code.length !== 6 || isJoining}
            className="w-full py-4 bg-primary-container text-on-primary-container font-label-caps text-label-caps uppercase tracking-widest border border-primary transition-all duration-300 btn-glow relative overflow-hidden group disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span className="relative z-10 flex items-center justify-center gap-2">
              {isJoining ? (
                <span className="material-symbols-outlined text-sm animate-spin">
                  refresh
                </span>
              ) : (
                <span className="material-symbols-outlined text-sm">
                  cell_tower
                </span>
              )}
              {isJoining ? "NEGOTIATING..." : "Connect Device"}
            </span>
            <div className="absolute inset-0 bg-[url('data:image/svg+xml;utf8,<svg width=\'4\' height=\'4\' xmlns=\'http://www.w3.org/2000/svg\'><rect width=\'4\' height=\'1\' fill=\'rgba(0,0,0,0.1)\'/></svg>')] opacity-0 group-hover:opacity-100 transition-opacity"></div>
          </button>
        </div>

        <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-outline-variant/50 -translate-x-2 -translate-y-2"></div>
        <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-outline-variant/50 translate-x-2 -translate-y-2"></div>
        <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-outline-variant/50 -translate-x-2 translate-y-2"></div>
        <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-outline-variant/50 translate-x-2 translate-y-2"></div>
      </main>
    );
  }

  return (
    <div className="bg-background text-on-background h-screen w-screen overflow-hidden flex font-body-reg selection:bg-primary/30 selection:text-primary relative z-10">
      <aside className="hidden md:flex flex-col h-full bg-zinc-950 border-r w-64 border-zinc-800 relative z-20 shrink-0">
        <div className="p-6 border-b border-zinc-800 mb-4 flex items-center gap-3">
          <div className="w-10 h-10 bg-zinc-900 border border-zinc-700 flex items-center justify-center overflow-hidden shrink-0">
            <span className="material-symbols-outlined text-cyan-400">
              account_circle
            </span>
          </div>
          <div>
            <h2 className="text-cyan-400 font-black font-['Space_Grotesk'] text-[14px] leading-tight">
              OPERATOR_01
            </h2>
            <span className="font-['Space_Grotesk'] text-[10px] text-zinc-500 block">
              SECTOR-7G
            </span>
          </div>
        </div>

        <nav className="flex-1 flex flex-col gap-1 px-2">
          <a
            className="flex items-center gap-3 px-4 py-3 bg-cyan-400/10 border-l-4 border-cyan-400 text-cyan-400 font-['Space_Grotesk'] text-[10px] font-bold"
            href="#"
          >
            <span className="material-symbols-outlined text-[18px]">
              videocam
            </span>
            CAM_ARRAY
          </a>
          <a
            className="flex items-center gap-3 px-4 py-3 text-zinc-500 hover:bg-zinc-900 hover:border-l-4 hover:border-zinc-700 flicker-transition duration-75 font-['Space_Grotesk'] text-[10px] font-bold"
            href="#"
          >
            <span className="material-symbols-outlined text-[18px]">
              terminal
            </span>
            TERMINAL
          </a>
          <a
            className="flex items-center gap-3 px-4 py-3 text-zinc-500 hover:bg-zinc-900 hover:border-l-4 hover:border-zinc-700 flicker-transition duration-75 font-['Space_Grotesk'] text-[10px] font-bold"
            href="#"
          >
            <span className="material-symbols-outlined text-[18px]">
              sensors
            </span>
            SENSOR_HUB
          </a>
        </nav>

        <div className="mt-auto px-4 pb-6 pt-4 border-t border-zinc-800">
          <button
            onClick={onBack}
            className="w-full mb-4 py-2 border border-error text-error font-['Space_Grotesk'] text-[10px] font-bold hover:bg-error/10 transition-colors uppercase tracking-widest flex items-center justify-center gap-2"
          >
            <span className="material-symbols-outlined text-[16px]">
              power_settings_new
            </span>
            TERMINATE
          </button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0 bg-background relative z-10 w-full">
        <header className="flex justify-between items-center w-full px-6 h-14 bg-zinc-950/80 backdrop-blur-xl docked full-width top-0 border-b border-zinc-800 shrink-0 z-30">
          <div className="flex items-center gap-8 h-full">
            <button
              onClick={onBack}
              className="md:hidden text-zinc-500 hover:text-cyan-400 mr-2"
            >
              <span className="material-symbols-outlined">menu</span>
            </button>
            <div className="font-black text-cyan-400 tracking-tighter text-xl shrink-0">
              OS-CORE:COMMAND
            </div>
            <nav className="hidden md:flex h-full gap-6">
              <a
                className="flex items-center h-full text-cyan-400 border-b-2 border-cyan-400 pb-1 font-['Space_Grotesk'] uppercase tracking-widest text-[10px] opacity-80"
                href="#"
              >
                LIVE_FEED
              </a>
            </nav>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 md:p-6 flex flex-col xl:flex-row gap-6">
          <section className="flex-[3] flex flex-col gap-6 min-w-0" ref={containerRef}>
            <div className={`relative w-full aspect-video bg-surface-container/40 backdrop-blur-[20px] border border-white/15 border-b-black/50 overflow-hidden flex flex-col shadow-[inset_0_0_60px_rgba(0,0,0,0.8)] ${isFullscreen ? 'fixed inset-0 z-50 h-screen w-screen !border-0' : ''}`}>
              <div className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-primary z-20 m-2"></div>
              <div className="absolute top-0 right-0 w-8 h-8 border-t-2 border-r-2 border-primary z-20 m-2"></div>
              <div className="absolute bottom-0 left-0 w-8 h-8 border-b-2 border-l-2 border-primary z-20 m-2"></div>
              <div className="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-primary z-20 m-2"></div>

              <div className="absolute top-0 left-0 w-full p-4 flex justify-between items-start z-20 bg-gradient-to-b from-black/80 to-transparent">
                <div className="flex items-center gap-3">
                  {isRecording && (
                    <span className="border border-error bg-error/10 text-error px-2 py-0.5 font-label-caps text-[10px] flex items-center gap-1 backdrop-blur-sm">
                      <span className="w-1.5 h-1.5 rounded-full bg-error animate-pulse"></span>
                      REC
                    </span>
                  )}
                  <span className="border border-primary bg-primary/10 text-primary px-2 py-0.5 font-label-caps text-[10px] backdrop-blur-sm hidden sm:block">
                    CAM-04_SECTOR-7
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="font-data-mono text-[10px] text-primary bg-surface-container-highest/80 px-2 py-1 border border-outline-variant backdrop-blur-md">
                    LIVE STREAM // HD
                  </div>
                  <button onClick={handleToggleFullscreen} className="bg-surface-container-highest/80 border border-outline-variant text-primary p-1 hover:bg-primary/20 backdrop-blur-md">
                    <span className="material-symbols-outlined text-[16px]">
                      {isFullscreen ? "fullscreen_exit" : "fullscreen"}
                    </span>
                  </button>
                </div>
              </div>

              <div className="absolute inset-0 z-10 scanlines pointer-events-none opacity-40 mix-blend-overlay"></div>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                className="w-full h-full object-cover z-0 grayscale-[20%] contrast-125 saturate-150 mix-blend-luminosity bg-black"
              />

              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-12 h-12 z-20 pointer-events-none opacity-50 flex items-center justify-center">
                <div className="w-full h-[1px] bg-primary absolute"></div>
                <div className="h-full w-[1px] bg-primary absolute"></div>
                <div className="w-6 h-6 border border-primary rounded-full absolute"></div>
              </div>

              <div className="absolute bottom-0 left-0 w-full p-4 hidden sm:flex justify-between items-end z-20 bg-gradient-to-t from-black/90 to-transparent font-data-mono text-[10px]">
                <div className="flex flex-col gap-1 text-primary">
                  <div>
                    LAT: <span className="text-on-surface">34.0522° N</span>
                  </div>
                  <div>
                    LON: <span className="text-on-surface">118.2437° W</span>
                  </div>
                  <div className="text-secondary-container mt-1">
                    SYS.TEM: OPTIMAL
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 text-on-surface-variant text-[10px]">
                  <div>AZIMUTH: 184.2</div>
                  <div>ELEVATION: -12.4</div>
                  <div>ZOOM: 1.0x OPTICAL</div>
                </div>
              </div>
            </div>

            <div className={`bg-surface-container/40 backdrop-blur-[20px] border border-white/15 border-b-black/50 p-4 flex flex-col sm:flex-row items-center justify-between gap-4 ${isFullscreen ? 'hidden' : ''}`}>
              <div className="flex gap-4 w-full sm:w-auto">
                <button 
                  onClick={handleRecord}
                  className={`flex-1 sm:flex-none justify-center ${isRecording ? 'bg-error text-on-error border-error hover:bg-error/80' : 'bg-primary text-on-primary border-primary hover:bg-primary-fixed'} font-label-caps text-[10px] px-4 py-2 transition-colors flex items-center gap-2 h-9`}
                >
                  <span className="material-symbols-outlined text-[16px]">
                    {isRecording ? "stop_circle" : "radio_button_checked"}
                  </span>
                  {isRecording ? "STOP REC" : "INIT RECORD"}
                </button>
                <button 
                  onClick={handleSnapshot}
                  className="flex-1 sm:flex-none justify-center bg-transparent border border-primary text-primary font-label-caps text-[10px] px-4 py-2 hover:bg-primary/10 transition-colors flex items-center gap-2 h-9"
                >
                  <span className="material-symbols-outlined text-[16px]">
                    photo_camera
                  </span>
                  SNAPSHOT
                </button>
              </div>
              <div className="hidden sm:flex items-center gap-4 border border-outline-variant bg-surface-dim px-4 py-1.5 opacity-80">
                <span className="font-label-caps text-[10px] text-on-surface-variant">
                  PAN/TILT
                </span>
                <div className="flex gap-1">
                  <button 
                    onClick={() => setIsMuted(!isMuted)} 
                    className={`p-1 ${isMuted ? 'text-error hover:bg-error/10' : 'text-on-surface hover:text-primary hover:bg-primary/10'} rounded`}
                    title={isMuted ? "Unmute Audio" : "Mute Audio"}
                  >
                    <span className="material-symbols-outlined text-[18px]">
                      {isMuted ? 'volume_off' : 'volume_up'}
                    </span>
                  </button>
                  <button onClick={() => handlePanTilt('up')} className="p-1 text-on-surface hover:text-primary hover:bg-primary/10 rounded">
                    <span className="material-symbols-outlined text-[18px]">
                      arrow_drop_up
                    </span>
                  </button>
                  <button onClick={() => handlePanTilt('down')} className="p-1 text-on-surface hover:text-primary hover:bg-primary/10 rounded">
                    <span className="material-symbols-outlined text-[18px]">
                      arrow_drop_down
                    </span>
                  </button>
                  <button onClick={() => handlePanTilt('left')} className="p-1 text-on-surface hover:text-primary hover:bg-primary/10 rounded">
                    <span className="material-symbols-outlined text-[18px]">
                      arrow_left
                    </span>
                  </button>
                  <button onClick={() => handlePanTilt('right')} className="p-1 text-on-surface hover:text-primary hover:bg-primary/10 rounded">
                    <span className="material-symbols-outlined text-[18px]">
                      arrow_right
                    </span>
                  </button>
                  <div className="w-px h-4 bg-outline-variant/50 mx-1 self-center"></div>
                  <button onClick={() => handlePanTilt('zoom_in')} className="p-1 text-on-surface hover:text-primary hover:bg-primary/10 rounded" title="Zoom In">
                    <span className="material-symbols-outlined text-[18px]">
                      zoom_in
                    </span>
                  </button>
                  <button onClick={() => handlePanTilt('zoom_out')} className="p-1 text-on-surface hover:text-primary hover:bg-primary/10 rounded" title="Zoom Out">
                    <span className="material-symbols-outlined text-[18px]">
                      zoom_out
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section className="flex-[1] flex flex-col gap-6 min-w-0 md:min-w-[320px]">
            <div className="bg-surface-container/40 backdrop-blur-[20px] border border-white/15 border-b-black/50 relative">
              <div className="absolute top-0 right-0 w-8 h-1 bg-primary"></div>
              <div className="p-3 border-b border-outline-variant/30 flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[16px]">
                  router
                </span>
                <h3 className="font-label-caps text-[11px] text-on-surface">
                  NETWORK UPLINK
                </h3>
              </div>
              <div className="p-4 flex flex-col gap-4 font-data-mono text-[11px]">
                <div className="flex justify-between items-end">
                  <span className="text-on-surface-variant text-[11px]">
                    BITRATE
                  </span>
                  <span className="text-primary text-[14px]">{stats.bitrate} Mbps</span>
                </div>
                <div className="w-full h-1.5 bg-surface-dim border border-outline-variant overflow-hidden">
                  <div className="h-full bg-primary" style={{ width: `${Math.min(100, Math.max(5, parseFloat(stats.bitrate) * 10))}%` }}></div>
                </div>
                <div className="grid grid-cols-2 gap-4 pt-2">
                  <div>
                    <span className="text-on-surface-variant text-[10px] block mb-1">
                      PACKET LOSS
                    </span>
                    <span className="text-on-surface text-[13px]">{stats.packetLoss}%</span>
                  </div>
                  <div>
                    <span className="text-on-surface-variant text-[10px] block mb-1">
                      LATENCY
                    </span>
                    <span className="text-on-surface text-[13px]">{stats.latency}ms</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-surface-container/40 backdrop-blur-[20px] border border-white/15 border-b-black/50 relative flex-1 flex flex-col min-h-[250px]">
              <div className="absolute top-0 right-0 w-8 h-1 bg-surface-variant"></div>
              <div className="p-3 border-b border-outline-variant/30 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-on-surface text-[16px]">
                    list_alt
                  </span>
                  <h3 className="font-label-caps text-[11px] text-on-surface">
                    SYS_EVENT.LOG
                  </h3>
                </div>
              </div>
              <div className="p-3 overflow-y-auto flex-1 font-data-mono text-[10px] leading-relaxed flex flex-col gap-2 max-h-[300px]">
                {logs.map((log, idx) => (
                  <div
                    key={idx}
                    className={`flex gap-2 ${log.level === "CRIT" ? "bg-error/10 border-l-2 border-error pl-1 py-0.5" : log.level === "WARN" ? "bg-secondary-container/10 border-l-2 border-secondary-container pl-1 py-0.5" : ""}`}
                  >
                    <span className="text-outline-variant shrink-0">
                      [{log.time}]
                    </span>
                    <span
                      className={`shrink-0 ${log.level === "CRIT" || log.level === "ERROR" ? "text-error" : log.level === "WARN" ? "text-secondary-container" : "text-primary"}`}
                    >
                      {log.level}
                    </span>
                    <span
                      className={
                        log.level === "CRIT" || log.level === "ERROR"
                          ? "text-error"
                          : log.level === "WARN"
                            ? "text-secondary-container"
                            : "text-on-surface"
                      }
                    >
                      {log.msg}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
