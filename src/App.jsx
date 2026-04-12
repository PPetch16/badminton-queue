import { useState, useEffect, useRef } from "react";
import { db } from "./firebase";
import {
  doc,
  setDoc,
  onSnapshot,
  runTransaction
} from "firebase/firestore";
import { QRCodeCanvas } from "qrcode.react";

const ROOM_ID = "main-room";
const ADMIN_PIN = "1445"; // 🔒 เปลี่ยนเอง

// ---------- level utils ----------
// ระดับมือแบดมินตันไทย (อ่อน → แข็ง):
// E → BG → BG+ → NB → S → N → P
const LEVELS = ["P", "N", "S", "NB", "BG+", "BG", "E"];
const LEVEL_VALUE = { P: 7, N: 6, S: 5, NB: 4, "BG+": 3, BG: 2, E: 1 };
const LEVEL_COLOR = {
  P:    "#cf1322", // แดง     — Professional/โค้ช
  N:    "#d46b08", // ส้ม     — นานาชาติ
  S:    "#d4b106", // เหลือง  — Super Man
  NB:   "#389e0d", // เขียว   — มือหน้าบ้าน
  "BG+":"#096dd9", // น้ำเงิน — BG+
  BG:   "#531dab", // ม่วง    — Beginner
  E:    "#595959", // เทา     — มือใหม่
};
const DEFAULT_LEVEL = "E";

const levelVal = (level) => LEVEL_VALUE[level] ?? 1;

// Snake-draft 4 players into balanced teams
// sorted desc: [best, 2nd, 3rd, worst]
// team1 = [best, worst]  team2 = [2nd, 3rd]  → avg levels match
const balancedTeams = (players) => {
  if (players.length !== 4) return players;
  const s = [...players].sort((a, b) => levelVal(b.level) - levelVal(a.level));
  return [s[0], s[3], s[1], s[2]];
};

// ---------- utils ----------
const shuffle = (arr) => [...arr].sort(() => Math.random() - 0.5);

const parseNames = (input) =>
  input
    .split("\n")
    .map((line) => {
      const colonIdx = line.indexOf(":");
      const name = (colonIdx === -1 ? line : line.slice(0, colonIdx)).trim();
      const lvlRaw = colonIdx === -1 ? "" : line.slice(colonIdx + 1).trim().toUpperCase();
      const level = LEVELS.includes(lvlRaw) ? lvlRaw : DEFAULT_LEVEL;
      return { name, level };
    })
    .filter((x) => x.name);

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

// ---------- LevelBadge ----------
const LevelBadge = ({ level }) => (
  <span style={{
    background: LEVEL_COLOR[level] || "#aaa",
    color: "#fff",
    borderRadius: 4,
    padding: "1px 6px",
    fontSize: 11,
    fontWeight: "bold",
    marginLeft: 5,
  }}>
    {level || DEFAULT_LEVEL}
  </span>
);

