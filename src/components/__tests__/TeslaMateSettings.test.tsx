import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TeslaMateSettings } from "@/components/TeslaMateSettings";
import { DEFAULT_TESLAMATE_CONFIG } from "@/lib/teslamate/config";

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

beforeEach(() => {
  localStorage.clear();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  // The repo's vitest config has no `globals`, so testing-library's automatic
  // cleanup never registers itself.
  cleanup();
  vi.unstubAllGlobals();
});

function setUrl(value: string) {
  fireEvent.change(screen.getByLabelText("Grafana URL"), { target: { value } });
}

describe("TeslaMateSettings", () => {
  it("explains that Grafana sends no CORS headers when a cross-origin call is blocked", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<TeslaMateSettings onClose={() => {}} onSaved={() => {}} />);

    setUrl("https://grafana.example.com");
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));

    await waitFor(() => expect(screen.getByText(/CORS/i)).toBeTruthy());
    expect(screen.getByText(/reverse proxy/i)).toBeTruthy();
  });

  it("explains that the token was rejected", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: "Unauthorized" }, 401));
    render(<TeslaMateSettings onClose={() => {}} onSaved={() => {}} />);

    setUrl("https://grafana.example.com");
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));

    await waitFor(() => expect(screen.getByText(/rejected the token/i)).toBeTruthy());
  });

  it("reports a missing TeslaMate datasource separately from a failed query", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse([{ uid: "X", name: "Prometheus", type: "prometheus" }]),
    );
    render(<TeslaMateSettings onClose={() => {}} onSaved={() => {}} />);

    setUrl("https://grafana.example.com");
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));

    await waitFor(() => expect(screen.getByText(/No TeslaMate datasource/i)).toBeTruthy());
  });

  it("keeps the token out of storage unless remembering is asked for", () => {
    const onSaved = vi.fn();
    render(<TeslaMateSettings onClose={() => {}} onSaved={onSaved} />);

    setUrl("https://grafana.example.com");
    fireEvent.change(screen.getByLabelText("Service account token"), {
      target: { value: "glsa_secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const stored = JSON.parse(localStorage.getItem("tesla-cam-teslamate-config")!);
    expect(stored.token).toBeNull();
    expect(stored.enabled).toBe(true);
    expect(onSaved).toHaveBeenCalled();
  });

  it("stores the token when remembering is asked for", () => {
    render(<TeslaMateSettings onClose={() => {}} onSaved={() => {}} />);

    setUrl("https://grafana.example.com");
    fireEvent.change(screen.getByLabelText("Service account token"), {
      target: { value: "glsa_secret" },
    });
    fireEvent.click(screen.getByLabelText("Remember the token on this device"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const stored = JSON.parse(localStorage.getItem("tesla-cam-teslamate-config")!);
    expect(stored.token).toBe("glsa_secret");
    expect(stored.rememberToken).toBe(true);
  });

  it("offers the bundled proxy as the default address", () => {
    render(<TeslaMateSettings onClose={() => {}} onSaved={() => {}} />);
    expect((screen.getByLabelText("Grafana URL") as HTMLInputElement).value).toBe(
      DEFAULT_TESLAMATE_CONFIG.grafanaUrl,
    );
  });
});
