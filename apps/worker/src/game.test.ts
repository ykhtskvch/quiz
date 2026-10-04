import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, type BankQuestion, type GameConfig, type OnboardingInput } from "@quiz/shared";
import { DEFAULT_ENGINE_CONFIG } from "@quiz/engine";
import { newRoomState, Room, type RoomState } from "./game.ts";

const config: GameConfig = {
  ...DEFAULT_CONFIG,
  presentation: { minMs: 3000, perCharMs: 0, maxMs: 3000 },
  answerMs: 15_000,
  revealMs: 10_000,
  skipGapMs: 1000,
  disconnectGraceMs: 25_000,
};

const bank: BankQuestion[] = ["q1", "q2", "q3", "q4"].map((id, i) => ({
  id,
  factId: `fact-${id}`,
  familyId: `f${i}`,
  language: "ru",
  originLanguage: "ru",
  cultureSpecificity: "GLOBAL",
  isBridge: false,
  topics: { [["space", "art", "food", "geography"][i]]: 1 },
  contexts: { GLOBAL: 1 },
  generations: {},
  difficulty: 2,
  dignity: 3,
  effects: {},
  ageSafety: "ALL",
  status: "DRAFT",
  text: `Question ${id}?`,
  options: [
    { key: "A", text: `${id}-a` },
    { key: "B", text: `${id}-b` },
    { key: "C", text: `${id}-c` },
    { key: "D", text: `${id}-d` },
  ],
  correctKey: "B",
  explanation: `Because ${id}`,
}));

const onboarding: OnboardingInput = {
  ageBand: "35_44",
  topics: [{ slug: "space", preference: "LIKE", depth: "EXPERT" }],
  backgrounds: ["POST_SOVIET"],
  dignity: "BALANCE",
};

/** A room with N connected, onboarded players, game started at t=0, first question presenting. */
function setup(nPlayers = 2) {
  const state: RoomState = newRoomState("ABCDEF", "display-hash", 0, config);
  const ids: string[] = [];
  const at = (s: RoomState) => new Room(s, config, bank, DEFAULT_ENGINE_CONFIG, keepOrder);
  for (let i = 0; i < nPlayers; i++) {
    const r = at(state);
    const p = r.join(`P${i}`, `p${i}`, `hash${i}`, 0);
    r.connect(p.id, 0);
    r.submitOnboarding(p.id, onboarding, 0);
    ids.push(p.id);
  }
  const room = () => at(state);
  expect(room().start(ids[0], 0).ok).toBe(true);
  return { state, ids, room };
}

const q = (state: RoomState) => state.game!.questions.at(-1)!;

/** rng ≈ 1 makes the option shuffle an identity, so "B" stays the correct key in these tests. */
const keepOrder = () => 0.999999;

describe("question cycle", () => {
  it("presents, opens answering after the presentation, reveals when everyone answered", () => {
    const { state, ids, room } = setup();
    expect(q(state).phase).toBe("PRESENTING");
    expect(room().answer(ids[0], "B", 1000).ok).toBe(false); // options not open yet

    room().tick(3000);
    expect(q(state).phase).toBe("ANSWERING");

    room().answer(ids[0], "B", 3000);
    expect(q(state).phase).toBe("ANSWERING");
    room().answer(ids[1], "A", 6000);
    expect(q(state).phase).toBe("REVEALED");

    room().tick(16_000);
    expect(q(state).number).toBe(2);
    expect(q(state).phase).toBe("PRESENTING");
  });

  it("reveals on timer expiry when someone did not answer", () => {
    const { state, ids, room } = setup();
    room().tick(3000);
    room().answer(ids[0], "B", 4000);
    room().tick(17_999);
    expect(q(state).phase).toBe("ANSWERING");
    room().tick(18_000);
    expect(q(state).phase).toBe("REVEALED");
  });

  it("scores 1000 + up to 150 for speed, nothing for wrong answers", () => {
    const { state, ids, room } = setup(3);
    room().tick(3000);
    room().answer(ids[0], "B", 3000); // instant
    room().answer(ids[1], "B", 10_500); // half the window
    room().answer(ids[2], "C", 3500); // wrong
    const a = q(state).answers;
    expect(a[ids[0]].base + a[ids[0]].bonus).toBe(1150);
    expect(a[ids[1]].base + a[ids[1]].bonus).toBe(1075);
    expect(a[ids[2]].base + a[ids[2]].bonus).toBe(0);
  });

  it("keeps the first answer on a repeated tap", () => {
    const { ids, room } = setup();
    room().tick(3000);
    room().answer(ids[0], "B", 4000);
    const again = room().answer(ids[0], "C", 4100);
    expect(again.ok && again.value.optionKey).toBe("B");
  });
});

