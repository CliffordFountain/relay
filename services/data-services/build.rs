fn main() -> Result<(), Box<dyn std::error::Error>> {
    let proto_path = if std::path::Path::new("/proto/relay.proto").exists() {
        "/proto/relay.proto"
    } else {
        "../../proto/relay.proto"
    };
    let include_dir = std::path::Path::new(proto_path)
        .parent()
        .ok_or("cannot determine proto include dir")?;

    tonic_build::configure()
        .build_server(true)
        .build_client(false)
        .compile_protos(&[proto_path], &[include_dir])?;

    Ok(())
}
