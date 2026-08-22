// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(String::as_str) == Some("ai") {
        std::process::exit(md_mini_lib::ai_socket::run_ai_cli(args));
    }
    if args.get(1).map(String::as_str) == Some("mcp") {
        std::process::exit(md_mini_lib::mcp_server::run(args));
    }
    md_mini_lib::run()
}
