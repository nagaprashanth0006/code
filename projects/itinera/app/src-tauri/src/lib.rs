//! Itinera's native shell. Rust is kept to what the platform requires:
//! official plugins for SQLite, HTTP, files and opening links, plus one small
//! protocol handler that serves local PMTiles packs to MapLibre.

mod tiles;

use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        // tiles://localhost/<region>.pmtiles (http://tiles.localhost/… on Windows)
        .register_asynchronous_uri_scheme_protocol("tiles", |ctx, request, responder| {
            let dir = ctx.app_handle().path().app_data_dir().map(|d| d.join("tiles"));
            std::thread::spawn(move || {
                let response = match dir {
                    Ok(dir) => tiles::serve(&dir, &request),
                    Err(e) => tiles::error(500, &e.to_string()),
                };
                responder.respond(response);
            });
        })
        .run(tauri::generate_context!())
        .expect("error while running Itinera");
}
