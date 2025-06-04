import test from "ava";
import { render } from "ink-testing-library";
import React from "react";
import App from "./App.js";

test("should display starting status initially", (t) => {
  const { lastFrame } = render(
    <App command="login" options={{ apiKey: "test-key" }} />
  );
  t.snapshot(lastFrame());
});

test("should display error for unknown command", (t) => {
  const { lastFrame } = render(<App command="unknown" options={{}} />);

  t.snapshot(lastFrame());
});

test("should display authentication required message when not logged in", (t) => {
  const { lastFrame } = render(<App command="push" options={{}} />);
  t.snapshot(lastFrame());
});
