/**
 * 선택자 식별 실험 — 같은 요소에 axe-core가 실행마다 다른 선택자를 붙이는지 순정 axe-core로 잰다.
 *
 * 실험 2(procedure-eval.mjs)와 같은 페이지 준비를 쓴다: 1280×800, ko-KR, 웹폰트 허용, 감속 없음,
 * 이미지·미디어 차단, DOMContentLoaded → load(최대 8초) → document.fonts.ready(최대 3초),
 * 그다음 재생 중인 유한 애니메이션 종료 대기(최대 1.5초, 연쇄 3회까지).
 * 검사 엔진 래퍼 없이 axe-core만 주입해 기본 WCAG 2 A·AA 태그 규칙 전체를 한 로드 안에서 두 번 돌린다(간격 500ms).
 * 두 실행 모두 elementRef·ancestry를 켜서, 1차 위반 요소를 페이지 안 WeakMap에 등록하고
 * 2차 결과의 요소와 실제 요소로 짝짓는다. 위치로 짐작하지 않는다.
 *
 * 세는 것(규칙별): 1차 위반 노드, 2차에서 같은 규칙으로 같은 요소가 다시 보고된 노드,
 * 그중 기본 선택자 문자열이 달라진 노드(속성·클래스 순서만 / 고른 특징이 달라짐),
 * 달라진 선택자가 2차의 같은 규칙 선택자 목록에도 없어 선택자로는 짝을 못 짓는 노드,
 * 위치 경로(ancestry)가 달라진 노드.
 * 범위: 최상위 문서만(iframes: false). 예외: 대기 단계 실패는 무시하고 측정한다.
 *
 * 원자료에는 실제 URL과 선택자가 들어가므로 공개 저장소 밖(.private 등)에 둔다.
 * 공개용은 anonymize-selector.mjs로 선택자를 뺀 집계만 남긴다.
 *
 * 실행: node selector-identity.mjs --sites=<사이트 JSON> --out=<원자료 폴더> [--runs=10] [--only=site-BN] [--gap=10000]
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);
const argOf = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=");
const SITES_FILE = argOf("sites");
const OUT = argOf("out");
const RUNS = Math.max(1, Number(argOf("runs")) || 10);
const ONLY = argOf("only")?.split(",").map((s) => s.trim()).filter(Boolean);
const GAP_MS = Math.max(0, Number(argOf("gap")) || 10_000);
const PASS_GAP_MS = 500;
const AXE_SOURCE = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

/** 유한 애니메이션 종료 대기 — 실험 2 엔진의 대기와 같은 규칙(상한 1.5초, 연쇄 3회) */
const SETTLE = `async (capMs) => {
  const deadline = Date.now() + capMs;
  for (let round = 0; round < 3; round++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return;
    const pending = document.getAnimations().filter((a) => {
      if (a.playState !== "running") return false;
      const it = a.effect?.getComputedTiming().iterations;
      return typeof it === "number" && Number.isFinite(it);
    });
    if (!pending.length) return;
    await Promise.race([Promise.all(pending.map((a) => a.finished.catch(() => undefined))), new Promise((r) => setTimeout(r, remaining))]);
  }
}`;

