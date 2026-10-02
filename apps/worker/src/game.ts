// Pure room/game state machine. No I/O: every method takes `now` and records effects,
// so the whole game loop is unit-testable with a fake clock. RoomDO is the thin adapter.
import {
  DEMO_BANK,
  OPTION_KEYS,
  type BroadcastEvent,
  type DemoQuestion,
  type GameConfig,
  type GameResults,
  type GameStatus,
  type OnboardingInput,
  type OptionKey,
  type PersonalResult,
  type PhaseTiming,
  type PlayerStatus,
  type PrivateEvent,
  type PublicPlayer,
  type PublicQuestion,
  type Reveal,
  type Snapshot,
  type StatQuestion,
} from "@quiz/shared";
import { aggregateProfile, playerProfile, type GroupProfile } from "./profile.ts";

export type Player = {
  id: string;
  nickname: string;
  tokenHash: string;
  isHost: boolean;
  joinedAt: number;
  /** First question number (in the current game) this player can answer. Late joiners start at the next one. */
  activeFrom: number;
  /** Private; never broadcast (BR-013). */
  onboarding: OnboardingInput | null;
  connected: boolean;
  disconnectedAt: number | null;
};

export type Answer = { key: OptionKey; responseMs: number; base: number; bonus: number; voided: boolean };

export type QuestionRun = {
  number: number;
  questionId: string;
  familyId: string;
  text: string;
  options: { key: OptionKey; text: string }[];
  correctKey: OptionKey;
  explanation: string;
  phase: "PRESENTING" | "ANSWERING" | "REVEALED" | "SKIPPED" | "CANCELLED";
  presentationMs: number;
  answerMs: number;
  answeringStartedAt: number | null;
  answers: Record<string, Answer>;
};

type PhaseDeadline = "PRESENTATION_END" | "ANSWER_END" | "REVEAL_END" | "NEXT_QUESTION";
export type Deadline =
  | { kind: PhaseDeadline; at: number }
  | { kind: "DISCONNECT_GRACE"; at: number; playerId: string }
  | { kind: "SOFT_END"; at: number }
  | { kind: "EXPIRY"; at: number };

export type Game = {
  number: number;
  status: GameStatus;
  startedAt: number;
  questions: QuestionRun[];
  paused: { kind: PhaseDeadline; remainingMs: number } | null;
  softEndSuggested: boolean;
  results: GameResults | null;
  /** Aggregated private preferences; backend-only input for the Composition Engine. */
  profile: GroupProfile | null;
};

/** Bump when RoomState changes shape; rooms stored in an older shape are treated as closed. */
export const ROOM_STATE_VERSION = 3;

/** `activeFrom` for a player who hasn't finished onboarding during a game. */
export const NOT_YET = Number.MAX_SAFE_INTEGER;

export type RoomState = {
  version: number;
  code: string;
  createdAt: number;
  lastActivityAt: number;
  displayTokenHash: string;
  players: Player[];
  game: Game | null;
  usedQuestionIds: string[];
  deadlines: Deadline[];
  seq: number;
  closed: boolean;
};

export type Effect =
  | { to: "all"; event: BroadcastEvent }
  | { to: "player"; playerId: string; event: PrivateEvent }
  | { to: "close" };

export type Viewer = { role: "display" } | { role: "player"; player: Player };

export type ErrorStatus = 400 | 401 | 403 | 404 | 409;
export type Result<T> = { ok: true; value: T } | { ok: false; status: ErrorStatus; error: string };
const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = (status: ErrorStatus, error: string): Result<never> => ({ ok: false, status, error });

const PHASE_DEADLINES: PhaseDeadline[] = ["PRESENTATION_END", "ANSWER_END", "REVEAL_END", "NEXT_QUESTION"];

