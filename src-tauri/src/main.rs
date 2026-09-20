// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    use_embedded_webview2_if_present();
    sgpa_lib::run()
}

/// Utilise le runtime WebView2 embarqué **s'il est présent** à côté de l'exécutable.
///
/// Tauri sait faire cela via `bundle.windows.webviewInstallMode = fixedRuntime`,
/// mais il pose alors la variable **inconditionnellement** : si le dossier manque,
/// WebView2 échoue au lieu de retomber sur le runtime installé sur le poste.
/// En testant l'existence, un seul binaire fonctionne dans les deux cas —
/// avec le runtime embarqué sur la clé, et sans lui sur un poste à jour.
#[cfg(windows)]
fn use_embedded_webview2_if_present() {
    let Ok(exe) = std::env::current_exe() else {
        return;
    };
    let Some(dir) = exe.parent() else {
        return;
    };
    let embedded = dir.join("webview2");
    if embedded.join("msedgewebview2.exe").is_file() {
        // SAFETY : appelé depuis main, avant tout démarrage de thread.
        unsafe {
            std::env::set_var("WEBVIEW2_BROWSER_EXECUTABLE_FOLDER", &embedded);
        }
    }
}

#[cfg(not(windows))]
fn use_embedded_webview2_if_present() {}