/** 한 번 실행: 위반 노드를 (규칙, 요소, 선택자, 위치 경로)로 돌려주고 요소는 페이지 안에 둔다 */
const RUN_PASS = `async (pass) => {
  const res = await axe.run(document, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
    resultTypes: ["violations"],
    elementRef: true,
    ancestry: true,
    iframes: false,
  });
  const key = (t) => (Array.isArray(t) ? t.map((x) => (Array.isArray(x) ? x.join(" >> ") : String(x))).join(" | ") : String(t));
  const nodes = [];
  for (const v of res.violations) for (const n of v.nodes) nodes.push({ ruleId: v.id, el: n.element ?? null, target: key(n.target), ancestry: key(n.ancestry) });
  if (pass === 1) {
    window.__siFirst = nodes;
    return { count: nodes.length };
  }
  // 2차: 1차 요소와 실제 요소로 짝짓기
  const second = new Map();
  for (const n of nodes) {
    if (!n.el) continue;
    const list = second.get(n.el) ?? [];
    list.push(n);
    second.set(n.el, list);
  }
  const secondTargets = new Map();
  for (const n of nodes) {
    const s = secondTargets.get(n.ruleId) ?? new Set();
    s.add(n.target);
    secondTargets.set(n.ruleId, s);
  }
  const out = [];
  for (const f of window.__siFirst ?? []) {
    const match = f.el ? (second.get(f.el) ?? []).find((x) => x.ruleId === f.ruleId) : undefined;
    out.push({
      ruleId: f.ruleId,
      hasElement: !!f.el,
      connected: f.el ? f.el.isConnected : null,
      matched: !!match,
      target1: f.target,
      target2: match ? match.target : null,
      ancestry1: f.ancestry,
      ancestry2: match ? match.ancestry : null,
      // 선택자 문자열로 짝을 지으면(필터가 하던 방식) 2차 같은 규칙 목록에서 찾아지는가
      selectorFound: (secondTargets.get(f.ruleId) ?? new Set()).has(f.target),
    });
  }
  return { count: nodes.length, first: out };
}`;

/** 선택자 정규화: 각 단계(복합 선택자)의 클래스·속성 순서를 정렬해 '순서만 다름'을 가린다.
 * 대괄호·괄호·따옴표 안의 공백과 결합자는 건드리지 않는다. */
