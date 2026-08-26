import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MapLegend } from "./map-legend";

describe("MapLegend (Task 31)", () => {
  it("renders a labelled toggle, collapsed by default", () => {
    const html = renderToStaticMarkup(<MapLegend />);

    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Show map legend");
  });

  it("lists every proposal type with text labels when open", () => {
    const html = renderToStaticMarkup(<MapLegend defaultOpen />);

    for (const label of ["Road / lane", "Bike lane", "Sidewalk", "Crossing", "Roundabout", "Traffic signal"]) {
      expect(html).toContain(label);
    }
    expect(html).toContain('role="group"');
    expect(html).toContain("Map legend");
  });
});
