// UI strings for both room languages (EPIC 36). The active language comes from the room
// (D-02); before a room is known it follows the home-page choice / browser language.
import { useSyncExternalStore } from "react";
import type { Language } from "@quiz/shared";

const ruNf = new Intl.NumberFormat("ru-RU");
/** 1 очко, 2 очка, 5 очков. */
function ruPlural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
}
const enNf = new Intl.NumberFormat("en-GB");

const ru = {
  appName: "Квиз для своих",
  gameLanguage: "Язык игры",
  languageName: { ru: "Русский", en: "English" } as Record<Language, string>,
  languageHint: "На этом языке будут вопросы и интерфейс у всех игроков.",
  tagline: "Вопросы, которые собираются под вашу компанию",
  createRoom: "Создать игру",
  creating: "Создаём…",
  haveCode: "Есть код комнаты?",
  join: "Войти",
  roomCode: "Код комнаты",
  yourName: "Как тебя зовут?",
  namePlaceholder: "Имя для этой игры",
  joining: "Входим…",
  scanToJoin: "Сканируй, чтобы играть",
  orOpen: "или открой",
  andEnterCode: "и введи код",
  players: "Игроки",
  noPlayersYet: "Пока никого — сканируйте QR-код",
  hostHint: "Кто войдёт первым, тот и управляет игрой",
  host: "ведущий",
  offline: "не в сети",
  waitingForHost: "Ждём, когда ведущий начнёт",
  youAreHost: "Ты управляешь игрой",
  start: "Начать",
  needTwoPlayers: "Нужно минимум 2 готовых игрока",
  question: (n: number, total: number) => `Вопрос ${n} из ${total}`,
  reading: "Читаем вопрос…",
  answered: (n: number, total: number) => `Ответили ${n} из ${total}`,
  answerAccepted: "Ответ принят",
  waitForOthers: "Ждём остальных",
  correct: "Верно!",
  wrong: "Мимо",
  noAnswer: "Не успел ответить",
  correctAnswer: "Правильный ответ",
  points: (n: number) => `+${ruNf.format(n)}`,
  total: (n: number) => `Всего: ${ruNf.format(n)}`,
  nextQuestion: "Следующий вопрос…",
  skipped: "Вопрос пропущен",
  paused: "Пауза",
  pause: "Пауза",
  resume: "Продолжить",
  skip: "Пропустить",
  end: "Закончить",
  confirmEnd: "Точно закончить?",
  softEnd: "Прошло полчаса. Закончить игру?",
  softEndContinue: "Играем дальше",
  pendingJoin: "Ты в игре со следующего вопроса",
  lookAtScreen: "Смотри на общий экран",
  results: "Итоги",
  winner: "Победитель",
  score: (n: number) => `${ruNf.format(n)} ${ruPlural(n, "очко", "очка", "очков")}`,
  gameLength: (n: number) => `Игра — ${n} ${ruPlural(n, "вопрос", "вопроса", "вопросов")}.`,
  scoringRules: "Очки за верный ответ: 3 — в первой половине времени, 2 — до трёх четвертей, 1 — в самом конце. Неверно — 0.",
  correctOf: (c: number, a: number) => `${c} из ${a}`,
  yourPlace: (place: number, of: number) => `Твоё место: ${place} из ${of}`,
  playAgain: "Сыграть ещё",
  waitPlayAgain: "Ведущий может начать новую игру",
  questionsPlayed: (n: number) => `Сыграно вопросов: ${n}`,
  statHardest: "Самый сложный вопрос",
  statEveryone: "Это знали все",
  statDivided: "Мнения разделились",
  statOnlyOne: "Это знал только один",
  statFastest: "Самый быстрый верный ответ",
  seconds: (ms: number) => `${(ms / 1000).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} с`,
  // onboarding
  back: "Назад",
  cancel: "Отмена",
  next: "Дальше",
  stepOf: (i: number, n: number) => `Шаг ${i} из ${n}`,
  privateNote: "Твои ответы видишь только ты",
  ageTitle: "Сколько тебе лет?",
  ageBand: { "13_17": "13–17", "18_24": "18–24", "25_34": "25–34", "35_44": "35–44", "45_54": "45–54", "55_PLUS": "55+" },
  topicsTitle: "Что тебе интересно?",
  topicsHint: (max: number) => `До ${max} тем. Чем точнее, тем больше вопросов «про тебя».`,
  showAllTopics: (n: number) => `Показать все темы · ещё ${n}`,
  limitReached: (max: number) => `Уже ${max} — сними одну, чтобы выбрать другую.`,
  nextWithCount: (n: number) => `Дальше · ${n}`,
  pickOne: "Выбери хотя бы одну тему",
  depthTitle: "Насколько хорошо ты в этом разбираешься?",
  depth: { CASUAL: "Немного", INTERESTED: "Люблю", EXPERT: "Знаток" },
  lessTitle: "Чего хочется поменьше?",
  lessHint: (max: number) => `До ${max} тем. Они будут попадаться реже, но не исчезнут совсем.`,
  skipStep: "Пропустить",
  backgroundTitle: "В какой культуре прошли твои детство и юность?",
  backgroundHint: "Можно выбрать несколько или пропустить.",
  background: {
    POST_SOVIET: "Постсоветское пространство",
    UK: "Великобритания",
    US: "США",
    EUROPE: "Европа",
    ASIA: "Азия",
  },
  dignityTitle: "Какой квиз тебе по душе?",
  dignity: {
    CLASSIC: { title: "Больше классики", hint: "история, наука, литература, искусство" },
    BALANCE: { title: "Всего понемногу", hint: "и серьёзное, и поп-культура" },
    POP: { title: "Больше поп-культуры и ностальгии", hint: "хиты, сериалы, реклама, мемы" },
  },
  editPrefs: "Изменить интересы",
  readyCount: (r: number, n: number) => `Готовы ${r} из ${n}`,
  chipOnboarding: "заполняет…",
  stragglersHint: "Кто не успел — подключится со следующего вопроса",
  readyWait: "Готово! Ждём начала",

  // offboarding
  feedbackTitle: "Как тебе игра?",
  fbPlayAgain: "Хочется сыграть ещё?",
  fbDifferentGroup: "А с другой компанией?",
  intent: { YES: "Да", MAYBE: "Может быть", NO: "Нет" } as Record<string, string>,
  fbDifficulty: "Сложность",
  fbDifficultyValues: { TOO_EASY: "Легко", JUST_RIGHT: "В самый раз", TOO_HARD: "Сложно" } as Record<string, string>,
  fbPace: "Темп",
  fbPaceValues: { TOO_SLOW: "Медленно", JUST_RIGHT: "В самый раз", TOO_FAST: "Быстро" } as Record<string, string>,
  fbBalance: "Темы",
  fbBalanceValues: { MORE_CLASSIC: "Больше классики", JUST_RIGHT: "В самый раз", MORE_POP: "Больше поп-культуры" } as Record<string, string>,
  fbNeedPlayAgain: "Ответь на первый вопрос",
  send: "Отправить",
  feedbackThanks: "Спасибо! Это помогает делать квиз лучше.",
  rateTitle: "Оцени вопросы",
  rateHint: "Плохие вопросы уйдут на доработку.",
  rating: {
    GREAT: { icon: "👍", label: "Отличный вопрос" },
    FINE: { icon: "👌", label: "Нормальный вопрос" },
    BAD: { icon: "👎", label: "Плохой вопрос" },
  },

  reconnecting: "Связь потеряна. Переподключаемся…",
  roomNotFound: "Комната не найдена. Проверь код.",
  displayNoToken: "Этот экран открыт без ключа комнаты. Создай игру заново на этом устройстве.",
  errorGeneric: "Что-то пошло не так. Попробуй ещё раз.",
  tooManyRequests: "Слишком много попыток. Подожди минуту и попробуй снова.",
};

