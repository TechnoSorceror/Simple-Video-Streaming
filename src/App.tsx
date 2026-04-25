import React, { useState, useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { Camera, MonitorPlay, Smartphone, Wifi, Loader2, ArrowLeft, ShieldCheck, AlertCircle } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

export default function App() {
  const [mode, setMode] = useState<"home" | "host" | "viewer">("home");

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 font-sans selection:bg-emerald-500/30 overflow-hidden">
      <AnimatePresence mode="wait">
        {mode === "home" && (
          <motion.div 
            key="home"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="h-screen flex flex-col items-center justify-center p-6 max-w-sm mx-auto"
          >
            <div className="bg-emerald-500/10 p-4 rounded-full mb-6">
              <Camera className="w-10 h-10 text-emerald-400" />
            </div>
            <h1 className="text-3xl font-semibold mb-2">LiveView</h1>
            <p className="text-neutral-400 text-center mb-10 leading-relaxed">
              Securely stream your phone's camera to your laptop in real-time.
            </p>

            <div className="w-full space-y-4">
              <button
                onClick={() => setMode("host")}
                className="w-full flex items-center justify-center gap-3 bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-medium py-3.5 px-4 rounded-xl transition-colors active:scale-[0.98]"
              >
                <Smartphone className="w-5 h-5" />
                Share Camera (Phone)
              </button>
              
              <button
                onClick={() => setMode("viewer")}
                className="w-full flex items-center justify-center gap-3 bg-neutral-800 hover:bg-neutral-700 text-white font-medium py-3.5 px-4 rounded-xl transition-colors active:scale-[0.98] border border-neutral-700"
              >
                <MonitorPlay className="w-5 h-5" />
                View Stream (Laptop)
              </button>
            </div>
            
            <div className="mt-12 flex items-center gap-2 text-xs text-neutral-500">
              <ShieldCheck className="w-4 h-4" />
              End-to-end encrypted via WebRTC
            </div>
          </motion.div>
        )}

        {mode === "host" && (
          <motion.div key="host" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-screen bg-neutral-950">
            <HostView onBack={() => setMode("home")} />
          </motion.div>
        )}

        {mode === "viewer" && (
          <motion.div key="viewer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-screen bg-neutral-950">
            <ViewerView onBack={() => setMode("home")} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function HostView({ onBack }: { onBack: () => void }) {
  const [code, setCode] = useState<string>("");
  const [status, setStatus] = useState<string>("Initializing...");
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pendingCandidates = useRef<RTCIceCandidateInit[]>([]);

  useEffect(() => {
    // Generate a 6-digit code
    const newCode = Math.floor(100000 + Math.random() * 900000).toString();
    setCode(newCode);

    const socket = io();
    socketRef.current = socket;

    socket.on("connect", () => {
      socket.emit("join-room", newCode);
      setStatus("Waiting for laptop to connect...");
    });

    const initPeerConnection = async () => {
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
      });
      pcRef.current = pc;

      // Add local stream tracks
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => {
          pc.addTrack(track, streamRef.current!);
        });
      }

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit("ice-candidate", { candidate: event.candidate, roomId: newCode });
        }
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "connected") {
          setIsConnected(true);
          setStatus("Streaming live to laptop");
        } else if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
          setIsConnected(false);
          setStatus("Viewer disconnected. Waiting...");
          // We could tear down connection here to be ready for the next viewer
        }
      };

      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit("offer", { offer, roomId: newCode });
      } catch (err) {
        console.error("Failed to create offer", err);
      }
    };

    let hasViewer = false;

    socket.on("user-joined", async () => {
      hasViewer = true;
      setStatus("Viewer joined! Connecting...");
      if (streamRef.current) {
        initPeerConnection();
      } else {
        setStatus("Viewer joined! Waiting for camera...");
      }
    });

    socket.on("answer", async ({ answer }) => {
      if (pcRef.current) {
        try {
          await pcRef.current.setRemoteDescription(new RTCSessionDescription(answer));
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
        } catch (err) {
          console.error("Failed to add ICE candidate", err);
        }
      } else {
        pendingCandidates.current.push(candidate);
      }
    });

    // Start camera
    navigator.mediaDevices.getUserMedia({ 
      video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } }, 
      audio: true 
    })
      .then(stream => {
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          // Mute local playback to avoid echo
          videoRef.current.muted = true;
        }
        if (hasViewer && !pcRef.current) {
          initPeerConnection();
        }
      })
      .catch(err => {
        console.error("Camera error:", err);
        setError("Camera access denied or unavailable. Please check permissions.");
        setStatus("");
      });

    return () => {
      socket.disconnect();
      pcRef.current?.close();
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, []);

  return (
    <div className="flex flex-col h-full absolute inset-0">
      {/* Overlay header */}
      <div className="absolute top-0 left-0 right-0 z-10 bg-gradient-to-b from-black/80 to-transparent p-4 pb-12 flex justify-between items-start">
        <button onClick={onBack} className="p-2 bg-black/40 hover:bg-black/60 rounded-full backdrop-blur-sm transition text-white">
          <ArrowLeft className="w-5 h-5" />
        </button>
        
        <div className="flex flex-col items-end">
          <div className="bg-black/40 backdrop-blur-md px-4 py-2 rounded-xl text-center border border-white/10 shadow-lg">
            <p className="text-xs text-neutral-400 font-medium uppercase tracking-wider mb-1">Room Code</p>
            <p className="text-3xl font-mono tracking-widest text-emerald-400 font-bold">{code || "------"}</p>
          </div>
          
          <div className="flex items-center gap-2 mt-3 bg-black/40 backdrop-blur-sm px-3 py-1.5 rounded-full border border-white/5">
            {isConnected ? (
              <span className="flex w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            ) : (
              <Loader2 className="w-3 h-3 text-emerald-400 animate-spin" />
            )}
            <span className="text-xs font-medium text-white/90">{status}</span>
          </div>
        </div>
      </div>

      {error ? (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center z-10 w-full mb-32 max-w-sm mx-auto">
          <div className="bg-red-500/10 p-4 rounded-full mb-4">
            <AlertCircle className="w-8 h-8 text-red-400" />
          </div>
          <p className="text-red-400 font-medium">{error}</p>
        </div>
      ) : (
        <video 
          ref={videoRef} 
          autoPlay 
          playsInline 
          muted 
          className="w-full h-full object-cover bg-neutral-900 absolute inset-0"
        />
      )}
    </div>
  );
}