export function newRoomState(code: string, displayTokenHash: string, now: number, config: GameConfig): RoomState {
  return {
    version: ROOM_STATE_VERSION,
    code,
    createdAt: now,
    lastActivityAt: now,
    displayTokenHash,
    players: [],
    game: null,
    usedQuestionIds: [],
    deadlines: [{ kind: "EXPIRY", at: now + config.roomExpiryMs }],
    seq: 0,
    closed: false,
  };
}

export class Room {
  readonly effects: Effect[] = [];

  constructor(
    readonly s: RoomState,
    private readonly config: GameConfig,
    private readonly bank: DemoQuestion[] = DEMO_BANK,
  ) {}

  // ================= commands =================

  join(nickname: string, id: string, tokenHash: string, now: number): Player {
    this.touch(now);
    const player: Player = {
      id,
      nickname: this.uniqueNickname(nickname),
      tokenHash,
      isHost: this.s.players.length === 0,
      joinedAt: now,
      activeFrom: this.gameRunning() ? NOT_YET : 1,
      onboarding: null,
      connected: false,
      disconnectedAt: null,
    };
    this.s.players.push(player);
    this.broadcast({ type: "PLAYER_JOINED", seq: 0, payload: { player: this.publicPlayer(player) } });
    return player;
  }

  connect(playerId: string, now: number) {
    const p = this.player(playerId);
    if (!p || p.connected) return;
    p.connected = true;
    p.disconnectedAt = null;
    this.s.deadlines = this.s.deadlines.filter((d) => !(d.kind === "DISCONNECT_GRACE" && d.playerId === playerId));
    this.broadcast({ type: "PLAYER_STATUS", seq: 0, payload: { playerId, status: this.playerStatus(p), ready: Boolean(p.onboarding) } });
    this.broadcastCounts(now);
  }

  disconnect(playerId: string, now: number) {
    const p = this.player(playerId);
    if (!p || !p.connected) return;
    p.connected = false;
    p.disconnectedAt = now;
    this.s.deadlines.push({ kind: "DISCONNECT_GRACE", at: now + this.config.disconnectGraceMs, playerId });
    this.broadcast({ type: "PLAYER_STATUS", seq: 0, payload: { playerId, status: "DISCONNECTED", ready: Boolean(p.onboarding) } });
  }

  submitOnboarding(playerId: string, input: OnboardingInput, now: number): Result<true> {
    const p = this.player(playerId);
    if (!p) return fail(401, "invalid token");
    // Preferences can change between games, not in the middle of one.
    if (this.gameRunning() && p.onboarding) return fail(409, "game in progress");
    this.touch(now);
    p.onboarding = input;
    if (this.gameRunning() && p.activeFrom === NOT_YET) {
      p.activeFrom = (this.currentQuestion()?.number ?? 0) + 1;
      this.s.game!.profile = this.buildProfile(); // late join updates future selection (Engine §14)
    }
    this.broadcast({ type: "PLAYER_STATUS", seq: 0, payload: { playerId, status: this.playerStatus(p), ready: Boolean(p.onboarding) } });
    return ok(true);
  }

  start(hostId: string, now: number): Result<true> {
    const host = this.requireHost(hostId);
    if (!host.ok) return host;
    if (this.s.game) return fail(409, "game already started");
    if (this.readyPlayers().length < this.config.minPlayers) return fail(409, `need at least ${this.config.minPlayers} ready players`);
    this.touch(now);
    // Players still filling in onboarding join from the question after they finish.
    for (const p of this.s.players) p.activeFrom = p.onboarding ? 1 : NOT_YET;
    this.newGame(1, now);
    return ok(true);
  }

  playAgain(hostId: string, now: number): Result<true> {
    const host = this.requireHost(hostId);
    if (!host.ok) return host;
    if (this.s.game?.status !== "FINISHED") return fail(409, "game not finished");
    if (this.readyPlayers().length < this.config.minPlayers) return fail(409, `need at least ${this.config.minPlayers} ready players`);
    this.touch(now);
    for (const p of this.s.players) p.activeFrom = p.onboarding ? 1 : NOT_YET;
    this.newGame(this.s.game.number + 1, now);
    return ok(true);
  }

