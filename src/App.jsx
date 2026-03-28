import { useState, useEffect } from "react";
import { db } from "./firebase";
import { doc, setDoc, onSnapshot } from "firebase/firestore";

const ROOM_ID = "main-room";

// 🔀 สุ่ม
function shuffle(arr) {
  return [...arr].sort(() => Math.random() - 0.5);
}

// 👤 สร้าง player
function createPlayers(names) {
  return names.map(name => ({
    name,
    played: 0
  }));
}

// 🔥 แปลง queue → คู่ + เศษ
function formatQueue(queue) {
  let pairs = [];
  let leftover = null;

  for (let i = 0; i < queue.length; i += 2) {
    if (queue[i + 1]) {
      pairs.push([queue[i], queue[i + 1]]);
    } else {
      leftover = queue[i];
    }
  }

  return { pairs, leftover };
}

export default function App() {
  const [namesInput, setNamesInput] = useState("");
  const [courtCount, setCourtCount] = useState(2);

  const [queue, setQueue] = useState([]);
  const [courts, setCourts] = useState([]);

  // 🔥 realtime sync
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "rooms", ROOM_ID), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();

        setNamesInput(data.namesInput || "");
        setCourtCount(data.courtCount || 2);
        setQueue(data.queue || []);
        setCourts(data.courts || []);
      }
    });

    return () => unsub();
  }, []);

  // 🔥 save
  const saveData = async (data) => {
    await setDoc(doc(db, "rooms", ROOM_ID), data);
  };

  // 🚀 เริ่มเกม
  const startGame = async () => {
    let names = namesInput
      .split("\n")
      .map(n => n.trim())
      .filter(n => n);

    let players = createPlayers(shuffle(names));

    let q = [...players];
    let newCourts = [];

    for (let i = 0; i < courtCount; i++) {
      let playersInCourt = q.splice(0, 4).map(p => ({
        ...p,
        played: p.played + 1
      }));

      newCourts.push({
        name: `สนาม ${i + 1}`, // ✅ มีชื่อสนาม
        players: playersInCourt,
        loserTeam: null
      });
    }

    setQueue(q);
    setCourts(newCourts);

    await saveData({
      namesInput,
      courtCount,
      queue: q,
      courts: newCourts
    });
  };

  // 🔥 เลือกทีมแพ้
  const selectLoserTeam = async (courtIndex, teamIndex) => {
    const newCourts = courts.map((court, i) =>
      i === courtIndex
        ? {
            ...court,
            loserTeam:
              court.loserTeam === teamIndex ? null : teamIndex
          }
        : court
    );

    setCourts(newCourts);

    await saveData({
      namesInput,
      courtCount,
      queue,
      courts: newCourts
    });
  };

  // 🔥 เปลี่ยนชื่อสนาม
  const updateCourtName = async (index, newName) => {
    const newCourts = [...courts];
    newCourts[index].name = newName;

    setCourts(newCourts);

    await saveData({
      namesInput,
      courtCount,
      queue,
      courts: newCourts
    });
  };

  // 🔥 จบรอบสนามเดียว
  const endCourt = async (courtIndex) => {
    const court = courts[courtIndex];

    if (court.loserTeam === null) {
      alert("เลือกทีมแพ้ก่อน");
      return;
    }

    const losers =
      court.loserTeam === 0
        ? court.players.slice(0, 2)
        : court.players.slice(2, 4);

    const loserNames = new Set(losers.map(p => p.name));

    let stay = [];
    let lose = [];
    let out = [];

    court.players.forEach(p => {
      if (loserNames.has(p.name)) {
        lose.push({ ...p, played: 0 });
      } else {
        if (p.played >= 2) {
          out.push({ ...p, played: 0 });
        } else {
          stay.push(p);
        }
      }
    });

    let newQueue = [...queue, ...lose, ...out];

    let nextPlayers = [
      ...stay,
      ...newQueue.splice(0, 4 - stay.length)
    ].map(p => ({
      ...p,
      played: p.played + 1
    }));

    const newCourts = courts.map((c, i) =>
      i === courtIndex
        ? { ...c, players: nextPlayers, loserTeam: null }
        : c
    );

    setQueue(newQueue);
    setCourts(newCourts);

    await saveData({
      namesInput,
      courtCount,
      queue: newQueue,
      courts: newCourts
    });
  };

  const { pairs, leftover } = formatQueue(queue);

  return (
    <div style={{ padding: 20 }}>
      <h1>🏸 Badminton Queue (Realtime)</h1>

      <textarea
        rows={6}
        placeholder="ใส่ชื่อ"
        value={namesInput}
        onChange={(e) => setNamesInput(e.target.value)}
        style={{ width: "100%" }}
      />

      <br /><br />

      <input
        type="number"
        value={courtCount}
        onChange={(e) => setCourtCount(Number(e.target.value))}
      /> สนาม

      <br /><br />

      <button onClick={startGame}>เริ่มเกม</button>

      <hr />

      {courts.map((court, i) => {
        const team1 = court.players?.slice(0, 2) || [];
        const team2 = court.players?.slice(2, 4) || [];

        const isLoser1 = court.loserTeam === 0;
        const isLoser2 = court.loserTeam === 1;

        return (
          <div key={i} style={{ marginBottom: 30 }}>
            {/* 🔥 แก้ชื่อสนาม */}
            <input
              value={court.name || ""}
              onChange={(e) =>
                updateCourtName(i, e.target.value)
              }
              style={{
                fontSize: "18px",
                fontWeight: "bold",
                marginBottom: "10px"
              }}
            />

            <div>
              {court.loserTeam === null
                ? "ยังไม่เลือกทีมแพ้"
                : `เลือกคู่ ${court.loserTeam + 1}`}
            </div>

            {/* คู่ 1 */}
            <div
              onClick={() => selectLoserTeam(i, 0)}
              style={{
                padding: "10px",
                margin: "6px 0",
                borderRadius: "8px",
                background: isLoser1 ? "#ff4d4f" : "#eee",
                cursor: "pointer"
              }}
            >
              <b>คู่ 1 {isLoser1 && "❌"}</b>
              {team1.map(p => (
                <div key={p.name}>
                  {p.name} ({p.played})
                </div>
              ))}
            </div>

            {/* คู่ 2 */}
            <div
              onClick={() => selectLoserTeam(i, 1)}
              style={{
                padding: "10px",
                margin: "6px 0",
                borderRadius: "8px",
                background: isLoser2 ? "#ff4d4f" : "#eee",
                cursor: "pointer"
              }}
            >
              <b>คู่ 2 {isLoser2 && "❌"}</b>
              {team2.map(p => (
                <div key={p.name}>
                  {p.name} ({p.played})
                </div>
              ))}
            </div>

            <button
              onClick={() => endCourt(i)}
              disabled={court.loserTeam === null}
            >
              จบรอบสนามนี้
            </button>
          </div>
        );
      })}

      <hr />

      <h2>⏳ คิวรอ</h2>

      {pairs.map((pair, i) => (
        <div key={i}>
          {i === 0 && "🔥 "}
          {pair[0].name} & {pair[1].name}
        </div>
      ))}

      {leftover && <div>เศษ: {leftover.name}</div>}
    </div>
  );
}