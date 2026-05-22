import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

try {
  console.log("🚀 Deploying build to __dist__...");

  console.log("📦 Building...");
  execSync("npm run build", { stdio: "inherit" });

  const distPath = path.resolve("./dist");

  if (!fs.existsSync(distPath)) {
    throw new Error("Folder 'dist' not found.");
  }

  const currentBranch = execSync("git branch --show-current").toString().trim();

  execSync("git checkout -B __dist__");

  console.log("🧹 Cleaning root directory...");
  const files = fs.readdirSync(".");
  for (const file of files) {
    if (file !== ".git" && file !== "node_modules" && file !== ".gitignore") {
      fs.rmSync(file, { recursive: true, force: true });
    }
  }

  execSync(`cp -r ${distPath}/* .`);

  execSync("git add -f .");

  const status = execSync("git status --porcelain").toString();
  if (status.length > 0) {
    execSync('git commit -m "chore: update distribution build"');
    execSync("git push origin __dist__ --force");
    console.log("✅ Branch __dist__ updated and synced!");
  } else {
    console.log("ℹ️ No changes to deploy.");
  }

  execSync(`git checkout main`);
} catch (e) {
  console.error("❌ Deploy failed:", e.message);
  process.exit(1);
}
