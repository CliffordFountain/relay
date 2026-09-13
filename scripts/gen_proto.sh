#!/usr/bin/env sh
# Regenerate the API's Python gRPC stubs from proto/relay.proto.
#
# The generated stubs (services/api/app/grpc_stubs/relay_pb2*.py) are committed so a fresh
# clone / CI can import the API without a codegen step — the API's Docker build context is
# ./services/api and does not include proto/, so there is no build-time protoc. Run this
# after changing proto/relay.proto and commit the result.
#
# Requires grpcio-tools:  pip install grpcio-tools
set -e
cd "$(dirname "$0")/.."

python -m grpc_tools.protoc -I proto \
  --python_out=services/api/app/grpc_stubs \
  --grpc_python_out=services/api/app/grpc_stubs \
  relay.proto

# grpc_tools emits a top-level `import relay_pb2`; make it package-relative so it imports
# correctly as app.grpc_stubs.relay_pb2_grpc.
sed -i 's/^import relay_pb2 as relay__pb2/from . import relay_pb2 as relay__pb2/' \
  services/api/app/grpc_stubs/relay_pb2_grpc.py

echo "Regenerated services/api/app/grpc_stubs/relay_pb2.py + relay_pb2_grpc.py"
