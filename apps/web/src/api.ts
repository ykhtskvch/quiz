import type { CreateRoomResponse, HostCommand, JoinResponse, OnboardingInput, OptionKey, QuestionRating, SessionFeedbackInput } from "@quiz/shared";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function call<T>(path: string, init: { token?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? res.statusText);
  return data as T;
}

export const api = {
  createRoom: () => call<CreateRoomResponse>("/rooms"),
  join: (code: string, nickname: string) => call<JoinResponse>(`/rooms/${code}/players`, { body: { nickname } }),
  host: (code: string, token: string, command: HostCommand) => call(`/rooms/${code}/${command}`, { token }),
  onboarding: (code: string, token: string, input: OnboardingInput) => call(`/rooms/${code}/onboarding`, { token, body: input }),
  feedback: (code: string, token: string, input: SessionFeedbackInput) => call(`/rooms/${code}/feedback`, { token, body: input }),
  rateQuestion: (code: string, token: string, number: number, rating: QuestionRating) =>
    call(`/rooms/${code}/question-feedback`, { token, body: { number, rating } }),
  answer: (code: string, token: string, optionKey: OptionKey) =>
    call<{ optionKey: OptionKey }>(`/rooms/${code}/answers`, { token, body: { optionKey } }),
};

// ---------- local session storage (wrapped: storage can be unavailable) ----------

export type PlayerSession = { playerId: string; playerToken: string };

const key = (code: string) => `quiz.player.${code}`;

export const session = {
  load(code: string): PlayerSession | null {
    try {
      const raw = localStorage.getItem(key(code));
      return raw ? (JSON.parse(raw) as PlayerSession) : null;
    } catch {
      return null;
    }
  },
  save(code: string, s: PlayerSession) {
    try {
      localStorage.setItem(key(code), JSON.stringify(s));
    } catch {
      // private mode: the session lives only in memory
    }
  },
  clear(code: string) {
    try {
      localStorage.removeItem(key(code));
    } catch {
      // ignore
    }
  },
};