describe("host controls", () => {
  it("pause freezes the timer and resume restores the remaining time", () => {
    const { state, ids, room } = setup();
    room().tick(3000);
    room().pause(ids[0], 8000); // 10s left
    room().tick(100_000);
    expect(q(state).phase).toBe("ANSWERING");
    expect(room().answer(ids[1], "B", 100_000).ok).toBe(false);

    room().resume(ids[0], 200_000);
    room().tick(209_999);
    expect(q(state).phase).toBe("ANSWERING");
    room().tick(210_000);
    expect(q(state).phase).toBe("REVEALED");
  });

  it("skip voids answers, moves on after the gap and never repeats the question", () => {
    const { state, ids, room } = setup();
    room().tick(3000);
    room().answer(ids[0], "B", 4000);
    expect(room().skip(ids[0], 5000).ok).toBe(true);
    expect(state.game!.questions[0].answers[ids[0]].voided).toBe(true);
    room().tick(6000);
    expect(q(state).number).toBe(2);
    expect(q(state).questionId).not.toBe("q1");
  });

  it("only the host can control the game", () => {
    const { ids, room } = setup();
    expect(room().pause(ids[1], 1000)).toMatchObject({ ok: false, status: 403 });
    expect(room().skip(ids[1], 1000)).toMatchObject({ ok: false, status: 403 });
    expect(room().end(ids[1], 1000)).toMatchObject({ ok: false, status: 403 });
  });

  it("end cancels an unrevealed question and excludes it from results", () => {
    const { state, ids, room } = setup();
    room().tick(3000);
    room().answer(ids[0], "B", 3000);
    room().answer(ids[1], "B", 3000); // reveal q1
    room().tick(13_000); // q2 presenting
    room().tick(16_000); // q2 answering
    room().answer(ids[0], "B", 16_000);
    room().end(ids[0], 17_000);

    const results = state.game!.results!;
    expect(state.game!.status).toBe("FINISHED");
    expect(state.game!.questions[1].phase).toBe("CANCELLED");
    expect(results.questionsPlayed).toBe(1);
    expect(results.leaderboard.map((l) => l.score)).toEqual([1150, 1150]);
    expect(state.deadlines.every((d) => d.kind === "EXPIRY")).toBe(true);
  });

  it("play again keeps used questions and facts out", () => {
    const { state, ids, room } = setup();
    const first = q(state).questionId;
    room().end(ids[0], 1000);
    room().playAgain(ids[0], 2000);
    expect(state.game!.number).toBe(2);
    expect(q(state).questionId).not.toBe(first);
    expect(state.usedFactIds).toHaveLength(2);
  });

  it("reshuffles options on every showing and remaps the correct key", () => {
    const state = newRoomState("ABCDEF", "h", 0, config);
    const reverse = (() => {
      const seq = [0, 0, 0, 0.5, 0, 0, 0]; // engine pick, then a permutation
      let i = 0;
      return () => seq[i++ % seq.length];
    })();
    const room = () => new Room(state, config, bank, DEFAULT_ENGINE_CONFIG, reverse);
    for (const id of ["a", "b"]) {
      const p = room().join(id, id, `h${id}`, 0);
      room().connect(p.id, 0);
      room().submitOnboarding(p.id, onboarding, 0);
    }
    room().start(state.players[0].id, 0);
    const run = q(state);
    const original = bank.find((b) => b.id === run.questionId)!;
    const correctText = original.options.find((o) => o.key === original.correctKey)!.text;
    expect(run.options.find((o) => o.key === run.correctKey)!.text).toBe(correctText);
    expect(run.options.map((o) => o.key)).toEqual(["A", "B", "C", "D"]);
  });
});

describe("players", () => {
  it("a disconnected player blocks the reveal only during the grace period", () => {
    const { state, ids, room } = setup();
    room().tick(3000);
    room().disconnect(ids[1], 4000);
    room().answer(ids[0], "B", 5000);
    expect(q(state).phase).toBe("ANSWERING");
    room().tick(29_000); // grace over, before the answer timer
    expect(q(state).phase).toBe("REVEALED");
  });

  it("a late joiner starts from the next question with zero score", () => {
    const { state, room } = setup();
    room().tick(3000);
    const late = room().join("Late", "late", "hash-late", 4000);
    room().connect(late.id, 4000);
    expect(room().snapshot({ role: "player", player: late }, 4100).you).toMatchObject({ status: "ONBOARDING" });
    room().submitOnboarding(late.id, onboarding, 4200);
    expect(room().answer(late.id, "B", 4500)).toMatchObject({ ok: false, status: 409 });
    expect(room().snapshot({ role: "player", player: late }, 4500).you).toMatchObject({ status: "PENDING" });

    room().tick(18_000); // reveal by timer
    room().tick(28_000); // q2
    expect(q(state).number).toBe(2);
    room().tick(31_000);
    expect(room().answer(late.id, "B", 31_000).ok).toBe(true);
  });

  it("hides the single-person stat in rooms with fewer than 4 players", () => {
    for (const [n, shown] of [
      [3, false],
      [4, true],
    ] as const) {
      const { state, ids, room } = setup(n);
      room().tick(3000);
      ids.forEach((id, i) => room().answer(id, i === 0 ? "B" : "C", 3000));
      room().end(ids[0], 5000);
      expect(Boolean(state.game!.results!.stats.onlyOneKnew)).toBe(shown);
    }
  });
});

