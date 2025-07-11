import delay from "delay";
import { render } from "ink-testing-library";
import React from "react";
import { beforeEach, expect, test } from "vitest";
import createConfig from "../config.js";
import Login from "./login.js";

beforeEach(() => {
  // Clear any existing config before each test
  const config = createConfig();
  config.clear();
});

test("should display starting status initially", () => {
  const { lastFrame } = render(<Login />);
  expect(lastFrame()).toMatchSnapshot();
});

test("should persist api key", async () => {
  const randomKey = Math.random().toString(36).slice(2, 15);
  const { stdin, lastFrame } = render(<Login />);

  // Wait a bit for the component to be ready
  await delay(50);

  // Type the API key
  stdin.write(randomKey);

  // Wait for the input to be processed
  await delay(50);

  // Submit with Enter
  stdin.write("\r");

  // Wait for the submit to be processed
  await delay(200);

  expect(lastFrame()).toMatchSnapshot();
  const config = createConfig();
  expect(config.get("apiKey")).toBe(randomKey);
});

test("should show already logged in message when API key exists and no force flag", () => {
  const config = createConfig();
  config.set("apiKey", "existing-api-key");

  const { lastFrame } = render(<Login />);
  expect(lastFrame()).toMatchSnapshot();
});

test("should show login prompt when API key exists but force flag is true", () => {
  const config = createConfig();
  config.set("apiKey", "existing-api-key");

  const { lastFrame } = render(<Login force={true} />);
  expect(lastFrame()).toMatchSnapshot();
});

test("should allow overriding existing API key with force flag", async () => {
  const config = createConfig();
  config.set("apiKey", "existing-api-key");

  const newRandomKey = Math.random().toString(36).slice(2, 15);
  const { stdin, lastFrame } = render(<Login force={true} />);

  // Wait a bit for the component to be ready
  await delay(50);

  // Type the new API key
  stdin.write(newRandomKey);

  // Wait for the input to be processed
  await delay(50);

  // Submit with Enter
  stdin.write("\r");

  // Wait for the submit to be processed
  await delay(200);

  expect(lastFrame()).toMatchSnapshot();
  expect(config.get("apiKey")).toBe(newRandomKey);
});
