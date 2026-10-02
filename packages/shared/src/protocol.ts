// Wire protocol between RoomDO and clients — docs/spec-v0.2/07-api-realtime.md.
// Events are past tense; commands go over HTTP. Only broadcast events carry `seq`.

export type OptionKey = "A" | "B" | "C" | "D";
export type Role = "display" | "player";
export type RoomStatus = "WAITING" | "ACTIVE" | "FINISHED";
export type QuestionPhase = "ANSWERING" | "REVEALED";

export type PublicPlayer = { id: string; nickname: string; isHost: boolean; connected: boolean };

/** What every client may see about the current question. Never contains the correct key before reveal. */
export type PublicQuestion = {
  id: string;
  number: number;
  text: string;
  options: { key: OptionKey; text: string }[];
  phase: QuestionPhase;
  answered: number;
  activePlayers: number;
};

export type Reveal = {
  correctKey: OptionKey;
  explanation: string;
  distribution: Record<OptionKey, number>;
};

export type Snapshot = {
  you: { role: "display" } | { role: "player"; playerId: string; nickname: string; isHost: boolean };
  room: { code: string; status: RoomStatus; players: PublicPlayer[] };
  question: PublicQuestion | null;
  reveal: Reveal | null;
  /** Player-only: own answer and result for the current question. */
  mine: { answer: OptionKey | null; correct: boolean | null } | null;
  seq: number;
};

export type ServerEvent =
  | { type: "SNAPSHOT"; payload: Snapshot }
  | { type: "PLAYER_JOINED"; seq: number; payload: { player: PublicPlayer } }
  | { type: "PLAYER_PRESENCE"; seq: number; payload: { playerId: string; connected: boolean } }
  | { type: "QUESTION_PRESENTED"; seq: number; payload: { question: PublicQuestion } }
  | { type: "ANSWER_COUNT_UPDATED"; seq: number; payload: { answered: number; activePlayers: number } }
  | { type: "QUESTION_REVEALED"; seq: number; payload: Reveal }
  // private
  | { type: "ANSWER_ACCEPTED"; payload: { optionKey: OptionKey } }
  | { type: "PERSONAL_RESULT"; payload: { correct: boolean } };

/** Client → server over WebSocket: only a resync request. Everything else is HTTP. */
export type ClientMessage = { type: "SYNC" };

// ---------- HTTP ----------

export type CreateRoomResponse = { roomCode: string; displayToken: string };
export type JoinRequest = { nickname: string };
export type JoinResponse = { playerId: string; playerToken: string; isHost: boolean };
export type AnswerRequest = { optionKey: OptionKey };
export type ApiError = { error: string };

export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I
export const ROOM_CODE_LENGTH = 6;
export const NICKNAME_MAX = 20;

export const isRoomCode = (s: string) =>
  s.length === ROOM_CODE_LENGTH && [...s].every((c) => ROOM_CODE_ALPHABET.includes(c));