describe("onboarding", () => {
  it("start needs two players who finished onboarding; stragglers join later", () => {
    const state = newRoomState("ABCDEF", "h", 0, config);
    const room = () => new Room(state, config, bank, DEFAULT_ENGINE_CONFIG, keepOrder);
    const a = room().join("A", "a", "ha", 0);
    const b = room().join("B", "b", "hb", 0);
    const c = room().join("C", "c", "hc", 0);
    for (const p of [a, b, c]) room().connect(p.id, 0);
    room().submitOnboarding(a.id, onboarding, 0);
    expect(room().start(a.id, 0)).toMatchObject({ ok: false, status: 409 });

    room().submitOnboarding(b.id, onboarding, 0);
    expect(room().start(a.id, 0).ok).toBe(true);
    expect(state.game!.profile!.players.map((p) => p.playerId)).toEqual([a.id, b.id]);

    // C finishes onboarding mid-question: plays from the next one and enters the profile.
    room().tick(3000);
    room().submitOnboarding(c.id, onboarding, 4000);
    expect(state.players.find((p) => p.id === c.id)!.activeFrom).toBe(2);
    expect(state.game!.profile!.players).toHaveLength(3);
  });

  it("preferences can change between games but not during one", () => {
    const { ids, room } = setup();
    expect(room().submitOnboarding(ids[0], onboarding, 1000)).toMatchObject({ ok: false, status: 409 });
    room().end(ids[0], 2000);
    expect(room().submitOnboarding(ids[0], { ...onboarding, dignity: "POP" }, 3000).ok).toBe(true);
  });

  it("never broadcasts onboarding answers", () => {
    const state = newRoomState("ABCDEF", "h", 0, config);
    const r = new Room(state, config, bank, DEFAULT_ENGINE_CONFIG, keepOrder);
    const p = r.join("A", "a", "ha", 0);
    r.connect(p.id, 0);
    r.submitOnboarding(p.id, { ...onboarding, ageBand: "13_17" }, 0);
    const broadcast = r.effects.filter((e) => e.to === "all").map((e) => JSON.stringify(e)).join("");
    expect(broadcast).not.toMatch(/13_17|POST_SOVIET|space|BALANCE/);
    const display = JSON.stringify(r.snapshot({ role: "display" }, 0));
    expect(display).not.toMatch(/13_17|POST_SOVIET|BALANCE/);
  });
});

describe("room language", () => {
  it("an English room only ever presents English questions", () => {
    const mixed: BankQuestion[] = [
      ...bank,
      ...bank.map((q) => ({ ...q, id: q.id.replace("q", "en"), language: "en" as const, text: `EN ${q.text}` })),
    ];
    const state = newRoomState("ABCDEF", "h", 0, config, "en");
    const room = () => new Room(state, config, mixed, DEFAULT_ENGINE_CONFIG, keepOrder);
    for (const id of ["a", "b"]) {
      const p = room().join(id, id, `h${id}`, 0);
      room().connect(p.id, 0);
      room().submitOnboarding(p.id, onboarding, 0);
    }
    room().start(state.players[0].id, 0);
    for (let t = 0; state.game!.status !== "FINISHED" && t < 200_000; t += 1000) room().tick(t);
    const shown = state.game!.questions.map((q) => q.questionId);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.every((id) => id.startsWith("en"))).toBe(true);
    expect(room().snapshot({ role: "display" }, 0).room.language).toBe("en");
  });
});

