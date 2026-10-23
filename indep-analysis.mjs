/**
 * 독립 표본 집계 — 규칙을 만드는 데 쓰지 않은 무작위 사이트에서 필터 수정 전후의 P3−P0를 센다.
 * 입력은 procedure-eval.mjs를 엔진 판마다 한 세션씩(--conds=P0,P3) 돌린 두 폴더다(원자료나 익명본 모두 가능).
 * 실행: node indep-analysis.mjs --before=dataset/indep-before --after=dataset/indep-after [--out=<결과 md>]
 * 구간은 procedure-analysis.mjs와 같은 사이트 부트스트랩(10,000회, 시드 20261020)이다.
 */
import fs from "node:fs";
import path from "node:path";

const argOf = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=");
const BEFORE = argOf("before") ?? "dataset/indep-before";
const AFTER = argOf("after") ?? "dataset/indep-after";
const OUTF = argOf("out");
const SEED = 20261020;
const BOOT = 10_000;
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const median = (xs) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
/** 사이트 군집 부트스트랩: 사이트별 차이의 평균에 대한 95% 백분위 구간 */

function bootstrapMeanCI(d, seed = SEED) {
  if (d.length < 2) return [NaN, NaN];
  const r = rng(seed), ms = [];
  for (let b = 0; b < BOOT; b++) {
    let s = 0;
    for (let i = 0; i < d.length; i++) s += d[Math.floor(r() * d.length)];
    ms.push(s / d.length);
  }
  ms.sort((a, b) => a - b);
  return [ms[Math.floor(0.025 * BOOT)], ms[Math.floor(0.975 * BOOT)]];
}
const load = (dir) => {
  const out = [];
  for (const s of fs.readdirSync(dir).filter((d) => d.startsWith("site-")).sort())
    for (const f of fs.readdirSync(path.join(dir, s)).filter((x) => x.endsWith(".json"))) out.push(JSON.parse(fs.readFileSync(path.join(dir, s, f), "utf8")));
  return out;
};
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : "–");
const lines = [];
const say = (s = "") => lines.push(s);
const B = load(BEFORE), A = load(AFTER);
const sites = [...new Set([...B, ...A].map((r) => r.site))].sort();
const okSite = (recs, s) => recs.filter((r) => r.site === s && r.ok);
const per = (recs, s, c) => {
  const xs = okSite(recs, s).filter((r) => r.cond.key === c);
  return xs.length ? xs.reduce((a, r) => a + r.contrast.final.length, 0) / xs.length : NaN;
};
// 두 세션 모두에서 P0·P3가 한 번 이상 성공한 사이트만 쓴다
const usable = sites.filter((s) => ["P0", "P3"].every((c) => Number.isFinite(per(B, s, c)) && Number.isFinite(per(A, s, c))));
const dB = usable.map((s) => per(B, s, "P3") - per(B, s, "P0"));
const dA = usable.map((s) => per(A, s, "P3") - per(A, s, "P0"));
const ciB = bootstrapMeanCI(dB), ciA = bootstrapMeanCI(dA);
const p3 = (recs) => recs.filter((r) => r.ok && r.cond.key === "P3");
const dropsB = p3(B).reduce((a, r) => a + r.contrast.dropped.length, 0);
const dropsA = p3(A).reduce((a, r) => a + r.contrast.dropped.length, 0);
const dropSitesB = new Set(p3(B).filter((r) => r.contrast.dropped.length).map((r) => r.site));
const keptA = p3(A).reduce((a, r) => {
  const p2 = new Set((r.visTrace ?? []).flatMap((v) => v.passes?.[1]?.nodes ?? []).map((n) => JSON.stringify(n.target)));
  const same = new Set((r.contrast.keptSameElement ?? []).map((n) => JSON.stringify(n.target)).filter((k) => !p2.has(k)));
  const hid = (r.contrast.keptHidden ?? []).map((n) => JSON.stringify(n.target)).filter((k) => !p2.has(k) && !same.has(k));
  return { same: a.same + same.size, hidden: a.hidden + hid.length };
}, { same: 0, hidden: 0 });
const runs = p3(B).length;
say("# 독립 표본 결과");
say();
say(`사이트 ${sites.length}곳(두 세션 P0·P3 모두 성공 ${usable.length}곳) · 로드 수정 전 ${B.filter((r) => r.ok).length}/${B.length}, 수정 후 ${A.filter((r) => r.ok).length}/${A.length}`);
say(`명도 대비 보고가 있는 사이트(P0 기준): ${usable.filter((s) => per(B, s, "P0") > 0).length}곳`);
say();
say(`P3−P0 사이트 평균: 수정 전 ${f2(mean(dB))} [${f2(ciB[0])}, ${f2(ciB[1])}], 수정 후 ${f2(mean(dA))} [${f2(ciA[0])}, ${f2(ciA[1])}]`);
say(`수정 전 P3에서 필터가 뺀 노드: ${dropsB}건(${dropSitesB.size}곳, P3 로드 ${runs}회). 수정 후 P3에서 뺀 노드: ${dropsA}건.`);
say(`수정 후 P3에서 선택자로 다시 잡히지 않았지만 유지한 노드: 같은 요소 ${keptA.same}건, 숨김 ${keptA.hidden}건.`);
say(`P3−P0가 줄어든 곳(수정 전): ${dB.filter((x) => x < 0).length}곳, 늘어난 곳 ${dB.filter((x) => x > 0).length}곳 / 수정 후 줄어든 곳 ${dA.filter((x) => x < 0).length}곳, 늘어난 곳 ${dA.filter((x) => x > 0).length}곳`);
say();
say("| 사이트 | 전 P0 | 전 P3 | 후 P0 | 후 P3 |");
say("|---|---|---|---|---|");
for (const s of usable) if (per(B, s, "P0") || per(B, s, "P3") || per(A, s, "P3")) say(`| ${s} | ${f2(per(B, s, "P0"))} | ${f2(per(B, s, "P3"))} | ${f2(per(A, s, "P0"))} | ${f2(per(A, s, "P3"))} |`);
const fails = [...B, ...A].filter((r) => !r.ok);
if (fails.length) { say(); say(`실패 ${fails.length}건: ` + [...new Set(fails.map((f) => f.site))].join(", ")); }
const text = lines.join("\n") + "\n";
if (OUTF) fs.writeFileSync(OUTF, text);
process.stdout.write(text);
