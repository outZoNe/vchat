//! Батч-отправка UDP: очередь исходящих + sendmmsg на Linux.
//! При backpressure не теряем пакеты из SFU и не делаем await на каждый send.

use bytes::Bytes;
use sfu::Sfu;
use sansio::Protocol;
use std::{collections::VecDeque, io::ErrorKind, net::SocketAddr};
use tokio::net::UdpSocket;

/// Потолок очереди: при переполнении дропаем самые старые (live-медиа).
const MAX_PENDING: usize = 8192;

#[cfg(target_os = "linux")]
/// Размер одного sendmmsg.
const BATCH_SIZE: usize = 64;

pub struct OutboundPacket {
    pub data: Bytes,
    pub addr: SocketAddr,
}

pub type OutQueue = VecDeque<OutboundPacket>;

pub fn new_queue() -> OutQueue {
    VecDeque::with_capacity(1024)
}

/// Забираем все готовые пакеты из SFU в очередь (без syscall).
pub fn drain_sfu(sfu: &mut Sfu, pending: &mut OutQueue) {
    while let Some(pkt) = sfu.poll_write() {
        while pending.len() >= MAX_PENDING {
            pending.pop_front();
        }
        pending.push_back(OutboundPacket {
            data: Bytes::from(pkt.message),
            addr: pkt.transport.peer_addr,
        });
    }
}

/// Неблокирующая отправка + максимум одно ожидание writable.
/// Остаток остаётся в `pending` на следующий тик воркера.
pub async fn flush(udp: &UdpSocket, pending: &mut OutQueue) {
    if pending.is_empty() {
        return;
    }

    if flush_nonblocking(udp, pending) {
        return;
    }

    if udp.writable().await.is_err() {
        return;
    }

    let _ = flush_nonblocking(udp, pending);
}

/// `true` - очередь пуста. `false` - сокет забит (WouldBlock), пакеты остались.
fn flush_nonblocking(udp: &UdpSocket, pending: &mut OutQueue) -> bool {
    #[cfg(target_os = "linux")]
    {
        flush_linux(udp, pending)
    }
    #[cfg(not(target_os = "linux"))]
    {
        flush_fallback(udp, pending)
    }
}

#[cfg(not(target_os = "linux"))]
fn flush_fallback(udp: &UdpSocket, pending: &mut OutQueue) -> bool {
    while let Some(pkt) = pending.pop_front() {
        match udp.try_send_to(&pkt.data, pkt.addr) {
            Ok(_) => {}
            Err(e) if e.kind() == ErrorKind::WouldBlock => {
                pending.push_front(pkt);
                return false;
            }
            // Битый/unreachable addr - дропаем пакет, очередь не стопорим
            Err(_) => {}
        }
    }
    true
}

#[cfg(target_os = "linux")]
fn flush_linux(udp: &UdpSocket, pending: &mut OutQueue) -> bool {
    use std::{io, os::fd::AsRawFd};

    let fd = udp.as_raw_fd();

    while !pending.is_empty() {
        let batch_n = pending.len().min(BATCH_SIZE);
        let mut batch = Vec::with_capacity(batch_n);
        for _ in 0..batch_n {
            batch.push(pending.pop_front().expect("batch_n <= len"));
        }

        let sent = sendmmsg_batch(fd, &batch);

        match sent {
            Ok(n) if n >= batch.len() => {
                // вся пачка ушла
            }
            Ok(n) => {
                // частичный успех - хвост обратно в очередь (порядок FIFO)
                for pkt in batch.into_iter().skip(n).rev() {
                    pending.push_front(pkt);
                }
                // буфер почти полный - дальше будет EAGAIN
                return false;
            }
            Err(e) if e.kind() == ErrorKind::WouldBlock => {
                for pkt in batch.into_iter().rev() {
                    pending.push_front(pkt);
                }
                return false;
            }
            Err(_) => {
                // Ошибка на пачке: дропаем первый, остальные пробуем снова
                for pkt in batch.into_iter().skip(1).rev() {
                    pending.push_front(pkt);
                }
            }
        }
    }

    true
}

#[cfg(target_os = "linux")]
fn sendmmsg_batch(fd: libc::c_int, batch: &[OutboundPacket]) -> std::io::Result<usize> {
    use std::io;

    if batch.is_empty() {
        return Ok(0);
    }

    let addrs: Vec<socket2::SockAddr> = batch
        .iter()
        .map(|p| socket2::SockAddr::from(p.addr))
        .collect();

    let mut iovecs: Vec<libc::iovec> = batch
        .iter()
        .map(|p| libc::iovec {
            iov_base: p.data.as_ptr() as *mut libc::c_void,
            iov_len: p.data.len(),
        })
        .collect();

    let mut msgs: Vec<libc::mmsghdr> = Vec::with_capacity(batch.len());
    for i in 0..batch.len() {
        msgs.push(libc::mmsghdr {
            msg_hdr: libc::msghdr {
                msg_name: addrs[i].as_ptr() as *mut libc::c_void,
                msg_namelen: addrs[i].len() as libc::socklen_t,
                msg_iov: &mut iovecs[i] as *mut libc::iovec,
                msg_iovlen: 1,
                msg_control: std::ptr::null_mut(),
                msg_controllen: 0,
                msg_flags: 0,
            },
            msg_len: 0,
        });
    }

    let rc = unsafe {
        libc::sendmmsg(
            fd,
            msgs.as_mut_ptr(),
            batch.len() as libc::c_uint,
            libc::MSG_DONTWAIT,
        )
    };

    if rc < 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(rc as usize)
    }
}
