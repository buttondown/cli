import { describe, expect, it } from "bun:test";
import { deserialize, serialize } from "./email.js";

const EMAIL_WITH_COMPLEX_FRONTMATTER = `---
subject: "Test: 001"
metadata:
  foo: "bar"
---

Test`;

// Ideally, this would be a little better.
const ROUND_TRIPPED_EMAIL_WITH_COMPLEX_FRONTMATTER = `---
subject: "Test: 001"
metadata: 
  foo: bar
---

Test`;

const FRONT_MATTER_WITH_EMOJIS = `---
subject: "Test 🚀"
---

Test`;

const REALISTIC_FRONTMATTER = `---
id: ccdc672c-aae5-4cee-b07c-60726df4aa1c
publish_date: 2025-05-09T17:52:59.527494Z
subject: 5/9/2025
status: sent
slug: "592025"
secondary_id: 3
---

<!-- buttondown-editor-mode: fancy --><p>(An engineering-focused weeknotes! I’m sure next week will be very support-and-onboarding-heavy once my brain becomes back online.)</p><ol><li><p>Let me lead with the obvious and solipsistic: this is my final day on vacation! I can say confidently that this is the least I've thought about or worked on Buttondown in at least a year, so thank you to everyone for making it such a smooth week. I know we're a little bit underwater on the support ticket front, and I am excited to dig in and help burn down that backlog when I get back. But, the absence of operational issues really makes me pause and feel grateful for how far we've come over the past couple of months. (And t/y for only bullying me a moderate amount for keeping 1:1s even though I’m on vacation.)</p></li><li><p>We've officially been using Tailscale for two weeks, and at least from my limited exposure, it seems like the deployment has gone really well. I'm enjoying the Tailscale version of go-links, having an actual internal doc site again, and the vague sense of foundational security that it gives us. I think we're going to be shifting things like the Postal servers and admin over to Tailscale in the near future. It's nice to finally have the first milestone towards a solution in this after idly wondering, hmm, how should we solve this for the past two years? Thanks to Mati for leading the way, both in terms of rubber ducking this approach to me and actually signing up for the original account. </p></li><li><p>Operational expenses are creeping up. Some of this, I think, is temporary, such as our Better Stack bill doubling month over month. Other things feel a little bit less temporary, like Heroku's bill starting to flirt with the $3,000 mark.  I don't think any of this is new or shocking, and I think a lot of our longer-term investments are still the right ones to make and help defray and protect our margin. One of the things that I should probably get better at is focusing on the big-ticket items as opposed to the low-hanging fruit. I wanted to shift off of using Iframely, which we're spending a paltry $30 a month on. As nice as it would be to remove that from our dependency chain, it really doesn't move the needle in terms of saving cash compared to, say, cutting our Heroku bill in half. </p></li><li><p>On a fun note, one of the things that I've found LLM tooling to be really good for are the sorts of internal tools that are hard to justify spending a week on but are easy to justify spending an afternoon on. I checked a UI for visualizing the Overmind output into the repository, and I hope to actually open source this pretty soon. I think it's a really good representative example. A thing that makes our day-to-day engineering experience 1% nicer, and that 1% isn't worth the randomization, but throwing an LLM to spike out a solution and being comfortable with abandoning the project if it does an insufficiently poor job works really well. In general, this coheres with my sense of LLMs being really good at blank canvas problems and pattern matching problems, such as here are “four OAuth providers, now please add a fifth one.”</p></li><li><p>I wanted to wait one more week before taking the victory lap, but it looks like our Postgres-based queuing runner is legit. In the past five days, we've processed more asynchronous actions through this runner than through our legacy RQ system. The core processing loop has been fast and without the unnecessary Redis dependency. There's still a little bit of optimization we can do on the enqueuing side of things, but it feels really good to have a radically simpler approach for what is a core part of our infrastructure. I don't think we're going to try to explicitly remove Redis altogether, but it’s more of a long-term shift. (Don’t expect me to block any PRs because you’ve used Redis instead of <code>AsynchronousAction</code>.)</p></li></ol>`;

const EMAIL_WITH_LEADING_COMMENT = `---
subject: Test
---

<!-- buttondown-editor-mode: fancy --><p>(An engineering-focused weeknotes! I’m sure next week will be very support-and-onboarding-heavy once my brain becomes back online.)</p>  
`;

describe("email deserialization", () => {
  it("should parse markdown content", () => {
    const content = "---\nsubject: Test\n---\n\nTest";
    const parsed = deserialize(content);
    expect(parsed.email.subject).toEqual("Test");
    expect(parsed.email.body).toEqual("Test");
  });

  it("should handle quotes in the frontmatter", () => {
    const content = '---\nsubject: "Test"\n---\n\nTest';
    const parsed = deserialize(content);
    expect(parsed.email.subject).toEqual("Test");
    expect(parsed.email.body).toEqual("Test");
  });

  it("can handle more complex frontmatter", () => {
    const content = EMAIL_WITH_COMPLEX_FRONTMATTER;
    const parsed = deserialize(content);
    expect(parsed.email.subject).toEqual("Test: 001");
    expect(parsed.email.metadata).toEqual({ foo: "bar" });
    expect(parsed.email.body).toEqual("Test");
    expect(parsed.isValid).toBe(true);
    expect(parsed.error).toBeUndefined();
  });

  it("honors existing escapement", () => {
    const content = EMAIL_WITH_COMPLEX_FRONTMATTER;
    const parsed = deserialize(content);
    const reserialized = serialize(parsed.email);
    expect(reserialized).toEqual(ROUND_TRIPPED_EMAIL_WITH_COMPLEX_FRONTMATTER);
  });

  it("can handle emojis in the frontmatter", () => {
    const content = FRONT_MATTER_WITH_EMOJIS;
    const parsed = deserialize(content);
    expect(parsed.email.subject).toEqual("Test 🚀");
  });

  it("can handle realistic frontmatter", () => {
    const content = REALISTIC_FRONTMATTER;
    const parsed = deserialize(content);
    expect(parsed.email.subject).toEqual("5/9/2025");
  });

  it("can handle leading comments", () => {
    const content = EMAIL_WITH_LEADING_COMMENT;
    const parsed = deserialize(content);
    expect(parsed.email.subject).toEqual("Test");
  });
});
