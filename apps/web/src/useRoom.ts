// Room connection: WebSocket with auto-reconnect, event reducer and seq-gap resync (09-system-design §6.3, §9).
import { useEffect, useReducer, useRef } from "react";
import type { ServerEvent, Snapshot } from "@quiz/shared";

export type ConnectionStatus = "connecting" | "open" | "reconnecting" | "unauthorized" | "not-found";

type State = { snapshot: Snapshot | null; status: ConnectionStatus };

type Action = { kind: "event"; event: ServerEvent } | { kind: "status"; status: ConnectionStatus };

function apply(s: Snapshot, e: ServerEvent): Snapshot {
  const next = { ...s, seq: "seq" in e ? e.seq : s.seq };
  switch (e.type) {
    case "SNAPSHOT":
      return e.payload;
    case "PLAYER_JOINED": {
      const others = s.room.players.filter((p) => p.id !== e.payload.player.id);
      return { ...next, room: { ...s.room, players: [...others, e.payload.player] } };
    }
    case "PLAYER_PRESENCE":
      return {
        ...next,
        room: {
          ...s.room,
          players: s.room.players.map((p) => (p.id === e.payload.playerId ? { ...p, connected: e.payload.connected } : p)),
        },
      };
    case "QUESTION_PRESENTED":
      return {
        ...next,
        room: { ...s.room, status: "ACTIVE" },
        question: e.payload.question,
        reveal: null,
        mine: s.you.role === "player" ? { answer: null, correct: null } : null,
      };
    case "ANSWER_COUNT_UPDATED":
      return s.question ? { ...next, question: { ...s.question, ...e.payload } } : next;
    case "QUESTION_REVEALED":
      return { ...next, reveal: e.payload, question: s.question ? { ...s.question, phase: "REVEALED" } : null };
    case "ANSWER_ACCEPTED":
      return s.mine ? { ...next, mine: { ...s.mine, answer: e.payload.optionKey } } : next;
    case "PERSONAL_RESULT":
      return s.mine ? { ...next, mine: { ...s.mine, correct: e.payload.correct } } : next;
  }
}

function reducer(state: State, action: Action): State {
  if (action.kind === "status") return { ...state, status: action.status };
  const e = action.event;
  if (e.type === "SNAPSHOT") return { snapshot: e.payload, status: "open" };
  if (!state.snapshot) return state;
  return { ...state, snapshot: apply(state.snapshot, e) };
}

export function useRoom(code: string, token: string | null) {
  const [state, dispatch] = useReducer(reducer, { snapshot: null, status: "connecting" });
  const lastSeq = useRef<number | null>(null);

  useEffect(() => {
    if (!token) return;
    let ws: WebSocket | null = null;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${location.host}/api/rooms/${code}/ws?token=${encodeURIComponent(token)}`);
      ws.onopen = () => {
        attempt = 0;
      };
      ws.onmessage = (msg) => {
        const event = JSON.parse(String(msg.data)) as ServerEvent;
        if (event.type === "SNAPSHOT") {
          lastSeq.current = event.payload.seq;
        } else if ("seq" in event) {
          if (lastSeq.current !== null && event.seq !== lastSeq.current + 1) {
            // Missed a broadcast: ask the server for a fresh snapshot instead of guessing.
            ws?.send(JSON.stringify({ type: "SYNC" }));
            return;
          }
          lastSeq.current = event.seq;
        }
        dispatch({ kind: "event", event });
      };
      ws.onclose = (e) => {
        if (stopped) return;
        if (e.code === 4401) return dispatch({ kind: "status", status: "unauthorized" });
        if (e.code === 4404) return dispatch({ kind: "status", status: "not-found" });
        dispatch({ kind: "status", status: "reconnecting" });
        const delay = Math.min(5000, 500 * 2 ** attempt++);
        timer = setTimeout(connect, delay);
      };
    };

    // Phones close sockets when the screen locks; reconnect right away when the page is visible again.
    const onVisible = () => {
      if (document.visibilityState === "visible" && ws && ws.readyState === WebSocket.CLOSED) {
        clearTimeout(timer);
        attempt = 0;
        connect();
      }
    };

    connect();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      ws?.close();
    };
  }, [code, token]);

  return state;
}
