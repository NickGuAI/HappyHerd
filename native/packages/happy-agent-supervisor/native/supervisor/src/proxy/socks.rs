//! The loopback SOCKS5 front-end.
//!
//! Only `CONNECT` is offered, and only as `socks5h`: the destination name travels across the link,
//! and the egress process resolves it under the command's policy. Resolving inside the sandbox
//! would let a name that policy allows be pointed at an address it does not.

use crate::proxy::bridge::relay;
use crate::proxy::credential::ProxyCredential;
use crate::proxy::mux::{Mux, RefusalReason};
use std::io::{Read, Write};
use std::net::{Shutdown, TcpStream};
use std::sync::Arc;

const VERSION: u8 = 5;
const USER_PASSWORD_AUTHENTICATION: u8 = 2;
const NO_ACCEPTABLE_AUTHENTICATION: u8 = 0xff;
const USER_PASSWORD_VERSION: u8 = 1;
const AUTHENTICATION_SUCCEEDED: u8 = 0;
const AUTHENTICATION_FAILED: u8 = 1;
const COMMAND_CONNECT: u8 = 1;
const ADDRESS_IPV4: u8 = 1;
const ADDRESS_NAME: u8 = 3;
const ADDRESS_IPV6: u8 = 4;

const REPLY_SUCCEEDED: u8 = 0;
const REPLY_GENERAL_FAILURE: u8 = 1;
const REPLY_NOT_ALLOWED: u8 = 2;
const REPLY_HOST_UNREACHABLE: u8 = 4;
const REPLY_COMMAND_UNSUPPORTED: u8 = 7;
const REPLY_ADDRESS_UNSUPPORTED: u8 = 8;

pub(crate) fn serve(mux: &Arc<Mux>, credential: &ProxyCredential, mut client: TcpStream) {
    match negotiate(&mut client, credential) {
        Ok(Some(target)) => match mux.open(&target.host, target.port) {
            Ok(stream) => {
                if reply(&mut client, REPLY_SUCCEEDED).is_err() {
                    return;
                }
                relay(client, stream, &[]);
            }
            Err(failure) => {
                let code = match failure.reason {
                    RefusalReason::Blocked => REPLY_NOT_ALLOWED,
                    RefusalReason::Unresolvable | RefusalReason::Unreachable => {
                        REPLY_HOST_UNREACHABLE
                    }
                };
                let _ = reply(&mut client, code);
                let _ = client.shutdown(Shutdown::Write);
            }
        },
        Ok(None) => {}
        Err(_) => {
            let _ = reply(&mut client, REPLY_GENERAL_FAILURE);
            let _ = client.shutdown(Shutdown::Write);
        }
    }
}

struct Target {
    host: String,
    port: u16,
}

fn negotiate(
    client: &mut TcpStream,
    credential: &ProxyCredential,
) -> std::io::Result<Option<Target>> {
    let mut greeting = [0_u8; 2];
    client.read_exact(&mut greeting)?;
    if greeting[0] != VERSION {
        return Err(std::io::Error::other("unsupported SOCKS version"));
    }
    let mut methods = vec![0_u8; greeting[1] as usize];
    client.read_exact(&mut methods)?;
    // The only method offered is the one that proves the client holds the secret from the proxy
    // address, so a client that will not authenticate is turned away before it names a destination.
    if !methods.contains(&USER_PASSWORD_AUTHENTICATION) {
        client.write_all(&[VERSION, NO_ACCEPTABLE_AUTHENTICATION])?;
        let _ = client.shutdown(Shutdown::Write);
        return Ok(None);
    }
    client.write_all(&[VERSION, USER_PASSWORD_AUTHENTICATION])?;
    if !authenticate(client, credential)? {
        client.write_all(&[USER_PASSWORD_VERSION, AUTHENTICATION_FAILED])?;
        let _ = client.shutdown(Shutdown::Write);
        return Ok(None);
    }
    client.write_all(&[USER_PASSWORD_VERSION, AUTHENTICATION_SUCCEEDED])?;

    let mut request = [0_u8; 4];
    client.read_exact(&mut request)?;
    if request[0] != VERSION {
        return Err(std::io::Error::other("unsupported SOCKS version"));
    }
    if request[1] != COMMAND_CONNECT {
        reply(client, REPLY_COMMAND_UNSUPPORTED)?;
        let _ = client.shutdown(Shutdown::Write);
        return Ok(None);
    }
    let host = match request[3] {
        ADDRESS_IPV4 => {
            let mut address = [0_u8; 4];
            client.read_exact(&mut address)?;
            std::net::Ipv4Addr::from(address).to_string()
        }
        ADDRESS_IPV6 => {
            let mut address = [0_u8; 16];
            client.read_exact(&mut address)?;
            std::net::Ipv6Addr::from(address).to_string()
        }
        ADDRESS_NAME => {
            let mut length = [0_u8; 1];
            client.read_exact(&mut length)?;
            let mut name = vec![0_u8; length[0] as usize];
            client.read_exact(&mut name)?;
            match String::from_utf8(name) {
                Ok(name) => name,
                Err(_) => {
                    reply(client, REPLY_ADDRESS_UNSUPPORTED)?;
                    let _ = client.shutdown(Shutdown::Write);
                    return Ok(None);
                }
            }
        }
        _ => {
            reply(client, REPLY_ADDRESS_UNSUPPORTED)?;
            let _ = client.shutdown(Shutdown::Write);
            return Ok(None);
        }
    };
    let mut port = [0_u8; 2];
    client.read_exact(&mut port)?;
    let port = u16::from_be_bytes(port);
    if host.is_empty() || port == 0 {
        reply(client, REPLY_ADDRESS_UNSUPPORTED)?;
        let _ = client.shutdown(Shutdown::Write);
        return Ok(None);
    }
    Ok(Some(Target { host, port }))
}

/// Reads the RFC 1929 user name and password sub-negotiation.
fn authenticate(client: &mut TcpStream, credential: &ProxyCredential) -> std::io::Result<bool> {
    let mut header = [0_u8; 2];
    client.read_exact(&mut header)?;
    if header[0] != USER_PASSWORD_VERSION {
        return Ok(false);
    }
    let mut user = vec![0_u8; header[1] as usize];
    client.read_exact(&mut user)?;
    let mut length = [0_u8; 1];
    client.read_exact(&mut length)?;
    let mut secret = vec![0_u8; length[0] as usize];
    client.read_exact(&mut secret)?;
    Ok(credential.authorizes_socks(&user, &secret))
}

/// Answers with the unspecified IPv4 bind address, which is what a proxy that never owns a local
/// address for the destination can honestly report.
fn reply(client: &mut TcpStream, code: u8) -> std::io::Result<()> {
    client.write_all(&[VERSION, code, 0, ADDRESS_IPV4, 0, 0, 0, 0, 0, 0])
}
