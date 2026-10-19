/**
 * 측정 절차 평가 하네스 — 실서비스 검사 엔진(a11ychk runAxeOnPage)의 측정 절차를 그대로 쓰고,
 * 유한 애니메이션 종료 대기와 2-패스 안정성 필터만 켜고 끈 4조건을 같은 페이지에 반복 적용한다.
 *
 *   P0 단일 측정   (대기 끔, 필터 끔)
 *   P1 대기만      (대기 켬, 필터 끔)
 *   P2 필터만      (대기 끔, 필터 켬)
 *   P3 실서비스    (대기 켬, 필터 켬)
 *
 * 2026-08 실험(contrast-falsepos.mjs)과 다른 점
 * - 렌더링 조건은 실서비스 웹 검사와 같게 고정한다: 웹폰트 허용, 감속 없음, 뷰포트 1280×800, ko-KR,
 *   이미지·미디어 차단, DOMContentLoaded → load(최대 8초) → document.fonts.ready(최대 3초) 뒤 검사.
 * - 회차마다 원자료를 저장한다(이어서 실행 가능).
 * - 조건 순서를 사이트·회차마다 고정 시드로 섞고, 같은 사이트의 연속 로드 사이에 최소 간격을 둔다.
 * - axe가 돈 바로 그 순간에 위반 노드마다 화면 노출 정보(보이는지, 가려졌는지, 회전 콘텐츠 안인지)를 기록한다.
 *   엔진이 끝난 뒤에 재면 2-패스의 500ms 사이에 캐러셀 슬라이드가 바뀌기 때문이다.
 *
 * 준비: npm install && node build-core.mjs --a11ychk=<a11ychk 경로>   (vendor/a11ychk-runaxe.mjs 생성)
 * 실행: node procedure-eval.mjs --sites=<사이트 JSON> --out=<원자료 폴더> [--runs=10] [--only=site-BN,site-DJ] [--gap=10000]
 *   사이트 JSON: { "sites": [ { "id": "site-BN", "url": "https://…", "group": "A" }, … ] }
 *   원자료에는 실제 URL과 선택자가 들어가므로 공개 저장소 밖(.private 등)에 둔다.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { runAxeOnPage } from "./vendor/a11ychk-runaxe.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const argOf = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=");

const SITES_FILE = argOf("sites");
const OUT = argOf("out");
const RUNS = Math.max(1, Number(argOf("runs")) || 10);
const ONLY = argOf("only")?.split(",").map((s) => s.trim()).filter(Boolean);
const GAP_MS = Math.max(0, Number(argOf("gap")) || 10_000);
const SEED = Number(argOf("seed")) || 20261019;
if (!SITES_FILE || !OUT) {
  console.error("사용: node procedure-eval.mjs --sites=<사이트 JSON> --out=<원자료 폴더> [--runs=10] [--only=…] [--gap=10000]");
  process.exit(2);
}

export const CONDITIONS = [
  { key: "P0", settleAnimations: false, stabilityFilter: false },
  { key: "P1", settleAnimations: true, stabilityFilter: false },
  { key: "P2", settleAnimations: false, stabilityFilter: true },
  { key: "P3", settleAnimations: true, stabilityFilter: true },
];

// ── 고정 시드 무작위 (mulberry32) ──
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (s) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);
function shuffled(list, seed) {
  const r = rng(seed);
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 실행 순서: 회차 → 자리(0~3) → 사이트. 사이트마다 회차별 조건 순서를 섞고, 같은 사이트의
 * 다음 로드는 다른 사이트를 모두 거친 뒤에 오게 한다(최소 간격은 GAP_MS로 따로 보장).
 */
export function schedule(siteIds, runs, seed) {
  const tasks = [];
  for (let round = 1; round <= runs; round++) {
    const orders = new Map(siteIds.map((id) => [id, shuffled(CONDITIONS, seed ^ hash(`${id}#${round}`))]));
    for (let slot = 0; slot < CONDITIONS.length; slot++) {
      for (const id of siteIds) tasks.push({ id, round, slot, cond: orders.get(id)[slot] });
    }
  }
  return tasks;
}