export function normalizeSelector(sel) {
  const compounds = [];
  let cur = "", depth = 0, quote = null;
  const flush = (sep) => {
    if (cur) compounds.push(cur);
    if (sep) compounds.push(sep);
    cur = "";
  };
  for (let i = 0; i < sel.length; i++) {
    const c = sel[i];
    if (quote) { cur += c; if (c === "\\") { cur += sel[++i] ?? ""; } else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") { quote = c; cur += c; continue; }
    if (c === "\\") { cur += c + (sel[++i] ?? ""); continue; }
    if (c === "[" || c === "(") depth++;
    if (c === "]" || c === ")") depth--;
    if (depth === 0 && /[\s>+~|]/.test(c)) {
      let sep = c;
      while (i + 1 < sel.length && /[\s>+~|]/.test(sel[i + 1])) sep += sel[++i];
      flush(sep.trim() ? ` ${sep.trim()} ` : " ");
      continue;
    }
    cur += c;
  }
  flush();
  return compounds
    .map((part) => {
      if (/^ .* $|^ $/.test(part)) return part;
      const toks = [];
      let k = 0;
      while (k < part.length) {
        let m = part.slice(k).match(/^(\[(?:"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^\]])*\]|::?[\w-]+(?:\((?:[^()]|\([^()]*\))*\))?|\.(?:\\.|[\w-])+|#(?:\\.|[\w-])+|(?:\\.|[\w*-])+)/);
        if (!m) { toks.push(part.slice(k)); break; }
        toks.push(m[0]); k += m[0].length;
      }
      const head = toks.filter((x) => !/^[.#[:]/.test(x));
      const ids = toks.filter((x) => x.startsWith("#"));
      const cls = toks.filter((x) => x.startsWith(".")).sort();
      const attrs = toks.filter((x) => x.startsWith("[")).sort();
      const ps = toks.filter((x) => x.startsWith(":"));
      return head.join("") + ids.join("") + cls.join("") + attrs.join("") + ps.join("");
    })
    .join("");
}

export function classify(p) {
  if (!p.matched) return "notMatched";
  if (p.target1 === p.target2) return "same";
  return normalizeSelector(p.target1) === normalizeSelector(p.target2) ? "orderOnly" : "featureChanged";
}

async function measure(browser, site) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: "ko-KR",
    userAgent: "Mozilla/5.0 (compatible; contrast-flakiness-exp/0.3; research)",
  });
  const startedAt = new Date().toISOString();
  try {
    const page = await context.newPage();
    await page.route("**/*", (route) => {
      const type = route.request().resourceType();
      if (type === "image" || type === "media") return route.abort();
      return route.continue();
    });
    const resp = await page.goto(site.url, { waitUntil: "domcontentloaded", timeout: 25_000 });
    await page.waitForLoadState("load", { timeout: 8_000 }).catch(() => undefined);
    await Promise.race([page.evaluate(() => document.fonts.ready.then(() => undefined)), page.waitForTimeout(3_000)]).catch(() => undefined);
    await Promise.race([page.evaluate(`(${SETTLE})(1500)`), page.waitForTimeout(1_700)]).catch(() => undefined);
    await page.addScriptTag({ content: AXE_SOURCE });
    const t0 = Date.now();
    const p1 = await page.evaluate(`(${RUN_PASS})(1)`);
    const pass1Ms = Date.now() - t0;
    await page.waitForTimeout(PASS_GAP_MS);
    const p2 = await page.evaluate(`(${RUN_PASS})(2)`);
    const nodes = (p2.first ?? []).map((p) => ({ ...p, kind: classify(p), ancestryChanged: p.matched ? p.ancestry1 !== p.ancestry2 : null }));
    return { ok: true, startedAt, finishedAt: new Date().toISOString(), httpStatus: resp?.status() ?? null, pass1Count: p1.count, pass2Count: p2.count, pass1Ms, nodes };
  } catch (e) {
    return { ok: false, startedAt, finishedAt: new Date().toISOString(), error: String(e?.message ?? e).split("\n")[0].slice(0, 300) };
  } finally {
    await context.close().catch(() => undefined);
  }
}

async function main() {
  if (!SITES_FILE || !OUT) {
    console.error("사용: node selector-identity.mjs --sites=<사이트 JSON> --out=<원자료 폴더> [--runs=10] [--only=…] [--gap=10000]");
    process.exit(2);
  }
  const { sites: all } = JSON.parse(fs.readFileSync(SITES_FILE, "utf8"));
  const sites = ONLY ? all.filter((s) => ONLY.includes(s.id)) : all;
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const env = {
    node: process.version,
    os: `${os.platform()} ${os.release()} ${os.arch()}`,
    playwright: require("playwright/package.json").version,
    chromium: browser.version(),
    axeCore: require("axe-core/package.json").version,
    rules: "wcag2a+wcag2aa (axe-core 기본 태그)",
    passGapMs: PASS_GAP_MS,
    runs: RUNS,
    gapMs: GAP_MS,
  };
  const envPath = path.join(OUT, "env.json");
  const firstStart = fs.existsSync(envPath) ? JSON.parse(fs.readFileSync(envPath, "utf8")).startedAt : new Date().toISOString();
  fs.writeFileSync(envPath, JSON.stringify({ ...env, startedAt: firstStart, sites: sites.map((s) => s.id) }, null, 2));
  const lastLoad = new Map();
  const total = RUNS * sites.length;
  let done = 0;
  // 회차마다 모든 사이트를 한 번씩 돈다(같은 사이트 로드 사이에 다른 사이트가 끼고, 최소 간격은 GAP_MS로 보장)
  for (let round = 1; round <= RUNS; round++) {
    for (const site of sites) {
      done++;
      const file = path.join(OUT, site.id, `r${String(round).padStart(2, "0")}.json`);
      if (fs.existsSync(file)) continue;
      const wait = (lastLoad.get(site.id) ?? 0) + GAP_MS - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastLoad.set(site.id, Date.now());
      const rec = await measure(browser, site);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ site: site.id, group: site.group, url: site.url, round, env, ...rec }));
      const msg = rec.ok
        ? `1차 ${rec.pass1Count}, 같은 요소 ${rec.nodes.filter((n) => n.matched).length}, 선택자 바뀜 ${rec.nodes.filter((n) => n.kind === "orderOnly" || n.kind === "featureChanged").length}`
        : `실패: ${rec.error}`;
      console.log(`[${done}/${total}] ${site.id} r${round} ${msg}`);
    }
  }
  await browser.close();
  const prev = JSON.parse(fs.readFileSync(envPath, "utf8"));
  fs.writeFileSync(envPath, JSON.stringify({ ...prev, finishedAt: new Date().toISOString() }, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