  answer(playerId: string, key: OptionKey, now: number): Result<{ optionKey: OptionKey }> {
    const p = this.player(playerId);
    if (!p) return fail(401, "invalid token");
    const q = this.currentQuestion();
    if (this.s.game?.status !== "ACTIVE" || !q || q.phase !== "ANSWERING") return fail(409, "question closed");
    if (!q.options.some((o) => o.key === key)) return fail(400, "unknown option");
    if (p.activeFrom > q.number) return fail(409, "you join from the next question");

    // Idempotent: a repeated tap returns the first accepted answer (07-api §7.3).
    const existing = q.answers[playerId];
    if (existing) return ok({ optionKey: existing.key });

    this.touch(now);
    q.answers[playerId] = { key, responseMs: Math.max(0, now - (q.answeringStartedAt ?? now)), base: 0, bonus: 0, voided: false };
    this.private(playerId, { type: "ANSWER_ACCEPTED", payload: { optionKey: key } });
    this.broadcastCounts(now);
    if (this.allAnswered(q, now)) this.closeAnswering(q, now);
    return ok({ optionKey: key });
  }

  pause(hostId: string, now: number): Result<true> {
    const host = this.requireHost(hostId);
    if (!host.ok) return host;
    const g = this.s.game;
    if (g?.status !== "ACTIVE") return fail(409, "game not running");
    this.touch(now);
    const phase = this.s.deadlines.find((d): d is Deadline & { kind: PhaseDeadline } => PHASE_DEADLINES.includes(d.kind as PhaseDeadline));
    g.paused = phase ? { kind: phase.kind, remainingMs: Math.max(0, phase.at - now) } : null;
    this.clearPhaseDeadlines();
    g.status = "PAUSED";
    this.broadcast({ type: "GAME_PAUSED", seq: 0, payload: { timing: this.timing(now) } });
    return ok(true);
  }

  resume(hostId: string, now: number): Result<true> {
    const host = this.requireHost(hostId);
    if (!host.ok) return host;
    const g = this.s.game;
    if (g?.status !== "PAUSED") return fail(409, "game not paused");
    this.touch(now);
    if (g.paused) this.s.deadlines.push({ kind: g.paused.kind, at: now + g.paused.remainingMs });
    g.paused = null;
    g.status = "ACTIVE";
    this.broadcast({ type: "GAME_RESUMED", seq: 0, payload: { timing: this.timing(now) } });
    return ok(true);
  }

  /** D-10: allowed while presenting or answering; all answers are voided; the fact stays used. */
  skip(hostId: string, now: number): Result<true> {
    const host = this.requireHost(hostId);
    if (!host.ok) return host;
    const q = this.currentQuestion();
    if (this.s.game?.status !== "ACTIVE") return fail(409, "game not running");
    if (!q || (q.phase !== "PRESENTING" && q.phase !== "ANSWERING")) return fail(409, "nothing to skip");
    this.touch(now);
    this.voidQuestion(q, "SKIPPED");
    this.clearPhaseDeadlines();
    this.broadcast({ type: "QUESTION_SKIPPED", seq: 0, payload: { number: q.number } });
    this.s.deadlines.push({ kind: "NEXT_QUESTION", at: now + this.config.skipGapMs });
    return ok(true);
  }

  /** D-11: any time; an unrevealed question is cancelled like a skip. */
  end(hostId: string, now: number): Result<true> {
    const host = this.requireHost(hostId);
    if (!host.ok) return host;
    const g = this.s.game;
    if (!g || g.status === "FINISHED") return fail(409, "no game in progress");
    this.touch(now);
    const q = this.currentQuestion();
    if (q && (q.phase === "PRESENTING" || q.phase === "ANSWERING")) this.voidQuestion(q, "CANCELLED");
    this.finishGame();
    return ok(true);
  }

