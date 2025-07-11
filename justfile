install:
    bun install

build:
    bun build src/cli.tsx --compile


lint:
    bun lint:fix
    bun tsc


test:
    bun test