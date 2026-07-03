import { afterEach } from "bun:test";

// Command components set process.exitCode = 1 on failure paths, and several
// tests exercise those paths on purpose. Reset after each test so the test
// process itself doesn't report failure when every test passed.
afterEach(() => {
	// Bun ignores `process.exitCode = undefined`; 0 actually clears it. A
	// real test failure still exits non-zero — bun's own failure exit takes
	// precedence over this value.
	process.exitCode = 0;
});
