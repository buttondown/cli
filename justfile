install:
    bun install

build:
    bun run build

lint:
    bun lint:fix
    bun tsc

test:
    FORCE_COLOR=1 bun test src/*

build-and-pull:
    just build
    node ./dist/cli.js pull

release version="patch":
    npm version {{version}} --no-git-tag-version
    git add package.json
    git commit -m "chore(cli): bump version to v$(node -p 'require(\"./package.json\").version')"
    git push

publish:
    bun publish