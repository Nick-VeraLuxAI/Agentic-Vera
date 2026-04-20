FROM alpine:3.20

WORKDIR /workspace

# Fixed non-root runtime identity for sandbox execution.
USER 65532:65532

ENTRYPOINT []
