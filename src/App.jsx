import { useState, useEffect, useRef, forwardRef } from "react";
import { db } from "./firebase";
import { doc, setDoc, onSnapshot, runTransaction } from "firebase/firestore";
import { QRCodeCanvas } from "qrcode.react";

const ROOM_ID = "main-room";
const ADMIN_PIN = "1445";

// ---------- level utils ----------
// E → BG → BG+ → NB → S → N → P
const LEVELS = ["P", "N", "S", "NB", "BG+", "BG", "E"];
const LEVEL_VALUE = { P: 7, N: 6, S: 5, NB: 4, "BG+": 3, BG: 2, E: 1 };
const LEVEL_COLOR = {
  P: "#cf1322", N: "#d46b08", S: "#d4b106",
  NB: "#389e0d", "BG+": "#096dd9", BG: "#531dab", E: "#595959",
};
const DEFAULT_LEVEL = "E";

const levelVal = (level) => LEVEL_VALUE[level] ?? 1;

const balancedTeams = (players) => {
  if (players.length !== 4) return players;
  const s = [...players].sort((a, b) => levelVal(b.level) - levelVal(a.level));
  return [s[0], s[3], s[1], s[2]];
};

// ---------- utils ----------
const shuffle = (arr) => [...arr].sort(() => Math.random() - 0.5);

const parseNames = (input) =>
  input.split("\n").map((line) => {
    const colonIdx = line.indexOf(":");
    const name = (colonIdx === -1 ? line : line.slice(0, colonIdx)).trim();
    const lvlRaw = colonIdx === -1 ? "" : line.slice(colonIdx + 1).trim().toUpperCase();
    return { name, level: LEVELS.includes(lvlRaw) ? lvlRaw : DEFAULT_LEVEL };
  }).filter((x) => x.name);

const createPlayers = (list) =>
  list.map(({ name, level }) => ({ name, level: level || DEFAULT_LEVEL, played: 0 }));

const formatQueue = (queue) => {
  const pairs = [];
  let leftover = null;
  for (let i = 0; i < queue.length; i += 2) {
    if (queue[i + 1]) pairs.push([queue[i], queue[i + 1]]);
    else leftover = queue[i];
  }
  return { pairs, leftover };
};

// ---------- components ----------
const LevelBadge = ({ level }) => (
  <span style={{
    background: LEVEL_COLOR[level] || "#aaa",
    color: "#fff",
    borderRadius: 6,
    padding: "2px 7px",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 0.3,
    flexShrink: 0,
  }}>
    {level || DEFAULT_LEVEL}
  </span>
);

const Btn = ({ children, onClick, disabled, variant = "default", style: sx = {} }) => {
  const base = {
    height: 44,
    minWidth: 44,
    borderRadius: 12,
    border: "none",
    fontWeight: 600,
    fontSize: 15,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.45 : 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    padding: "0 18px",
    transition: "opacity .15s",
    whiteSpace: "nowrap",
  };
  const variants = {
    primary:  { background: "#1a1a2e", color: "#fff" },
    success:  { background: "#52c41a", color: "#fff" },
    danger:   { background: "#ff4d4f", color: "#fff" },
    warning:  { background: "#faad14", color: "#fff" },
    ghost:    { background: "#f4f4f6", color: "#333" },
    default:  { background: "#f4f4f6", color: "#333" },
    orange:   { background: "#fa8c16", color: "#fff" },
  };
  return (
    <button onClick={onClick} disabled={disabled} style={{ ...base, ...variants[variant], ...sx }}>
      {children}
    </button>
  );
};

const Input = forwardRef(({ style: sx = {}, ...props }, ref) => (
  <input ref={ref} style={{
    height: 44,
    borderRadius: 12,
    border: "1.5px solid #e8e8e8",
    padding: "0 14px",
    fontSize: 15,
    background: "#fff",
    outline: "none",
    boxSizing: "border-box",
    width: "100%",
    color: "#000",
    ...sx,
  }} {...props} />
));

const Card = ({ children, style: sx = {} }) => (
  <div style={{
    background: "#fff",
    borderRadius: 20,
    padding: 16,
    marginBottom: 12,
    boxShadow: "0 2px 12px rgba(0,0,0,0.07)",
    ...sx,
  }}>
    {children}
  </div>
);

const SectionLabel = ({ children }) => (
  <div style={{
    fontSize: 11,
    fontWeight: 700,
    color: "#aaa",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 10,
  }}>
    {children}
  </div>
);

