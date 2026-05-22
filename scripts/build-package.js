import fs from "node:fs";
import path from "node:path";

const rootPkg = JSON.parse(fs.readFileSync("./package.json", "utf-8"));

delete rootPkg.scripts;
delete rootPkg.devDependencies;
delete rootPkg.jest;
delete rootPkg.eslintConfig;

delete rootPkg.files;

const fixPath = (p) => {
  if (typeof p !== "string") return p;
  return p.replace(/^(\.?\/?)?(dist\/)?/, "./");
};

if (rootPkg.main) rootPkg.main = fixPath(rootPkg.main);
if (rootPkg.types) rootPkg.types = fixPath(rootPkg.types);
if (rootPkg.module) rootPkg.module = fixPath(rootPkg.module);

if (rootPkg.exports) {
  for (const key in rootPkg.exports) {
    const exp = rootPkg.exports[key];
    if (typeof exp === "object") {
      for (const subKey in exp) {
        exp[subKey] = fixPath(exp[subKey]);
      }
    } else if (typeof exp === "string") {
      rootPkg.exports[key] = fixPath(exp);
    }
  }
}

const distDir = path.resolve("./dist");
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

fs.writeFileSync(
  path.join(distDir, "package.json"),
  JSON.stringify(rootPkg, null, 2),
  "utf-8",
);

console.log("✓ Clean package.json generated in dist/");
