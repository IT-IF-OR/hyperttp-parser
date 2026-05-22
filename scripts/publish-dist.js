import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

try {
  console.log("🚀 Deploying build to __dist__...");

  // 1. Читаем текущую версию
  const pkg = JSON.parse(fs.readFileSync("./package.json", "utf-8"));
  const version = pkg.version;
  console.log(`📦 Building version ${version}...`);

  // 2. Сборка
  execSync("npm run build", { stdio: "inherit" });
  const distPath = path.resolve("./dist");

  // 3. Сохраняем текущую ветку и переключаемся на __dist__
  const currentBranch = execSync("git branch --show-current").toString().trim();
  execSync("git checkout -B __dist__");

  // 4. Проверка версии в __dist__ (если файл существует)
  let existingVersion = null;
  if (fs.existsSync("./package.json")) {
    try {
      existingVersion = JSON.parse(
        fs.readFileSync("./package.json", "utf-8"),
      ).version;
    } catch (e) {
      /* файл может быть поврежден или пуст */
    }
  }

  if (existingVersion === version) {
    console.log(
      `ℹ️ Version ${version} is already deployed to __dist__. Skipping.`,
    );
    execSync(`git checkout ${currentBranch}`);
    process.exit(0);
  }

  // 5. Очистка корня (удаляем всё, кроме .git, node_modules и .gitignore)
  console.log("🧹 Cleaning root directory...");
  const files = fs.readdirSync(".");
  for (const file of files) {
    if (file !== ".git" && file !== "node_modules" && file !== ".gitignore") {
      fs.rmSync(file, { recursive: true, force: true });
    }
  }

  // 6. Копирование
  execSync(`cp -r ${distPath}/* .`);

  // 7. Git операции
  execSync("git add -f .");
  execSync(`git commit -m "chore: release v${version}"`);
  execSync("git push origin __dist__ --force");

  console.log(`✅ Branch __dist__ updated to v${version}!`);

  // 8. Возврат
  execSync(`git checkout ${currentBranch}`);
} catch (e) {
  console.error("❌ Deploy failed:", e.message);
  // На случай ошибки возвращаемся на основную ветку
  try {
    execSync("git checkout main");
  } catch {}
  process.exit(1);
}
