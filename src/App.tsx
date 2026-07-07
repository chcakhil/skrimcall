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
  Lock,
  Unlock,
  Key,
  UserCheck,
  AlertTriangle,
  Send,
  RefreshCw,
  Search,
  BookOpen,
} from "lucide-react";
import { generateKeyPair, encryptMessage, decryptMessage, ensureReady } from "./lib/encryption";

interface LogEntry {
  id: string;
  timestamp: string;
  direction: "in" | "out" | "sys";
  type: string;
  payload: any;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<"encryption" | "webrtc">("encryption");

  // WebRTC Tab States
  const [roomId, setRoomId] = useState("skrim-dev-room");
  const [userId, setUserId] = useState("");
  const [connected, setConnected] = useState(false);
  const [members, setMembers] = useState<string[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [targetId, setTargetId] = useState("");
  const wsRef = useRef<WebSocket | null>(null);
  const logsEndRef = useRef<HTMLDivElement | null>(null);

  // E2E Encryption Tab States
  const [sodiumLoaded, setSodiumLoaded] = useState(false);
  const [signupUsername, setSignupUsername] = useState("Alice");
  const [myPublicKey, setMyPublicKey] = useState("");
  const [myPrivateKey, setMyPrivateKey] = useState("");
  const [isRegistered, setIsRegistered] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [pkiDbCount, setPkiDbCount] = useState(0);

  // Directory / Key Lookup States
  const [searchUsername, setSearchUsername] = useState("Bob");
  const [foundPublicKey, setFoundPublicKey] = useState("");
  const [searchError, setSearchError] = useState("");
  const [searching, setSearching] = useState(false);

  // Encrypt Form States
  const [encryptSenderName, setEncryptSenderName] = useState("Alice");
  const [encryptSenderPrivateKey, setEncryptSenderPrivateKey] = useState("");
  const [encryptRecipientName, setEncryptRecipientName] = useState("Bob");
  const [encryptRecipientPublicKey, setEncryptRecipientPublicKey] = useState("");
  const [plaintextMessage, setPlaintextMessage] = useState("Hi Bob! This is an end-to-end encrypted message using Curve25519.");
  const [generatedCiphertext, setGeneratedCiphertext] = useState("");

  // Decrypt Form States
  const [decryptSenderPublicKey, setDecryptSenderPublicKey] = useState("");
  const [decryptRecipientPrivateKey, setDecryptRecipientPrivateKey] = useState("");
  const [decryptCiphertext, setDecryptCiphertext] = useState("");
  const [decryptedPlaintext, setDecryptedPlaintext] = useState("");
  const [decryptedSender, setDecryptedSender] = useState("");
  const [decryptedSuccess, setDecryptedSuccess] = useState<boolean | null>(null);
  const [decryptedErrorMsg, setDecryptedErrorMsg] = useState("");

  // Simulation Logs State
  const [simLogs, setSimLogs] = useState<string[]>([]);
  const [simActive, setSimActive] = useState(false);

  const [copiedText, setCopiedText] = useState("");

  // Initialize randomized userId & Libsodium
  useEffect(() => {
    setUserId(`react-peer-${Math.floor(Math.random() * 9000 + 1000)}`);
    ensureReady()
      .then(() => {
        setSodiumLoaded(true);
        // Pre-generate Alice's keypair for convenience
        return handleGenerateKeyPair("Alice", false);
      })
      .catch((err) => console.error("Failed to load sodium", err));
    fetchHealth();
  }, []);

  // Fetch server health to get total keys count
  const fetchHealth = async () => {
    try {
      const res = await fetch("/api/health");
      const data = await res.json();
      if (typeof data.registeredKeysCount === "number") {
        setPkiDbCount(data.registeredKeysCount);
      }
    } catch (e) {
      console.warn("Could not query server health", e);
    }
  };

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

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(label);
    setTimeout(() => setCopiedText(""), 2000);
  };

  // ==========================================
  // WEBRTC SIGNALING UTILS
  // ==========================================
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
      addLog("sys", "ERROR", "WebSocket encountered an error.");
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

