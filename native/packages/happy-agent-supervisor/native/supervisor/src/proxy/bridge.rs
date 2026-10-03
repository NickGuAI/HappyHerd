//! Joins one accepted loopback connection to one stream on the shared link.

use crate::proxy::mux::MuxStream;
use std::io::{Read, Write};
use std::net::{Shutdown, TcpStream};
use std::sync::Arc;

const RELAY_BUFFER_BYTES: usize = 32 * 1024;

/// Relays until the destination finishes, then closes the workload's socket.
///
/// `head` carries whatever the front-end already read past the request it parsed, which for
/// `CONNECT` is often the first TLS record.
pub(crate) fn relay(client: TcpStream, stream: Arc<MuxStream>, head: &[u8]) {
    if !head.is_empty() && stream.send(head).is_err() {
        let _ = client.shutdown(Shutdown::Both);
        return;
    }
    let Ok(client_reader) = client.try_clone() else {
        let _ = client.shutdown(Shutdown::Both);
        return;
    };
    let upload_stream = Arc::clone(&stream);
    let upload = std::thread::Builder::new()
        .name("supervisor-proxy-upload".to_string())
        .spawn(move || {
            forward_to_stream(&client_reader, &upload_stream);
            // The workload keeps its half of the socket open in plenty of protocols, so the read
            // side is shut down explicitly rather than waited on.
            let _ = client_reader.shutdown(Shutdown::Read);
        });
    forward_to_client(&client, &stream);
    let _ = client.shutdown(Shutdown::Both);
    if let Ok(upload) = upload {
        let _ = upload.join();
    }
}

fn forward_to_stream(mut client: &TcpStream, stream: &MuxStream) {
    let mut buffer = [0_u8; RELAY_BUFFER_BYTES];
    loop {
        match client.read(&mut buffer) {
            Ok(0) => break,
            Ok(read) => {
                if stream.send(&buffer[..read]).is_err() {
                    return;
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => return,
        }
    }
    stream.end_send();
}

fn forward_to_client(mut client: &TcpStream, stream: &MuxStream) {
    let mut buffer = [0_u8; RELAY_BUFFER_BYTES];
    loop {
        match stream.receive(&mut buffer) {
            Ok(0) => break,
            Ok(read) => {
                if client.write_all(&buffer[..read]).is_err() {
                    return;
                }
            }
            Err(_) => return,
        }
    }
    let _ = client.shutdown(Shutdown::Write);
}
