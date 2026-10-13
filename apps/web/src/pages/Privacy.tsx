// "About data" (EPIC 41 P-06): what the game keeps, where and for how long — in the words of the code.
import { CONTACT_EMAIL } from "../contact.ts";
import { navigate } from "../router.ts";
import { useT } from "../strings.ts";

export function Privacy() {
  const t = useT();
  const p = t.privacyPage;
  return (
    <main className="privacy-page">
      <p className="brand-mark">{t.appName}</p>
      <h1>{p.title}</h1>
      <p className="lead">{p.intro}</p>
      {p.sections.map((s) => (
        <section key={s.title}>
          <h2>{s.title}</h2>
          <ul>
            {s.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ))}
      {CONTACT_EMAIL && (
        <section>
          <h2>{p.contactTitle}</h2>
          <p>
            {p.contactText} <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
          </p>
        </section>
      )}
      <button className="link" onClick={() => navigate("/")}>
        {p.back}
      </button>
    </main>
  );
}
