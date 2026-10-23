/**
 * selector-identity.mjs 원자료를 공개용으로 익명화한다.
 * - 사이트는 원자료에 이미 익명 ID(site-XX)로 저장되어 있다. URL과 선택자 문자열(target·ancestry)은 뺀다.
 * - 노드마다 규칙, 같은 요소로 짝지어졌는지, 선택자 변화의 종류, 선택자로 찾아지는지, 위치 경로가 바뀌었는지만 남긴다.
 * 실행: node anonymize-selector.mjs --in=<원자료 폴더> --out=dataset/selector-identity
 * 공개 전: node check-anonymity.mjs --dir=dataset/selector-identity
 */
import fs from "node:fs";
import path from "node:path";

const argOf = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=");
const IN = argOf("in");
const OUT = argOf("out");
if (!IN || !OUT) {
  console.error("사용: node anonymize-selector.mjs --in=<원자료 폴더> --out=<공개 폴더>");
  process.exit(2);
}

const sites = fs.readdirSync(IN).filter((d) => d.startsWith("site-")).sort();
let files = 0;
for (const site of sites) {
  fs.mkdirSync(path.join(OUT, site), { recursive: true });
  for (const f of fs.readdirSync(path.join(IN, site)).filter((x) => x.endsWith(".json")).sort()) {
    const r = JSON.parse(fs.readFileSync(path.join(IN, site, f), "utf8"));
    const { url, nodes, error, ...base } = r;
    const out = { ...base };
    if (r.ok) {
      out.nodes = nodes.map((n) => ({
        ruleId: n.ruleId,
        hasElement: n.hasElement,
        connected: n.connected,
        matched: n.matched,
        kind: n.kind,
        selectorFound: n.selectorFound,
        ancestryChanged: n.ancestryChanged,
      }));
    } else {
      out.error = String(error ?? "").replace(/https?:\/\/\S+/g, "<url>");
    }
    fs.writeFileSync(path.join(OUT, site, f), JSON.stringify(out));
    files++;
  }
}
const env = JSON.parse(fs.readFileSync(path.join(IN, "env.json"), "utf8"));
fs.writeFileSync(path.join(OUT, "env.json"), JSON.stringify(env, null, 2));
console.log(`익명화 완료: ${sites.length}곳, ${files}개 파일 → ${OUT}`);