  /** Processes every deadline that is due. Called from the Durable Object alarm. */
  tick(now: number) {
    for (;;) {
      const due = this.s.deadlines.filter((d) => d.at <= now).sort((a, b) => a.at - b.at)[0];
      if (!due) return;
      this.s.deadlines.splice(this.s.deadlines.indexOf(due), 1);
      this.fire(due, now);
      if (this.s.closed) return;
    }
  }

  nextAlarm(): number | null {
    return this.s.deadlines.length ? Math.min(...this.s.deadlines.map((d) => d.at)) : null;
  }

  // ================= views =================

  snapshot(viewer: Viewer, now: number): Snapshot {
    const g = this.s.game;
    const q = this.currentQuestion();
    const me = viewer.role === "player" ? viewer.player : null;
    const myAnswer = me && q ? q.answers[me.id] : undefined;
    return {
      you: me
        ? {
            role: "player",
            playerId: me.id,
            nickname: me.nickname,
            isHost: me.isHost,
            status: this.playerStatus(me),
            onboarding: me.onboarding,
          }
        : { role: "display" },
      room: { code: this.s.code, status: this.roomStatus(), players: this.s.players.map((p) => this.publicPlayer(p)) },
      game: g ? { number: g.number, status: g.status, softEndSuggested: g.softEndSuggested } : null,
      question: g?.status === "FINISHED" ? null : this.publicQuestion(now),
      reveal: q?.phase === "REVEALED" && g?.status !== "FINISHED" ? this.revealData(q) : null,
      mine: me
        ? {
            answer: myAnswer && !myAnswer.voided ? myAnswer.key : null,
            result: q?.phase === "REVEALED" && myAnswer ? this.personalResult(q, myAnswer) : null,
            total: this.totalScore(me.id),
          }
        : null,
      results: g?.status === "FINISHED" ? g.results : null,
      seq: this.s.seq,
    };
  }

  // ================= internals =================

  private fire(d: Deadline, now: number) {
    const q = this.currentQuestion();
    switch (d.kind) {
      case "PRESENTATION_END":
        if (q?.phase === "PRESENTING") this.openAnswering(q, now);
        return;
      case "ANSWER_END":
        if (q?.phase === "ANSWERING") this.closeAnswering(q, now);
        return;
      case "REVEAL_END":
      case "NEXT_QUESTION":
        if (this.s.game?.status === "ACTIVE") this.presentNext(now);
        return;
      case "DISCONNECT_GRACE": {
        // The player now stops counting as active; the question may be complete without them.
        this.broadcastCounts(now);
        if (q?.phase === "ANSWERING" && this.allAnswered(q, now)) this.closeAnswering(q, now);
        return;
      }
      case "SOFT_END":
        if (this.s.game && this.s.game.status !== "FINISHED") {
          this.s.game.softEndSuggested = true;
          this.broadcast({ type: "SOFT_END_SUGGESTED", seq: 0, payload: {} });
        }
        return;
      case "EXPIRY":
        this.s.closed = true;
        this.effects.push({ to: "close" });
        return;
    }
  }

  private newGame(number: number, now: number) {
    this.s.game = {
      number,
      status: "ACTIVE",
      startedAt: now,
      questions: [],
      paused: null,
      softEndSuggested: false,
      results: null,
      profile: this.buildProfile(),
    };
    this.s.deadlines = this.s.deadlines.filter((d) => d.kind === "EXPIRY" || d.kind === "DISCONNECT_GRACE");
    this.s.deadlines.push({ kind: "SOFT_END", at: now + this.config.softEndAfterMs });
    this.broadcast({ type: "GAME_STARTED", seq: 0, payload: { number } });
    this.presentNext(now);
  }

