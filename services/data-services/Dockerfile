FROM rust:1.78-alpine AS builder

RUN apk add --no-cache musl-dev protobuf-dev

WORKDIR /app
COPY Cargo.toml Cargo.lock* ./
RUN mkdir src && echo 'fn main() {}' > src/main.rs
RUN cargo build --release 2>/dev/null || true
RUN rm -rf src

COPY . .
RUN cargo build --release

FROM alpine:3.20
RUN apk add --no-cache ca-certificates
COPY --from=builder /app/target/release/relay-data-services /usr/local/bin/
EXPOSE 50051
CMD ["relay-data-services"]
