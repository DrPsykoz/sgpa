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

// Cargo.toml était le seul fichier de version oublié : il est resté en 0.1.0
// pendant que les deux autres passaient en 0.1.1. C'est la version de Cargo.toml
// qui finit dans les métadonnées du binaire Windows, donc celle qu'un utilisateur
// lit dans les propriétés du fichier.
const cargoPath = "src-tauri/Cargo.toml";
const cargo = readFileSync(cargoPath, "utf8");
const bumped = cargo.replace(
    /^version = "\d+\.\d+\.\d+"$/m,
    `version = "${newVersion}"`
);
if (bumped === cargo) {
    console.error(
        `Échec : aucune ligne 'version = "x.y.z"' trouvée dans ${cargoPath}.`
    );
    process.exit(1);
}
writeFileSync(cargoPath, bumped);

console.log(newVersion);
