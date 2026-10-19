/**
 * procedure-eval.mjs 원자료 요약 — 사이트 ID 단위로만 집계하고 URL·선택자는 내보내지 않는다.
 *
 * 실행: node procedure-summary.mjs --in=<원자료 폴더> [--out=<요약 md 경로>]
 *
 * 보고 노드 분류(명도 대비 1차 측정 기준)
 * - 화면 밖: 측정 순간 화면에 보이지 않던 노드(숨김·잘림·가로 화면 밖·불투명도 0)
 * - 과도 상태: 보였지만 측정 순간 글자색이 끝 상태(애니메이션 종료 후) 글자색과 다르거나, 누적 불투명도가 1 미만(페이드 중)
 * - 정상 보고: 보였고 측정 순간 색이 끝 상태와 같음(진탐 후보 — 대비 계산 자체의 정확성은 별도 확인)
 */
import fs from "node:fs";
import path from "node:path";

const argOf = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=");
const IN = argOf("in");
const OUT = argOf("out");
if (!IN) {
  console.error("사용: node procedure-summary.mjs --in=<원자료 폴더> [--out=<요약 md>]");
  process.exit(2);
}

const key = (t) => JSON.stringify(t);
const rgb = (hex) => {
  if (!hex) return null;
  const m = hex.replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  return m ? `rgb(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)})` : null;
};

function classify(rec) {
  const firstVis = new Map();
  const pass1 = rec.visTrace?.find((f) => f.frameUrl === "main")?.passes?.[0]?.nodes ?? [];
  for (const n of pass1) firstVis.set(key(n.target), n.vis);
  const end = new Map((rec.endState ?? []).map((e) => [key(e.target), e.color]));
  const out = { offscreen: 0, transient: 0, normal: 0, unknown: 0 };
  for (const n of rec.contrast.firstPass) {
    const v = firstVis.get(key(n.target));
    if (!v || !v.found) out.unknown++;
    else if (!v.visible) out.offscreen++;
    else if ((end.get(key(n.target)) && v.color !== end.get(key(n.target))) || v.opacity < 0.99) out.transient++;
    else out.normal++;
  }
  // 2-패스 탈락 노드 중 1차 측정 때 화면에 보였던 것(실제 위반을 버렸을 가능성)
  let droppedVisible = 0;
  for (const d of rec.contrast.dropped) {
    const v = firstVis.get(key(d.target));
    if (v?.visible) droppedVisible++;
  }
  return { ...out, droppedVisible };
}

const sites = fs.readdirSync(IN).filter((d) => fs.statSync(path.join(IN, d)).isDirectory()).sort();
const rows = [];
const fails = [];
const durations = [];
for (const site of sites) {
  const byCond = {};
  for (const f of fs.readdirSync(path.join(IN, site)).filter((f) => f.endsWith(".json"))) {
    const rec = JSON.parse(fs.readFileSync(path.join(IN, site, f), "utf8"));
    durations.push(Date.parse(rec.finishedAt) - Date.parse(rec.startedAt));
    const c = rec.cond.key;
    const agg = (byCond[c] ??= { runs: 0, fail: 0, first: 0, final: 0, dropped: 0, offscreen: 0, transient: 0, normal: 0, unknown: 0, droppedVisible: 0, finalSets: [] });
    agg.runs++;
    if (!rec.ok) {
      agg.fail++;
      fails.push(`${site} ${f}: ${rec.error}`);
      continue;
    }
    agg.first += rec.contrast.firstPass.length;
    agg.final += rec.contrast.final.length;
    agg.dropped += rec.contrast.dropped.length;
    const k = classify(rec);
    for (const x of ["offscreen", "transient", "normal", "unknown", "droppedVisible"]) agg[x] += k[x];
    agg.finalSets.push(new Set(rec.contrast.final.map((n) => key(n.target))));
  }
  for (const [c, a] of Object.entries(byCond).sort()) {
    const ok = a.runs - a.fail;
    // 선택자 단위 비결정: 최종 보고된 노드 중 성공 회차 전부에 나오지 않은 것
    const counts = new Map();
    for (const s of a.finalSets) for (const k of s) counts.set(k, (counts.get(k) ?? 0) + 1);
    const nondet = [...counts.values()].filter((n) => n < ok).length;
    const per = (x) => (ok ? (x / ok).toFixed(1) : "–");
    rows.push(`| ${site} | ${c} | ${ok}/${a.runs} | ${per(a.first)} | ${per(a.final)} | ${per(a.dropped)} | ${per(a.offscreen)} | ${per(a.transient)} | ${per(a.normal)} | ${per(a.droppedVisible)} | ${counts.size} | ${nondet} |`);
  }
}

const sec = durations.length ? (durations.reduce((a, b) => a + b, 0) / durations.length / 1000).toFixed(1) : "–";
const md = [
  "# 측정 절차 평가 — 원자료 요약",
  "",
  `- 입력: \`${path.basename(IN)}\` · 로드 ${durations.length}회 · 로드당 평균 ${sec}초(측정 대기 제외)`,
  "- 값은 성공 회차당 평균 노드 수(명도 대비). 화면 밖·과도 상태·정상 보고는 1차 측정 기준 분류",
  "",
  "| 사이트 | 조건 | 성공 | 1차 | 최종 | 2-패스 탈락 | 화면 밖 | 과도 상태 | 정상 보고 | 탈락 중 보였던 것 | 최종 노드 종류 | 그중 비결정 |",
  "|---|---|---|---|---|---|---|---|---|---|---|---|",
  ...rows,
  "",
  fails.length ? `## 실패 ${fails.length}건\n\n${fails.map((f) => `- ${f.replace(/https?:\/\/\S+/g, "<url>")}`).join("\n")}` : "실패 없음",
].join("\n");
if (OUT) fs.writeFileSync(OUT, md);
console.log(md);
