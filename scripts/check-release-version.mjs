import packageJson from "../package.json" with { type: "json" };

const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME;
const expected = `v${packageJson.version}`;

if (!tag) {
  console.error("缺少 Git tag；请传入 v<版本> 或设置 GITHUB_REF_NAME。");
  process.exitCode = 1;
} else if (tag !== expected) {
  console.error(`Git tag ${tag} 与 package.json 版本不一致，应为 ${expected}。`);
  process.exitCode = 1;
}
