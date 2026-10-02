// Wire protocol between RoomDO and clients — docs/spec-v0.2/07-api-realtime.md.
// Events are past tense; commands go over HTTP. Only broadcast events carry `seq`.
import type { OnboardingInput } from "./onboarding.ts";

export type OptionKey = "A" | "B" | "C" | "D";
export const OPTION_KEYS: OptionKey[] = ["A", "B", "C", "D"];

export type RoomStatus = "WAITING" | "ACTIVE" | "CLOSED";
export type GameStatus = "ACTIVE" | "PAUSED" | "FINISHED";
export type QuestionPhase = "PRESENTING" | "ANSWERING" | "REVEALED";
/** ONBOARDING: joined, private onboarding not finished. PENDING: plays from the next question. */
export type PlayerStatus = "ONBOARDING" | "PENDING" | "ACTIVE" | "DISCONNECTED";

/** `ready` = finished onboarding; independent of connection status. */
export type PublicPlayer = { id: string; nickname: string; isHost: boolean; status: PlayerStatus; ready: boolean };

/**
 * Countdown for the current phase. Clients render `remainingMs` relative to the moment they
 * received the message, so phone clocks don't matter (T-03).
 */
export type PhaseTiming = { durationMs: number; remainingMs: number; paused: boolean };

/** What every client may see about the current question. Never contains the correct key before reveal. */
export type PublicQuestion = {
  number: number;
  text: string;
  phase: QuestionPhase;
  /** Hidden during PRESENTING (BR-058). */
  options: { key: OptionKey; text: string }[] | null;
  answered: number;
  activePlayers: number;
  timing: PhaseTiming | null;
};

export type Reveal = {
  correctKey: OptionKey;
  explanation: string;
  distribution: Record<OptionKey, number>;
};

export type PersonalResult = { correct: boolean; baseScore: number; speedBonus: number; points: number };

export type StatQuestion = { number: number; text: string; correctText: string };

export type GameResults = {
  leaderboard: { playerId: string; nickname: string; score: number; correct: number; attempted: number }[];
  stats: {
    hardest: StatQuestion | null;
    everyoneKnew: StatQuestion | null;
    mostDivided: StatQuestion | null;
    /** No name on purpose (D-09); omitted in rooms with fewer than 4 players (BR-129). */
    onlyOneKnew: StatQuestion | null;
    fastestCorrect: { nickname: string; responseMs: number; question: StatQuestion } | null;
  };
  questionsPlayed: number;
};

export type Snapshot = {
  you:
    | { role: "display" }
    | {
        role: "player";
        playerId: string;
        nickname: string;
        isHost: boolean;
        status: PlayerStatus;
        /** Own answers only — lets the phone prefill "change my preferences". */
        onboarding: OnboardingInput | null;
      };
  room: { code: string; status: RoomStatus; players: PublicPlayer[] };
  game: { number: number; status: GameStatus; softEndSuggested: boolean } | null;
  question: PublicQuestion | null;
  reveal: Reveal | null;
  /** Player-only: own answer/result for the current question and running total. */
  mine: { answer: OptionKey | null; result: PersonalResult | null; total: number } | null;
  results: GameResults | null;
  seq: number;
};

export type ServerEvent =
  | { type: "SNAPSHOT"; payload: Snapshot }
  | { type: "PLAYER_JOINED"; seq: number; payload: { player: PublicPlayer } }
  | { type: "PLAYER_STATUS"; seq: number; payload: { playerId: string; status: PlayerStatus; ready: boolean } }
  | { type: "GAME_STARTED"; seq: number; payload: { number: number } }
  | { type: "QUESTION_PRESENTED"; seq: number; payload: { question: PublicQuestion } }
  | { type: "ANSWER_PHASE_STARTED"; seq: number; payload: { options: { key: OptionKey; text: string }[]; timing: PhaseTiming; activePlayers: number } }
  | { type: "ANSWER_COUNT_UPDATED"; seq: number; payload: { answered: number; activePlayers: number } }
  | { type: "QUESTION_REVEALED"; seq: number; payload: { reveal: Reveal; timing: PhaseTiming } }
  | { type: "QUESTION_SKIPPED"; seq: number; payload: { number: number } }
  | { type: "GAME_PAUSED"; seq: number; payload: { timing: PhaseTiming | null } }
  | { type: "GAME_RESUMED"; seq: number; payload: { timing: PhaseTiming | null } }
  | { type: "SOFT_END_SUGGESTED"; seq: number; payload: Record<string, never> }
  | { type: "GAME_FINISHED"; seq: number; payload: { results: GameResults } }
  // private
  | { type: "ANSWER_ACCEPTED"; payload: { optionKey: OptionKey } }
  | { type: "PERSONAL_RESULT"; payload: { result: PersonalResult; total: number } };

export type BroadcastEvent = Extract<ServerEvent, { seq: number }>;
export type PrivateEvent = Exclude<ServerEvent, { seq: number } | { type: "SNAPSHOT" }>;

/** Client → server over WebSocket: only a resync request. Everything else is HTTP. */
export type ClientMessage = { type: "SYNC" };

// ---------- HTTP ----------

export type CreateRoomResponse = { roomCode: string; displayToken: string };
export type JoinRequest = { nickname: string };
export type JoinResponse = { playerId: string; playerToken: string; isHost: boolean };
export type AnswerRequest = { optionKey: OptionKey };
export type ApiError = { error: string };
export type HostCommand = "start" | "pause" | "resume" | "skip" | "end" | "play-again";

export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I
export const ROOM_CODE_LENGTH = 6;
export const NICKNAME_MAX = 20;

export const isRoomCode = (s: string) =>
  s.length === ROOM_CODE_LENGTH && [...s].every((c) => ROOM_CODE_ALPHABET.includes(c));
