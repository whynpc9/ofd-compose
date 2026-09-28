# Runtime matrix invocations

Frozen source commit: `5ead51614a41ceb6b581f2a469b211508220b55b`

Frozen context: `/private/tmp/ofd18-context-pure`

Source identity: `/private/tmp/ofd18-context-pure/.matrix/source.json`

## arm64 image

```sh
docker buildx build --platform linux/arm64 --load --tag ofd-compose-runtime-matrix:issue18-pure-arm64 --file /private/tmp/ofd18-context-pure/tests/runtime-matrix/Dockerfile /private/tmp/ofd18-context-pure
```

Image ID: `sha256:cbc4ff91d0d70ff37ec1b66249d043ca9de645f467d9077c88828eedb88d1b25`

```sh
docker run --rm --platform linux/arm64 --network none --cpus 2 --memory 4g --read-only --tmpfs /tmp:rw,size=256m -e MATRIX_SOURCE_IDENTITY=/workspace/.matrix/source.json -e MATRIX_EXECUTION_LABEL=nativeARMOrbStack -e MATRIX_IMAGE_ID=sha256:cbc4ff91d0d70ff37ec1b66249d043ca9de645f467d9077c88828eedb88d1b25 -v /Users/wanghongyi/.codex/worktrees/1a8f/ofd-compose/.scratch/issue18-output/pure-arm64:/evidence ofd-compose-runtime-matrix:issue18-pure-arm64 tests/runtime-matrix/run.mjs corpus .matrix/corpus.json /evidence /probe/OFDCompose.RuntimeProbe.dll
docker run --rm --platform linux/arm64 --network none --cpus 2 --memory 4g --read-only --tmpfs /tmp:rw,size=256m -e MATRIX_SOURCE_IDENTITY=/workspace/.matrix/source.json -e MATRIX_EXECUTION_LABEL=nativeARMOrbStack -e MATRIX_IMAGE_ID=sha256:cbc4ff91d0d70ff37ec1b66249d043ca9de645f467d9077c88828eedb88d1b25 -v /Users/wanghongyi/.codex/worktrees/1a8f/ofd-compose/.scratch/issue18-output/pure-arm64:/evidence ofd-compose-runtime-matrix:issue18-pure-arm64 tests/runtime-matrix/run.mjs benchmark .matrix/corpus.json /evidence /probe/OFDCompose.RuntimeProbe.dll
```

## amd64 image on ARM host

```sh
docker buildx build --platform linux/amd64 --load --tag ofd-compose-runtime-matrix:issue18-pure-amd64 --file /private/tmp/ofd18-context-pure/tests/runtime-matrix/Dockerfile /private/tmp/ofd18-context-pure
```

Image ID: `sha256:e3eb3bc1fadf11f76914f42b6f62b47a287d6091fc35cc9112d155f71507e961`

```sh
docker run --rm --platform linux/amd64 --network none --cpus 2 --memory 4g --read-only --tmpfs /tmp:rw,size=256m -e MATRIX_SOURCE_IDENTITY=/workspace/.matrix/source.json -e MATRIX_EXECUTION_LABEL=emulatedX64OnARMOrbStack -e MATRIX_IMAGE_ID=sha256:e3eb3bc1fadf11f76914f42b6f62b47a287d6091fc35cc9112d155f71507e961 -v /Users/wanghongyi/.codex/worktrees/1a8f/ofd-compose/.scratch/issue18-output/pure-amd64:/evidence ofd-compose-runtime-matrix:issue18-pure-amd64 tests/runtime-matrix/run.mjs corpus .matrix/corpus.json /evidence /probe/OFDCompose.RuntimeProbe.dll
docker run --rm --platform linux/amd64 --network none --cpus 2 --memory 4g --read-only --tmpfs /tmp:rw,size=256m -e MATRIX_SOURCE_IDENTITY=/workspace/.matrix/source.json -e MATRIX_EXECUTION_LABEL=emulatedX64OnARMOrbStack -e MATRIX_IMAGE_ID=sha256:e3eb3bc1fadf11f76914f42b6f62b47a287d6091fc35cc9112d155f71507e961 -v /Users/wanghongyi/.codex/worktrees/1a8f/ofd-compose/.scratch/issue18-output/pure-amd64:/evidence ofd-compose-runtime-matrix:issue18-pure-amd64 tests/runtime-matrix/run.mjs benchmark .matrix/corpus.json /evidence /probe/OFDCompose.RuntimeProbe.dll
```

Both corpus and benchmark runs used the image's default `node` entrypoint. The amd64 runs used host emulation and are not native-x64 performance evidence.

## .NET validation

Official SDK manifest list: `sha256:ed034a8bf0b24ded0cbbac07e17825d8e9ebfe21e308191d0f7421eaf5ad4664`; cached image ID `sha256:927989b59ab634d7d5f2e780c3cafc8d83806d074355772927f6c93a6f889cfc`; observed SDK `10.0.302` on `linux/arm64`.

Restore and build used `-m:1 /nodeReuse:false /p:UseSharedCompilation=false --disable-build-servers`, a writable `DOTNET_CLI_HOME=/tmp/dotnet`, and task-scoped `NUGET_PACKAGES=/private/tmp/issue18-nuget` mounted at `/nuget`.

The valid MTP invocation was:

```sh
dotnet test --solution dotnet/OFDCompose.slnx --configuration Release --no-build --no-restore
```

Result: 494 succeeded, 0 failed, 0 skipped. A preceding invocation incorrectly forwarded MSBuild-only switches to xUnit v3, selected zero tests, and exited 5; its raw log is retained as an invalid excluded attempt.

Reader outputs:

- `.scratch/issue18-output/ofd-reader-input`
- `.scratch/issue18-output/source-reader-input`