const en: Strings = {
  appName: "Quiz for your crowd",
  gameLanguage: "Game language",
  languageName: { ru: "Русский", en: "English" },
  languageHint: "Questions and every player's screen will be in this language.",
  tagline: "Questions that tune themselves to your group",
  createRoom: "Create a game",
  creating: "Creating…",
  haveCode: "Got a room code?",
  join: "Join",
  roomCode: "Room code",
  yourName: "What's your name?",
  namePlaceholder: "Name for this game",
  joining: "Joining…",
  scanToJoin: "Scan to play",
  orOpen: "or open",
  andEnterCode: "and enter the code",
  players: "Players",
  noPlayersYet: "Nobody yet — scan the QR code",
  hostHint: "Whoever joins first runs the game",
  host: "host",
  offline: "offline",
  waitingForHost: "Waiting for the host to start",
  youAreHost: "You're running the game",
  start: "Start",
  needTwoPlayers: "Needs at least 2 ready players",
  question: (n: number, total: number) => `Question ${n} of ${total}`,
  reading: "Reading the question…",
  answered: (n: number, total: number) => `${n} of ${total} answered`,
  answerAccepted: "Answer locked in",
  waitForOthers: "Waiting for the others",
  correct: "Correct!",
  wrong: "Not quite",
  noAnswer: "Out of time",
  correctAnswer: "Correct answer",
  points: (n: number) => `+${enNf.format(n)}`,
  total: (n: number) => `Total: ${enNf.format(n)}`,
  nextQuestion: "Next question…",
  skipped: "Question skipped",
  paused: "Paused",
  pause: "Pause",
  resume: "Resume",
  skip: "Skip",
  end: "End game",
  confirmEnd: "Really end?",
  softEnd: "It's been half an hour. End the game?",
  softEndContinue: "Keep playing",
  pendingJoin: "You're in from the next question",
  lookAtScreen: "Look at the big screen",
  results: "Results",
  winner: "Winner",
  score: (n: number) => `${enNf.format(n)} ${n === 1 ? "point" : "points"}`,
  gameLength: (n: number) => `A game is ${n} questions.`,
  scoringRules: "Points for a right answer: 3 in the first half of the time, 2 up to three quarters, 1 at the very end. Wrong — 0.",
  correctOf: (c: number, a: number) => `${c} of ${a}`,
  yourPlace: (place: number, of: number) => `You placed ${place} of ${of}`,
  playAgain: "Play again",
  waitPlayAgain: "The host can start a new game",
  questionsPlayed: (n: number) => `Questions played: ${n}`,
  statHardest: "Toughest question",
  statEveryone: "Everyone knew this",
  statDivided: "Most divided",
  statOnlyOne: "Only one person knew",
  statFastest: "Fastest correct answer",
  seconds: (ms: number) => `${(ms / 1000).toLocaleString("en-GB", { maximumFractionDigits: 1 })} s`,
  back: "Back",
  cancel: "Cancel",
  next: "Next",
  stepOf: (i: number, n: number) => `Step ${i} of ${n}`,
  privateNote: "Only you can see your answers",
  ageTitle: "How old are you?",
  ageBand: { "13_17": "13–17", "18_24": "18–24", "25_34": "25–34", "35_44": "35–44", "45_54": "45–54", "55_PLUS": "55+" },
  topicsTitle: "What are you into?",
  topicsHint: (max: number) => `Up to ${max} topics. The more honest, the more questions that are "yours".`,
  showAllTopics: (n: number) => `Show all topics · ${n} more`,
  limitReached: (max: number) => `That's ${max} — unselect one to pick another.`,
  nextWithCount: (n: number) => `Next · ${n}`,
  pickOne: "Pick at least one topic",
  depthTitle: "How well do you know it?",
  depth: { CASUAL: "A bit", INTERESTED: "Love it", EXPERT: "Expert" },
  lessTitle: "Anything you'd like less of?",
  lessHint: (max: number) => `Up to ${max} topics. They'll come up less often, but won't disappear completely.`,
  skipStep: "Skip",
  backgroundTitle: "Which culture did you grow up in?",
  backgroundHint: "Pick any that apply, or skip.",
  background: {
    POST_SOVIET: "Post-Soviet countries",
    UK: "United Kingdom",
    US: "United States",
    EUROPE: "Europe",
    ASIA: "Asia",
  },
  dignityTitle: "What kind of quiz do you like?",
  dignity: {
    CLASSIC: { title: "More classic", hint: "history, science, literature, art" },
    BALANCE: { title: "A bit of everything", hint: "serious stuff and pop culture" },
    POP: { title: "More pop culture and nostalgia", hint: "hits, TV shows, ads, memes" },
  },
  editPrefs: "Change my interests",
  readyCount: (r: number, n: number) => `${r} of ${n} ready`,
  chipOnboarding: "choosing…",
  stragglersHint: "Anyone still choosing will join from the next question",
  readyWait: "All set! Waiting to start",
  feedbackTitle: "How was it?",
  fbPlayAgain: "Up for another game?",
  fbDifferentGroup: "And with a different group?",
  intent: { YES: "Yes", MAYBE: "Maybe", NO: "No" },
  fbDifficulty: "Difficulty",
  fbDifficultyValues: { TOO_EASY: "Too easy", JUST_RIGHT: "Just right", TOO_HARD: "Too hard" },
  fbPace: "Pace",
  fbPaceValues: { TOO_SLOW: "Too slow", JUST_RIGHT: "Just right", TOO_FAST: "Too fast" },
  fbBalance: "Topics",
  fbBalanceValues: { MORE_CLASSIC: "More classic", JUST_RIGHT: "Just right", MORE_POP: "More pop culture" },
  fbNeedPlayAgain: "Answer the first question",
  send: "Send",
  feedbackThanks: "Thank you! This helps make the quiz better.",
  rateTitle: "Rate the questions",
  rateHint: "Bad ones get sent back for a rewrite.",
  rating: {
    GREAT: { icon: "👍", label: "Great question" },
    FINE: { icon: "👌", label: "Fine question" },
    BAD: { icon: "👎", label: "Bad question" },
  },
  reconnecting: "Connection lost. Reconnecting…",
  roomNotFound: "Room not found. Check the code.",
  displayNoToken: "This screen was opened without the room key. Create the game again on this device.",
  errorGeneric: "Something went wrong. Please try again.",
  tooManyRequests: "Too many attempts. Wait a minute and try again.",
};

export type Strings = typeof ru;
const STRINGS: Record<Language, Strings> = { ru, en };

// ---------- active language (tiny external store) ----------

const KEY = "quiz.language";
function initial(): Language {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "ru" || saved === "en") return saved;
  } catch {
    // storage unavailable
  }
  return navigator.language?.toLowerCase().startsWith("ru") ? "ru" : "en";
}

let current: Language = initial();
document.documentElement.lang = current;
document.title = STRINGS[current].appName;
const listeners = new Set<() => void>();

export function setLanguage(lang: Language, remember = false) {
  if (remember) {
    try {
      localStorage.setItem(KEY, lang);
    } catch {
      // ignore
    }
  }
  if (lang === current) return;
  current = lang;
  document.documentElement.lang = lang;
  document.title = STRINGS[lang].appName;
  listeners.forEach((l) => l());
}

export function useLanguage(): Language {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}

export function useT(): Strings {
  return STRINGS[useLanguage()];
}
