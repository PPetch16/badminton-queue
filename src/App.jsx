import { useState } from "react";

function shuffle(arr) {
  return [...arr].sort(() => Math.random() - 0.5);
}

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

  // 🚀 เริ่มเกม
  const startGame = () => {
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
        players: playersInCourt,
        loserTeam: null
      });
    }

    setQueue(q);
    setCourts(newCourts);
  };

  // 🔥 เลือกทีมแพ้
  const selectLoserTeam = (courtIndex, teamIndex) => {
    setCourts(prev =>
      prev.map((court, i) =>
        i === courtIndex
          ? {
              ...court,
              loserTeam:
                court.loserTeam === teamIndex ? null : teamIndex
            }
          : court
      )
    );
  };

  // 🔥 จบรอบสนามเดียว
  const endCourt = (courtIndex) => {
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

    setCourts(prev =>
      prev.map((c, i) =>
        i === courtIndex
          ? { players: nextPlayers, loserTeam: null }
          : c
      )
    );

    setQueue(newQueue);
  };

  // 🔥 format queue เป็นคู่
  const { pairs, leftover } = formatQueue(queue);

  return (
    <div style={{ padding: 20, fontFamily: "sans-serif" }}>
      <h1>🏸 Badminton Queue (Multi Court)</h1>

      <textarea
        rows={8}
        placeholder="ใส่ชื่อ (1 บรรทัด ต่อ 1 คน)"
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
        const team1 = court.players.slice(0, 2);
        const team2 = court.players.slice(2, 4);

        const isLoser1 = court.loserTeam === 0;
        const isLoser2 = court.loserTeam === 1;

        return (
          <div key={i} style={{ marginBottom: 30 }}>
            <h2>🏟️ สนาม {i + 1}</h2>

            <div>
              สถานะ:{" "}
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
              style={{
                marginTop: "10px",
                background:
                  court.loserTeam !== null ? "black" : "gray",
                color: "white",
                padding: "8px 12px",
                border: "none",
                cursor:
                  court.loserTeam !== null
                    ? "pointer"
                    : "not-allowed"
              }}
            >
              จบรอบสนามนี้
            </button>
          </div>
        );
      })}

      <hr />

      <h2>⏳ คิวรอ</h2>

      {/* 🔥 แสดงเป็นคู่ */}
      {pairs.map((pair, i) => (
        <div key={i}>
          {i === 0 && "🔥 "}
          {pair[0].name} & {pair[1].name}
        </div>
      ))}

      {/* 🔥 เศษ */}
      {leftover && (
        <div style={{ marginTop: "8px", color: "red" }}>
          เศษ: {leftover.name}
        </div>
      )}
    </div>
  );
}