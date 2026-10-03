//! The frame protocol the front-ends and the egress process share.
//!
//! One `socketpair` carries every stream, so nothing inside the jail needs a route to anything. The
//! frame layer is deliberately small: an existing multiplexer would pull a dependency tree into the
//! one component that must stay auditable, and the only thing being multiplexed is
//! `open_stream(host, port)` plus its bytes. What the protocol does not skip is per-stream credit,
//! because a single workload connection that stops reading would otherwise stall every other stream
//! sharing the link.

pub(crate) const MAGIC: [u8; 4] = *b"HPX1";
pub(crate) const HANDSHAKE_ACCEPTED: u8 = 0;

pub(crate) const FRAME_HEADER_BYTES: usize = 9;
pub(crate) const MAX_PAYLOAD_BYTES: usize = 65_535;
pub(crate) const MAX_CHUNK_BYTES: usize = 32 * 1024;
pub(crate) const MAX_HOST_BYTES: usize = 255;
pub(crate) const MAX_MESSAGE_BYTES: usize = 512;
pub(crate) const INITIAL_WINDOW_BYTES: u32 = 256 * 1024;
pub(crate) const WINDOW_UPDATE_THRESHOLD_BYTES: u32 = INITIAL_WINDOW_BYTES / 2;
pub(crate) const MAX_CONCURRENT_STREAMS: usize = 256;

pub(crate) const FRAME_OPEN: u8 = 1;
pub(crate) const FRAME_OPENED: u8 = 2;
pub(crate) const FRAME_REFUSED: u8 = 3;
pub(crate) const FRAME_DATA: u8 = 4;
pub(crate) const FRAME_END: u8 = 5;
pub(crate) const FRAME_RESET: u8 = 6;
pub(crate) const FRAME_WINDOW: u8 = 7;

pub(crate) const REFUSED_BLOCKED: u8 = 1;
pub(crate) const REFUSED_UNRESOLVABLE: u8 = 2;
pub(crate) const REFUSED_UNREACHABLE: u8 = 3;

pub(crate) fn encode_frame(kind: u8, id: u32, payload: &[u8]) -> Vec<u8> {
    let mut frame = Vec::with_capacity(FRAME_HEADER_BYTES + payload.len());
    frame.push(kind);
    frame.extend_from_slice(&id.to_be_bytes());
    frame.extend_from_slice(&(payload.len() as u32).to_be_bytes());
    frame.extend_from_slice(payload);
    frame
}

/// Reads a window grant from a payload that a peer may have truncated.
pub(crate) fn decode_window(payload: &[u8]) -> u32 {
    u32::from_be_bytes([
        payload.first().copied().unwrap_or(0),
        payload.get(1).copied().unwrap_or(0),
        payload.get(2).copied().unwrap_or(0),
        payload.get(3).copied().unwrap_or(0),
    ])
}
