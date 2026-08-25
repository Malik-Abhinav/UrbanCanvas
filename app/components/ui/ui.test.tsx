import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Button } from "./button";
import { Input } from "./input";
import { Panel } from "./panel";
import { Tooltip } from "./tooltip";

describe("Button", () => {
  it("renders the primary variant class by default", () => {
    const html = renderToStaticMarkup(<Button>Save</Button>);

    expect(html).toContain("primary-button");
    expect(html).toContain("Save");
  });

  it("renders the secondary variant class on request", () => {
    const html = renderToStaticMarkup(<Button variant="secondary">Cancel</Button>);

    expect(html).toContain("secondary-button");
  });

  it("disables and marks busy while loading", () => {
    const html = renderToStaticMarkup(<Button isLoading>Saving</Button>);

    expect(html).toContain("disabled");
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("uc-spinner");
  });
});

describe("Input", () => {
  it("associates the label with the field", () => {
    const html = renderToStaticMarkup(<Input label="Project name" />);

    expect(html).toContain('for="');
    expect(html).toContain("Project name");
  });

  it("marks invalid and links the error message", () => {
    const html = renderToStaticMarkup(<Input error="Name is required" label="Project name" />);

    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('role="alert"');
    expect(html).toContain("Name is required");
    expect(html).toMatch(/aria-describedby="[^"]+-message"/);
  });

  it("shows success with status role instead of alert", () => {
    const html = renderToStaticMarkup(<Input label="Project name" success="Saved" />);

    expect(html).not.toContain('aria-invalid');
    expect(html).toContain('role="status"');
    expect(html).toContain("Saved");
  });

  it("shows hint text when there is no status message", () => {
    const html = renderToStaticMarkup(<Input hint="Up to 80 characters" label="Project name" />);

    expect(html).toContain("Up to 80 characters");
  });
});

describe("Panel", () => {
  it("renders title and body content", () => {
    const html = renderToStaticMarkup(
      <Panel title="Layers">
        <p>Body</p>
      </Panel>
    );

    expect(html).toContain("Layers");
    expect(html).toContain("<p>Body</p>");
    expect(html).toContain("info-panel");
  });

  it("omits the header entirely without title or actions", () => {
    const html = renderToStaticMarkup(
      <Panel>
        <p>Body</p>
      </Panel>
    );

    expect(html).not.toContain("<h2");
  });
});

describe("Tooltip", () => {
  it("links trigger to bubble via aria-describedby", () => {
    const html = renderToStaticMarkup(<Tooltip content="Draw a road">Road</Tooltip>);

    expect(html).toMatch(/aria-describedby="[^"]+"/);
    expect(html).toContain('role="tooltip"');
    expect(html).toContain("Draw a road");
  });
});