// ---------- main ----------
export default function App() {
  const [namesInput, setNamesInput]       = useState("");
  const [courtCount, setCourtCount]       = useState(2);
  const [queue, setQueue]                 = useState([]);
  const [courts, setCourts]               = useState([]);
  const [newPlayer, setNewPlayer]         = useState("");
  const [newPlayerLevel, setNewPlayerLevel] = useState(DEFAULT_LEVEL);
  const [resting, setResting]             = useState([]);
  const [showSetup, setShowSetup]         = useState(true);
  const [showQR, setShowQR]               = useState(false);

  const [isAdmin, setIsAdmin]   = useState(false);
  const [pinInput, setPinInput] = useState("");

  const debounceRef = useRef(null);
  const addInputRef = useRef(null);

  const params    = new URLSearchParams(window.location.search);
  const isViewer  = params.get("viewer") === "1";
  const baseUrl   = window.location.origin + window.location.pathname;
  const viewerUrl = baseUrl + "?viewer=1";

  const ref     = doc(db, "rooms", ROOM_ID);
  const canEdit = isAdmin && !isViewer;

  const [playerHistory, setPlayerHistory] = useState({}); // { "ชื่อ": "ระดับ" }

  useEffect(() => {
    const unsub = onSnapshot(ref, (snap) => {
      if (!snap.exists()) return;
      const d = snap.data();
      setNamesInput(d.namesInput || "");
      setCourtCount(d.courtCount || 2);
      setQueue(d.queue || []);
      setCourts(d.courts || []);
      setResting(d.resting || []);
      setPlayerHistory(d.playerHistory || {});
    });
    return () => unsub();
  }, []);

  // เพิ่มชื่อ+ระดับลง history — merge เข้า state แล้ว save พร้อมข้อมูลอื่น
  const mergeHistory = (players, currentHistory = playerHistory) => {
    const merged = { ...currentHistory };
    players.forEach(({ name, level }) => { merged[name] = level; });
    return merged;
  };

  const save = (data) => setDoc(ref, data);

  const login = () => {
    if (pinInput === ADMIN_PIN) { setIsAdmin(true); setPinInput(""); }
    else alert("PIN ผิด");
  };

  const startGame = async () => {
    if (!canEdit) return;

    // รวมผู้เล่นจากทุกแหล่ง แล้ว deduplicate ตามชื่อ
    const fromTextarea = createPlayers(parseNames(namesInput));
    const fromActive   = [
      ...queue,
      ...courts.flatMap((c) => c.players || []),
      ...resting,
    ].map((p) => ({ name: p.name, level: p.level || DEFAULT_LEVEL, played: 0 }));

    // deduplicate ตามชื่อ — fromActive ก่อน, fromTextarea เติมเฉพาะชื่อใหม่
    const seen = new Set();
    const allPlayers = [...fromActive, ...fromTextarea].filter(({ name }) => {
      if (!name || seen.has(name)) return false;
      seen.add(name);
      return true;
    });

    // sync namesInput ให้ครบทุกคน ป้องกันหายตอนกดตั้งค่ากลับมา
    const newNamesInput = allPlayers.map((p) => `${p.name}:${p.level}`).join("\n");

    let players = shuffle(allPlayers);
    let q = [...players];
    const newCourts = [];
    for (let i = 0; i < courtCount; i++) {
      const four = q.splice(0, 4);
      const p = balancedTeams(four).map((x) => ({ ...x, played: x.played + 1 }));
      newCourts.push({ name: `สนาม ${i + 1}`, players: p, loserTeam: null });
    }
    const newHistory = mergeHistory(players);
    setNamesInput(newNamesInput);
    setQueue(q); setCourts(newCourts); setResting([]); setPlayerHistory(newHistory);
    setShowSetup(false);
    await save({ namesInput: newNamesInput, courtCount, queue: q, courts: newCourts, resting: [], playerHistory: newHistory });
  };

  const selectLoser = async (i, team) => {
    if (!canEdit) return;
    const newCourts = courts.map((c, idx) =>
      idx === i ? { ...c, loserTeam: c.loserTeam === team ? null : team } : c
    );
    setCourts(newCourts);
    await save({ namesInput, courtCount, queue, courts: newCourts, resting, playerHistory });
  };

  const updateCourtName = (i, name) => {
    if (!canEdit) return;
    const newCourts = [...courts];
    newCourts[i].name = name;
    setCourts(newCourts);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      save({ namesInput, courtCount, queue, courts: newCourts, resting });
    }, 400);
  };

  const endCourt = async (i) => {
    if (!canEdit) return;
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.data();
      let courts = data.courts, queue = data.queue;
      const court = courts[i];
      if (!court || court.loserTeam === null) return;

      const losers = court.loserTeam === 0 ? court.players.slice(0, 2) : court.players.slice(2, 4);
      const loserSet = new Set(losers.map((p) => p.name));
      let stay = [], lose = [], out = [];
      court.players.forEach((p) => {
        if (loserSet.has(p.name))  lose.push({ ...p, played: 0 });
        else if (p.played >= 2)    out.push({ ...p, played: 0 });
        else                       stay.push(p);
      });

      let newQueue = [...queue, ...lose, ...out];
      const fromQueue = newQueue.splice(0, 4 - stay.length);
      const four = [...stay, ...fromQueue].map((p) => ({ ...p, played: p.played + 1 }));
      courts[i] = { ...court, players: four.length === 4 ? balancedTeams(four) : four, loserTeam: null };
      tx.set(ref, { ...data, queue: newQueue, courts });
    });
  };

  const addPlayer = async () => {
    const name = (addInputRef.current?.value || newPlayer).trim();
    if (!canEdit || !name) return;

    const allNames = new Set([
      ...queue.map((p) => p.name),
      ...courts.flatMap((c) => c.players?.map((p) => p.name) || []),
      ...resting.map((p) => p.name),
    ]);
    if (allNames.has(name)) {
      alert(`"${name}" มีในระบบแล้ว`);
      return;
    }

    // เขียนลง namesInput ด้วย เพื่อให้ "จัดใหม่" ดึงชื่อนี้ได้ด้วย
    const line = `${name}:${newPlayerLevel}`;
    const alreadyInTextarea = parseNames(namesInput).some((p) => p.name === name);
    const newNamesInput = alreadyInTextarea
      ? namesInput
      : namesInput ? `${namesInput}\n${line}` : line;

    const newQueue = [...queue, { name, level: newPlayerLevel, played: 0 }];
    setQueue(newQueue);
    setNamesInput(newNamesInput);
    setNewPlayer("");
    addInputRef.current?.focus();
    const newHistory = mergeHistory([{ name, level: newPlayerLevel }]);
    setPlayerHistory(newHistory);
    await save({ namesInput: newNamesInput, courtCount, queue: newQueue, courts, resting, playerHistory: newHistory });
  };

  const removePair = async (i) => {
    if (!canEdit) return;
    const start = i * 2;
    const newQueue = queue.filter((_, idx) => idx !== start && idx !== start + 1);
    setQueue(newQueue);
    await save({ namesInput, courtCount, queue: newQueue, courts, resting, playerHistory });
  };

  const restPlayer = async (playerName) => {
    if (!canEdit) return;
    const idx = queue.findIndex((p) => p.name === playerName);
    if (idx === -1) return;
    const player = queue[idx];
    const hadLeftover = queue.length % 2 === 1;
    let newQueue;
    if (hadLeftover) {
      if (idx === queue.length - 1) {
        newQueue = queue.filter((_, i) => i !== idx);
      } else {
        const leftover = queue[queue.length - 1];
        const without = queue.filter((_, i) => i !== idx && i !== queue.length - 1);
        newQueue = [...without.slice(0, idx), leftover, ...without.slice(idx)];
      }
    } else {
      const partnerIdx = idx % 2 === 0 ? idx + 1 : idx - 1;
      const partner = queue[partnerIdx];
      newQueue = [...queue.filter((_, i) => i !== idx && i !== partnerIdx), partner];
    }
    const newResting = [...resting, { ...player, played: 0 }];
    setQueue(newQueue); setResting(newResting);
    await save({ namesInput, courtCount, queue: newQueue, courts, resting: newResting, playerHistory });
  };

  const returnFromRest = async (playerName) => {
    if (!canEdit) return;
    const player = resting.find((p) => p.name === playerName);
    if (!player) return;
    const newResting = resting.filter((p) => p.name !== playerName);
    const newQueue = [...queue, { ...player, played: 0 }];
    setResting(newResting); setQueue(newQueue);
    await save({ namesInput, courtCount, queue: newQueue, courts, resting: newResting, playerHistory });
  };

  const reset = async () => {
    if (!canEdit) return;
    if (!confirm("รีเซ็ตทั้งหมด?")) return;
    await setDoc(ref, { namesInput: "", courtCount: 2, queue: [], courts: [], resting: [], playerHistory });
    setShowSetup(true);
  };

  const { pairs, leftover } = formatQueue(queue);
  const gameStarted = courts.length > 0;

  // ---------- UI ----------
  return (
    <div style={{
      maxWidth: 480,
      margin: "0 auto",
      minHeight: "100vh",
      background: "#f0f2f5",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Prompt', sans-serif",
      paddingBottom: canEdit ? 90 : 24,
    }}>

      {/* ── HEADER ── */}
      <div style={{
        background: "#1a1a2e",
        color: "#fff",
        padding: "14px 20px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        position: "sticky",
        top: 0,
        zIndex: 100,
        boxShadow: "0 2px 12px rgba(0,0,0,0.2)",
      }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 18, letterSpacing: 0.3 }}>🏸 Badminton Queue</div>
          <div style={{ fontSize: 12, marginTop: 2, opacity: 0.6 }}>
            {isViewer ? "👀 ดูอย่างเดียว" : isAdmin ? "🔑 Admin" : "🔒 ล็อกอยู่"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setShowQR(!showQR)} style={{
            background: "rgba(255,255,255,0.12)", border: "none", color: "#fff",
            borderRadius: 10, padding: "8px 12px", cursor: "pointer", fontSize: 18,
          }}>
            📷
          </button>
          {gameStarted && canEdit && (
            <button onClick={() => setShowSetup(!showSetup)} style={{
              background: showSetup ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.12)",
              border: "none", color: "#fff",
              borderRadius: 10, padding: "8px 12px", cursor: "pointer", fontSize: 13, fontWeight: 600,
            }}>
              {showSetup ? "◀ ซ่อน" : "⚙️ ตั้งค่า"}
            </button>
          )}
        </div>
      </div>

      <div style={{ padding: "14px 14px 0" }}>

        {/* ── QR POPUP ── */}
        {showQR && (
          <Card style={{ textAlign: "center" }}>
            <SectionLabel>QR — ลิงก์ดูคิว</SectionLabel>
            <QRCodeCanvas value={viewerUrl} size={180} style={{ margin: "0 auto", display: "block" }} />
            <div style={{ fontSize: 12, color: "#aaa", marginTop: 8, wordBreak: "break-all" }}>{viewerUrl}</div>
          </Card>
        )}

        {/* ── VIEWER BANNER ── */}
        {isViewer && (
          <div style={{
            background: "#fffbe6", border: "1px solid #ffe58f",
            borderRadius: 12, padding: "10px 14px", marginBottom: 12,
            fontSize: 14, color: "#874d00",
          }}>
            👀 โหมดดูอย่างเดียว — สแกน QR เพื่อแชร์หน้านี้
          </div>
        )}

        {/* ── LOGIN ── */}
        {!isAdmin && !isViewer && (
          <Card>
            <SectionLabel>เข้าสู่ระบบ Admin</SectionLabel>
            <div style={{ display: "flex", gap: 8 }}>
              <Input
                type="password"
                placeholder="ใส่ PIN"
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && login()}
                style={{ color: "#000" }}
              />
              <Btn variant="primary" onClick={login} sx={{ flexShrink: 0 }}>เข้า</Btn>
            </div>
          </Card>
        )}

        {/* ── SETUP ── */}
        {(!gameStarted || showSetup) && canEdit && (
          <Card>
            <SectionLabel>⚙️ ตั้งค่า</SectionLabel>
            <div style={{ fontSize: 12, color: "#aaa", marginBottom: 6 }}>
              ชื่อ 1 คนต่อบรรทัด · ใส่ระดับได้ เช่น <code>สมชาย:NB</code>
            </div>
            <textarea
              rows={5}
              value={namesInput}
              onChange={(e) => setNamesInput(e.target.value)}
              placeholder={"สมชาย:S\nสมหญิง:NB\nก้อง:BG+\nน้ำ:BG"}
              style={{
                width: "100%", borderRadius: 12, border: "1.5px solid #e8e8e8",
                padding: 12, fontSize: 14, resize: "vertical",
                boxSizing: "border-box", outline: "none", lineHeight: 1.7,
              }}
            />
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
              <span style={{ fontSize: 14, color: "#555", whiteSpace: "nowrap" }}>จำนวนสนาม</span>
              <input
                type="number" min={1} max={10}
                value={courtCount}
                onChange={(e) => setCourtCount(Math.max(1, +e.target.value))}
                style={{
                  width: 60, height: 44, borderRadius: 12, border: "1.5px solid #e8e8e8",
                  textAlign: "center", fontSize: 16, fontWeight: 700, outline: "none", color: "#000",
                }}
              />
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <Btn variant="primary" onClick={startGame} style={{ flex: 1 }}>
                ▶️ เริ่มเกม
              </Btn>
              {gameStarted && (
                <Btn variant="danger" onClick={reset}>รีเซ็ต</Btn>
              )}
            </div>
          </Card>
        )}

        {/* ── COURTS ── */}
        {courts.map((c, i) => {
          const t1 = c.players?.slice(0, 2) || [];
          const t2 = c.players?.slice(2, 4) || [];
          return (
            <Card key={i}>
              {/* court name */}
              <div style={{ display: "flex", alignItems: "center", marginBottom: 12, gap: 8 }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 10, background: "#1a1a2e",
                  color: "#fff", fontWeight: 700, fontSize: 14,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {i + 1}
                </div>
                <input
                  value={c.name || ""}
                  disabled={!canEdit}
                  onChange={(e) => updateCourtName(i, e.target.value)}
                  style={{
                    flex: 1, height: 36, borderRadius: 10, border: "1.5px solid #e8e8e8",
                    padding: "0 12px", fontSize: 15, fontWeight: 600, outline: "none", color: "#000",
                    background: canEdit ? "#fff" : "transparent",
                    cursor: canEdit ? "text" : "default",
                  }}
                />
              </div>

              {/* teams — 2 columns */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {[t1, t2].map((team, idx) => {
                  const isLoser = c.loserTeam === idx;
                  return (
                    <div
                      key={idx}
                      onClick={() => canEdit && selectLoser(i, idx)}
                      style={{
                        borderRadius: 14,
                        padding: "10px 12px",
                        background: isLoser ? "#fff1f0" : "#f7f8fa",
                        border: `2px solid ${isLoser ? "#ff4d4f" : "#eee"}`,
                        cursor: canEdit ? "pointer" : "default",
                        transition: "all .15s",
                        userSelect: "none",
                      }}
                    >
                      <div style={{
                        fontSize: 11, fontWeight: 700, color: isLoser ? "#ff4d4f" : "#aaa",
                        letterSpacing: 1, marginBottom: 8, textTransform: "uppercase",
                      }}>
                        {isLoser ? "❌ แพ้" : team.map((p) => p.name).join(" & ")}
                      </div>
                      {team.map((p) => (
                        <div key={p.name} style={{
                          display: "flex", alignItems: "center", gap: 6,
                          flexWrap: "wrap", marginBottom: 6,
                        }}>
                          <LevelBadge level={p.level} />
                          <span style={{ fontWeight: 600, fontSize: 14, color: "#1a1a2e" }}>{p.name}</span>
                          <span style={{ fontSize: 11, color: "#bbb" }}>×{p.played}</span>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>

              {/* end round */}
              {canEdit && (
                <Btn
                  variant={c.loserTeam !== null ? "success" : "ghost"}
                  onClick={() => endCourt(i)}
                  disabled={c.loserTeam === null}
                  style={{ width: "100%", marginTop: 10 }}
                >
                  {c.loserTeam !== null ? "✅ จบรอบ" : "เลือกทีมที่แพ้ก่อน"}
                </Btn>
              )}
            </Card>
          );
        })}

        {/* ── QUEUE ── */}
        {(pairs.length > 0 || leftover) && (
          <Card>
            <SectionLabel>⏳ คิวรอ · {queue.length} คน</SectionLabel>
            {pairs.map((p, i) => (
              <div
                key={i}
                style={{
                  borderRadius: 14,
                  background: i === 0 ? "#f6ffed" : "#fafafa",
                  border: `1.5px solid ${i === 0 ? "#b7eb8f" : "#f0f0f0"}`,
                  padding: "10px 12px",
                  marginBottom: 8,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontWeight: 700, fontSize: 12, color: i === 0 ? "#52c41a" : "#aaa" }}>
                    {i === 0 ? "🔥 " : ""}{p.map((x) => x.name).join(" & ")}
                  </span>
                  {canEdit && (
                    <button
                      onClick={() => removePair(i)}
                      style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, padding: 2, color: "#ccc" }}
                    >
                      ✕
                    </button>
                  )}
                </div>
                {p.map((player) => (
                  <div key={player.name} style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "5px 0", borderTop: "1px solid #f0f0f0",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <LevelBadge level={player.level} />
                      <span style={{ fontWeight: 600, fontSize: 14, color: "#1a1a2e" }}>{player.name}</span>
                    </div>
                    {canEdit && (
                      <button
                        onClick={() => restPlayer(player.name)}
                        style={{
                          background: "#fff7e6", border: "1px solid #ffd591", color: "#fa8c16",
                          borderRadius: 8, padding: "4px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer",
                        }}
                      >
                        😴 พัก
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ))}

            {leftover && (
              <div style={{
                borderRadius: 14, background: "#fafafa", border: "1.5px dashed #d9d9d9",
                padding: "10px 12px", display: "flex", justifyContent: "space-between", alignItems: "center",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <LevelBadge level={leftover.level} />
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{leftover.name}</span>
                  <span style={{ fontSize: 12, color: "#bbb" }}>— รอเข้าคู่</span>
                </div>
                {canEdit && (
                  <button
                    onClick={() => restPlayer(leftover.name)}
                    style={{
                      background: "#fff7e6", border: "1px solid #ffd591", color: "#fa8c16",
                      borderRadius: 8, padding: "4px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer",
                    }}
                  >
                    😴 พัก
                  </button>
                )}
              </div>
            )}
          </Card>
        )}

        {/* ── RESTING ── */}
        {resting.length > 0 && (
          <Card>
            <SectionLabel>😴 พักอยู่ · {resting.length} คน</SectionLabel>
            {resting.map((p) => (
              <div key={p.name} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "8px 0", borderBottom: "1px solid #f5f5f5",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <LevelBadge level={p.level} />
                  <span style={{ fontWeight: 600, fontSize: 14, color: "#1a1a2e" }}>{p.name}</span>
                </div>
                {canEdit && (
                  <button
                    onClick={() => returnFromRest(p.name)}
                    style={{
                      background: "#f6ffed", border: "1px solid #b7eb8f", color: "#52c41a",
                      borderRadius: 8, padding: "4px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer",
                    }}
                  >
                    ▶️ กลับคิว
                  </button>
                )}
              </div>
            ))}
          </Card>
        )}

        {/* placeholder when nothing started */}
        {!gameStarted && !isViewer && !canEdit && (
          <div style={{ textAlign: "center", color: "#ccc", padding: "40px 20px", fontSize: 14 }}>
            รอ admin เริ่มเกม...
          </div>
        )}

      </div>

      {/* ── STICKY ADD PLAYER BAR ── */}
      {canEdit && (
        <div style={{
          position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)",
          width: "100%", maxWidth: 480,
          background: "#fff",
          borderTop: "1px solid #eee",
          padding: "10px 14px",
          boxShadow: "0 -4px 20px rgba(0,0,0,0.08)",
          display: "flex", gap: 8, alignItems: "center",
          boxSizing: "border-box",
          zIndex: 99,
        }}>
          <datalist id="player-history">
            {Object.entries(playerHistory).map(([name]) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          <Input
            ref={addInputRef}
            list="player-history"
            value={newPlayer}
            onChange={(e) => {
              setNewPlayer(e.target.value);
              const knownLevel = playerHistory[e.target.value];
              if (knownLevel) setNewPlayerLevel(knownLevel);
            }}
            onKeyDown={(e) => e.key === "Enter" && addPlayer()}
            placeholder="ชื่อผู้เล่น..."
            style={{ flex: 1, color: "#000" }}
          />
          <select
            value={newPlayerLevel}
            onChange={(e) => setNewPlayerLevel(e.target.value)}
            style={{
              height: 44, borderRadius: 12, border: "1.5px solid #e8e8e8",
              padding: "0 8px", fontSize: 14, fontWeight: 700, outline: "none",
              background: LEVEL_COLOR[newPlayerLevel] || "#aaa",
              color: "#fff", cursor: "pointer", flexShrink: 0,
            }}
          >
            {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          <Btn variant="primary" onClick={addPlayer} style={{ flexShrink: 0 }}>+</Btn>
        </div>
      )}
    </div>
  );
}
