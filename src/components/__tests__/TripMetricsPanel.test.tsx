import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { TripMetricsPanel } from "@/components/TripMetricsPanel";
import { DEFAULT_TESLAMATE_CONFIG } from "@/lib/teslamate/config";
import type { PositionSample, TripSummary } from "@/lib/teslamate/types";

const TRIP: TripSummary = {
  id: 7,
  startMs: 0,
  endMs: 600_000,
  distanceKm: 12.5,
  durationMin: 15,
  speedMaxKmh: 60,
  powerMaxKw: 30,
  powerMinKw: -10,
  ascentM: 5,
  descentM: 12,
  outsideTempAvgC: 20,
  insideTempAvgC: 25,
  startIdealRangeKm: 280,
  endIdealRangeKm: 270,
  startKm: 162_723,
  endKm: 162_735,
  efficiencyKwhPerKm: 0.1367,
  startBatteryPct: 60,
  endBatteryPct: 55,
  startPlace: "Home",
  endPlace: "Work",
};

const SAMPLE: PositionSample = {
  tMs: 0,
  speedKmh: 42,
  powerKw: -8,
  batteryPct: 58,
  usableBatteryPct: 57,
  odometerKm: 162_730,
  elevationM: 175,
  idealRangeKm: 275,
  estRangeKm: 270,
  ratedRangeKm: 275,
  tpmsFl: 2.9,
  tpmsFr: 2.9,
  tpmsRl: 3,
  tpmsRr: 3,
  outsideTempC: 21,
  insideTempC: 26,
  latitude: 40.7,
  longitude: 8.5,
};

afterEach(cleanup);

function renderPanel(overrides: Partial<React.ComponentProps<typeof TripMetricsPanel>> = {}) {
  const props = {
    trip: TRIP,
    sample: SAMPLE,
    config: DEFAULT_TESLAMATE_CONFIG,
    speedUnit: "kmh" as const,
    ...overrides,
  };
  return render(<TripMetricsPanel {...props} />);
}

describe("TripMetricsPanel", () => {
  it("shows only the configured trip fields", () => {
    renderPanel({
      config: { ...DEFAULT_TESLAMATE_CONFIG, tripFields: ["trip_distance"] },
    });

    expect(screen.getByText("12.5 km")).toBeTruthy();
    expect(screen.queryByText("Work")).toBeNull();
  });

  it("shows only the configured live fields", () => {
    renderPanel({
      config: {
        ...DEFAULT_TESLAMATE_CONFIG,
        tripFields: ["trip_distance"],
        liveFields: ["battery"],
      },
    });

    expect(screen.getByText("58%")).toBeTruthy();
    expect(screen.queryByText(/kW regen/)).toBeNull();
  });

  it("renders no live block when no live fields are chosen", () => {
    renderPanel({ config: { ...DEFAULT_TESLAMATE_CONFIG, liveFields: [] } });

    expect(screen.getByText("12.5 km")).toBeTruthy();
    expect(screen.queryByText("58%")).toBeNull();
  });

  it("renders a missing value as an em dash, not a zero", () => {
    renderPanel({
      trip: { ...TRIP, distanceKm: null },
      config: { ...DEFAULT_TESLAMATE_CONFIG, tripFields: ["trip_distance"] },
    });

    expect(screen.getByText("—")).toBeTruthy();
    expect(screen.queryByText("0.0 km")).toBeNull();
  });

  it("marks regenerative power as such", () => {
    renderPanel({
      config: {
        ...DEFAULT_TESLAMATE_CONFIG,
        tripFields: ["trip_distance"],
        liveFields: ["power"],
      },
    });

    expect(screen.getByText("8 kW regen")).toBeTruthy();
  });

  it("says so when no trip covers the clip", () => {
    renderPanel({ trip: null });

    expect(screen.getByText(/No TeslaMate trip covers this clip/i)).toBeTruthy();
  });

  it("marks a trip that is still in progress as provisional", () => {
    renderPanel({
      trip: { ...TRIP, endMs: null, distanceKm: null },
      config: { ...DEFAULT_TESLAMATE_CONFIG, tripFields: ["trip_distance"] },
    });

    expect(screen.getByText(/in progress/i)).toBeTruthy();
    expect(screen.getByText("—")).toBeTruthy();
  });

  it("lays the tire pressures out in the positions they describe", () => {
    renderPanel({
      config: {
        ...DEFAULT_TESLAMATE_CONFIG,
        tripFields: [],
        liveFields: ["tpms_fl", "tpms_fr", "tpms_rl", "tpms_rr"],
      },
    });

    const grid = screen.getByLabelText("Tire pressures");
    expect(grid.className).toContain("grid-cols-2");
    for (const position of ["FL", "FR", "RL", "RR"]) {
      expect(screen.getByLabelText(`Tire ${position}`)).toBeTruthy();
    }
    // Both front tires read 2.9 and both rear tires 3.0 in the fixture.
    expect(screen.getAllByText("2.9 bar")).toHaveLength(2);
    expect(screen.getAllByText("3.0 bar")).toHaveLength(2);
  });

  it("renders a trip stats link with the trip expanded into it", () => {
    renderPanel({
      carId: 1,
      config: {
        ...DEFAULT_TESLAMATE_CONFIG,
        tripFields: ["trip_distance"],
        tripLinkTemplate: "https://g/d/x?var-drive_id={driveId}&car={carId}&from={startMs}",
      },
    });

    const link = screen.getByRole("link", { name: /trip stats/i });
    expect(link.getAttribute("href")).toBe("https://g/d/x?var-drive_id=7&car=1&from=0");
  });

  it("renders no link when no template is configured", () => {
    renderPanel();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("does not show a running distance for a trip still in progress", () => {
    // TeslaMate can report 0 for a drive that has only just started; that is
    // not a 0 km trip.
    renderPanel({
      trip: { ...TRIP, endMs: null, distanceKm: 0 },
      config: { ...DEFAULT_TESLAMATE_CONFIG, tripFields: ["trip_distance"] },
    });

    expect(screen.queryByText("0.0 km")).toBeNull();
    expect(screen.getByText("—")).toBeTruthy();
  });
});