  private presentNext(now: number) {
    const g = this.s.game!;
    const prev = g.questions.at(-1);
    const used = new Set(this.s.usedQuestionIds);
    const next =
      this.bank.find((q) => !used.has(q.id) && q.familyId !== prev?.familyId) ?? this.bank.find((q) => !used.has(q.id));
    if (!next) return this.finishGame(); // bank exhausted

    const number = (prev?.number ?? 0) + 1;
    const { minMs, perCharMs, maxMs } = this.config.presentation;
    const run: QuestionRun = {
      number,
      questionId: next.id,
      familyId: next.familyId,
      text: next.text,
      options: next.options,
      correctKey: next.correctKey,
      explanation: next.explanation,
      phase: "PRESENTING",
      presentationMs: Math.min(maxMs, Math.max(minMs, next.text.length * perCharMs)),
      answerMs: next.answerMs ?? this.config.answerMs,
      answeringStartedAt: null,
      answers: {},
    };
    g.questions.push(run);
    this.s.usedQuestionIds.push(next.id); // presented = consumed (BR-134)
    this.s.deadlines.push({ kind: "PRESENTATION_END", at: now + run.presentationMs });

    for (const p of this.s.players) {
      if (p.activeFrom === number && number > 1) {
        this.broadcast({ type: "PLAYER_STATUS", seq: 0, payload: { playerId: p.id, status: this.playerStatus(p), ready: Boolean(p.onboarding) } });
      }
    }
    this.broadcast({ type: "QUESTION_PRESENTED", seq: 0, payload: { question: this.publicQuestion(now)! } });
  }

  private openAnswering(q: QuestionRun, now: number) {
    q.phase = "ANSWERING";
    q.answeringStartedAt = now;
    this.s.deadlines.push({ kind: "ANSWER_END", at: now + q.answerMs });
    this.broadcast({
      type: "ANSWER_PHASE_STARTED",
      seq: 0,
      payload: { options: q.options, timing: this.timing(now)!, activePlayers: this.activePlayers(q, now).length },
    });
  }

  private closeAnswering(q: QuestionRun, now: number) {
    this.clearPhaseDeadlines();
    q.phase = "REVEALED";
    for (const a of Object.values(q.answers)) {
      const correct = a.key === q.correctKey;
      a.base = correct ? this.config.baseScore : 0;
      const remaining = Math.max(0, 1 - a.responseMs / q.answerMs);
      a.bonus = correct ? Math.round(this.config.speedBonusMax * remaining) : 0;
    }
    this.s.deadlines.push({ kind: "REVEAL_END", at: now + this.config.revealMs });
    this.broadcast({ type: "QUESTION_REVEALED", seq: 0, payload: { reveal: this.revealData(q), timing: this.timing(now)! } });
    for (const [playerId, a] of Object.entries(q.answers)) {
      this.private(playerId, { type: "PERSONAL_RESULT", payload: { result: this.personalResult(q, a), total: this.totalScore(playerId) } });
    }
  }

  private voidQuestion(q: QuestionRun, phase: "SKIPPED" | "CANCELLED") {
    q.phase = phase;
    for (const a of Object.values(q.answers)) {
      a.voided = true;
      a.base = 0;
      a.bonus = 0;
    }
  }

  private finishGame() {
    const g = this.s.game!;
    this.clearPhaseDeadlines();
    this.s.deadlines = this.s.deadlines.filter((d) => d.kind !== "SOFT_END");
    g.status = "FINISHED";
    g.paused = null;
    g.results = this.computeResults();
    this.broadcast({ type: "GAME_FINISHED", seq: 0, payload: { results: g.results } });
  }

