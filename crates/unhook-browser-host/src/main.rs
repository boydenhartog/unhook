use std::{
    io::{self, Read, Write},
    path::Path,
};
use unhook_core::BrowserState;

fn serve(mut input: impl Read, mut output: impl Write, path: &Path) -> io::Result<()> {
    loop {
        let mut header = [0; 4];
        match input.read_exact(&mut header) {
            Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => return Ok(()),
            result => result?,
        }
        let length = u32::from_ne_bytes(header) as usize;
        if length == 0 || length > 1024 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Invalid message size",
            ));
        }
        let mut bytes = vec![0; length];
        input.read_exact(&mut bytes)?;
        let request: serde_json::Value = serde_json::from_slice(&bytes)?;
        if request != serde_json::json!({"type": "getState"}) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Read-only bridge accepts getState only",
            ));
        }
        let state = std::fs::read(path)
            .ok()
            .filter(|bytes| bytes.len() <= 256_000)
            .and_then(|bytes| serde_json::from_slice::<BrowserState>(&bytes).ok())
            .filter(|state| state.valid());
        let bytes = serde_json::to_vec(&state)?;
        output.write_all(&(bytes.len() as u32).to_ne_bytes())?;
        output.write_all(&bytes)?;
        output.flush()?;
    }
}

fn main() {
    if std::env::args().nth(1).as_deref() != Some(unhook_core::BROWSER_EXTENSION_ORIGIN) {
        eprintln!("This read-only host is launched by the Unhook browser extension.");
        std::process::exit(1);
    }
    let Some(directory) = dirs::data_dir() else {
        std::process::exit(1)
    };
    if let Err(error) = serve(
        io::stdin().lock(),
        io::stdout().lock(),
        &directory.join("org.unhook.desktop/browser-state.json"),
    ) {
        eprintln!("Unhook browser bridge: {error}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn frame(request: serde_json::Value) -> Vec<u8> {
        let body = serde_json::to_vec(&request).unwrap();
        [((body.len() as u32).to_ne_bytes()).as_slice(), &body].concat()
    }
    #[test]
    fn reads_current_app_state_for_each_request_and_handles_missing_app() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("state.json");
        let state = serde_json::json!({"version":1,"domains":["marktplaats.nl"],"active":true,"endsAt":1000,"updatedAt":500});
        std::fs::write(&path, state.to_string()).unwrap();
        let mut output = vec![];
        serve(
            frame(serde_json::json!({"type":"getState"})).as_slice(),
            &mut output,
            &path,
        )
        .unwrap();
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&output[4..]).unwrap(),
            state
        );
        std::fs::remove_file(&path).unwrap();
        output.clear();
        serve(
            frame(serde_json::json!({"type":"getState"})).as_slice(),
            &mut output,
            &path,
        )
        .unwrap();
        assert_eq!(&output[4..], b"null");
    }
    #[test]
    fn refuses_writes_and_oversized_frames() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("state.json");
        for input in [
            frame(serde_json::json!({"type":"startFocus"})),
            1025u32.to_ne_bytes().to_vec(),
        ] {
            assert!(serve(input.as_slice(), vec![], &path).is_err());
            assert!(!path.exists());
        }
    }
}