function ViewerView({ onBack }: { onBack: () => void }) {
  const [code, setCode] = useState("");
  const [isJoining, setIsJoining] = useState(false);
  const [status, setStatus] = useState("Waiting to connect...");
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    return () => {
      socketRef.current?.disconnect();
      pcRef.current?.close();
    };
  }, []);

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length !== 6) {
      setError("Please enter a valid 6-digit code.");
      return;
    }
    setError(null);
    setIsJoining(true);
    setStatus("Connecting to room...");
    
    const socket = io();
    socketRef.current = socket;
    const pendingCandidates: RTCIceCandidateInit[] = [];

    socket.on("connect", () => {
      socket.emit("join-room", code);
      setStatus("Waiting for host to start video...");
    });

    socket.on("offer", async ({ offer }) => {
      setStatus("Host found, connecting stream...");
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
      });
      pcRef.current = pc;

      pc.ontrack = (event) => {
        if (videoRef.current && event.streams[0]) {
          videoRef.current.srcObject = event.streams[0];
          // We need to play it if it doesn't autoplay due to browser policies
          videoRef.current.play().catch(e => console.error("Could not auto-play", e));
        }
      };

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit("ice-candidate", { candidate: event.candidate, roomId: code });
        }
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "connected") {
          setIsConnected(true);
          setStatus("Connected - Live");
        } else if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
          setIsConnected(false);
          setStatus("Host disconnected. Stream ended.");
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
      } catch (err) {
        console.error("Failed to handle offer", err);
      }
    });

    socket.on("ice-candidate", async ({ candidate }) => {
      if (pcRef.current && pcRef.current.remoteDescription) {
        try {
          await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
          console.error("Failed to add ICE candidate", err);
        }
      } else {
        pendingCandidates.push(candidate);
      }
    });
  };

  return (
    <div className="flex flex-col h-full bg-neutral-900 absolute inset-0">
       <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between p-4 bg-gradient-to-b from-black/80 to-transparent pb-8">
        <button onClick={onBack} className="p-2 bg-black/40 hover:bg-black/60 rounded-full backdrop-blur-sm transition text-white">
          <ArrowLeft className="w-5 h-5" />
        </button>
        {isJoining && (
          <div className="flex items-center gap-2 bg-black/40 backdrop-blur-sm px-3 py-1.5 rounded-full border border-white/5">
            {isConnected ? (
              <span className="flex w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            ) : (
              <Loader2 className="w-3 h-3 text-emerald-400 animate-spin" />
            )}
            <span className="text-xs font-medium text-white/90">{status}</span>
          </div>
        )}
      </div>

      {!isJoining ? (
        <div className="flex-1 flex flex-col items-center justify-center p-6 max-w-sm mx-auto w-full">
           <div className="bg-neutral-800 p-4 rounded-full mb-6">
              <Wifi className="w-8 h-8 text-neutral-400" />
            </div>
            <h2 className="text-2xl font-semibold mb-2">Connect to Camera</h2>
            <p className="text-neutral-400 text-center mb-8">
              Enter the 6-digit code shown on the phone to start viewing the stream.
            </p>

            <form onSubmit={handleJoin} className="w-full">
              <div className="mb-6">
                <input
                  type="text"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ''))}
                  placeholder="------"
                  className="w-full bg-neutral-950 border border-neutral-700 rounded-xl px-4 py-4 text-center text-3xl font-mono tracking-[0.5em] text-emerald-400 placeholder:text-neutral-800 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all font-bold"
                  autoFocus
                />
                {error && <p className="text-red-400 text-sm mt-2 text-center">{error}</p>}
              </div>

              <button
                type="submit"
                disabled={code.length !== 6}
                className="w-full bg-white text-neutral-950 font-medium py-3.5 px-4 rounded-xl hover:bg-neutral-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Connect Stream
              </button>
            </form>
        </div>
      ) : (
        <div className="w-full h-full relative">
          <video 
            ref={videoRef} 
            autoPlay 
            playsInline 
            className="w-full h-full object-cover bg-neutral-950"
          />
          {!isConnected && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-neutral-900/80 backdrop-blur-sm z-10">
               <Loader2 className="w-8 h-8 text-emerald-500 animate-spin mb-4" />
               <p className="text-emerald-400 font-medium animate-pulse">{status}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

