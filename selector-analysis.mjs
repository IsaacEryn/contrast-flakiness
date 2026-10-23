/**
 * selector-identity 결과 집계 — 같은 요소에 두 실행이 다른 선택자를 붙인 비율을 규칙별·사이트별로 센다.
 * 익명 공개본(dataset/selector-identity)과 비공개 원자료 둘 다 읽는다.
 * 실행: node selector-analysis.mjs --in=dataset/selector-identity [--out=<결과 md>]
 *
 * 용어
 * - 1차 노드: 첫 실행이 낸 위반 노드(규칙 × 요소)
 * - 같은 요소: 두 번째 실행이 같은 규칙으로 같은 요소(페이지 안 참조)를 다시 보고함
 * - 선택자 바뀜: 같은 요소인데 기본 선택자 문자열이 다름. 순서만(클래스·속성 순서) / 특징 바뀜(고른 클래스·속성이 다름)
 * - 선택자로 못 찾음: 같은 요소인데 첫 실행의 선택자가 두 번째 실행의 같은 규칙 선택자 목록에 없음(선택자로 짝짓는 필터가 버리는 경우)
 * - 위치 경로 바뀜: ancestry 옵션의 경로가 달라짐
 */
import fs from "node:fs";
import path from "node:path";

const argOf = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=");
const IN = argOf("in") ?? "dataset/selector-identity";
const OUTF = argOf("out");
const lines = [];
const say = (s = "") => lines.push(s);
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : "-");
const table = (head, rows) => [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");

const recs = [];
for (const site of fs.readdirSync(IN).filter((d) => d.startsWith("site-")).sort())
  for (const f of fs.readdirSync(path.join(IN, site)).filter((x) => x.endsWith(".json")).sort())
    recs.push(JSON.parse(fs.readFileSync(path.join(IN, site, f), "utf8")));
const ok = recs.filter((r) => r.ok);
const env = JSON.parse(fs.readFileSync(path.join(IN, "env.json"), "utf8"));

const tally = () => ({ first: 0, matched: 0, same: 0, orderOnly: 0, featureChanged: 0, notFound: 0, ancestryChanged: 0, notMatched: 0, sites: new Set(), changedSites: new Set() });
const add = (t, r, n) => {
  t.first++;
  t.sites.add(r.site);
  if (!n.matched) { t.notMatched++; return; }
  t.matched++;
  t[n.kind]++;
  if (n.kind === "orderOnly" || n.kind === "featureChanged") t.changedSites.add(r.site);
  if (!n.selectorFound) t.notFound++;
  if (n.ancestryChanged) t.ancestryChanged++;
};
const all = tally(), byRule = new Map(), bySite = new Map(), nonContrast = tally();
for (const r of ok)
  for (const n of r.nodes) {
    add(all, r, n);
    if (n.ruleId !== "color-contrast") add(nonContrast, r, n);
    if (!byRule.has(n.ruleId)) byRule.set(n.ruleId, tally());
    add(byRule.get(n.ruleId), r, n);
    if (!bySite.has(r.site)) bySite.set(r.site, tally());
    add(bySite.get(r.site), r, n);
  }
const row = (name, t) => [name, t.first, t.matched, `${t.orderOnly + t.featureChanged} (${pct(t.orderOnly + t.featureChanged, t.matched)})`, t.orderOnly, t.featureChanged, `${t.notFound} (${pct(t.notFound, t.matched)})`, `${t.ancestryChanged} (${pct(t.ancestryChanged, t.matched)})`, `${t.changedSites.size}/${t.sites.size}`];
const head = ["", "1차 노드", "같은 요소", "선택자 바뀜", "순서만", "특징 바뀜", "선택자로 못 찾음", "위치 경로 바뀜", "바뀐 곳/보고된 곳"];

say("# 선택자 식별 실험 결과");
say();
say(`원자료: ${IN} · 로드 ${ok.length}/${recs.length} 성공 · axe-core ${env.axeCore} · Chromium ${env.chromium} · 실행 간격 ${env.passGapMs}ms · 측정 ${env.startedAt} ~ ${env.finishedAt ?? "?"}`);
say();
say("## 전체와 명도 대비 밖");
say();
say(table(head, [row("전체", all), row("color-contrast 제외", nonContrast), row("color-contrast", byRule.get("color-contrast") ?? tally())]));
say();
say("## 규칙별 (1차 노드 많은 순)");
say();
say(table(["규칙", ...head.slice(1)], [...byRule.entries()].sort((a, b) => b[1].first - a[1].first).map(([k, t]) => row(k, t))));
say();
say("## 사이트별 (선택자 바뀐 노드 많은 순, 바뀐 곳만)");
say();
const siteRows = [...bySite.entries()].filter(([, t]) => t.orderOnly + t.featureChanged > 0).sort((a, b) => b[1].orderOnly + b[1].featureChanged - (a[1].orderOnly + a[1].featureChanged));
say(table(["사이트", ...head.slice(1, 8)], siteRows.map(([k, t]) => row(k, t).slice(0, 8))));
say();
const changedTotal = all.orderOnly + all.featureChanged;
const top = siteRows.slice(0, 2).reduce((a, [, t]) => a + t.orderOnly + t.featureChanged, 0);
say(`선택자가 바뀐 노드가 있는 사이트: ${siteRows.length}/${bySite.size}곳. 상위 2곳이 ${top}/${changedTotal}(${pct(top, changedTotal)}).`);
say(`선택자가 바뀐 노드가 있는 로드: ${ok.filter((r) => r.nodes.some((n) => n.kind === "orderOnly" || n.kind === "featureChanged")).length}/${ok.length}.`);
say(`같은 요소로 짝지어지지 않은 1차 노드: ${all.notMatched}(${pct(all.notMatched, all.first)}) — 두 번째 실행이 그 요소를 보고하지 않음.`);
say(`위치 경로(ancestry)는 바뀌지 않았는데 기본 선택자만 바뀐 노드: ${ok.reduce((a, r) => a + r.nodes.filter((n) => (n.kind === "orderOnly" || n.kind === "featureChanged") && n.ancestryChanged === false).length, 0)}, 기본 선택자는 같은데 위치 경로만 바뀐 노드: ${ok.reduce((a, r) => a + r.nodes.filter((n) => n.kind === "same" && n.ancestryChanged).length, 0)}.`);
const fails = recs.filter((r) => !r.ok);
if (fails.length) {
  say();
  say(`## 실패 ${fails.length}건`);
  for (const f of fails) say(`- ${f.site} r${f.round}: ${f.error}`);
}
const text = lines.join("\n") + "\n";
if (OUTF) fs.writeFileSync(OUTF, text);
process.stdout.write(text);
