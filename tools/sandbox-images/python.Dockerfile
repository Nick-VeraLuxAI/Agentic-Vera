FROM python:3.11-alpine

WORKDIR /workspace

# Fixed non-root runtime identity for sandbox execution.
USER 65532:65532

ENTRYPOINT []
