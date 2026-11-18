# syntax=docker/dockerfile:1

FROM rust:1-bookworm AS builder
WORKDIR /app

COPY Cargo.toml Cargo.lock ./
COPY src ./src

RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/target/release/vchat /usr/local/bin/vchat

# Bind-адреса внутри контейнера; ICE (MEDIA_ADDR) и WORKER_COUNT приходят из compose/.env
ENV WS_ADDR=0.0.0.0:8080 \
    MEDIA_BIND_IP=0.0.0.0

EXPOSE 8080
EXPOSE 3478-3493/udp

CMD ["vchat"]
