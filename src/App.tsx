import { useState, useEffect, useRef } from "react";
import {
  Server,
  Layers,
  Terminal,
  ArrowRight,
  User,
  Users,
  CheckCircle,
  Wifi,
  ExternalLink,
  Copy,
  Play,
  Shield,
  Clock,
  Radio,
} from "lucide-react";

interface LogEntry {
  id: string;
  timestamp: string;
  direction: "in" | "out" | "sys";
  type: string;
  payload: any;
}

export default function App() {
  const [roomId, setRoomId] = useState("skrim-dev-room");
  const [userId, setUserId] = useState("");
  const [connected, setConnected] = useState(false);
  const [members, setMembers] = useState<string[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [copiedText, setCopiedText] = useState("");
  const [targetId, setTargetId] = useState("");
  const wsRef = useRef<WebSocket | null>(null);
  const logsEndRef = useRef<HTMLDivElement | null>(null);

  // Initialize randomized userId
  useEffect(() => {
    setUserId(`react-peer-${Math.floor(Math.random() * 9000 + 1000)}`);
  }, []);

  // Auto scroll logs
  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs]);

  const addLog = (direction: "in" | "out" | "sys", type: string, payload: any) => {
    const newEntry: LogEntry = {
      id: Math.random().toString(36).substr(2, 9),
      timestamp: new Date().toLocaleTimeString(),
      direction,
      type,
      payload,
    };
    setLogs((prev) => [...prev, newEntry]);
  };

  const connectAndJoin = () => {
    if (wsRef.current) {
      wsRef.current.close();
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    addLog("sys", "CONNECTION", `Establishing WebSocket to ${wsUrl}...`);

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      addLog("sys", "CONNECTED", `Connected successfully as ${userId}`);

      // Send join message
      const joinPayload = { type: "join", roomId, userId };
      ws.send(JSON.stringify(joinPayload));
      addLog("out", "join", joinPayload);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        addLog("in", data.type, data);

        if (data.type === "joined") {
          setMembers(data.members || []);
        } else if (data.type === "user-joined") {
          setMembers((prev) => {
            if (!prev.includes(data.userId)) {
              return [...prev, data.userId];
            }
            return prev;
          });
        } else if (data.type === "user-left") {
          setMembers((prev) => prev.filter((id) => id !== data.userId));
        }
      } catch (err) {
        addLog("sys", "ERROR", `Raw websocket message received: ${event.data}`);
      }
    };

    ws.onclose = () => {
      setConnected(false);
      setMembers([]);
      addLog("sys", "DISCONNECTED", "WebSocket connection closed.");
    };

    ws.onerror = (err) => {
      addLog("sys", "ERROR", "WebSocket encounterd an error.");
    };
  };

  const disconnect = () => {
    if (wsRef.current) {
      const leavePayload = { type: "leave" };
      try {
        wsRef.current.send(JSON.stringify(leavePayload));
        addLog("out", "leave", leavePayload);
      } catch (e) {}
      wsRef.current.close();
    }
  };

  const sendSignal = (type: "offer" | "answer" | "ice-candidate") => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    let payload: any = {
      type,
      roomId,
      targetId: targetId || undefined,
    };

    if (type === "offer") {
      payload.sdp = {
        type: "offer",
        sdp: `v=0\r\no=- ${Math.floor(Math.random() * 1000000)} IN IP4 127.0.0.1\r\ns=Skrim-Call-Test\r\nt=0 0\r\na=group:BUNDLE audio video\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111 103\r\na=setup:actpass\r\na=mid:audio\r\n`,
      };
    } else if (type === "answer") {
      payload.sdp = {
        type: "answer",
        sdp: `v=0\r\no=- ${Math.floor(Math.random() * 1000000)} IN IP4 127.0.0.1\r\ns=Skrim-Call-Test\r\nt=0 0\r\na=group:BUNDLE audio video\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=setup:active\r\na=mid:audio\r\n`,
      };
    } else if (type === "ice-candidate") {
      payload.candidate = {
        candidate: `candidate:${Math.floor(Math.random() * 1000000000)} 1 UDP ${Math.floor(Math.random() * 100000)} 127.0.0.1 ${Math.floor(Math.random() * 60000 + 1000)} typ host`,
        sdpMid: "audio",
        sdpMLineIndex: 0,
      };
    }

    wsRef.current.send(JSON.stringify(payload));
    addLog("out", type, payload);
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(label);
    setTimeout(() => setCopiedText(""), 2000);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans flex flex-col antialiased">
      {/* Top Banner Navigation */}
      <nav className="border-b border-slate-800 bg-slate-900/40 backdrop-blur px-8 py-4 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-sky-550/10 border border-sky-500/20 rounded-lg text-sky-400">
            <Radio className="h-5 w-5 animate-pulse" />
          </div>
          <div>
            <span className="text-xs text-sky-400 font-mono font-bold tracking-widest uppercase">Signaling Engine</span>
            <h1 className="text-xl font-bold text-white tracking-tight">skrim-calling</h1>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <a
            href="/test.html"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center space-x-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 hover:border-slate-600 px-4 py-2 rounded-lg text-xs font-semibold tracking-wide transition-all duration-200"
          >
            <span>Open Standalone Tester</span>
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </nav>

      {/* Main Grid View */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 lg:p-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Left Side: Dynamic Control Panel & Info */}
        <div className="lg:col-span-5 flex flex-col space-y-6">
          
          {/* Dashboard Welcome & Overview */}
          <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-6 shadow-xl relative overflow-hidden">
            <div className="absolute top-0 right-0 p-8 opacity-5">
              <Server className="h-32 w-32" />
            </div>
            
            <div className="relative z-10">
              <h2 className="text-lg font-semibold text-white mb-2">WebRTC Signaling Environment</h2>
              <p className="text-xs text-slate-400 leading-relaxed">
                Welcome to the unified dashboard for <strong>skrim-calling</strong>. Below you can spin up a connection right inside the console, join signaling rooms, and inspect outgoing/incoming messages.
              </p>
              
              <div className="mt-4 flex flex-wrap gap-2">
                <span className="inline-flex items-center space-x-1 px-2.5 py-1 bg-emerald-950/40 border border-emerald-900/30 text-emerald-400 rounded-full text-[10px] font-mono">
                  <CheckCircle className="h-3 w-3" />
                  <span>Rooms Enabled</span>
                </span>
                <span className="inline-flex items-center space-x-1 px-2.5 py-1 bg-indigo-950/40 border border-indigo-900/30 text-indigo-400 rounded-full text-[10px] font-mono">
                  <Shield className="h-3 w-3" />
                  <span>CORS Friendly</span>
                </span>
                <span className="inline-flex items-center space-x-1 px-2.5 py-1 bg-sky-950/40 border border-sky-900/30 text-sky-400 rounded-full text-[10px] font-mono">
                  <Layers className="h-3 w-3" />
                  <span>JSON Frame</span>
                </span>
              </div>
            </div>
          </div>

          {/* Connection Sandbox Control */}
          <div className="bg-slate-900 border border-slate-800/80 rounded-2xl p-6 shadow-xl space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">Playground Client</h3>
              <div className={`px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold border ${
                connected 
                  ? "bg-emerald-950/30 border-emerald-800 text-emerald-400"
                  : "bg-slate-950 border-slate-800 text-slate-500"
              }`}>
                {connected ? "CONNECTED" : "DISCONNECTED"}
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Active Room ID</label>
                <input
                  type="text"
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value)}
                  disabled={connected}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-sky-500 rounded-xl px-3.5 py-2.5 text-sm text-slate-100 focus:outline-none font-mono disabled:opacity-50 transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">User Identity (Custom / Generated)</label>
                <div className="flex space-x-2">
                  <input
                    type="text"
                    value={userId}
                    onChange={(e) => setUserId(e.target.value)}
                    disabled={connected}
                    className="flex-1 bg-slate-950 border border-slate-800 focus:border-sky-500 rounded-xl px-3.5 py-2.5 text-sm text-slate-100 focus:outline-none font-mono disabled:opacity-50 transition-colors"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-2">
                <button
                  onClick={connected ? disconnect : connectAndJoin}
                  className={`w-full py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 cursor-pointer flex items-center justify-center space-x-2 ${
                    connected
                      ? "bg-rose-650 hover:bg-rose-500 text-white shadow-lg shadow-rose-950/40"
                      : "bg-sky-600 hover:bg-sky-500 text-white shadow-lg shadow-sky-950/40"
                  }`}
                >
                  <Wifi className="h-4 w-4" />
                  <span>{connected ? "Disconnect" : "Join Room"}</span>
                </button>
                
                <a
                  href="/test.html"
                  target="_blank"
                  className="w-full bg-slate-850 hover:bg-slate-800 text-slate-300 border border-slate-800 hover:border-slate-700 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 flex items-center justify-center space-x-2"
                >
                  <span>Open Peer Tab</span>
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            </div>
          </div>

          {/* Members list & Signal Panel */}
          {connected && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4 animate-fade-in">
              <div>
                <h4 className="text-xs font-semibold uppercase text-slate-400 tracking-wider mb-2 flex items-center space-x-2">
                  <Users className="h-4 w-4 text-sky-400" />
                  <span>Active Room Members ({members.length})</span>
                </h4>
                <div className="bg-slate-950 rounded-xl p-3 border border-slate-850/80 max-h-36 overflow-y-auto">
                  {members.length === 0 ? (
                    <p className="text-xs text-slate-500 italic">Waiting for other users to join...</p>
                  ) : (
                    <div className="space-y-1.5">
                      {members.map((id) => (
                        <div key={id} className="flex items-center justify-between bg-slate-900 border border-slate-800/50 px-2.5 py-1.5 rounded-lg text-xs font-mono">
                          <span className="text-slate-300 font-medium">{id}</span>
                          <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Target Specific Member (Default: Broadcast)</label>
                <select
                  value={targetId}
                  onChange={(e) => setTargetId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-sm text-slate-100 font-mono focus:outline-none focus:ring-1 focus:ring-sky-500"
                >
                  <option value="">[Broadcast to All Room Peers]</option>
                  {members.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-2 pt-1">
                <span className="text-[11px] font-medium text-slate-400 uppercase block tracking-wider">Trigger Synthetic WebRTC Signals</span>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={() => sendSignal("offer")}
                    className="bg-indigo-650 hover:bg-indigo-650/80 hover:text-white transition-all text-indigo-300 text-xs font-medium py-2 rounded-lg cursor-pointer"
                  >
                    Send Offer
                  </button>
                  <button
                    onClick={() => sendSignal("answer")}
                    className="bg-emerald-650 hover:bg-emerald-650/80 hover:text-white transition-all text-emerald-300 text-xs font-medium py-2 rounded-lg cursor-pointer"
                  >
                    Send Answer
                  </button>
                  <button
                    onClick={() => sendSignal("ice-candidate")}
                    className="bg-amber-650 hover:bg-amber-650/80 hover:text-white transition-all text-amber-300 text-xs font-medium py-2 rounded-lg cursor-pointer"
                  >
                    Send ICE
                  </button>
                </div>
              </div>
            </div>
          )}

        </div>

        {/* Right Side: Log Console / Guide tabs */}
        <div className="lg:col-span-7 flex flex-col bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden min-h-[500px]">
          
          {/* Header tabs */}
          <div className="bg-slate-950 border-b border-slate-800/80 px-6 py-4 flex items-center justify-between">
            <div className="flex items-center space-x-2 text-slate-200">
              <Terminal className="h-4 w-4 text-sky-400" />
              <span className="text-sm font-bold tracking-wide uppercase">Real-Time Event Stream</span>
            </div>
            <button
              onClick={() => setLogs([])}
              className="text-[11px] text-slate-400 hover:text-white bg-slate-900 hover:bg-slate-850 px-3 py-1 rounded-lg border border-slate-800 transition-colors cursor-pointer"
            >
              Clear Feed
            </button>
          </div>

          {/* Logs feed */}
          <div className="flex-1 bg-slate-950 p-5 overflow-y-auto space-y-4 font-mono text-xs">
            {logs.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center text-slate-500 py-12">
                <Clock className="h-8 w-8 text-slate-700 mb-2 animate-pulse" />
                <p className="italic text-slate-500 text-xs">No active logs in playground session.</p>
                <p className="text-[10px] text-slate-650 mt-1 max-w-sm">
                  Join a room on the left side, or open the standalone tester in another tab to observe signaling messages fly.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {logs.map((log) => {
                  let bannerColor = "text-slate-400 bg-slate-900 border-slate-800";
                  let directLabel = "";

                  if (log.direction === "sys") {
                    bannerColor = "text-amber-400 bg-amber-950/15 border-amber-900/30";
                    directLabel = "[SYSTEM]";
                  } else if (log.direction === "in") {
                    if (log.type === "offer") {
                      bannerColor = "text-indigo-400 bg-indigo-950/20 border-indigo-900/40";
                    } else if (log.type === "answer") {
                      bannerColor = "text-emerald-400 bg-emerald-950/20 border-emerald-900/40";
                    } else if (log.type === "ice-candidate") {
                      bannerColor = "text-amber-400 bg-amber-950/20 border-amber-900/40";
                    } else {
                      bannerColor = "text-sky-400 bg-sky-950/10 border-sky-900/30";
                    }
                    directLabel = `◄ RECV [${log.type.toUpperCase()}]`;
                  } else if (log.direction === "out") {
                    bannerColor = "text-slate-300 bg-slate-900/40 border-slate-800/80";
                    directLabel = `► SENT [${log.type.toUpperCase()}]`;
                  }

                  return (
                    <div key={log.id} className={`p-3 border rounded-xl ${bannerColor} space-y-2 transition-all`}>
                      <div className="flex items-center justify-between text-[10px] font-bold opacity-80">
                        <span>{directLabel}</span>
                        <span>{log.timestamp}</span>
                      </div>
                      <pre className="overflow-x-auto whitespace-pre-wrap leading-relaxed max-h-48 break-all">{JSON.stringify(log.payload, null, 2)}</pre>
                    </div>
                  );
                })}
                <div ref={logsEndRef} />
              </div>
            )}
          </div>

          {/* Quick-code instructions inside console */}
          <div className="bg-slate-950 border-t border-slate-800 p-5 space-y-3">
            <span className="text-xs font-semibold text-slate-300 uppercase tracking-wide flex items-center space-x-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-sky-400"></span>
              <span>Running locally? Quick Guide</span>
            </span>
            <div className="bg-slate-900 rounded-xl p-3 text-[11px] font-mono text-slate-400 leading-relaxed space-y-1">
              <div><span className="text-sky-400"># Start server (with live-reload)</span></div>
              <div className="text-slate-200">npm run dev</div>
              <div className="pt-2"><span className="text-sky-400"># Start CoTurn (STUN/TURN) in background</span></div>
              <div className="text-slate-200">docker-compose up -d</div>
            </div>
          </div>

        </div>

      </main>
    </div>
  );
}
