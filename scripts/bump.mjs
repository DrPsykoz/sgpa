import { readFileSync, writeFileSync } from "fs";

const type = process.argv[2] || "patch";
const tauriRaw = readFileSync("src-tauri/tauri.conf.json", "utf8");
const tauri = JSON.parse(tauriRaw);
let [major, minor, patch] = tauri.version.split(".").map(Number);

if (type === "minor") {
    minor++;
    patch = 0;
} else {
    patch++;
}

const newVersion = `${major}.${minor}.${patch}`;

tauri.version = newVersion;
writeFileSync(
    "src-tauri/tauri.conf.json",
    JSON.stringify(tauri, null, 4) + "\n"
);

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
pkg.version = newVersion;
writeFileSync("package.json", JSON.stringify(pkg, null, 4) + "\n");

console.log(newVersion);