describe("feedback and analytics", () => {
  const analytics = (r: Room) => r.effects.flatMap((e) => (e.to === "analytics" ? [e.event] : []));

  it("emits anonymous per-question stats with distribution by the file's option keys", () => {
    const { ids, room } = setup(3);
    const r = room();
    r.tick(3000);
    r.answer(ids[0], "B", 3000);
    r.answer(ids[1], "B", 4000);
    r.answer(ids[2], "A", 5000);
    const played = analytics(r).find((e) => e.kind === "QUESTION_PLAYED");
    expect(played).toMatchObject({ kind: "QUESTION_PLAYED", answered: 3, correct: 2, distribution: { A: 1, B: 2, C: 0, D: 0 } });
    expect(JSON.stringify(analytics(r))).not.toMatch(/P0|P1|P2|"p0"|"p1"|"p2"|ABCDEF/);
  });

  it("records skips and the end of a game", () => {
    const { ids, room } = setup();
    const r = room();
    r.skip(ids[0], 1000);
    r.tick(2000);
    r.end(ids[0], 3000);
    const kinds = analytics(r).map((e) => e.kind);
    expect(kinds).toEqual(["QUESTION_SKIPPED", "GAME_FINISHED"]);
    expect(analytics(r)[1]).toMatchObject({ endedBy: "HOST", questionsPlayed: 0 });
  });

  it("accepts offboarding once per player after the game, never with a player id", () => {
    const { state, ids, room } = setup();
    expect(room().submitFeedback(ids[0], { playAgain: "YES" }, 1000)).toMatchObject({ ok: false, status: 409 });
    room().tick(3000);
    room().answer(ids[0], "B", 3000);
    room().answer(ids[1], "B", 3000);
    room().end(ids[0], 5000);

    const r = room();
    expect(r.submitFeedback(ids[0], { playAgain: "YES", difficulty: "JUST_RIGHT" }, 6000).ok).toBe(true);
    expect(r.submitFeedback(ids[0], { playAgain: "NO" }, 6100).ok).toBe(true); // idempotent, ignored
    const events = analytics(r);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "SESSION_FEEDBACK", feedback: { playAgain: "YES" } });
    expect(JSON.stringify(events)).not.toContain(ids[0]);
    expect(r.snapshot({ role: "player", player: state.players[0] }, 6200).mine).toMatchObject({ feedbackGiven: true });
  });

  it("lets each player rate a revealed question once", () => {
    const { state, ids, room } = setup();
    room().tick(3000);
    room().answer(ids[0], "B", 3000);
    room().answer(ids[1], "B", 3000);
    room().end(ids[0], 5000);
    expect(state.game!.results!.questions).toEqual([{ number: 1, text: expect.any(String) }]);

    const r = room();
    expect(r.rateQuestion(ids[0], 1, "GREAT", 6000).ok).toBe(true);
    expect(r.rateQuestion(ids[0], 1, "BAD", 6100).ok).toBe(true);
    expect(r.rateQuestion(ids[0], 2, "BAD", 6200)).toMatchObject({ ok: false, status: 404 });
    expect(analytics(r).filter((e) => e.kind === "QUESTION_RATED")).toHaveLength(1);
    expect(r.snapshot({ role: "player", player: state.players[0] }, 6300).mine?.ratings).toEqual({ 1: "GREAT" });
  });
});

describe("privacy and lifecycle", () => {
  it("never sends engine internals (hero target, scores) to any client", () => {
    const { state, ids, room } = setup();
    const r = room();
    r.tick(3000);
    r.answer(ids[0], "B", 3000);
    r.answer(ids[1], "B", 3000);
    expect(state.game!.questions[0].selection).toBeDefined();
    const sent = [...r.effects.map((e) => JSON.stringify(e)), JSON.stringify(r.snapshot({ role: "display" }, 3000))];
    const player = state.players[0];
    sent.push(JSON.stringify(r.snapshot({ role: "player", player }, 3000)));
    for (const s of sent) expect(s).not.toMatch(/heroPlayerId|selection|components|composition|profile/);
  });

  it("never broadcasts the correct key before the reveal", () => {
    const { ids, room } = setup();
    const r = room();
    r.tick(3000);
    r.answer(ids[0], "A", 3000);
    const beforeReveal = r.effects.filter((e) => e.to === "all").map((e) => JSON.stringify(e));
    expect(beforeReveal.some((s) => s.includes("correctKey"))).toBe(false);
  });

  it("closes the room after inactivity", () => {
    const { state, room } = setup();
    const r = room();
    r.tick(config.roomExpiryMs + 1);
    expect(state.closed).toBe(true);
    expect(r.effects.some((e) => e.to === "close")).toBe(true);
  });

  it("keeps seq gapless across broadcasts", () => {
    const { state, ids, room } = setup();
    room().tick(3000);
    room().answer(ids[0], "B", 3000);
    room().answer(ids[1], "B", 3000);
    expect(state.seq).toBeGreaterThan(5);
  });
});
