# syntax=docker/dockerfile:1

# Keep these immutable references synchronized with image-lock.json.
FROM --platform=$BUILDPLATFORM mcr.microsoft.com/dotnet/sdk:10.0.302@sha256:72dd743782f2ae7e5476fd64f6a460045e3998dc862218b80e6944cba79a01b0 AS dotnet-build

ENV DOTNET_CLI_HOME=/tmp/dotnet \
    DOTNET_SKIP_FIRST_TIME_EXPERIENCE=1 \
    DOTNET_CLI_TELEMETRY_OPTOUT=1 \
    NUGET_XMLDOC_MODE=skip

WORKDIR /src
COPY global.json ./
COPY dotnet/ dotnet/
COPY schemas/ schemas/
COPY third_party/ofdrw.net/ third_party/ofdrw.net/
RUN dotnet restore dotnet/tools/OFDCompose.RuntimeProbe/OFDCompose.RuntimeProbe.csproj \
      --locked-mode \
      -m:1 \
      /nodeReuse:false \
      /p:UseSharedCompilation=false \
      --disable-build-servers \
    && dotnet publish dotnet/tools/OFDCompose.RuntimeProbe/OFDCompose.RuntimeProbe.csproj \
      --configuration Release \
      --no-restore \
      --output /probe \
      /p:UseAppHost=false \
      -m:1 \
      /nodeReuse:false \
      /p:UseSharedCompilation=false \
      --disable-build-servers

FROM node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df AS node-dependencies

ENV NODE_ENV=production
WORKDIR /workspace
# The matrix runner supplies a minimal generated context. Its JS has already
# been built, but dependencies are installed here so native packages, if any,
# always match the target Linux architecture.
COPY . /workspace/
RUN corepack enable \
    && pnpm install --prod --frozen-lockfile

FROM mcr.microsoft.com/dotnet/aspnet:10.0@sha256:2d584d8147faddb0d678c5748d47953e5b8e18621ed4fb7049a91381d9d7746f AS runtime

ENV DOTNET_CLI_HOME=/tmp/dotnet \
    DOTNET_SKIP_FIRST_TIME_EXPERIENCE=1 \
    DOTNET_CLI_TELEMETRY_OPTOUT=1 \
    NODE_ENV=production

# Copy only the Node executable and license, not npm/Corepack, headers, or the
# remainder of the Node image's development surface.
COPY --from=node-dependencies /usr/local/bin/node /usr/local/bin/node
COPY --from=node-dependencies /usr/local/LICENSE /usr/local/share/licenses/node/LICENSE
COPY --from=dotnet-build /probe/ /probe/

WORKDIR /workspace
COPY --from=node-dependencies /workspace/ /workspace/

ENTRYPOINT ["node"]
