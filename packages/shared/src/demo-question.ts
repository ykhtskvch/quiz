import type { OptionKey } from "./protocol.ts";

// M1 uses one hardcoded question; M4 replaces it with the Composition Engine.
export const DEMO_QUESTION = {
  id: "tatu-eurovision-2003-place-ru-1",
  text: "Какое место заняла группа t.A.T.u. на «Евровидении-2003» с песней «Не верь, не бойся»?",
  options: [
    { key: "A", text: "Первое" },
    { key: "B", text: "Третье" },
    { key: "C", text: "Второе" },
    { key: "D", text: "Девятое" },
  ] as { key: OptionKey; text: string }[],
  correctKey: "B" as OptionKey,
  explanation: "Россия набрала 164 балла — всего на 3 меньше победительницы, Сертаб Эренер из Турции.",
};