  // ==========================================
  // LIBSODIUM E2E ENCRYPTION HANDLERS
  // ==========================================
  const handleGenerateKeyPair = async (name: string, notify = true) => {
    try {
      const keys = await generateKeyPair();
      setMyPublicKey(keys.publicKey);
      setMyPrivateKey(keys.privateKey);
      setIsRegistered(false);

      // Auto fill key generation forms to make it silky smooth
      setEncryptSenderPrivateKey(keys.privateKey);
      setEncryptSenderName(name);

      if (notify) {
        addSimLog(`Generated fresh Curve25519 keypair client-side for user '${name}'`);
      }
    } catch (err: any) {
      alert(`Keypair generation failed: ${err.message}`);
    }
  };

  const handleRegisterPublicKey = async () => {
    if (!signupUsername.trim() || !myPublicKey) {
      alert("Please generate a keypair first!");
      return;
    }

    setRegistering(true);
    try {
      const response = await fetch("/register-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: signupUsername.trim(),
          publicKey: myPublicKey,
        }),
      });

      const result = await response.json();
      if (response.ok && result.success) {
        setIsRegistered(true);
        addSimLog(`Registered public key for '${signupUsername}' on server storage`);
        fetchHealth();
      } else {
        throw new Error(result.error || "Server registration failed");
      }
    } catch (err: any) {
      alert(`Registration failed: ${err.message}`);
    } finally {
      setRegistering(false);
    }
  };

  const handleLookupKey = async () => {
    if (!searchUsername.trim()) {
      alert("Please enter a username to search!");
      return;
    }

    setSearching(true);
    setSearchError("");
    setFoundPublicKey("");

    try {
      const response = await fetch(`/key/${searchUsername.trim()}`);
      const data = await response.json();

      if (response.ok && data.publicKey) {
        setFoundPublicKey(data.publicKey);
        addSimLog(`Retrieved '${searchUsername}' public key from Express registry`);
        
        // Auto fill encryption form recipient key
        setEncryptRecipientPublicKey(data.publicKey);
        setEncryptRecipientName(searchUsername);
      } else {
        setSearchError(data.error || "Public key not found");
      }
    } catch (err: any) {
      setSearchError(`Query failed: ${err.message}`);
    } finally {
      setSearching(false);
    }
  };

  const handleEncryptForm = async () => {
    if (!encryptSenderPrivateKey) {
      alert("Missing sender private key! Ensure you've generated keys.");
      return;
    }
    if (!encryptRecipientPublicKey) {
      alert("Missing recipient public key! Search for a registered user's public key or type one in.");
      return;
    }
    if (!plaintextMessage.trim()) {
      alert("Please type a message to encrypt!");
      return;
    }

    try {
      const cipher = await encryptMessage(
        plaintextMessage,
        encryptRecipientPublicKey,
        encryptSenderPrivateKey
      );
      setGeneratedCiphertext(cipher);
      addSimLog(`Encrypted message from '${encryptSenderName}' to '${encryptRecipientName}'`);
      
      // Auto fill decryption form
      setDecryptCiphertext(cipher);
      setDecryptSenderPublicKey(myPublicKey); // Since sender is usually 'Me' (Alice)
      setDecryptRecipientPrivateKey(encryptSenderPrivateKey); // Default placeholders for self testing
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleDecryptForm = async (usePrivateKey: string, useSenderPublicKey: string) => {
    if (!decryptCiphertext) {
      alert("Please enter or generate a ciphertext first!");
      return;
    }
    const privKey = usePrivateKey || decryptRecipientPrivateKey;
    const pubKey = useSenderPublicKey || decryptSenderPublicKey;

    if (!privKey) {
      alert("Missing recipient private key required for decryption.");
      return;
    }
    if (!pubKey) {
      alert("Missing sender public key required to verify authenticity.");
      return;
    }

    setDecryptedPlaintext("");
    setDecryptedErrorMsg("");
    setDecryptedSuccess(null);

    try {
      const decrypted = await decryptMessage(decryptCiphertext, pubKey, privKey);
      setDecryptedPlaintext(decrypted);
      setDecryptedSuccess(true);
      addSimLog(`Decrypted message successfully! Authenticated and verified.`);
    } catch (err: any) {
      setDecryptedSuccess(false);
      setDecryptedErrorMsg(err.message);
      addSimLog(`FAIL CLOSED: Decryption attempt rejected (Invalid keys / Integrity check failure)`);
    }
  };

  // One-click 3-user scenario simulation (Ann, Bob, Charlie)
  const runAnnBobCharlieSimulation = async () => {
    setSimActive(true);
    setSimLogs([]);
    
    try {
      const logsList: string[] = [];
      const pushLog = (txt: string) => {
        logsList.push(`[${new Date().toLocaleTimeString()}] ${txt}`);
        setSimLogs([...logsList]);
      };

      pushLog("🚀 Starting client-side E2E message encryption simulation...");
      await ensureReady();
      pushLog("✅ libsodium is ready on the client.");

      // 1. Generate keypairs
      pushLog("1. Creating keypairs in-memory client-side...");
      const ann = await generateKeyPair();
      pushLog(`🔑 Generated Ann's Curve25519 keypair. Public Key (trunc): ${ann.publicKey.substring(0, 16)}...`);
      
      const bob = await generateKeyPair();
      pushLog(`🔑 Generated Bob's Curve25519 keypair. Public Key (trunc): ${bob.publicKey.substring(0, 16)}...`);
      
      const charlie = await generateKeyPair();
      pushLog(`🔑 Generated Charlie's Curve25519 keypair. Public Key (trunc): ${charlie.publicKey.substring(0, 16)}...`);

      // 2. Register with server
      pushLog("2. Registering public keys to Express directory endpoint...");
      
      const regUser = async (userId: string, publicKey: string) => {
        const res = await fetch("/register-key", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, publicKey })
        });
        const d = await res.json();
        if (!res.ok || !d.success) throw new Error(`Could not register ${userId}`);
        pushLog(`📡 registered '/register-key' for ${userId}`);
      };

      await regUser("Ann", ann.publicKey);
      await regUser("Bob", bob.publicKey);
      await regUser("Charlie", charlie.publicKey);
      
      await fetchHealth();

      // 3. Ann encrypts for Bob
      pushLog("3. Ann wants to send Bob a confidential note...");
      const secretPlaintext = "The launch password is: SodiumSecret2026!";
      pushLog(`💬 Plaintext: "${secretPlaintext}"`);
      
      // Look up Bob's public key from server
      pushLog("📡 Querying server directory GET '/key/Bob' to get Bob's public key...");
      const bobLookupRes = await fetch("/key/Bob");
      const bobLookupData = await bobLookupRes.json();
      const bobsKey = bobLookupData.publicKey;
      pushLog(`✅ Server returned Bob's Public Key: ${bobsKey.substring(0, 20)}...`);

      pushLog("🔒 Alice/Ann encrypts message using Bob's public key and Ann's private key...");
      const cipher = await encryptMessage(secretPlaintext, bobsKey, ann.privateKey);
      pushLog(`🔒 Ciphertext (Base64 combined with 24-byte Nonce): "${cipher}"`);
      
      // Show that it doesn't contain the plain text
      pushLog(`🔍 Security check: Does ciphertext contain plain text directly? -> ${cipher.includes(secretPlaintext) ? "❌ YES" : "🛡️ NO"}`);

      // 4. Bob decrypts
      pushLog("4. Bob receives the ciphertext. Bob fetches Ann's public key from directory...");
      const annLookupRes = await fetch("/key/Ann");
      const annLookupData = await annLookupRes.json();
      const annsKey = annLookupData.publicKey;
      
      pushLog("🔓 Bob decrypts using Bob's private key and Ann's public key...");
      const decryptedPlaintext = await decryptMessage(cipher, annsKey, bob.privateKey);
      pushLog(`🎉 SUCCESS! Bob successfully decrypted message: "${decryptedPlaintext}"`);

      // 5. Charlie (Wrong Recipient) tries to decrypt
      pushLog("5. Charlie (the intruder) intercepts the ciphertext...");
      pushLog("⚠️ Charlie attempts to decrypt the message using Charlie's private key and Ann's public key...");
      
      try {
        await decryptMessage(cipher, annsKey, charlie.privateKey);
        pushLog("❌ FAILED SECURITY CHECK: Charlie decrypted Bob's message!");
      } catch (err: any) {
        pushLog(`🛡️ FAIL-CLOSED VERIFIED: libsodium correctly rejected decryption! Error: "${err.message}"`);
      }

      pushLog("🏁 Simulation completed successfully. Client-side E2E secure architecture verified!");

      // Update forms with these generated keys so user can play manually
      setSignupUsername("Ann");
      setMyPublicKey(ann.publicKey);
      setMyPrivateKey(ann.privateKey);
      setIsRegistered(true);

      setEncryptSenderName("Ann");
      setEncryptSenderPrivateKey(ann.privateKey);
      setEncryptRecipientName("Bob");
      setEncryptRecipientPublicKey(bob.publicKey);
      setPlaintextMessage(secretPlaintext);
      setGeneratedCiphertext(cipher);

      setDecryptCiphertext(cipher);
      setDecryptSenderPublicKey(ann.publicKey);
      setDecryptRecipientPrivateKey(bob.privateKey);
      setDecryptedPlaintext(secretPlaintext);
      setDecryptedSuccess(true);
      setDecryptedErrorMsg("");
      
    } catch (e: any) {
      setSimLogs(prev => [...prev, `❌ Error during simulation: ${e.message}`]);
    } finally {
      setSimActive(false);
    }
  };

  const addSimLog = (msg: string) => {
    const time = new Date().toLocaleTimeString();
    setSimLogs((prev) => [`[${time}] ${msg}`, ...prev.slice(0, 49)]);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans flex flex-col antialiased">
      {/* Top Banner Navigation */}
      <nav className="border-b border-slate-800 bg-slate-900/40 backdrop-blur px-8 py-4 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-emerald-400">
            <Shield className="h-5 w-5 animate-pulse" />
          </div>
          <div>
            <span className="text-xs text-emerald-400 font-mono font-bold tracking-widest uppercase">E2EE Cryptographic Suite</span>
            <h1 className="text-xl font-bold text-white tracking-tight">skrim-calling & encryption</h1>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex bg-slate-900/80 border border-slate-850 p-1.5 rounded-xl space-x-1">
          <button
            id="tab-btn-encryption"
            onClick={() => setActiveTab("encryption")}
            className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              activeTab === "encryption"
                ? "bg-emerald-600 text-white shadow-lg"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            libsodium E2E Encryption
          </button>
          <button
            id="tab-btn-webrtc"
            onClick={() => setActiveTab("webrtc")}
            className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              activeTab === "webrtc"
                ? "bg-sky-600 text-white shadow-lg"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            WebRTC Signaling Console
          </button>
        </div>
      </nav>

      {/* Main Grid View */}
      {activeTab === "encryption" ? (
        <main className="flex-1 max-w-7xl w-full mx-auto p-6 lg:p-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Left Column: Register Key / Simulator / Lookup Directory */}
          <div className="lg:col-span-5 flex flex-col space-y-6">
            
            {/* Header Status & Database Indicators */}
            <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-5 shadow-xl relative overflow-hidden">
              <div className="absolute top-0 right-0 p-8 opacity-5">
                <Key className="h-24 w-24" />
              </div>
              
              <div className="relative z-10 space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-semibold text-white">Client-Side E2E Encryption</h2>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${
                    sodiumLoaded ? "bg-emerald-950/40 border-emerald-800 text-emerald-400" : "bg-red-950/40 border-red-800 text-red-400"
                  }`}>
                    {sodiumLoaded ? "LIBSODIUM READY" : "LOADING WASM..."}
                  </span>
                </div>
                
                <p className="text-xs text-slate-400 leading-relaxed">
                  Messages are encrypted client-side using <strong>libsodium</strong>. Private keys stay strictly in browser memory. Public keys are registered with the server key-distribution API.
                </p>

                <div className="flex items-center space-x-2 pt-1 text-[11px] text-slate-400 font-mono">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span>
                  <span>Server Registered Keys: <strong>{pkiDbCount}</strong></span>
                  <button onClick={fetchHealth} className="p-1 text-slate-500 hover:text-emerald-400 transition-colors">
                    <RefreshCw className="h-3 w-3" />
                  </button>
                </div>
              </div>
            </div>

            {/* Step 1: User Signup & Keypair Generation Simulator */}
            <div className="bg-slate-900 border border-slate-800/80 rounded-2xl p-5 shadow-xl space-y-4">
              <div className="flex items-center space-x-2 border-b border-slate-800/60 pb-3">
                <span className="w-5 h-5 flex items-center justify-center rounded-full bg-emerald-950 text-emerald-400 font-mono text-xs font-bold border border-emerald-800/30">1</span>
                <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">User "Signup" Key Generator</h3>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">User Handle / Identity</label>
                  <div className="flex space-x-2">
                    <input
                      type="text"
                      value={signupUsername}
                      onChange={(e) => setSignupUsername(e.target.value)}
                      placeholder="e.g. Alice"
                      className="flex-1 bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-xl px-3.5 py-2 text-xs text-slate-100 focus:outline-none font-mono transition-colors"
                    />
                    <button
                      onClick={() => handleGenerateKeyPair(signupUsername)}
                      className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 hover:border-slate-600 px-3.5 py-2 rounded-xl text-xs font-semibold tracking-wide transition-all cursor-pointer flex items-center space-x-1"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      <span>Gen Keys</span>
                    </button>
                  </div>
                </div>

                {myPublicKey && (
                  <div className="space-y-3 animate-fade-in bg-slate-950/80 p-3 rounded-xl border border-slate-850">
                    <div className="text-[10px] font-mono text-slate-500 flex justify-between items-center">
                      <span>Public Key (Safe to share)</span>
                      <button
                        onClick={() => copyToClipboard(myPublicKey, "pubkey")}
                        className="text-emerald-400 hover:text-emerald-300 flex items-center space-x-1 cursor-pointer"
                      >
                        <Copy className="h-3 w-3" />
                        <span>{copiedText === "pubkey" ? "Copied" : "Copy"}</span>
                      </button>
                    </div>
                    <div className="bg-slate-900 px-2 py-1.5 rounded font-mono text-[9px] text-emerald-500 break-all border border-slate-800/40">
                      {myPublicKey}
                    </div>

                    <div className="text-[10px] font-mono text-slate-500 flex justify-between items-center">
                      <span className="flex items-center space-x-1">
                        <Lock className="h-3 w-3 text-rose-500" />
                        <span className="text-rose-400">Private Key (CLIENT-ONLY)</span>
                      </span>
                      <button
                        onClick={() => copyToClipboard(myPrivateKey, "privkey")}
                        className="text-rose-400 hover:text-rose-300 flex items-center space-x-1 cursor-pointer"
                      >
                        <Copy className="h-3 w-3" />
                        <span>{copiedText === "privkey" ? "Copied" : "Copy"}</span>
                      </button>
                    </div>
                    <div className="bg-slate-900 px-2 py-1.5 rounded font-mono text-[9px] text-rose-500 break-all border border-slate-800/40">
                      {myPrivateKey}
                    </div>

                    <div className="pt-2">
                      <button
                        onClick={handleRegisterPublicKey}
                        disabled={registering}
                        className={`w-full py-2 rounded-xl text-xs font-semibold transition-all duration-200 cursor-pointer flex items-center justify-center space-x-2 ${
                          isRegistered
                            ? "bg-emerald-950/40 border border-emerald-500/30 text-emerald-400 cursor-not-allowed"
                            : "bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-950/40"
                        }`}
                      >
                        <UserCheck className="h-3.5 w-3.5" />
                        <span>{registering ? "Registering..." : isRegistered ? "Registered with Server ✓" : `Register ${signupUsername}'s Key`}</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Step 2: Key Lookup Directory */}
            <div className="bg-slate-900 border border-slate-800/80 rounded-2xl p-5 shadow-xl space-y-4">
              <div className="flex items-center space-x-2 border-b border-slate-800/60 pb-3">
                <span className="w-5 h-5 flex items-center justify-center rounded-full bg-emerald-950 text-emerald-400 font-mono text-xs font-bold border border-emerald-800/30">2</span>
                <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">Recipient Public Key Lookup</h3>
              </div>

              <div className="space-y-3">
                <label className="block text-xs font-medium text-slate-400">Find Recipient on Server Registry</label>
                <div className="flex space-x-2">
                  <input
                    type="text"
                    value={searchUsername}
                    onChange={(e) => setSearchUsername(e.target.value)}
                    placeholder="Search e.g. Bob"
                    className="flex-1 bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-xl px-3.5 py-2 text-xs text-slate-100 focus:outline-none font-mono transition-colors"
                  />
                  <button
                    onClick={handleLookupKey}
                    disabled={searching}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white px-3.5 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer flex items-center space-x-1"
                  >
                    <Search className="h-3.5 w-3.5" />
                    <span>Lookup</span>
                  </button>
                </div>

                {foundPublicKey && (
                  <div className="p-3 bg-slate-950 rounded-xl border border-emerald-900/30 text-xs font-mono space-y-2 animate-fade-in">
                    <div className="flex justify-between text-[10px] text-slate-500">
                      <span>✓ Found {searchUsername}'s Key:</span>
                      <button
                        onClick={() => copyToClipboard(foundPublicKey, "lookupkey")}
                        className="text-emerald-400 hover:text-emerald-300"
                      >
                        {copiedText === "lookupkey" ? "Copied" : "Copy"}
                      </button>
                    </div>
                    <div className="text-[9px] text-emerald-400 bg-slate-900 p-2 rounded break-all">
                      {foundPublicKey}
                    </div>
                  </div>
                )}

                {searchError && (
                  <div className="p-3 bg-red-950/20 border border-red-900/30 text-red-400 rounded-xl text-xs font-mono">
                    ⚠️ {searchError}
                  </div>
                )}
              </div>
            </div>

            {/* Instant 3-User Local Simulator Card */}
            <div className="bg-slate-900 border border-slate-800/80 rounded-2xl p-5 shadow-xl space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800/60 pb-3">
                <div className="flex items-center space-x-2">
                  <Play className="h-4 w-4 text-emerald-400" />
                  <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">Instant 3-User Simulator</h3>
                </div>
                <span className="text-[9px] font-mono bg-slate-950 px-2 py-0.5 rounded text-emerald-400 border border-emerald-900/20 font-bold">Ann, Bob, Charlie</span>
              </div>

              <p className="text-xs text-slate-500 leading-relaxed">
                Clicking the simulation button runs the entire key generation, registration, lookup, encryption, happy-path decryption, and wrong-recipient fail-closed check locally.
              </p>

              <button
                onClick={runAnnBobCharlieSimulation}
                disabled={simActive}
                className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white py-2.5 rounded-xl text-xs font-semibold shadow-lg transition-all cursor-pointer flex items-center justify-center space-x-2"
              >
                {simActive ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    <span>Running Simulation...</span>
                  </>
                ) : (
                  <>
                    <Play className="h-3.5 w-3.5" />
                    <span>Run Full Simulation</span>
                  </>
                )}
              </button>
            </div>

          </div>

          {/* Right Column: Encryptor, Decryptor and Logs */}
          <div className="lg:col-span-7 flex flex-col space-y-6">
            
            {/* Encryption & Decryption Workstations */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              
              {/* Encrypt Message Station */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl flex flex-col justify-between space-y-4">
                <div className="space-y-3">
                  <div className="flex items-center space-x-2 border-b border-slate-800/60 pb-2">
                    <Lock className="h-4 w-4 text-emerald-400" />
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300">Message Encryptor</h3>
                  </div>

                  <div>
                    <label className="block text-[10px] uppercase font-mono text-slate-500 mb-1">1. Sender Private Key</label>
                    <input
                      type="password"
                      value={encryptSenderPrivateKey}
                      onChange={(e) => setEncryptSenderPrivateKey(e.target.value)}
                      placeholder="Sender Private Key (Base64)"
                      className="w-full bg-slate-950 border border-slate-850 rounded-lg p-2 text-xs font-mono text-rose-400 focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] uppercase font-mono text-slate-500 mb-1">2. Recipient Public Key</label>
                    <input
                      type="text"
                      value={encryptRecipientPublicKey}
                      onChange={(e) => setEncryptRecipientPublicKey(e.target.value)}
                      placeholder="Recipient Public Key (Base64)"
                      className="w-full bg-slate-950 border border-slate-850 rounded-lg p-2 text-xs font-mono text-emerald-400 focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] uppercase font-mono text-slate-500 mb-1">3. Private Message</label>
                    <textarea
                      value={plaintextMessage}
                      onChange={(e) => setPlaintextMessage(e.target.value)}
                      rows={3}
                      placeholder="Type a secret message..."
                      className="w-full bg-slate-950 border border-slate-850 rounded-lg p-2 text-xs text-slate-250 focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>

                <div className="pt-2">
                  <button
                    onClick={handleEncryptForm}
                    className="w-full bg-emerald-600 hover:bg-emerald-500 text-white py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer flex items-center justify-center space-x-1"
                  >
                    <Lock className="h-3.5 w-3.5" />
                    <span>Encrypt Message</span>
                  </button>
                </div>
              </div>

              {/* Decrypt Message Station */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl flex flex-col justify-between space-y-4">
                <div className="space-y-3">
                  <div className="flex items-center space-x-2 border-b border-slate-800/60 pb-2">
                    <Unlock className="h-4 w-4 text-emerald-400" />
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300">Message Decryptor</h3>
                  </div>

                  <div>
                    <label className="block text-[10px] uppercase font-mono text-slate-500 mb-1">1. Sender Public Key</label>
                    <input
                      type="text"
                      value={decryptSenderPublicKey}
                      onChange={(e) => setDecryptSenderPublicKey(e.target.value)}
                      placeholder="Sender Public Key (Base64)"
                      className="w-full bg-slate-950 border border-slate-850 rounded-lg p-2 text-xs font-mono text-emerald-400 focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] uppercase font-mono text-slate-500 mb-1">2. Recipient Private Key</label>
                    <input
                      type="password"
                      value={decryptRecipientPrivateKey}
                      onChange={(e) => setDecryptRecipientPrivateKey(e.target.value)}
                      placeholder="Recipient Private Key (Base64)"
                      className="w-full bg-slate-950 border border-slate-850 rounded-lg p-2 text-xs font-mono text-rose-400 focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] uppercase font-mono text-slate-500 mb-1">3. Target Ciphertext</label>
                    <textarea
                      value={decryptCiphertext}
                      onChange={(e) => setDecryptCiphertext(e.target.value)}
                      rows={3}
                      placeholder="Combined ciphertext (Base64)"
                      className="w-full bg-slate-950 border border-slate-850 rounded-lg p-2 text-xs font-mono text-slate-350 focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>

                <div className="pt-2 grid grid-cols-2 gap-2">
                  <button
                    onClick={() => handleDecryptForm("", "")}
                    className="w-full bg-teal-650 hover:bg-teal-600 text-teal-100 border border-teal-800 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer flex items-center justify-center space-x-1"
                  >
                    <Unlock className="h-3.5 w-3.5" />
                    <span>Decrypt E2E</span>
                  </button>

                  <button
                    onClick={() => handleDecryptForm("invalid-private-key-to-fail-closed-base64=", decryptSenderPublicKey)}
                    className="w-full bg-rose-950/40 hover:bg-rose-900/40 text-rose-400 border border-rose-900/40 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer flex items-center justify-center space-x-1"
                  >
                    <AlertTriangle className="h-3.5 w-3.5" />
                    <span>Test Fail-Closed</span>
                  </button>
                </div>
              </div>

            </div>

            {/* Generated Ciphertext display & Decryption results */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              
              {/* Ciphertext Box */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-3">
                <span className="text-[10px] font-mono text-slate-500 font-semibold uppercase tracking-wide">Last Encrypted Ciphertext</span>
                <div className="bg-slate-950 rounded-xl p-3 border border-slate-855 min-h-[120px] flex flex-col justify-between">
                  {generatedCiphertext ? (
                    <>
                      <div className="text-[10px] font-mono text-emerald-400 break-all leading-relaxed max-h-24 overflow-y-auto">
                        {generatedCiphertext}
                      </div>
                      <div className="flex justify-between items-center pt-2 border-t border-slate-850 mt-2">
                        <span className="text-[9px] font-mono text-slate-500">Includes 24-byte Nonce prepended</span>
                        <button
                          onClick={() => copyToClipboard(generatedCiphertext, "cipher")}
                          className="text-xs text-emerald-400 hover:text-emerald-300 font-semibold cursor-pointer"
                        >
                          {copiedText === "cipher" ? "Copied" : "Copy Ciphertext"}
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="h-full flex items-center justify-center text-center text-slate-600 italic text-xs py-8">
                      No ciphertext generated yet. Click "Encrypt Message" above!
                    </div>
                  )}
                </div>
              </div>

              {/* Decrypted Results Panel */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-3">
                <span className="text-[10px] font-mono text-slate-500 font-semibold uppercase tracking-wide">Decryption Result Window</span>
                <div className="bg-slate-950 rounded-xl p-3 border border-slate-855 min-h-[120px] flex flex-col justify-between">
                  {decryptedSuccess === true ? (
                    <div className="space-y-2 animate-fade-in flex-1 flex flex-col justify-between">
                      <div className="p-2 bg-emerald-950/40 border border-emerald-900/30 rounded-lg text-xs text-emerald-400 font-mono font-medium flex items-center space-x-1">
                        <UserCheck className="h-4 w-4" />
                        <span>Decryption Succeeded & Verified!</span>
                      </div>
                      <p className="text-xs text-slate-200 bg-slate-900/50 p-2.5 rounded border border-slate-800/40 break-all font-mono">
                        "{decryptedPlaintext}"
                      </p>
                    </div>
                  ) : decryptedSuccess === false ? (
                    <div className="space-y-2 animate-fade-in flex-1 flex flex-col justify-between">
                      <div className="p-2.5 bg-rose-950/40 border border-rose-900/40 rounded-lg text-xs text-rose-400 font-mono flex items-start space-x-1.5">
                        <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                        <div>
                          <strong className="block font-bold">DECRYPTION FAILED (FAIL-CLOSED)</strong>
                          <span className="text-[10px] text-rose-300/80 leading-snug">{decryptedErrorMsg}</span>
                        </div>
                      </div>
                      <p className="text-[10px] text-slate-500 leading-normal italic bg-slate-900/20 p-2 rounded">
                        Verification of cipher authenticity failed. No corrupt or trash data was leaked (Fail-closed protocol).
                      </p>
                    </div>
                  ) : (
                    <div className="h-full flex items-center justify-center text-center text-slate-600 italic text-xs py-8">
                      Ready. Trigger E2E Decryption to view plaintext output here.
                    </div>
                  )}
                </div>
              </div>

            </div>

            {/* Cryptographic Operation Logs */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden min-h-[160px] flex flex-col">
              <div className="bg-slate-950 border-b border-slate-800/80 px-5 py-3 flex items-center justify-between">
                <div className="flex items-center space-x-2 text-slate-200">
                  <Terminal className="h-4 w-4 text-emerald-400" />
                  <span className="text-xs font-bold tracking-wide uppercase">Cryptographic Operation Logs</span>
                </div>
                <button
                  onClick={() => setSimLogs([])}
                  className="text-[10px] text-slate-400 hover:text-white bg-slate-900 hover:bg-slate-850 px-2 py-0.5 rounded border border-slate-800 transition-colors cursor-pointer"
                >
                  Clear Logs
                </button>
              </div>

              <div className="flex-1 bg-slate-950 p-4 overflow-y-auto max-h-[180px] font-mono text-[10px] text-slate-400 space-y-1">
                {simLogs.length === 0 ? (
                  <div className="text-slate-600 italic py-6 text-center">
                    No operations recorded yet. Generate keys, run lookup, or hit "Run Full Simulation" to fill.
                  </div>
                ) : (
                  simLogs.map((log, idx) => (
                    <div key={idx} className="border-b border-slate-900 pb-1 break-all">
                      {log}
                    </div>
                  ))
                )}
              </div>
            </div>

          </div>

        </main>
      ) : (
        /* WebRTC Signaling Console Tab */
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
                  Welcome to the signaling panel for <strong>skrim-calling</strong>. You can establish a connection right inside this console, join a room, and send test SDP/ICE messages.
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
                        ? "bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-950/40"
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
                      className="bg-indigo-600 hover:bg-indigo-500 transition-all text-white text-xs font-medium py-2 rounded-lg cursor-pointer"
                    >
                      Send Offer
                    </button>
                    <button
                      onClick={() => sendSignal("answer")}
                      className="bg-emerald-600 hover:bg-emerald-500 transition-all text-white text-xs font-medium py-2 rounded-lg cursor-pointer"
                    >
                      Send Answer
                    </button>
                    <button
                      onClick={() => sendSignal("ice-candidate")}
                      className="bg-amber-600 hover:bg-amber-500 transition-all text-white text-xs font-medium py-2 rounded-lg cursor-pointer"
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
                  <p className="text-[10px] text-slate-600 mt-1 max-w-sm">
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
                <div className="text-slate-200 font-bold">npm run dev</div>
                <div className="pt-2"><span className="text-sky-400"># Start CoTurn (STUN/TURN) in background</span></div>
                <div className="text-slate-200 font-bold">docker-compose up -d</div>
              </div>
            </div>

          </div>

        </main>
      )}
    </div>
  );
}
