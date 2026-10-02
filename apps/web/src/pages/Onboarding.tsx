// Private onboarding on the player's phone (EPIC 3). Nothing here is shown to anyone else.
import { useMemo, useState } from "react";
import {
  AGE_BANDS,
  BACKGROUND_CONTEXTS,
  MAX_LIKED_TOPICS,
  TOPICS,
  type AgeBand,
  type BackgroundContext,
  type Depth,
  type DignityChoice,
  type OnboardingInput,
} from "@quiz/shared";
import { api } from "../api.ts";
import { t } from "../strings.ts";

type Step = "age" | "topics" | "depth" | "less" | "background" | "dignity";
const STEPS: Step[] = ["age", "topics", "depth", "less", "background", "dignity"];

const groups = [...new Set(TOPICS.map((x) => x.group))];
const topicBySlug = new Map(TOPICS.map((x) => [x.slug, x]));

export function Onboarding({
  code,
  token,
  initial,
  onDone,
  onCancel,
}: {
  code: string;
  token: string;
  initial: OnboardingInput | null;
  onDone: (submitted: OnboardingInput) => void;
  /** Present when editing existing preferences between games. */
  onCancel?: () => void;
}) {
  const [step, setStep] = useState<Step>("age");
  const [ageBand, setAgeBand] = useState<AgeBand | null>(initial?.ageBand ?? null);
  const [liked, setLiked] = useState<Map<string, Depth>>(
    () => new Map(initial?.topics.flatMap((x) => (x.preference === "LIKE" ? [[x.slug, x.depth] as const] : [])) ?? []),
  );
  const [less, setLess] = useState<Set<string>>(() => new Set(initial?.topics.filter((x) => x.preference === "LESS_OF").map((x) => x.slug)));
  const [backgrounds, setBackgrounds] = useState<Set<BackgroundContext>>(() => new Set(initial?.backgrounds ?? []));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const index = STEPS.indexOf(step);
  const go = (s: Step) => {
    setError(null);
    setStep(s);
    window.scrollTo(0, 0);
  };
  const next = () => go(STEPS[index + 1]);
  const back = () => index > 0 && go(STEPS[index - 1]);

  const submit = async (dignity: DignityChoice) => {
    if (!ageBand) return go("age");
    setBusy(true);
    setError(null);
    try {
      const input: OnboardingInput = {
        ageBand,
        dignity,
        backgrounds: backgrounds.size ? [...backgrounds] : null, // empty = skipped → inferred (D-01)
        topics: [
          ...[...liked].map(([slug, depth]) => ({ slug, preference: "LIKE" as const, depth })),
          ...[...less].filter((slug) => !liked.has(slug)).map((slug) => ({ slug, preference: "LESS_OF" as const })),
        ],
      };
      await api.onboarding(code, token, input);
      onDone(input);
    } catch {
      setError(t.errorGeneric);
      setBusy(false);
    }
  };

  const toggle = <T,>(set: Set<T>, value: T) => {
    const copy = new Set(set);
    if (copy.has(value)) copy.delete(value);
    else copy.add(value);
    return copy;
  };

  return (
    <section className="onboarding">
      <header className="onb-head">
        {index > 0 ? (
          <button className="link" onClick={back}>
            ← {t.back}
          </button>
        ) : onCancel ? (
          <button className="link" onClick={onCancel}>
            {t.cancel}
          </button>
        ) : (
          <span />
        )}
        <span className="muted small">{t.stepOf(index + 1, STEPS.length)}</span>
      </header>
      <p className="muted small privacy-note">{t.privateNote}</p>

      {step === "age" && (
        <>
          <h2>{t.ageTitle}</h2>
          <div className="choice-list">
            {AGE_BANDS.map((band) => (
              <button
                key={band}
                className={`choice ${ageBand === band ? "selected" : ""}`}
                onClick={() => {
                  setAgeBand(band);
                  next();
                }}
              >
                {t.ageBand[band]}
              </button>
            ))}
          </div>
        </>
      )}

      {step === "topics" && (
        <>
          <h2>{t.topicsTitle}</h2>
          <p className="muted small">{t.topicsHint(MAX_LIKED_TOPICS)}</p>
          <TopicGrid
            selected={new Set(liked.keys())}
            onToggle={(slug) => {
              const copy = new Map(liked);
              if (copy.has(slug)) copy.delete(slug);
              else if (copy.size < MAX_LIKED_TOPICS) copy.set(slug, "INTERESTED");
              setLiked(copy);
            }}
          />
          <StickyNext disabled={liked.size === 0} onClick={next} label={liked.size ? t.nextWithCount(liked.size) : t.pickOne} />
        </>
      )}

      {step === "depth" && (
        <>
          <h2>{t.depthTitle}</h2>
          <ul className="depth-list">
            {[...liked].map(([slug, depth]) => {
              const topic = topicBySlug.get(slug)!;
              return (
                <li key={slug}>
                  <span className="depth-topic">
                    {topic.emoji} {topic.name}
                  </span>
                  <div className="segmented">
                    {(["CASUAL", "INTERESTED", "EXPERT"] as Depth[]).map((d) => (
                      <button key={d} className={depth === d ? "on" : ""} onClick={() => setLiked(new Map(liked).set(slug, d))}>
                        {t.depth[d]}
                      </button>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
          <StickyNext onClick={next} label={t.next} />
        </>
      )}

      {step === "less" && (
        <>
          <h2>{t.lessTitle}</h2>
          <p className="muted small">{t.lessHint}</p>
          <TopicGrid selected={less} exclude={new Set(liked.keys())} variant="less" onToggle={(slug) => setLess(toggle(less, slug))} />
          <StickyNext onClick={next} label={less.size ? t.next : t.skipStep} />
        </>
      )}

      {step === "background" && (
        <>
          <h2>{t.backgroundTitle}</h2>
          <p className="muted small">{t.backgroundHint}</p>
          <div className="choice-list">
            {BACKGROUND_CONTEXTS.map((c) => (
              <button key={c} className={`choice ${backgrounds.has(c) ? "selected" : ""}`} onClick={() => setBackgrounds(toggle(backgrounds, c))}>
                {t.background[c]}
              </button>
            ))}
          </div>
          <StickyNext onClick={next} label={backgrounds.size ? t.next : t.skipStep} />
        </>
      )}

      {step === "dignity" && (
        <>
          <h2>{t.dignityTitle}</h2>
          <div className="choice-list">
            {(["CLASSIC", "BALANCE", "POP"] as DignityChoice[]).map((d) => (
              <button
                key={d}
                className={`choice tall ${initial?.dignity === d ? "selected" : ""}`}
                disabled={busy}
                onClick={() => submit(d)}
              >
                <strong>{t.dignity[d].title}</strong>
                <span className="muted small">{t.dignity[d].hint}</span>
              </button>
            ))}
          </div>
          {error && <p className="error">{error}</p>}
        </>
      )}
    </section>
  );
}

function TopicGrid({
  selected,
  exclude,
  onToggle,
  variant = "like",
}: {
  selected: Set<string>;
  exclude?: Set<string>;
  onToggle: (slug: string) => void;
  variant?: "like" | "less";
}) {
  const byGroup = useMemo(
    () => groups.map((g) => ({ group: g, topics: TOPICS.filter((x) => x.group === g && !exclude?.has(x.slug)) })).filter((g) => g.topics.length),
    [exclude],
  );
  return (
    <div className="topic-groups">
      {byGroup.map(({ group, topics }) => (
        <div key={group}>
          <h3 className="group-title">{group}</h3>
          <div className="topic-grid">
            {topics.map((x) => (
              <button
                key={x.slug}
                className={`topic-card ${selected.has(x.slug) ? `selected ${variant}` : ""}`}
                aria-pressed={selected.has(x.slug)}
                onClick={() => onToggle(x.slug)}
              >
                <span className="emoji" aria-hidden>
                  {x.emoji}
                </span>
                <span>{x.name}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function StickyNext({ onClick, label, disabled = false }: { onClick: () => void; label: string; disabled?: boolean }) {
  return (
    <div className="sticky-next">
      <button className="primary big" disabled={disabled} onClick={onClick}>
        {label}
      </button>
    </div>
  );
}
