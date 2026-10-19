/**
 * procedure-eval.mjs 원자료를 공개용으로 익명화한다.
 * - 사이트는 원자료에 이미 익명 ID(site-XX)로 저장되어 있다. URL(url·finalUrl)과 HTML 조각은 뺀다.
 * - 선택자(target)는 사이트 안에서 고정된 pe-N으로 바꾼다(모든 회차·조건에서 같은 선택자는 같은 번호).
 *   번호는 선택자 문자열의 정렬 순서로 매겨 다시 돌려도 같게 나온다. 8월 데이터의 el-N과는 별개 번호다.
 * - 색·대비·글자 크기·굵기·화면 노출 정보·시간·환경은 그대로 둔다.
 * 실행: node anonymize-procedure.mjs --in=<원자료 폴더> --out=dataset/procedure-eval
 * 공개 전: node check-anonymity.mjs --dir=dataset/procedure-eval --mapping=<비공개 매핑표>
 */
import fs from "node:fs";
import path from "node:path";

const argOf = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=");
const IN = argOf("in");
const OUT = argOf("out");
if (!IN || !OUT) {
  console.error("사용: node anonymize-procedure.mjs --in=<원자료 폴더> --out=<공개 폴더>");
  process.exit(2);
}

const key = (t) => JSON.stringify(t);
const sites = fs.readdirSync(IN).filter((d) => d.startsWith("site-")).sort();
fs.mkdirSync(OUT, { recursive: true });
let files = 0;

for (const site of sites) {
  const names = fs.readdirSync(path.join(IN, site)).filter((f) => f.endsWith(".json")).sort();
  const recs = names.map((f) => [f, JSON.parse(fs.readFileSync(path.join(IN, site, f), "utf8"))]);
  // 사이트 안의 모든 선택자 수집 → 정렬 → pe-N
  const all = new Set();
  for (const [, r] of recs) {
    if (!r.ok) continue;
    for (const part of ["firstPass", "final", "dropped", "keptHidden", "keptSameElement"]) for (const n of r.contrast[part] ?? []) all.add(key(n.target));
    for (const f of r.visTrace ?? []) for (const p of f.passes ?? []) for (const n of p.nodes ?? []) all.add(key(n.target));
    for (const e of r.endState ?? []) all.add(key(e.target));
  }
  const ids = new Map([...all].sort().map((k, i) => [k, [`pe-${i + 1}`]]));
  const anonNode = ({ html, target, ...rest }) => ({ ...rest, target: ids.get(key(target)) });

  fs.mkdirSync(path.join(OUT, site), { recursive: true });
  for (const [f, r] of recs) {
    const { url, finalUrl, ...base } = r;
    const outRec = { ...base };
    if (r.ok) {
      outRec.contrast = {
        firstPass: r.contrast.firstPass.map(anonNode),
        final: r.contrast.final.map(anonNode),
        dropped: r.contrast.dropped.map(anonNode),
        ...(r.contrast.keptHidden ? { keptHidden: r.contrast.keptHidden.map(anonNode) } : {}),
        ...(r.contrast.keptSameElement ? { keptSameElement: r.contrast.keptSameElement.map(anonNode) } : {}),
      };
      outRec.visTrace = (r.visTrace ?? []).map((fr) => ({
        frameUrl: fr.frameUrl,
        passes: (fr.passes ?? []).map((p) => (p.error ? { error: "redacted" } : { at: p.at, nodes: (p.nodes ?? []).map((n) => ({ target: ids.get(key(n.target)), vis: n.vis })) })),
      }));
      outRec.endState = (r.endState ?? []).map((e) => ({ ...e, target: ids.get(key(e.target)) }));
    } else {
      outRec.error = String(r.error ?? "").replace(/https?:\/\/\S+/g, "<url>");
    }
    fs.writeFileSync(path.join(OUT, site, f), JSON.stringify(outRec));
    files++;
  }
}
const env = JSON.parse(fs.readFileSync(path.join(IN, "env.json"), "utf8"));
fs.writeFileSync(path.join(OUT, "env.json"), JSON.stringify(env, null, 2));
console.log(`익명화 완료: ${sites.length}곳, ${files}개 파일 → ${OUT}`);
