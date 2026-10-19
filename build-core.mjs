/**
 * a11ychk 검사 엔진(runAxeOnPage)을 이 하네스에서 쓰도록 번들한다.
 * 실서비스 측정 절차(유한 애니메이션 종료 대기 + 2-패스 안정성 필터)를 다시 구현하지 않고 그대로 평가하기 위해서다.
 *
 * 실행: node build-core.mjs --a11ychk=<a11ychk 저장소 경로>
 *   → vendor/a11ychk-runaxe.mjs, vendor/BUILD_INFO.json (vendor/는 저장소에 올리지 않는다)
 * 필요: 그 경로에 npm install이 되어 있을 것(esbuild를 거기서 쓴다). a11ychk 커밋 a8b0c7c 이후(연구 옵션 포함).
 * 런타임 외부 의존은 axe-core 하나다(이 패키지의 dependencies에 있다).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const argOf = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const SRC = argOf("a11ychk");
if (!SRC) {
  console.error("사용: node build-core.mjs --a11ychk=<a11ychk 저장소 경로>");
  process.exit(2);
}
const HERE = path.dirname(fileURLToPath(import.meta.url));
const VENDOR = path.join(HERE, "vendor");
fs.mkdirSync(VENDOR, { recursive: true });

const entry = path.join(SRC, "packages/core/src/scanner/runAxe.ts");
if (!fs.existsSync(entry)) {
  console.error(`엔진 소스 없음: ${entry}`);
  process.exit(2);
}
const esbuild = path.join(SRC, "node_modules/.bin/esbuild");
const out = path.join(VENDOR, "a11ychk-runaxe.mjs");
execFileSync(esbuild, [entry, "--bundle", "--platform=node", "--format=esm", "--target=node22", "--external:axe-core", "--external:playwright-core", `--outfile=${out}`, "--log-level=warning"], { stdio: "inherit" });

const git = (...a) => execFileSync("git", ["-C", SRC, ...a], { encoding: "utf8" }).trim();
const info = {
  a11ychkCommit: git("rev-parse", "HEAD"),
  a11ychkDirty: git("status", "--porcelain", "--", "packages/core").length > 0,
  builtAt: new Date().toISOString(),
};
fs.writeFileSync(path.join(VENDOR, "BUILD_INFO.json"), JSON.stringify(info, null, 2));
console.log(`번들 완료: ${path.relative(HERE, out)} (a11ychk ${info.a11ychkCommit.slice(0, 7)}${info.a11ychkDirty ? ", 작업 트리 변경 있음" : ""})`);
