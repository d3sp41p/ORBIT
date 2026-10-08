import { BALANCE } from "@orbit/core";

export default function Home() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        textAlign: "center",
        padding: 24,
      }}
    >
      <div>
        <p
          style={{
            fontFamily: "var(--mono)",
            letterSpacing: "0.2em",
            fontSize: 12,
            color: "var(--accent)",
          }}
        >
          ORBIT · DEEP SPACE NETWORK
        </p>
        <h1 style={{ fontWeight: 300, margin: "12px 0" }}>Every holder is a world.</h1>
        <p style={{ fontFamily: "var(--mono)", fontSize: 12, opacity: 0.6 }}>
          SYSTEM INITIALIZING · TICK {BALANCE.tickHours}H
        </p>
      </div>
    </main>
  );
}
