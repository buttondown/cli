install:
    bun install

build:
    bun build src/cli.tsx --compile


lint:
    bun lint:fix
    bun tsc

test:
    FORCE_COLOR=1 bun test src/*


build-and-pull:
    just build
    ./cli pull