// ── 페이지 안에서 실행: axe 결과의 color-contrast 노드마다 화면 노출 정보 ──
const VIS_RECORDER = `async (run) => {
  const res = await run();
  try {
    const W = window.innerWidth;
    const find = (target) => {
      // axe target: 프레임 안에서 ["sel"] 또는 그림자 DOM이면 [["host","inner"]]
      const t = target[target.length - 1];
      if (typeof t === "string") return document.querySelector(t);
      if (Array.isArray(t)) {
        let root = document;
        let el = null;
        for (const s of t) { el = root.querySelector(s); if (!el) return null; root = el.shadowRoot || el; }
        return el;
      }
      return null;
    };
    const visOf = (el) => {
      if (!el) return { found: false };
      const r = el.getBoundingClientRect();
      let opacity = 1, hiddenBy = null, clipped = false, rotating = false;
      for (let a = el; a && a.nodeType === 1; a = a.parentElement) {
        const s = getComputedStyle(a);
        opacity *= Number(s.opacity);
        if (!hiddenBy && (s.visibility === "hidden" || s.display === "none")) hiddenBy = "css";
        if (!hiddenBy && a.getAttribute("aria-hidden") === "true") hiddenBy = "aria-hidden";
        if (!hiddenBy && a.inert) hiddenBy = "inert";
        const cls = (typeof a.className === "string" ? a.className : "") + " " + (a.getAttribute("aria-roledescription") || "");
        if (/carousel|swiper|slick|splide|owl-|flicking|bx-|rolling|slider|slide/i.test(cls)) rotating = true;
        if (a !== el && /hidden|clip/.test(s.overflowX + " " + s.overflowY)) {
          const ar = a.getBoundingClientRect();
          const ix = Math.min(r.right, ar.right) - Math.max(r.left, ar.left);
          const iy = Math.min(r.bottom, ar.bottom) - Math.max(r.top, ar.top);
          if (ix <= 0 || iy <= 0) clipped = true;
        }
      }
      const inHorizontal = r.right > 0 && r.left < W;
      const visible = r.width > 0 && r.height > 0 && !hiddenBy && !clipped && inHorizontal && opacity > 0.01;
      return {
        found: true, visible, hiddenBy, clipped, inHorizontal, rotating,
        opacity: Math.round(opacity * 1000) / 1000,
        x: Math.round(r.left), y: Math.round(r.top + window.scrollY), w: Math.round(r.width), h: Math.round(r.height),
        color: getComputedStyle(el).color,
      };
    };
    const nodes = [];
    for (const v of res.violations || []) {
      if (v.id !== "color-contrast") continue;
      for (const n of v.nodes) nodes.push({ target: n.target, vis: visOf(find(n.target)) });
    }
    (window.__visTrace = window.__visTrace || []).push({ at: Math.round(performance.now()), nodes });
  } catch (e) {
    (window.__visTrace = window.__visTrace || []).push({ error: String(e) });
  }
  return res;
}`;

/** 엔진이 부르는 frame.evaluate("window.axe.run(…)")를 감싸, 결과가 나온 순간의 노출 정보를 남긴다 */
function patchFrameEvaluate(page) {
  const proto = Object.getPrototypeOf(page.mainFrame());
  if (proto.__visPatched) return;
  const orig = proto.evaluate;
  proto.evaluate = function (expr, arg) {
    if (typeof expr === "string" && expr.startsWith("window.axe.run(")) {
      expr = `(${VIS_RECORDER})(() => ${expr})`;
    }
    return orig.call(this, expr, arg);
  };
  proto.__visPatched = true;
}

/** 측정이 끝난 뒤 1차 노드의 끝 상태(애니메이션 종료 후 색·노출) — 과도 상태 판정용 */
const END_STATE = `async (targets) => {
  const finite = document.getAnimations().filter((a) => a.playState === "running" && Number.isFinite(a.effect?.getComputedTiming().iterations));
  await Promise.race([Promise.all(finite.map((a) => a.finished.catch(() => undefined))), new Promise((r) => setTimeout(r, 3000))]);
  const out = [];
  for (const target of targets) {
    const t = target[target.length - 1];
    const el = typeof t === "string" ? document.querySelector(t) : null;
    let opacity = null;
    if (el) { opacity = 1; for (let a = el; a && a.nodeType === 1; a = a.parentElement) opacity *= Number(getComputedStyle(a).opacity); }
    out.push({ target, color: el ? getComputedStyle(el).color : null, opacity, found: !!el });
  }
  return out;
}`;

const contrastNodes = (violations) =>
  violations
    .filter((v) => v.id === "color-contrast")
    .flatMap((v) =>
      v.nodes.map((n) => {
        const d = n.any?.[0]?.data ?? {};
        return {
          target: n.target,
          html: String(n.html ?? "").slice(0, 300),
          fgColor: d.fgColor ?? null,
          bgColor: d.bgColor ?? null,
          contrastRatio: d.contrastRatio ?? null,
          fontSize: d.fontSize ?? null,
          fontWeight: d.fontWeight ?? null,
          expectedContrastRatio: d.expectedContrastRatio ?? null,
        };
      }),
    );

