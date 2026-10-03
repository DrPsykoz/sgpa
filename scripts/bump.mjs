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

// Cargo.lock porte AUSSI la version du paquet, et il était resté en 0.1.0
// pendant que Cargo.toml passait en 0.1.2 : la CI bumpait trois fichiers sur
// quatre, et la première commande cargo lancée après une release corrigeait le
// verrou en silence — laissant une modification non commitée derrière chaque
// version publiée.
//
// On ne passe pas par `cargo` pour ça : l'appeler ici compilerait OpenSSL
// depuis ses sources (rusqlite est en `bundled-sqlcipher-vendored-openssl`),
// soit plusieurs minutes et une dépendance à Perl, dans un script dont le seul
// travail est de réécrire quatre nombres.
//
// La substitution est ancrée sur le BLOC du paquet `sgpa`, jamais sur la
// première ligne `version =` du fichier : Cargo.lock en contient plusieurs
// centaines, une par dépendance, et une substitution large réécrirait la
// version d'un paquet tiers.
const lockPath = "src-tauri/Cargo.lock";
const lock = readFileSync(lockPath, "utf8");
const lockBumped = lock.replace(
    /(\[\[package\]\]\nname = "sgpa"\nversion = )"\d+\.\d+\.\d+"/,
    `$1"${newVersion}"`
);
if (lockBumped === lock) {
    console.error(
        `Échec : bloc '[[package]] name = "sgpa"' introuvable dans ${lockPath}.\n` +
            `Le paquet a-t-il été renommé ? Sans cette mise à jour, le verrou reste\n` +
            `périmé et la prochaine commande cargo salira l'arbre de travail.`
    );
    process.exit(1);
}
writeFileSync(lockPath, lockBumped);

console.log(newVersion);
