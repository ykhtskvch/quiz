// Private onboarding on the player's phone (EPIC 3). Nothing here is shown to anyone else.
import { useMemo, useState } from "react";
import {
  AGE_BANDS,
  BACKGROUND_CONTEXTS,
  MAX_LESS_TOPICS,
  MAX_LIKED_TOPICS,
  TOPICS,
  type AgeBand,
  type BackgroundContext,
  type Depth,
  type DignityChoice,
  type OnboardingInput,
} from "@quiz/shared";
import { api } from "../api.ts";
import { useLanguage, useT } from "../strings.ts";

type Step = "age" | "topics" | "depth" | "less" | "background" | "dignity";
const STEPS: Step[] = ["age", "topics", "depth", "less", "background", "dignity"];

const topicBySlug = new Map(TOPICS.map((x) => [x.slug, x]));

export function Onboarding({
  code,
  token,
  initial,
  onDone,
  onCancel,
  availableTopics,
}: {
  code: string;
  token: string;
  initial: OnboardingInput | null;
  onDone: (submitted: OnboardingInput) => void;
  /** Present when editing existing preferences between games. */
  onCancel?: () => void;
  /** Topics that have questions in the room language; null while loading or unknown (show all). */
  availableTopics?: string[] | null;
}) {
  const t = useT();
  const lang = useLanguage();
  const offered = useMemo(
    () => (availableTopics && availableTopics.length ? TOPICS.filter((x) => availableTopics.includes(x.slug)) : TOPICS),
    [availableTopics],
  );
  const name = (slug: string) => {
    const x = topicBySlug.get(slug)!;
    return lang === "en" ? x.nameEn : x.name;
  };
  const [step, setStep] = useState<Step>("age");
  const [ageBand, setAgeBand] = useState<AgeBand | null>(initial?.ageBand ?? null);
  const [liked, setLiked] = useState<Map<string, Depth>>(
    () =>
      new Map(
        // Older answers could have up to 12 topics; keep the first ones within today's limit.
        (initial?.topics.flatMap((x) => (x.preference === "LIKE" && topicBySlug.has(x.slug) ? [[x.slug, x.depth] as const] : [])) ?? []).slice(
          0,
          MAX_LIKED_TOPICS,
        ),
      ),
  );
  const [less, setLess] = useState<Set<string>>(
    () => new Set(initial?.topics.filter((x) => x.preference === "LESS_OF").map((x) => x.slug).slice(0, MAX_LESS_TOPICS)),
  );
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
            topics={offered}
            selected={new Set(liked.keys())}
            max={MAX_LIKED_TOPICS}
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
                    {topic.emoji} {name(slug)}
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
          <p className="muted small">{t.lessHint(MAX_LESS_TOPICS)}</p>
          <TopicGrid
            topics={offered}
            selected={less}
            exclude={new Set(liked.keys())}
            variant="less"
            max={MAX_LESS_TOPICS}
            onToggle={(slug) => setLess(less.has(slug) || less.size < MAX_LESS_TOPICS ? toggle(less, slug) : less)}
          />
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

/**
 * Main (level-A) topics first; the rest behind "show all" so the list isn't a wall (playtest 1).
 * Anything already selected always stays visible. At `max` selections the other cards lock.
 */
function TopicGrid({
  topics: all,
  selected,
  exclude,
  onToggle,
  max,
  variant = "like",
}: {
  topics: typeof TOPICS;
  selected: Set<string>;
  exclude?: Set<string>;
  onToggle: (slug: string) => void;
  max: number;
  variant?: "like" | "less";
}) {
  const t = useT();
  const lang = useLanguage();
  const [expanded, setExpanded] = useState(false);
  const pool = useMemo(() => all.filter((x) => !exclude?.has(x.slug)), [all, exclude]);
  const shown = expanded ? pool : pool.filter((x) => x.featured || selected.has(x.slug));
  const hidden = pool.length - shown.length;
  const full = selected.size >= max;
  const byGroup = [...new Set(shown.map((x) => x.group))].map((g) => ({ group: g, topics: shown.filter((x) => x.group === g) }));
  return (
    <div className="topic-groups">
      {byGroup.map(({ group, topics }) => (
        <div key={group}>
          <h3 className="group-title">{lang === "en" ? topics[0].groupEn : group}</h3>
          <div className="topic-grid">
            {topics.map((x) => (
              <button
                key={x.slug}
                className={`topic-card ${selected.has(x.slug) ? `selected ${variant}` : ""}`}
                aria-pressed={selected.has(x.slug)}
                disabled={full && !selected.has(x.slug)}
                onClick={() => onToggle(x.slug)}
              >
                <span className="emoji" aria-hidden>
                  {x.emoji}
                </span>
                <span>{lang === "en" ? x.nameEn : x.name}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      {full && <p className="muted small">{t.limitReached(max)}</p>}
      {hidden > 0 && (
        <button className="link show-all" onClick={() => setExpanded(true)}>
          {t.showAllTopics(hidden)}
        </button>
      )}
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
