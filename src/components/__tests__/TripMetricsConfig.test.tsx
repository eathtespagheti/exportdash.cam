import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TripMetricsConfig } from "@/components/TripMetricsConfig";

const STORAGE_KEY = "tesla-cam-teslamate-config";

function stored() {
  return JSON.parse(localStorage.getItem(STORAGE_KEY)!);
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("TripMetricsConfig", () => {
  it("switches a trip field on and persists it", () => {
    const onChange = vi.fn();
    render(<TripMetricsConfig onClose={() => {}} onChange={onChange} />);

    // "Distance" is in the default list, so switching it off must remove it.
    fireEvent.click(screen.getByLabelText("Trip: Distance"));

    expect(stored().tripFields).not.toContain("trip_distance");
    expect(onChange).toHaveBeenCalled();
  });

  it("switches a live field on and persists it", () => {
    render(<TripMetricsConfig onClose={() => {}} onChange={() => {}} />);

    fireEvent.click(screen.getByLabelText("Live: Tire pressure FL"));

    expect(stored().liveFields).toContain("tpms_fl");
  });

  it("persists the unit choices", () => {
    render(<TripMetricsConfig onClose={() => {}} onChange={() => {}} />);

    fireEvent.change(screen.getByLabelText("Distance unit"), {
      target: { value: "mi" },
    });
    fireEvent.change(screen.getByLabelText("Temperature unit"), {
      target: { value: "f" },
    });

    expect(stored().distanceUnit).toBe("mi");
    expect(stored().temperatureUnit).toBe("f");
  });

  it("persists the panel corner", () => {
    render(<TripMetricsConfig onClose={() => {}} onChange={() => {}} />);

    fireEvent.click(screen.getByLabelText("Corner: bottom-left"));

    expect(stored().panelCorner).toBe("bottom-left");
  });

  it("disables a corner the mini-map already uses", () => {
    render(
      <TripMetricsConfig
        onClose={() => {}}
        onChange={() => {}}
        occupiedCorners={["bottom-right"]}
      />,
    );

    expect(screen.getByLabelText("Corner: bottom-right")).toBeDisabled();
    expect(screen.getByLabelText("Corner: top-left")).not.toBeDisabled();
  });

  it("does not offer the geocoded place names by default", () => {
    render(<TripMetricsConfig onClose={() => {}} onChange={() => {}} />);

    expect(
      (screen.getByLabelText("Trip: Start place") as HTMLInputElement).checked,
    ).toBe(false);
  });
});