export default function App() {
  const [namesInput, setNamesInput] = useState("");
  const [courtCount, setCourtCount] = useState(2);
  const [queue, setQueue] = useState([]);
  const [courts, setCourts] = useState([]);
  const [newPlayer, setNewPlayer] = useState("");
  const [newPlayerLevel, setNewPlayerLevel] = useState(DEFAULT_LEVEL);
  const [resting, setResting] = useState([]);

  const [isAdmin, setIsAdmin] = useState(false);
  const [pinInput, setPinInput] = useState("");

  const debounceRef = useRef(null);

  const params = new URLSearchParams(window.location.search);
  const isViewer = params.get("viewer") === "1";

  const baseUrl = window.location.origin + window.location.pathname;
  const viewerUrl = baseUrl + "?viewer=1";

  const ref = doc(db, "rooms", ROOM_ID);
  const canEdit = isAdmin && !isViewer;

  // ---------- realtime ----------
  useEffect(() => {
    const unsub = onSnapshot(ref, (snap) => {
      if (!snap.exists()) return;
      const d = snap.data();
      setNamesInput(d.namesInput || "");
      setCourtCount(d.courtCount || 2);
      setQueue(d.queue || []);
      setCourts(d.courts || []);
      setResting(d.resting || []);
    });
    return () => unsub();
  }, []);

  const save = (data) => setDoc(ref, data);

  // ---------- auth ----------
  const login = () => {
    if (pinInput === ADMIN_PIN) {
      setIsAdmin(true);
      alert("เข้าโหมด admin แล้ว");
    } else {
      alert("PIN ผิด");
    }
  };

  // ---------- actions ----------
  const startGame = async () => {
    if (!canEdit) return;

    const parsed = parseNames(namesInput);
    let players = createPlayers(shuffle(parsed));
    let q = [...players];
    let newCourts = [];

    for (let i = 0; i < courtCount; i++) {
      const four = q.splice(0, 4);
      const p = balancedTeams(four).map((x) => ({ ...x, played: x.played + 1 }));
      newCourts.push({ name: `สนาม ${i + 1}`, players: p, loserTeam: null });
    }

    setQueue(q);
    setCourts(newCourts);
    setResting([]);
    await save({ namesInput, courtCount, queue: q, courts: newCourts, resting: [] });
  };

  const selectLoser = async (i, team) => {
    if (!canEdit) return;
    const newCourts = courts.map((c, idx) =>
      idx === i ? { ...c, loserTeam: c.loserTeam === team ? null : team } : c
    );
    setCourts(newCourts);
    await save({ namesInput, courtCount, queue, courts: newCourts, resting });
  };

  const updateCourtName = (i, name) => {
    if (!canEdit) return;
    const newCourts = [...courts];
    newCourts[i].name = name;
    setCourts(newCourts);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      save({ namesInput, courtCount, queue, courts: newCourts, resting });
    }, 300);
  };

  const endCourt = async (i) => {
    if (!canEdit) return;
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.data();
      let courts = data.courts;
      let queue = data.queue;
      const court = courts[i];
      if (!court || court.loserTeam === null) return;

      const losers =
        court.loserTeam === 0
          ? court.players.slice(0, 2)
          : court.players.slice(2, 4);
      const loserSet = new Set(losers.map((p) => p.name));

      let stay = [], lose = [], out = [];
      court.players.forEach((p) => {
        if (loserSet.has(p.name)) lose.push({ ...p, played: 0 });
        else if (p.played >= 2) out.push({ ...p, played: 0 });
        else stay.push(p);
      });

      let newQueue = [...queue, ...lose, ...out];
      const fromQueue = newQueue.splice(0, 4 - stay.length);
      const four = [...stay, ...fromQueue].map((p) => ({ ...p, played: p.played + 1 }));

      // จัดทีม balanced เฉพาะตอนได้ครบ 4 คน
      const next = four.length === 4 ? balancedTeams(four) : four;

      courts[i] = { ...court, players: next, loserTeam: null };
      tx.set(ref, { ...data, queue: newQueue, courts });
    });
  };

  const addPlayer = async () => {
    if (!canEdit || !newPlayer.trim()) return;
    const newQueue = [...queue, { name: newPlayer.trim(), level: newPlayerLevel, played: 0 }];
    setQueue(newQueue);
    setNewPlayer("");
    await save({ namesInput, courtCount, queue: newQueue, courts, resting });
  };

  const removePair = async (i) => {
    if (!canEdit) return;
    const start = i * 2;
    const newQueue = queue.filter((_, idx) => idx !== start && idx !== start + 1);
    setQueue(newQueue);
    await save({ namesInput, courtCount, queue: newQueue, courts, resting });
  };

  // ---------- rest actions ----------
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
      const withoutBoth = queue.filter((_, i) => i !== idx && i !== partnerIdx);
      newQueue = [...withoutBoth, partner];
    }

    const newResting = [...resting, { ...player, played: 0 }];
    setQueue(newQueue);
    setResting(newResting);
    await save({ namesInput, courtCount, queue: newQueue, courts, resting: newResting });
  };

  const returnFromRest = async (playerName) => {
    if (!canEdit) return;
    const player = resting.find((p) => p.name === playerName);
    if (!player) return;
    const newResting = resting.filter((p) => p.name !== playerName);
    const newQueue = [...queue, { ...player, played: 0 }];
    setResting(newResting);
    setQueue(newQueue);
    await save({ namesInput, courtCount, queue: newQueue, courts, resting: newResting });
  };

  const reset = async () => {
    if (!canEdit) return;
    if (!confirm("รีเซ็ตทั้งหมด?")) return;
    await setDoc(ref, { namesInput: "", courtCount: 2, queue: [], courts: [], resting: [] });
  };

  const { pairs, leftover } = formatQueue(queue);

  // ---------- UI ----------
  return (
    <div style={{ maxWidth: 520, margin: "auto", padding: 20 }}>
      <h1>🏸 Badminton Queue</h1>

      {isViewer && (
        <div style={{ background: "#fff3cd", padding: 10 }}>👀 ดูอย่างเดียว</div>
      )}

      {!isAdmin && !isViewer && (
        <div>
          <input
            type="password"
            placeholder="PIN"
            value={pinInput}
            onChange={(e) => setPinInput(e.target.value)}
          />
          <button onClick={login}>เข้าสู่ระบบ</button>
        </div>
      )}

      <QRCodeCanvas value={viewerUrl} size={140} />

      <div style={{ marginTop: 10, fontSize: 12, color: "#888" }}>
        กรอกชื่อ 1 คนต่อบรรทัด · ใส่ระดับได้ เช่น <code>Alice:A</code> (S / A / B / C)
      </div>
      <textarea
        rows={5}
        value={namesInput}
        disabled={!canEdit}
        onChange={(e) => setNamesInput(e.target.value)}
        style={{ width: "100%", marginTop: 4 }}
        placeholder={"Alice:S\nBob:A\nCharlie:B\nDave:C"}
      />

      <div style={{ display: "flex", gap: 6, marginTop: 6, alignItems: "center" }}>
        <input
          value={newPlayer}
          disabled={!canEdit}
          onChange={(e) => setNewPlayer(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addPlayer()}
          placeholder="เพิ่มคน"
          style={{ flex: 1 }}
        />
        <select
          value={newPlayerLevel}
          disabled={!canEdit}
          onChange={(e) => setNewPlayerLevel(e.target.value)}
        >
          {LEVELS.map((l) => <option key={l}>{l}</option>)}
        </select>
        <button onClick={addPlayer} disabled={!canEdit}>+</button>
      </div>

      <div style={{ marginTop: 8 }}>
        <input
          type="number"
          value={courtCount}
          disabled={!canEdit}
          onChange={(e) => setCourtCount(+e.target.value)}
          style={{ width: 50 }}
        /> สนาม
      </div>

      <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
        <button onClick={startGame} disabled={!canEdit}>เริ่มเกม</button>
        <button onClick={reset} disabled={!canEdit}>รีเซ็ต</button>
      </div>

      <hr />

      {courts.map((c, i) => {
        const t1 = c.players?.slice(0, 2) || [];
        const t2 = c.players?.slice(2, 4) || [];
        return (
          <div key={i} style={{ marginBottom: 16 }}>
            <input
              value={c.name || ""}
              disabled={!canEdit}
              onChange={(e) => updateCourtName(i, e.target.value)}
            />

            {[t1, t2].map((team, idx) => (
              <div
                key={idx}
                onClick={() => canEdit && selectLoser(i, idx)}
                style={{
                  background: c.loserTeam === idx ? "#ff4d4f" : "#eee",
                  padding: 8,
                  marginTop: 5,
                  borderRadius: 6,
                  cursor: canEdit ? "pointer" : "default",
                }}
              >
                <strong>คู่ {idx + 1}</strong>
                {team.map((p) => (
                  <div key={p.name} style={{ display: "flex", alignItems: "center", marginTop: 3 }}>
                    {p.name}
                    <LevelBadge level={p.level} />
                    <span style={{ marginLeft: 6, color: "#666", fontSize: 12 }}>({p.played})</span>
                  </div>
                ))}
              </div>
            ))}

            <button
              onClick={() => endCourt(i)}
              disabled={!canEdit || c.loserTeam === null}
              style={{ marginTop: 6 }}
            >
              จบรอบ
            </button>
          </div>
        );
      })}

      <hr />
      <h3>⏳ คิว</h3>

      {pairs.map((p, i) => (
        <div
          key={i}
          style={{
            background: i === 0 ? "#52c41a" : "#eee",
            padding: 6,
            marginTop: 4,
            borderRadius: 6,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <strong>{i === 0 ? "🔥 " : ""}คู่ที่ {i + 1}</strong>
            <button onClick={() => removePair(i)} disabled={!canEdit} title="ลบคู่นี้">❌</button>
          </div>
          {p.map((player) => (
            <div
              key={player.name}
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}
            >
              <span style={{ display: "flex", alignItems: "center" }}>
                {player.name}<LevelBadge level={player.level} />
              </span>
              <button
                onClick={() => restPlayer(player.name)}
                disabled={!canEdit}
                style={{ fontSize: 12, padding: "2px 8px" }}
              >
                😴 พัก
              </button>
            </div>
          ))}
        </div>
      ))}

      {leftover && (
        <div style={{
          background: "#eee",
          padding: 6,
          marginTop: 4,
          borderRadius: 6,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}>
          <span style={{ display: "flex", alignItems: "center" }}>
            เศษ: {leftover.name}<LevelBadge level={leftover.level} />
          </span>
          <button
            onClick={() => restPlayer(leftover.name)}
            disabled={!canEdit}
            style={{ fontSize: 12, padding: "2px 8px" }}
          >
            😴 พัก
          </button>
        </div>
      )}

      {resting.length > 0 && (
        <>
          <h3>😴 พักอยู่ ({resting.length} คน)</h3>
          {resting.map((p) => (
            <div
              key={p.name}
              style={{
                background: "#ffd6a5",
                padding: 6,
                marginTop: 4,
                borderRadius: 6,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span style={{ display: "flex", alignItems: "center" }}>
                {p.name}<LevelBadge level={p.level} />
              </span>
              <button
                onClick={() => returnFromRest(p.name)}
                disabled={!canEdit}
                style={{ fontSize: 12, padding: "2px 8px" }}
              >
                ▶️ กลับคิว
              </button>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
