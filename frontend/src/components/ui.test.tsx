import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Button, Field, FilterButtons, Input, LoadingState, Modal } from "./ui";

describe("shared product accessibility contracts", () => {
  it("associates generated field labels, hints and errors with the input", () => {
    const html = renderToStaticMarkup(<Field label="Business name" error="Enter a name"><Input /></Field>);
    const id = /<label for="([^"]+)"/.exec(html)?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`id="${id}"`);
    expect(html).toContain(`aria-describedby="${id}-description"`);
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain(`id="${id}-description"`);
  });
  it("does not accidentally submit a form through a secondary action", () => {
    expect(renderToStaticMarkup(<Button>Cancel</Button>)).toContain('type="button"');
    expect(renderToStaticMarkup(<Button type="submit">Save</Button>)).toContain('type="submit"');
  });
  it("exposes pending work and prevents duplicate submission", () => {
    const html = renderToStaticMarkup(<Button loading>Save changes</Button>);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('disabled=""');
  });
  it("uses native buttons with an explicit selected filter state", () => {
    const html = renderToStaticMarkup(<FilterButtons label="Status" value="all" onChange={() => undefined} options={[{ value: "all", label: "All" }, { value: "open", label: "Open" }]} />);
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('aria-label="Status"');
  });
  it("gives native dialogs an associated accessible title and removes closed dialogs", () => {
    expect(renderToStaticMarkup(<Modal open={false} title="Customer" onClose={() => undefined}>Content</Modal>)).toBe("");
    const html = renderToStaticMarkup(<Modal open title="Customer" onClose={() => undefined}>Content</Modal>);
    const labelId = /aria-labelledby="([^"]+)"/.exec(html)?.[1];
    expect(html).toContain("<dialog");
    expect(html).toContain(`id="${labelId}"`);
    expect(html).toContain('aria-label="Close Customer"');
  });
  it("labels loading without pretending placeholder rows are real data", () => {
    const html = renderToStaticMarkup(<LoadingState label="Loading customers" />);
    expect(html).toContain('role="status"');
    expect(html).toContain("Loading customers");
    expect(html).toContain('aria-hidden="true"');
  });
});
