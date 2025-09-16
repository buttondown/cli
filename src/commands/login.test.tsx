import delay from "delay";
import { render } from "ink-testing-library";
import React from "react";
import { beforeEach, describe, expect, test } from "bun:test";
import createConfig from "../config.js";
import Login from "./login.js";

beforeEach(() => {
  const config = createConfig();
  config.clear();
});

describe("login", () => {
  test("should display starting status initially", () => {
    const { lastFrame } = render(<Login />);
    expect(lastFrame()).toMatchInlineSnapshot(`
      "Please enter your Buttondown API key:

      \x1B[7mE\x1B[27m\x1B[90mnter your API key...\x1B[39m"
    `);
  });

  test("should persist api key", async () => {
    const randomKey = Math.random().toString(36).slice(2, 15);
    const { stdin, lastFrame } = render(<Login />);

    await delay(50);

    stdin.write(randomKey);

    await delay(50);

    stdin.write("\r");

    await delay(200);

    expect(lastFrame()).toMatchInlineSnapshot(`
      "\x1B[32m✓ Successfully configured API key!\x1B[39m

      To use a different API key, run this command again."
    `);
    const config = createConfig();
    expect(config.get("apiKey")).toBe(randomKey);
  });

  test("should show already logged in message when API key exists and no force flag", () => {
    const config = createConfig();
    config.set("apiKey", "existing-api-key");

    const { lastFrame } = render(<Login />);
    expect(lastFrame()).toMatchInlineSnapshot(`
      "\x1B[32m✓ You're already logged in!\x1B[39m

      To use a different API key, run: \x1B[36mbuttondown login --force\x1B[39m"
    `);
  });

  test("should show login prompt when API key exists but force flag is true", () => {
    const config = createConfig();
    config.set("apiKey", "existing-api-key");

    const { lastFrame } = render(<Login force={true} />);
    expect(lastFrame()).toMatchInlineSnapshot(`
      "Please enter your Buttondown API key:

      \x1B[7mE\x1B[27m\x1B[90mnter your API key...\x1B[39m"
    `);
  });

  test("should allow overriding existing API key with force flag", async () => {
    const config = createConfig();
    config.set("apiKey", "existing-api-key");

    const newRandomKey = Math.random().toString(36).slice(2, 15);
    const { stdin, lastFrame } = render(<Login force={true} />);

    await delay(50);

    stdin.write(newRandomKey);

    await delay(50);

    stdin.write("\r");

    await delay(200);

    expect(lastFrame()).toMatchInlineSnapshot(`
      "\x1B[32m✓ Successfully configured API key!\x1B[39m

      To use a different API key, run this command again."
    `);
    expect(config.get("apiKey")).toBe(newRandomKey);
  });
});