  private computeResults(): GameResults {
    const g = this.s.game!;
    const revealed = g.questions.filter((q) => q.phase === "REVEALED");
    const stat = (q: QuestionRun): StatQuestion => ({
      number: q.number,
      text: q.text,
      correctText: q.options.find((o) => o.key === q.correctKey)!.text,
    });

    const leaderboard = this.s.players
      .filter((p) => p.onboarding && p.activeFrom !== NOT_YET)
      .map((p) => {
        const mine = revealed.map((q) => q.answers[p.id]).filter((a): a is Answer => Boolean(a));
        return {
          playerId: p.id,
          nickname: p.nickname,
          score: mine.reduce((sum, a) => sum + a.base + a.bonus, 0),
          correct: mine.filter((a) => a.base > 0).length,
          attempted: revealed.filter((q) => q.number >= p.activeFrom).length,
        };
      })
      .sort((a, b) => b.score - a.score || b.correct - a.correct);

    const rows = revealed
      .map((q) => {
        const answers = Object.values(q.answers);
        const correct = answers.filter((a) => a.key === q.correctKey).length;
        const counts = OPTION_KEYS.map((k) => answers.filter((a) => a.key === k).length);
        const entropy = counts.reduce((h, c) => (c ? h - (c / answers.length) * Math.log2(c / answers.length) : h), 0);
        return { q, answered: answers.length, correct, rate: answers.length ? correct / answers.length : 0, entropy };
      })
      .filter((r) => r.answered > 0);

    const pick = <T>(xs: T[], better: (a: T, b: T) => boolean) => xs.reduce<T | null>((best, x) => (!best || better(x, best) ? x : best), null);
    const hardest = pick(rows.filter((r) => r.answered >= 2 && r.rate < 1), (a, b) => a.rate < b.rate);
    const everyone = pick(rows.filter((r) => r.answered >= 2 && r.correct === r.answered), (a, b) => a.answered > b.answered);
    const divided = pick(rows.filter((r) => r.answered >= 3 && r.entropy > 0), (a, b) => a.entropy > b.entropy);
    const participants = leaderboard.filter((l) => l.attempted > 0).length;
    const onlyOne =
      participants >= this.config.singlePersonStatsMinPlayers
        ? pick(rows.filter((r) => r.correct === 1 && r.answered >= 3), (a, b) => a.answered > b.answered)
        : null;

    let fastest: GameResults["stats"]["fastestCorrect"] = null;
    for (const q of revealed) {
      for (const [playerId, a] of Object.entries(q.answers)) {
        if (a.key !== q.correctKey || (fastest && a.responseMs >= fastest.responseMs)) continue;
        fastest = { nickname: this.player(playerId)?.nickname ?? "?", responseMs: a.responseMs, question: stat(q) };
      }
    }

    return {
      leaderboard,
      stats: {
        hardest: hardest && stat(hardest.q),
        everyoneKnew: everyone && stat(everyone.q),
        mostDivided: divided && stat(divided.q),
        onlyOneKnew: onlyOne && stat(onlyOne.q),
        fastestCorrect: fastest,
      },
      questionsPlayed: revealed.length,
    };
  }

  private publicQuestion(now: number): PublicQuestion | null {
    const q = this.currentQuestion();
    if (!q || q.phase === "SKIPPED" || q.phase === "CANCELLED") return null;
    return {
      number: q.number,
      text: q.text,
      phase: q.phase,
      options: q.phase === "PRESENTING" ? null : q.options,
      answered: Object.keys(q.answers).length,
      activePlayers: this.activePlayers(q, now).length,
      timing: this.timing(now),
    };
  }

  private timing(now: number): PhaseTiming | null {
    const g = this.s.game;
    const q = this.currentQuestion();
    if (!g || !q) return null;
    const durationMs =
      q.phase === "PRESENTING" ? q.presentationMs : q.phase === "ANSWERING" ? q.answerMs : q.phase === "REVEALED" ? this.config.revealMs : null;
    if (durationMs === null) return null;
    if (g.status === "PAUSED") return { durationMs, remainingMs: g.paused?.remainingMs ?? 0, paused: true };
    const kind: PhaseDeadline = q.phase === "PRESENTING" ? "PRESENTATION_END" : q.phase === "ANSWERING" ? "ANSWER_END" : "REVEAL_END";
    const d = this.s.deadlines.find((x) => x.kind === kind);
    return { durationMs, remainingMs: d ? Math.max(0, d.at - now) : 0, paused: false };
  }

  private revealData(q: QuestionRun): Reveal {
    const distribution: Record<OptionKey, number> = { A: 0, B: 0, C: 0, D: 0 };
    for (const a of Object.values(q.answers)) distribution[a.key]++;
    return { correctKey: q.correctKey, explanation: q.explanation, distribution };
  }

