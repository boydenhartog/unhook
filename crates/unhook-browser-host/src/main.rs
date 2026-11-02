use std::{
    io::{self, Read, Write},
    path::Path,
};
use unhook_core::{browser_ack_compatible, BrowserState, BROWSER_ACK_PROTOCOL_VERSION};

#[derive(serde::Deserialize)]
#[serde(tag = "type", deny_unknown_fields)]
enum Request {
    #[serde(rename = "getState")]
    GetState {},
    #[serde(rename = "applied", rename_all = "camelCase")]
    Applied {
        updated_at: i64,
        extension_version: String,
        #[serde(default)]
        protocol_version: Option<u32>,
    },
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct StateResponse {
    #[serde(flatten)]
    state: BrowserState,
    ack_protocol_version: u32,
}

fn read_state(path: &Path) -> Option<BrowserState> {
    std::fs::read(path)
        .ok()
        .filter(|bytes| bytes.len() <= 256_000)
        .and_then(|bytes| serde_json::from_slice::<BrowserState>(&bytes).ok())
        .filter(|state| state.valid())
}

fn acknowledge(
    path: &Path,
    updated_at: i64,
    version: &str,
    protocol_version: Option<u32>,
) -> io::Result<bool> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(io::Error::other)?
        .as_millis() as i64;
    let Some(state) = read_state(path) else {
        return Ok(false);
    };
    if updated_at <= 0
        || updated_at > state.updated_at
        || now - updated_at > 15_000
        || updated_at > now
        || !browser_ack_compatible(version, protocol_version)
    {
        return Ok(false);
    }
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::other("Invalid state location"))?;
    let temporary = tempfile::NamedTempFile::new_in(parent)?;
    serde_json::to_writer(
        temporary.as_file(),
        &serde_json::json!({
            "updatedAt": updated_at, "lastSeen": now, "extensionVersion": version,
            "protocolVersion": BROWSER_ACK_PROTOCOL_VERSION
        }),
    )?;
    temporary
        .persist(parent.join("browser-connection.json"))
        .map_err(|error| error.error)?;
    Ok(true)
}

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
        let request: Request = serde_json::from_slice(&bytes)?;
        let bytes = match request {
            Request::GetState {} => {
                serde_json::to_vec(&read_state(path).map(|state| StateResponse {
                    state,
                    ack_protocol_version: BROWSER_ACK_PROTOCOL_VERSION,
                }))?
            }
            Request::Applied {
                updated_at,
                extension_version,
                protocol_version,
            } => serde_json::to_vec(
                &serde_json::json!({"type":"ack", "ok":acknowledge(path, updated_at, &extension_version, protocol_version)?}),
            )?,
        };
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
            {
                let mut advertised = state;
                advertised["ackProtocolVersion"] = serde_json::json!(1);
                advertised
            }
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
            frame(serde_json::json!({"type":"getState","path":"/etc/hosts"})),
            1025u32.to_ne_bytes().to_vec(),
        ] {
            assert!(serve(input.as_slice(), vec![], &path).is_err());
            assert!(!path.exists());
        }
    }
    #[test]
    fn confirms_applied_config_but_refuses_stale_future_or_unbounded_receipts() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("state.json");
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64;
        let state = BrowserState {
            version: 1,
            domains: vec!["example.com".into()],
            active: false,
            ends_at: None,
            updated_at: now,
        };
        std::fs::write(&path, serde_json::to_vec(&state).unwrap()).unwrap();
        let mut output = vec![];
        serve(
            frame(serde_json::json!({"type":"applied","updatedAt":now,"extensionVersion":"0.2.0"}))
                .as_slice(),
            &mut output,
            &path,
        )
        .unwrap();
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&output[4..]).unwrap(),
            serde_json::json!({"type":"ack","ok":true})
        );
        let receipt = dir.path().join("browser-connection.json");
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&std::fs::read(&receipt).unwrap()).unwrap()
                ["extensionVersion"],
            "0.2.0"
        );
        for (timestamp, version) in [
            (now - 16_000, "0.2.0"),
            (now + 1, "0.2.0"),
            (now, "../../hosts"),
            (now, ""),
        ] {
            assert!(!acknowledge(&path, timestamp, version, None).unwrap());
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(receipt).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
    }

    #[test]
    fn supported_ack_protocol_is_independent_of_extension_release() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("state.json");
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64;
        std::fs::write(
            &path,
            serde_json::json!({
                "version":1,"domains":[],"active":false,"endsAt":null,"updatedAt":now
            })
            .to_string(),
        )
        .unwrap();
        let receipt = dir.path().join("browser-connection.json");
        for (version, protocol, accepted) in [
            ("0.2.2", Some(1), true),
            ("9.0.0", Some(1), true),
            ("0.2.0", None, true),
            ("0.2.1", None, true),
            ("0.2.2", None, false),
            ("9.0.0", Some(2), false),
            ("0.2.0", Some(0), false),
            ("1..2", Some(1), false),
        ] {
            let mut request = serde_json::json!({
                "type":"applied","updatedAt":now,"extensionVersion":version
            });
            if let Some(protocol) = protocol {
                request["protocolVersion"] = serde_json::json!(protocol);
            }
            let before = std::fs::read(&receipt).ok();
            let mut output = vec![];
            serve(frame(request).as_slice(), &mut output, &path).unwrap();
            assert_eq!(
                serde_json::from_slice::<serde_json::Value>(&output[4..]).unwrap(),
                serde_json::json!({"type":"ack","ok":accepted})
            );
            if accepted {
                let saved: serde_json::Value =
                    serde_json::from_slice(&std::fs::read(&receipt).unwrap()).unwrap();
                assert_eq!(saved["protocolVersion"], 1);
                assert_eq!(saved["extensionVersion"], version);
            } else {
                assert_eq!(std::fs::read(&receipt).ok(), before);
            }
        }
    }
}
