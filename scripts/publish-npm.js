import { execSync } from "node:child_process";

try {
  console.log("🚀 Подготовка билда...");
  execSync("npm run build", { stdio: "inherit" });

  console.log("📦 Публикация в NPM...");

  execSync("npm publish --access public", { cwd: "./dist", stdio: "inherit" });

  console.log("✅ Успешно опубликовано!");
} catch (e) {
  console.error("❌ Ошибка при публикации:", e.message);
  process.exit(1);
}