  private personalResult(q: QuestionRun, a: Answer): PersonalResult {
    return { correct: a.key === q.correctKey, baseScore: a.base, speedBonus: a.bonus, points: a.base + a.bonus };
  }

  private totalScore(playerId: string): number {
    const g = this.s.game;
    if (!g) return 0;
    return g.questions.reduce((sum, q) => {
      const a = q.answers[playerId];
      return q.phase === "REVEALED" && a ? sum + a.base + a.bonus : sum;
    }, 0);
  }

  private activePlayers(q: QuestionRun, now: number): Player[] {
    return this.s.players.filter(
      (p) =>
        p.activeFrom <= q.number &&
        (p.connected || (p.disconnectedAt !== null && now - p.disconnectedAt < this.config.disconnectGraceMs)),
    );
  }

  private allAnswered(q: QuestionRun, now: number): boolean {
    const active = this.activePlayers(q, now);
    return active.length > 0 && active.every((p) => q.answers[p.id]);
  }

  private broadcastCounts(now: number) {
    const q = this.currentQuestion();
    if (q?.phase === "ANSWERING") {
      this.broadcast({
        type: "ANSWER_COUNT_UPDATED",
        seq: 0,
        payload: { answered: Object.keys(q.answers).length, activePlayers: this.activePlayers(q, now).length },
      });
    }
  }

  private playerStatus(p: Player): PlayerStatus {
    if (!p.connected) return "DISCONNECTED";
    if (!p.onboarding) return "ONBOARDING";
    if (this.gameRunning() && p.activeFrom > (this.currentQuestion()?.number ?? 0)) return "PENDING";
    return "ACTIVE";
  }

  private gameRunning(): boolean {
    return Boolean(this.s.game && this.s.game.status !== "FINISHED");
  }

  private readyPlayers(): Player[] {
    return this.s.players.filter((p) => p.onboarding);
  }

  private buildProfile(): GroupProfile {
    return aggregateProfile(this.readyPlayers().map((p) => playerProfile(p.id, p.onboarding!)));
  }

  private publicPlayer(p: Player): PublicPlayer {
    return { id: p.id, nickname: p.nickname, isHost: p.isHost, status: this.playerStatus(p), ready: Boolean(p.onboarding) };
  }

  private roomStatus() {
    return this.s.closed ? "CLOSED" : this.s.game ? "ACTIVE" : "WAITING";
  }

  private currentQuestion(): QuestionRun | null {
    return this.s.game?.questions.at(-1) ?? null;
  }

  private player(id: string): Player | undefined {
    return this.s.players.find((p) => p.id === id);
  }

  private requireHost(playerId: string): Result<Player> {
    const p = this.player(playerId);
    if (!p) return fail(401, "invalid token");
    if (!p.isHost) return fail(403, "host only");
    return ok(p);
  }

  private uniqueNickname(raw: string): string {
    const base = raw;
    let nickname = base;
    for (let i = 2; this.s.players.some((p) => p.nickname.toLowerCase() === nickname.toLowerCase()); i++) nickname = `${base} ${i}`;
    return nickname;
  }

  private clearPhaseDeadlines() {
    this.s.deadlines = this.s.deadlines.filter((d) => !PHASE_DEADLINES.includes(d.kind as PhaseDeadline));
  }

  private touch(now: number) {
    this.s.lastActivityAt = now;
    this.s.deadlines = this.s.deadlines.filter((d) => d.kind !== "EXPIRY");
    this.s.deadlines.push({ kind: "EXPIRY", at: now + this.config.roomExpiryMs });
  }

  private broadcast(event: BroadcastEvent) {
    event.seq = ++this.s.seq;
    this.effects.push({ to: "all", event });
  }

  private private(playerId: string, event: PrivateEvent) {
    this.effects.push({ to: "player", playerId, event });
  }
}
