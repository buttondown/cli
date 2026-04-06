import { beforeEach, describe, expect, test } from "bun:test";
import delay from "delay";
import { render } from "ink-testing-library";
import createConfig from "../config.js";
import Login from "./login.js";

beforeEach(() => {
  const config = createConfig();
  config.clear();
});

describe("login", () => {
  test("should display starting status initially", () => {
    const { lastFrame } = render(<Login />);
    expect(lastFrame()).toContain("Please enter your Buttondown API key:");
  });

  test("should persist api key via interactive input", async () => {
    const randomKey = Math.random().toString(36).slice(2, 15);
    const { stdin, lastFrame } = render(<Login />);

    await delay(50);

    stdin.write(randomKey);

    await delay(50);

    stdin.write("\r");

    await delay(200);

    expect(lastFrame()).toContain("Logged in.");
    const config = createConfig();
    expect(config.get("apiKey")).toBe(randomKey);
  });

  test("should persist api key non-interactively when --api-key is passed", () => {
    const randomKey = Math.random().toString(36).slice(2, 15);
    const { lastFrame } = render(<Login apiKey={randomKey} />);

    expect(lastFrame()).toContain("Logged in.");
    const config = createConfig();
    expect(config.get("apiKey")).toBe(randomKey);
  });

  test("should show already logged in message when API key exists and no force flag", () => {
    const config = createConfig();
    config.set("apiKey", "existing-api-key");

    const { lastFrame } = render(<Login />);
    expect(lastFrame()).toContain("Already logged in.");
    expect(lastFrame()).toContain("buttondown login --force");
  });

  test("should show login prompt when API key exists but force flag is true", () => {
    const config = createConfig();
    config.set("apiKey", "existing-api-key");

    const { lastFrame } = render(<Login force={true} />);
    expect(lastFrame()).toContain("Please enter your Buttondown API key:");
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

    expect(lastFrame()).toContain("Logged in.");
    expect(config.get("apiKey")).toBe(newRandomKey);
  });

  test("should output JSON when --json flag is passed with --api-key", () => {
    const randomKey = Math.random().toString(36).slice(2, 15);
    const { lastFrame } = render(<Login apiKey={randomKey} json={true} />);

    expect(lastFrame()).toBe(JSON.stringify({ status: "logged_in" }));
    const config = createConfig();
    expect(config.get("apiKey")).toBe(randomKey);
  });
});