async function measure(browser, site, cond) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: "ko-KR",
    userAgent: "Mozilla/5.0 (compatible; a11ychk-exp/0.2; research)",
  });
  const startedAt = new Date().toISOString();
  try {
    const page = await context.newPage();
    patchFrameEvaluate(page);
    await page.route("**/*", (route) => {
      const type = route.request().resourceType();
      if (type === "image" || type === "media") return route.abort(); // 실서비스와 같음
      return route.continue();
    });
    const resp = await page.goto(site.url, { waitUntil: "domcontentloaded", timeout: 25_000 });
    await page.waitForLoadState("load", { timeout: 8_000 }).catch(() => undefined);
    await Promise.race([page.evaluate(() => document.fonts.ready.then(() => undefined)), page.waitForTimeout(3_000)]).catch(() => undefined);

    let trace = null;
    const t0 = Date.now();
    const result = await runAxeOnPage(page, {
      settleAnimations: cond.settleAnimations,
      stabilityFilter: cond.stabilityFilter,
      onResearchTrace: (t) => (trace = t),
    });
    const engineMs = Date.now() - t0;

    const visTrace = [];
    for (const frame of page.frames()) {
      const v = await frame.evaluate(() => window.__visTrace ?? []).catch(() => []);
      if (v.length) visTrace.push({ frameUrl: frame === page.mainFrame() ? "main" : "child", passes: v });
    }
    const first = contrastNodes(trace?.firstPass ?? []);
    const endState = await page.evaluate(`(${END_STATE})(${JSON.stringify(first.map((n) => n.target))})`).catch(() => []);

    return {
      ok: true,
      startedAt,
      finishedAt: new Date().toISOString(),
      httpStatus: resp?.status() ?? null,
      finalUrl: page.url(),
      engineMs,
      contrast: {
        firstPass: first,
        final: contrastNodes(trace?.final ?? []),
        dropped: (trace?.dropped ?? []).filter((d) => d.ruleId === "color-contrast").map((d) => contrastNodes([{ id: "color-contrast", nodes: [d.node] }])[0]),
        // 엔진이 확정 패스 때 화면에서 사라졌다고 보고 유지한 노드(a11ychk 필터 수정 이후 엔진에만 있음)
        keptHidden: (trace?.keptHidden ?? []).filter((d) => d.ruleId === "color-contrast").map((d) => contrastNodes([{ id: "color-contrast", nodes: [d.node] }])[0]),
        // 확정 패스가 같은 요소를 다른 선택자로 보고해 유지한 노드(a11ychk cd4d37f 이후)
        keptSameElement: (trace?.keptSameElement ?? []).filter((d) => d.ruleId === "color-contrast").map((d) => contrastNodes([{ id: "color-contrast", nodes: [d.node] }])[0]),
      },
      visTrace,
      endState,
      ruleCounts: Object.fromEntries((trace?.final ?? []).map((v) => [v.id, v.nodes.length])),
      engineViolations: result.violations?.length ?? null,
    };
  } catch (e) {
    return { ok: false, startedAt, finishedAt: new Date().toISOString(), error: String(e?.message ?? e).split("\n")[0].slice(0, 300) };
  } finally {
    await context.close().catch(() => undefined);
  }
}

async function main() {
  const { sites: all } = JSON.parse(fs.readFileSync(SITES_FILE, "utf8"));
  const sites = ONLY ? all.filter((s) => ONLY.includes(s.id)) : all;
  if (!sites.length) throw new Error("대상 사이트가 없다");
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const build = JSON.parse(fs.readFileSync(path.join(HERE, "vendor/BUILD_INFO.json"), "utf8"));
  const env = {
    node: process.version,
    os: `${os.platform()} ${os.release()} ${os.arch()}`,
    playwright: require("playwright/package.json").version,
    chromium: browser.version(),
    axeCore: require("axe-core/package.json").version,
    a11ychkCommit: build.a11ychkCommit,
    a11ychkDirty: build.a11ychkDirty,
    runs: RUNS,
    gapMs: GAP_MS,
    seed: SEED,
  };
  // 이어서 실행하면 처음 시작 시각을 지킨다
  const envPath = path.join(OUT, "env.json");
  const firstStart = fs.existsSync(envPath) ? JSON.parse(fs.readFileSync(envPath, "utf8")).startedAt : new Date().toISOString();
  fs.writeFileSync(envPath, JSON.stringify({ ...env, startedAt: firstStart, sites: sites.map((s) => s.id) }, null, 2));

  const byId = new Map(sites.map((s) => [s.id, s]));
  const tasks = schedule(sites.map((s) => s.id), RUNS, SEED);
  const lastLoad = new Map();
  let done = 0;
  for (const task of tasks) {
    const site = byId.get(task.id);
    const file = path.join(OUT, task.id, `r${String(task.round).padStart(2, "0")}-${task.cond.key}.json`);
    done++;
    if (fs.existsSync(file)) continue; // 이어서 실행
    const wait = (lastLoad.get(task.id) ?? 0) + GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastLoad.set(task.id, Date.now());
    const rec = await measure(browser, site, task.cond);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ site: task.id, group: site.group, url: site.url, round: task.round, slot: task.slot, cond: task.cond, env, ...rec }));
    const n = rec.ok ? `1차 ${rec.contrast.firstPass.length} → 최종 ${rec.contrast.final.length}` : `실패: ${rec.error}`;
    console.log(`[${done}/${tasks.length}] ${task.id} r${task.round} ${task.cond.key} ${n}`);
  }
  await browser.close();
  const envFile = path.join(OUT, "env.json");
  const prev = JSON.parse(fs.readFileSync(envFile, "utf8"));
  fs.writeFileSync(envFile, JSON.stringify({ ...prev, finishedAt: new Date().toISOString() }, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
