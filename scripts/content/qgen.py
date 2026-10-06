# Compact question specs -> content/families/<file>.yaml in the project schema (used for C2 / EPIC 36–38 drafts).
#   from qgen import render
#   render(topic, header, families, defaults, lang="ru", filename=None, method="AI", byline=...)
# families: [(family_id, family_name, [fact_dict, ...])]; each fact dict (merged over `defaults`) has
# id, statement, source, url?, text, options=[(text, type)], explanation, spec, topics, contexts,
# generations?, bridge?, time_sensitive?, difficulty, dignity, effects, notes?.
# Option type "OK" marks the correct answer; otherwise a distractor code from TYPES.
import json
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
TYPES = {"P": "PLAUSIBLE", "M": "COMMON_MISCONCEPTION", "N": "NEAR_MISS", "S": "SAME_CATEGORY", "C": "CONTEXTUAL_CONFUSION"}


def q(s):
    return json.dumps(s, ensure_ascii=False)


def flow(d):
    return "{ " + ", ".join(f"{k}: {v}" for k, v in d.items()) + " }"


def render(topic, header, families, defaults, lang="ru", filename=None, method="AI",
           byline="Written by Claude as DRAFT; every fact needs human review (BR-130)."):
    out = [f"# {header}", f"# {byline}", "", "families:"]
    for fam_id, fam_name, facts in families:
        out += [f"  - family: {fam_id}", f"    name: {q(fam_name)}", "    facts:"]
        for f in facts:
            m = {**defaults, **f}
            fid = m["id"]
            out += [f"      - id: {fid}", f"        statement: {q(m['statement'])}"]
            if m.get("time_sensitive"):
                out.append("        time_sensitive: true")
            url = f", url: {q(m['url'])}" if m.get("url") else ""
            out.append(f"        sources: [{{ name: {q(m['source'])}, type: REFERENCE{url}, verified: false }}]")
            out += ["        questions:", f"          - id: {fid}-{lang}-1", f"            language: {lang}", f"            origin_language: {lang}",
                    f"            culture_specificity: {m['spec']}"]
            if m.get("bridge"):
                out.append("            is_bridge: true")
            out += [f"            text: {q(m['text'])}", "            options:"]
            for key, (txt, t) in zip("ABCD", m["options"]):
                if t == "OK":
                    out.append(f"              - {{ key: {key}, text: {q(txt)}, correct: true }}")
                else:
                    out.append(f"              - {{ key: {key}, text: {q(txt)}, distractor: {TYPES[t]} }}")
            out.append(f"            explanation: {q(m['explanation'])}")
            out.append(f"            topics: {flow(m['topics'])}")
            out.append(f"            contexts: {flow(m['contexts'])}")
            if m.get("generations"):
                out.append(f"            generations: {flow(m['generations'])}")
            out += [f"            difficulty: {m['difficulty']}", f"            dignity: {m['dignity']}",
                    f"            effects: {flow(m['effects'])}", "            status: DRAFT", f"            generation_method: {method}"]
            if m.get("notes"):
                out.append("            review_notes: [" + ", ".join(q("AI doubt: " + n) for n in m["notes"]) + "]")
            out.append("")
    path = os.path.join(ROOT, "content", "families", f"{filename or topic}.yaml")
    with open(path, "w") as fh:
        fh.write("\n".join(out).rstrip() + "\n")
    n = sum(len(f) for _, _, f in families)
    assert all(sum(1 for o in f["options"] if o[1] == "OK") == 1 and len(f["options"]) == 4 for _, _, fs in families for f in fs), "options"
    print(f"{path}: {n} questions")
