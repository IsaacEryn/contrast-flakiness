/**
 * 논문 B 분석 — 8월 렌더링 조건 실험 재분석(A1~A4)과 측정 절차 평가(B1~B5) 표를 만든다.
 * 계획: paper/plans/analysis-plan.md. 원칙: 같은 횟수끼리 비교(합집합 금지), 사이트 단위 집계, 요인 분해,
 * 검정보다 효과 크기와 구간.
 *
 * 실행: node procedure-analysis.mjs [--august=dataset] [--procedure=<측정 절차 원자료 폴더>] [--fixed=<수정 엔진 원자료 폴더>] [--out=<결과 md>]
 *   --procedure는 procedure-eval.mjs의 원자료(비공개) 또는 같은 형식의 익명 공개본(dataset/procedure-eval)을 받는다.
 *   출력에는 사이트 ID와 집계값만 나온다.
 */
import fs from "node:fs";
import path from "node:path";

const argOf = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=");
const AUG = argOf("august") ?? "dataset";
const PROC = argOf("procedure");
const FIXED = argOf("fixed"); // 필터 수정 엔진으로 다시 잰 같은 형식의 원자료(선택)
const OUT = argOf("out");
const SEED = 20261020;
const BOOT = 10_000;

// ── 공통 통계 ──
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
function bootstrapMeanCI(diffs, seed = SEED) {
  if (diffs.length < 2) return [NaN, NaN];
  const r = rng(seed);
  const ms = [];
  for (let b = 0; b < BOOT; b++) {
    let s = 0;
    for (let i = 0; i < diffs.length; i++) s += diffs[Math.floor(r() * diffs.length)];
    ms.push(s / diffs.length);
  }
  ms.sort((a, b) => a - b);
  return [ms[Math.floor(0.025 * BOOT)], ms[Math.floor(0.975 * BOOT)]];
}
/** 부호 검정(정확, 양측): 0이 아닌 차이만 센다 */
function signTest(diffs) {
  const pos = diffs.filter((d) => d > 0).length;
  const neg = diffs.filter((d) => d < 0).length;
  const n = pos + neg;
  if (!n) return { pos, neg, ties: diffs.length, p: 1 };
  const k = Math.min(pos, neg);
  let c = 1, tail = 0;
  for (let i = 0; i <= n; i++) {
    if (i > 0) c = (c * (n - i + 1)) / i;
    if (i <= k) tail += c;
  }
  return { pos, neg, ties: diffs.length - n, p: Math.min(1, (2 * tail) / 2 ** n) };
}
const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : "–");
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : "–");
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : "–");
const ci = ([lo, hi]) => (Number.isFinite(lo) ? `[${f1(lo)}, ${f1(hi)}]` : "–");
const pval = (p) => (p < 0.001 ? "<0.001" : p.toFixed(3));
const table = (head, rows) => [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");

const out = [];
const say = (s = "") => out.push(s);

// ═════════ A. 8월 렌더링 조건 실험 재분석 ═════════
function august() {
  const C = ["base", "rm", "font", "rm+font"];
  const R = JSON.parse(fs.readFileSync(path.join(AUG, "results-combined.json"), "utf8"));
  const ok = R.filter((s) => C.every((c) => s.conditions[c]?.ok));
  const sumInc = (s, c) => s.conditions[c].nodes.reduce((a, n) => a + n.incidence, 0);
  const EXCL = new Set(["site-BN", "site-DJ"]);

  say("## A. 렌더링 조건 실험(2026-08) 재분석");
  say();
  say(`대상 ${ok.length}곳(4조건 모두 측정 성공), 조건당 5회. 회당 기대 위반 수 = 요소 발생률의 합.`);
  say();

  // A1 회당 기대 위반 수와 기준(base) 대비 사이트별 차이
  const rowsA1 = [];
  for (const scope of ["전체", "BN·DJ 제외"]) {
    const sites = ok.filter((s) => scope === "전체" || !EXCL.has(s.host));
    for (const c of C) {
      const tot = sites.reduce((a, s) => a + sumInc(s, c), 0);
      if (c === "base") {
        rowsA1.push([scope, c, f1(tot), "–", "–", "–"]);
        continue;
      }
      const diffs = sites.map((s) => sumInc(s, c) - sumInc(s, "base"));
      const st = signTest(diffs.map((d) => Math.round(d * 1000) / 1000));
      rowsA1.push([scope, c, f1(tot), f2(mean(diffs)), ci(bootstrapMeanCI(diffs)), `${st.pos}↑ ${st.neg}↓ ${st.ties}= (p=${pval(st.p)})`]);
    }
  }
  say("### A1 회당 기대 위반 수 (base 대비 사이트별 차이)");
  say();
  say(table(["범위", "조건", "합계(회당)", "사이트 평균 차이", "95% 구간(사이트 부트스트랩)", "부호 검정"], rowsA1));
  say();

  // A2 요인 분해 — 라벨 확정 결과(오탐/진탐/경계)를 조건별로
  const A = JSON.parse(fs.readFileSync(path.join(AUG, "labeling-assist.json"), "utf8"));
  const V = new Map();
  for (const f of fs.readdirSync(AUG).filter((f) => f.startsWith("label-verify-site-"))) {
    const j = JSON.parse(fs.readFileSync(path.join(AUG, f), "utf8"));
    for (const d of j.detail) V.set(`${j.host}|${d.selector}|${d.direction}`, d.verdict);
  }
  const verdictOf = (a) => {
    const v = V.get(`${a.host}|${a.selector}|${a.direction}`) ?? "";
    return v.startsWith("오탐") ? "FP" : v.startsWith("진탐") ? "TP" : "B";
  };
  const rowsA2 = [];
  for (const scope of ["전체", "BN·DJ 제외"]) {
    for (const c of ["rm", "font", "rm+font"]) {
      const x = { goneFP: 0, goneTP: 0, goneB: 0, addFP: 0, addTP: 0, addB: 0 };
      for (const a of A) {
        if (scope !== "전체" && EXCL.has(a.host)) continue;
        if (!a.conds.includes(c)) continue;
        const v = verdictOf(a);
        x[`${a.direction === "gone" ? "gone" : "add"}${v}`]++;
      }
      rowsA2.push([scope, c, x.goneFP, x.goneTP, x.goneB, x.addFP, x.addTP, x.addB]);
    }
  }
  say("### A2 조건 전환이 걷어낸·만든 위반 (요인별, 5회 안정 상태 재측정 라벨)");
  say();
  say("한 요소가 여러 조건에 걸칠 수 있어 행끼리 더하지 않는다. 라벨의 한계는 A3·B 결과와 함께 읽는다.");
  say();
  say(table(["범위", "조건", "사라짐 오탐", "사라짐 진탐", "사라짐 경계", "생김 오탐", "생김 진탐", "생김 경계"], rowsA2));
  say();

  // A3 선택자 단위 vs 스타일 묶음 단위 비결정
  const groupKey = (n) => `${n.fgColor}|${n.bgColor}|${n.contrastRatio}|${n.fontSize}|${n.fontWeight}`;
  const rowsA3 = [];
  let selN = 0, selND = 0, grpN = 0, grpND = 0;
  for (const s of ok) {
    for (const c of C) {
      const nodes = s.conditions[c].nodes;
      const nd = nodes.filter((n) => n.incidence > 0 && n.incidence < 1).length;
      const groups = new Map();
      for (const n of nodes) groups.set(groupKey(n), (groups.get(groupKey(n)) ?? 0) + n.incidence);
      // 묶음 발생률 합이 정수가 아니면 회차마다 묶음의 보고 수가 달랐다는 뜻(정수여도 일정하다는 보장은 없다 — 하한)
      const gnd = [...groups.values()].filter((v) => Math.abs(v - Math.round(v)) > 1e-6).length;
      selN += nodes.length; selND += nd; grpN += groups.size; grpND += gnd;
      if (nd > 0) rowsA3.push([s.host, c, `${nd}/${nodes.length}`, `${gnd}/${groups.size}`]);
    }
  }
  say("### A3 '비결정'은 선택자 단위에서만 큰가");
  say();
  say(`선택자 단위 비결정: ${selND}/${selN} (${pct(selND, selN)}). 스타일 묶음(전경·배경·대비·글자 크기·굵기) 단위에서 회당 보고 수가 달랐다고 확인되는 묶음: ${grpND}/${grpN} (${pct(grpND, grpN)}, 하한).`);
  say();
  say(table(["사이트", "조건", "선택자 비결정", "묶음 비결정(하한)"], rowsA3));
  say();

  // A4 결정적인 조건 효과 — 한 조건에서 5/5, 다른 조건에서 0/5
  const rowsA4 = [];
  for (const s of ok) {
    const inc = new Map();
    for (const c of C) for (const n of s.conditions[c].nodes) (inc.get(n.selector) ?? inc.set(n.selector, {}).get(n.selector))[c] = n.incidence;
    for (const [sel, m] of inc) {
      const v = C.map((c) => m[c] ?? 0);
      if (v.some((x) => x === 1) && v.some((x) => x === 0)) {
        const n = C.map((c) => s.conditions[c].nodes.find((x) => x.selector === sel)).find(Boolean);
        rowsA4.push([s.host, sel, n?.contrastRatio ?? "–", C.map((c, i) => `${c} ${v[i]}`).join(", ")]);
      }
    }
  }
  say("### A4 조건이 결정적으로 바꾼 요소 (어떤 조건에서 5/5, 다른 조건에서 0/5)");
  say();
  say(rowsA4.length ? table(["사이트", "요소", "대비", "조건별 발생률"], rowsA4) : "없음");
  say();
}

// ═════════ B. 측정 절차 평가 ═════════
function procedure() {
  const P = ["P0", "P1", "P2", "P3"];
  const recs = [];
  for (const site of fs.readdirSync(PROC).filter((d) => d.startsWith("site-")).sort()) {
    for (const f of fs.readdirSync(path.join(PROC, site)).filter((f) => f.endsWith(".json"))) {
      const r = JSON.parse(fs.readFileSync(path.join(PROC, site, f), "utf8"));
      if (r.ok) recs.push(r);
    }
  }
  const key = (t) => JSON.stringify(t);
  const groupKey = (n) => `${n.fgColor}|${n.bgColor}|${n.contrastRatio}|${n.fontSize}|${n.fontWeight}`;
  const env = recs[0]?.env ?? {};
  const sites = [...new Set(recs.map((r) => r.site))].sort();
  const groupOf = new Map(recs.map((r) => [r.site, r.group]));
  const by = (site, c) => recs.filter((r) => r.site === site && r.cond.key === c);

  // 노드별로 보고된 모든 로드에서 관측한 최댓값 — 누적 불투명도와 대비. 페이드 중인 노드는 로드마다
  // 측정 색(대비)이 달라지고, 설계상 반투명한 노드는 늘 같은 값이다. 끝 상태 불투명도는 2026-10-20 하네스부터 기록한다.
  // 한계: 최댓값은 보고된 로드에서만 관측되므로 가장 진한 로드의 페이드는 비과도로 남는다.
  const maxOpacity = new Map();
  const maxRatio = new Map();
  for (const r of recs) {
    for (const v of r.visTrace?.find((x) => x.frameUrl === "main")?.passes ?? []) {
      for (const n of v.nodes ?? []) {
        if (typeof n.vis?.opacity !== "number") continue;
        const k = `${r.site}|${key(n.target)}`;
        maxOpacity.set(k, Math.max(maxOpacity.get(k) ?? 0, n.vis.opacity));
      }
    }
    for (const n of r.contrast.firstPass) {
      const k = `${r.site}|${key(n.target)}`;
      if (typeof n.contrastRatio === "number") maxRatio.set(k, Math.max(maxRatio.get(k) ?? 0, n.contrastRatio));
    }
  }

  // 노드 분류(1차 측정 기준)
  function cls(r) {
    const ratioOf = new Map([...r.contrast.firstPass, ...r.contrast.dropped].map((n) => [key(n.target), n.contrastRatio]));
    const vis = new Map((r.visTrace?.find((v) => v.frameUrl === "main")?.passes?.[0]?.nodes ?? []).map((n) => [key(n.target), n.vis]));
    const end = new Map((r.endState ?? []).map((e) => [key(e.target), e]));
    return (target) => {
      const v = vis.get(key(target));
      if (!v || !v.found) return "unknown";
      const e = end.get(key(target));
      const k = `${r.site}|${key(target)}`;
      const usual = Math.max(maxOpacity.get(k) ?? 0, typeof e?.opacity === "number" ? e.opacity : 0);
      const ratio = ratioOf.get(key(target));
      const transient = (e?.color && v.color !== e.color) || v.opacity < usual - 0.01 || (typeof ratio === "number" && ratio < (maxRatio.get(k) ?? 0) - 0.05);
      if (transient) return "transient";
      if (!v.visible) return "hidden";
      return "visible";
    };
  }

  say("## B. 측정 절차 평가 (유한 애니메이션 종료 대기 × 2-패스 필터)");
  say();
  say(`대상 ${sites.length}곳(A군 ${sites.filter((s) => groupOf.get(s) === "A").length}, B군 ${sites.filter((s) => groupOf.get(s) === "B").length}), 조건당 ${env.runs ?? "?"}회, 성공 로드 ${recs.length}. 엔진 a11ychk ${String(env.a11ychkCommit ?? "").slice(0, 7)}, axe-core ${env.axeCore}, Playwright ${env.playwright}, Chromium ${env.chromium}.`);
  say("P0 단일 측정 · P1 대기만 · P2 필터만 · P3 실서비스(둘 다).");
  say();

  // B1 회당 최종 보고 수
  const perRun = (site, c, f) => mean(by(site, c).map(f));
  const finalN = (r) => r.contrast.final.length;
  const rowsB1 = [];
  for (const g of ["A", "B", "전체"]) {
    const ss = sites.filter((s) => g === "전체" || groupOf.get(s) === g);
    for (const c of P) {
      const tot = ss.reduce((a, s) => a + perRun(s, c, finalN), 0);
      if (c === "P0") {
        rowsB1.push([g, c, f1(tot), "–", "–", "–"]);
        continue;
      }
      const diffs = ss.map((s) => perRun(s, c, finalN) - perRun(s, "P0", finalN));
      const st = signTest(diffs.map((d) => Math.round(d * 1000) / 1000));
      rowsB1.push([g, c, f1(tot), f2(mean(diffs)), ci(bootstrapMeanCI(diffs)), `${st.pos}↑ ${st.neg}↓ ${st.ties}= (p=${pval(st.p)})`]);
    }
  }
  say("### B1 회당 최종 명도 대비 보고 수 (P0 대비 사이트별 차이)");
  say();
  say(table(["군", "조건", "합계(회당)", "사이트 평균 차이", "95% 구간(사이트 부트스트랩)", "부호 검정"], rowsB1));
  say();

  // B2 1차 보고의 분류 — 종료 대기의 효과
  const rowsB2 = [];
  for (const c of P) {
    const x = { visible: 0, transient: 0, hidden: 0, unknown: 0 };
    let runs = 0;
    for (const r of recs.filter((r) => r.cond.key === c)) {
      runs++;
      const k = cls(r);
      for (const n of r.contrast.firstPass) x[k(n.target)]++;
    }
    rowsB2.push([c, runs, f2(x.visible / runs), f2(x.transient / runs), f2(x.hidden / runs), f2(x.unknown / runs)]);
  }
  say("### B2 1차 측정 보고의 분류 (로드당 평균)");
  say();
  say("과도 상태 = 측정 순간 글자색이 끝 상태와 다르거나, 누적 불투명도나 측정 대비가 그 노드의 평소 값(보고된 모든 로드의 최댓값)보다 낮음. 숨김 = 크기 0·숨김 속성·잘림·가로 화면 밖.");
  say();
  say(table(["조건", "로드", "보이는 보고", "과도 상태", "숨김", "판단 불가"], rowsB2));
  say();

  // B3 2-패스 필터가 버린 것
  const rowsB3 = [];
  const uniq = { visible: new Set(), transient: new Set(), hidden: new Set(), unknown: new Set() };
  for (const s of sites) {
    for (const c of ["P2", "P3"]) {
      const x = { visible: 0, transient: 0, hidden: 0, unknown: 0 };
      for (const r of by(s, c)) {
        const k = cls(r);
        for (const d of r.contrast.dropped) {
          const t = k(d.target);
          x[t]++;
          uniq[t].add(`${s}|${key(d.target)}`);
        }
      }
      const tot = x.visible + x.transient + x.hidden + x.unknown;
      if (tot) rowsB3.push([s, groupOf.get(s), c, tot, x.visible, x.transient, x.hidden, x.unknown]);
    }
  }
  say("### B3 2-패스 필터가 결과에서 뺀 노드 (회차 합)");
  say();
  say("보이는 비과도 = 1차 측정 때 화면에 보였고 과도 상태가 아니었던 노드(실제 위반을 버렸을 가능성). 사람 확인 결과는 별도로 붙인다.");
  say();
  say(table(["사이트", "군", "조건", "탈락", "보이는 비과도", "과도 상태", "숨김", "판단 불가"], rowsB3));
  say();
  // 원고 표 2용 — 23곳 합계를 회차로 나눈 회당 값
  const rounds = Math.max(...recs.map((r) => r.round));
  const totB3 = ["P2", "P3"].map((c) => {
    const x = { all: 0, visible: 0, transient: 0, hidden: 0, unknown: 0 };
    for (const r of recs.filter((r) => r.cond.key === c)) {
      const k = cls(r);
      for (const d of r.contrast.dropped) { x.all++; x[k(d.target)]++; }
    }
    return [c, f1(x.all / rounds), f1(x.visible / rounds), f1(x.transient / rounds), f1(x.hidden / rounds), f1(x.unknown / rounds)];
  });
  // 필터가 뺀 노드가 확정 패스에서 같은 위치·크기·색으로 다시 보고되었는가 — 같은 요소를 axe가 다른 선택자로 부른 경우
  const reid = new Map();
  for (const r of recs.filter((r) => r.cond.stabilityFilter && r.contrast.dropped.length)) {
    const passes = r.visTrace?.find((v) => v.frameUrl === "main")?.passes ?? [];
    if (passes.length < 2) continue;
    const p1 = new Map((passes[0].nodes ?? []).map((n) => [key(n.target), n.vis]));
    const p2 = passes[1].nodes ?? [];
    for (const d of r.contrast.dropped) {
      const v = p1.get(key(d.target));
      const x = reid.get(r.site) ?? { dropped: 0, same: 0 };
      x.dropped++;
      if (v && p2.some((n) => n.vis && n.vis.x === v.x && n.vis.y === v.y && n.vis.w === v.w && n.vis.h === v.h && n.vis.color === v.color)) x.same++;
      reid.set(r.site, x);
    }
  }
  say("필터가 뺀 노드 중 확정 패스에서 같은 위치·크기·색으로 다시 보고된 것(같은 요소, 다른 선택자 — 회차 합, P2·P3):");
  say();
  const reidRows = [...reid].sort().map(([s, x]) => [s, x.dropped, x.same, pct(x.same, x.dropped)]);
  const reidTot = [...reid.values()].reduce((a, x) => ({ dropped: a.dropped + x.dropped, same: a.same + x.same }), { dropped: 0, same: 0 });
  reidRows.push(["합계", reidTot.dropped, reidTot.same, pct(reidTot.same, reidTot.dropped)]);
  say(table(["사이트", "탈락", "같은 자리 재보고", "비율"], reidRows));
  say();

  say("회당 합계(전 사이트, 원고 표 2):");
  say();
  say(table(["조건", "탈락", "보이는 비과도", "과도 상태", "숨김", "판단 불가"], totB3));
  say();
  // 대기 민감 노드: 1차 보고가 대기 없는 조건(P0·P2)에서만 나오고 대기 조건(P1·P3)에서는 한 번도 없음 — 페이드 중 보고의 직접 증거
  const firstConds = new Map();
  for (const r of recs) for (const n of r.contrast.firstPass) {
    const k = `${r.site}|${key(n.target)}`;
    (firstConds.get(k) ?? firstConds.set(k, new Set()).get(k)).add(r.cond.key);
  }
  const droppedKeys = new Set(Object.values(uniq).flatMap((s) => [...s]));
  const waitSensitive = [...droppedKeys].filter((k) => { const c = firstConds.get(k) ?? new Set(); return !c.has("P1") && !c.has("P3") && (c.has("P0") || c.has("P2")); });
  say(`고유 탈락 노드 ${droppedKeys.size}개(한 노드가 로드마다 다르게 분류될 수 있어 분류별 합은 이보다 크다): 보이는 비과도로 분류된 적 있음 ${uniq.visible.size}, 과도 상태 ${uniq.transient.size}, 숨김 ${uniq.hidden.size}, 판단 불가 ${uniq.unknown.size}.`);
  say(`그중 대기 민감(1차 보고가 P0·P2에서만, P1·P3에서는 한 번도 없음): ${waitSensitive.length}개 — 사이트별 ${Object.entries(waitSensitive.reduce((a, k) => ((a[k.split("|")[0]] = (a[k.split("|")[0]] ?? 0) + 1), a), {})).map(([s, n]) => `${s} ${n}`).join(", ") || "없음"}.`);
  say();

  // B4 반복 측정 안정성
  const rowsB4 = [];
  for (const s of sites) {
    for (const c of P) {
      const rs = by(s, c);
      const sets = rs.map((r) => new Set(r.contrast.final.map((n) => key(n.target))));
      const cnt = new Map();
      for (const st of sets) for (const k of st) cnt.set(k, (cnt.get(k) ?? 0) + 1);
      const selND = [...cnt.values()].filter((v) => v < rs.length).length;
      const gcounts = new Map();
      rs.forEach((r, i) => {
        for (const n of r.contrast.final) {
          const g = groupKey(n);
          if (!gcounts.has(g)) gcounts.set(g, Array(rs.length).fill(0));
          gcounts.get(g)[i]++;
        }
      });
      const grpND = [...gcounts.values()].filter((v) => new Set(v).size > 1).length;
      let jac = 0, pairs = 0;
      for (let i = 0; i < sets.length; i++)
        for (let j = i + 1; j < sets.length; j++) {
          const a = sets[i], b = sets[j];
          const inter = [...a].filter((k) => b.has(k)).length;
          const uni = new Set([...a, ...b]).size;
          jac += uni ? inter / uni : 1;
          pairs++;
        }
      if (cnt.size) rowsB4.push([s, c, `${selND}/${cnt.size}`, `${grpND}/${gcounts.size}`, f2(pairs ? jac / pairs : 1)]);
    }
  }
  say("### B4 반복 측정 안정성 (최종 보고 기준, 보고가 있는 사이트만)");
  say();
  say("선택자 비결정 = 일부 회차에만 나온 선택자. 묶음 비결정 = 회차마다 보고 수가 달라진 스타일 묶음(측정된 색 기준이라 페이드 중간 색은 따로 한 묶음이 된다). 자카드 = 회차 쌍의 최종 집합 유사도 평균.");
  say();
  say(table(["사이트", "조건", "선택자 비결정", "묶음 비결정", "자카드"], rowsB4));
  say();

  // B5 비용
  say("### B5 엔진 시간 (로드당 중앙값, ms)");
  say();
  say(table(["조건", "중앙값"], P.map((c) => [c, String(Math.round(median(recs.filter((r) => r.cond.key === c).map((r) => r.engineMs))))])));
  say();
}

function fixedCompare() {
  const key = (t) => JSON.stringify(t);
  const load = (dir) => {
    const out = [];
    for (const site of fs.readdirSync(dir).filter((d) => d.startsWith("site-")).sort())
      for (const f of fs.readdirSync(path.join(dir, site)).filter((f) => f.endsWith(".json"))) {
        const r = JSON.parse(fs.readFileSync(path.join(dir, site, f), "utf8"));
        if (r.ok) out.push(r);
      }
    return out;
  };
  const before = load(PROC), after = load(FIXED);
  const env = after[0]?.env ?? {};
  const sites = [...new Set(after.map((r) => r.site))].sort();
  const per = (rs, site, c, f) => { const xs = rs.filter((r) => r.site === site && r.cond.key === c); return xs.length ? mean(xs.map(f)) : NaN; };
  const fin = (r) => r.contrast.final.length;
  say("## C. 필터 수정 전후 (같은 하네스, 같은 23곳)");
  say();
  say(`수정 전 엔진 a11ychk ${String(before[0]?.env?.a11ychkCommit ?? "").slice(0, 7)}, 수정 후 ${String(env.a11ychkCommit ?? "").slice(0, 7)}. 조건당 ${env.runs ?? "?"}회. 값은 회당 최종 명도 대비 보고 수.`);
  say();
  const rows = [];
  const diffsBefore = [], diffsAfter = [];
  for (const s of sites) {
    const b0 = per(before, s, "P0", fin), b3 = per(before, s, "P3", fin), a0 = per(after, s, "P0", fin), a3 = per(after, s, "P3", fin), a2 = per(after, s, "P2", fin);
    const xs = after.filter((r) => r.site === s && r.cond.stabilityFilter);
    const n = xs.length || 1;
    // 같은 요소로 유지 = 최종 결과에 남았지만 확정 패스 선택자 목록에 없고 숨김 유지도 아닌 노드
    // (엔진 cd4d37f의 추적 목록은 선택자로 확정된 노드까지 담아, f0cbfbf에서 고친 의미로 여기서 다시 센다)
    const rescued = (r) => {
      const p2 = new Set((r.visTrace?.find((v) => v.frameUrl === "main")?.passes?.[1]?.nodes ?? []).map((n) => key(n.target)));
      const hidden = new Set((r.contrast.keptHidden ?? []).map((n) => key(n.target)));
      return r.contrast.final.filter((n) => !p2.has(key(n.target)) && !hidden.has(key(n.target))).length;
    };
    const sameEl = xs.reduce((a, r) => a + rescued(r), 0) / n;
    const hid = xs.reduce((a, r) => a + (r.contrast.keptHidden?.length ?? 0), 0) / n;
    const drop = xs.reduce((a, r) => a + r.contrast.dropped.length, 0) / n;
    diffsBefore.push(b3 - b0); diffsAfter.push(a3 - a0);
    if (b3 !== b0 || a3 !== a0 || sameEl || hid || drop) rows.push([s, f1(b0), f1(b3), f1(a0), f1(a3), f1(a2), f2(sameEl), f2(hid), f2(drop)]);
  }
  say(table(["사이트", "전 P0", "전 P3", "후 P0", "후 P3", "후 P2", "같은 요소로 유지(필터 켬, 회당)", "숨김으로 유지", "여전히 탈락"], rows));
  say();
  say(`P3−P0 사이트 평균: 수정 전 ${f2(mean(diffsBefore))} ${ci(bootstrapMeanCI(diffsBefore))}, 수정 후 ${f2(mean(diffsAfter))} ${ci(bootstrapMeanCI(diffsAfter))}.`);
  say();
}

say("# 논문 B 분석 결과");
say();
say(`생성: ${new Date().toISOString()} · 부트스트랩 ${BOOT}회, 시드 ${SEED}`);
say();
august();
if (PROC) procedure();
if (PROC && FIXED) fixedCompare();
const md = out.join("\n");
if (OUT) fs.writeFileSync(OUT, md);
console.log(md);
