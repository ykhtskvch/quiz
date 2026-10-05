// Room connection: WebSocket with auto-reconnect, event reducer and seq-gap resync (09-system-design §6.3, §9).
import { useEffect, useReducer, useRef, useState } from "react";
import type { PhaseTiming, ServerEvent, Snapshot } from "@quiz/shared";

export type ConnectionStatus = "connecting" | "open" | "reconnecting" | "unauthorized" | "not-found";

type State = {
  snapshot: Snapshot | null;
  status: ConnectionStatus;
  /** Local time when the current phase timing arrived; countdowns are relative to it (T-03). */
  timingAt: number;
};

type Action = { kind: "event"; event: ServerEvent; at: number } | { kind: "status"; status: ConnectionStatus };

function withTiming(s: Snapshot, timing: PhaseTiming | null): Snapshot {
  return s.question ? { ...s, question: { ...s.question, timing } } : s;
}

function apply(s: Snapshot, e: ServerEvent): Snapshot {
  const next: Snapshot = { ...s, seq: "seq" in e ? e.seq : s.seq };
  const clearMine = next.mine ? { ...next.mine, answer: null, result: null } : null;
  switch (e.type) {
    case "SNAPSHOT":
      return e.payload;
    case "PLAYER_JOINED": {
      const others = s.room.players.filter((p) => p.id !== e.payload.player.id);
      return { ...next, room: { ...s.room, players: [...others, e.payload.player] } };
    }
    case "PLAYER_STATUS": {
      const { playerId, status, ready } = e.payload;
      const you = s.you.role === "player" && s.you.playerId === playerId ? { ...s.you, status } : s.you;
      return { ...next, you, room: { ...s.room, players: s.room.players.map((p) => (p.id === playerId ? { ...p, status, ready } : p)) } };
    }
    case "GAME_STARTED":
      return {
        ...next,
        room: { ...s.room, status: "ACTIVE" },
        game: { number: e.payload.number, status: "ACTIVE", softEndSuggested: false, totalQuestions: e.payload.totalQuestions },
        question: null,
        reveal: null,
        results: null,
        mine: next.mine ? { answer: null, result: null, total: 0, feedbackGiven: false, ratings: {} } : null,
      };
    case "QUESTION_PRESENTED":
      return { ...next, question: e.payload.question, reveal: null, mine: clearMine };
    case "ANSWER_PHASE_STARTED":
      return s.question
        ? {
            ...next,
            question: { ...s.question, phase: "ANSWERING", options: e.payload.options, timing: e.payload.timing, answered: 0, activePlayers: e.payload.activePlayers },
          }
        : next;
    case "ANSWER_COUNT_UPDATED":
      return s.question ? { ...next, question: { ...s.question, ...e.payload } } : next;
    case "QUESTION_REVEALED":
      return s.question
        ? { ...next, reveal: e.payload.reveal, question: { ...s.question, phase: "REVEALED", timing: e.payload.timing } }
        : next;
    case "QUESTION_SKIPPED":
      return { ...next, question: null, reveal: null, mine: clearMine };
    case "GAME_PAUSED":
      return withTiming({ ...next, game: s.game && { ...s.game, status: "PAUSED" } }, e.payload.timing);
    case "GAME_RESUMED":
      return withTiming({ ...next, game: s.game && { ...s.game, status: "ACTIVE" } }, e.payload.timing);
    case "SOFT_END_SUGGESTED":
      return { ...next, game: s.game && { ...s.game, softEndSuggested: true } };
    case "GAME_FINISHED":
      return { ...next, game: s.game && { ...s.game, status: "FINISHED" }, results: e.payload.results, question: null, reveal: null };
    case "ANSWER_ACCEPTED":
      return s.mine ? { ...next, mine: { ...s.mine, answer: e.payload.optionKey } } : next;
    case "PERSONAL_RESULT":
      return s.mine ? { ...next, mine: { ...s.mine, result: e.payload.result, total: e.payload.total } } : next;
  }
}

const TIMED: ServerEvent["type"][] = ["SNAPSHOT", "QUESTION_PRESENTED", "ANSWER_PHASE_STARTED", "QUESTION_REVEALED", "GAME_PAUSED", "GAME_RESUMED"];

function reducer(state: State, action: Action): State {
  if (action.kind === "status") return { ...state, status: action.status };
  const e = action.event;
  const timingAt = TIMED.includes(e.type) ? action.at : state.timingAt;
  if (e.type === "SNAPSHOT") return { snapshot: e.payload, status: "open", timingAt };
  if (!state.snapshot) return state;
  return { ...state, snapshot: apply(state.snapshot, e), timingAt };
}

export function useRoom(code: string, token: string | null) {
  const [state, dispatch] = useReducer(reducer, { snapshot: null, status: "connecting", timingAt: 0 });
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
          if (lastSeq.current !== null && event.seq <= lastSeq.current) return; // already in the snapshot
          if (lastSeq.current !== null && event.seq !== lastSeq.current + 1) {
            // Missed a broadcast: ask the server for a fresh snapshot instead of guessing.
            ws?.send(JSON.stringify({ type: "SYNC" }));
            return;
          }
          lastSeq.current = event.seq;
        }
        dispatch({ kind: "event", event, at: performance.now() });
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

/** Remaining milliseconds of the current phase, re-rendering ~10×/s. */
export function useCountdown(timing: PhaseTiming | null | undefined, timingAt: number): number | null {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (!timing || timing.paused) return;
    const id = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(id);
  }, [timing]);
  if (!timing) return null;
  if (timing.paused) return timing.remainingMs;
  return Math.max(0, timing.remainingMs - (now - timingAt));
}
