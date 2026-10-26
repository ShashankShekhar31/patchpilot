// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ReviewSidebar, type ReviewSidebarProps } from "@/components/review-sidebar";
import type { TestResult } from "@/lib/ai/schema";

afterEach(cleanup);

const provider: TestResult["provider"] = {
  kind: "alan",
  label: "Alan harness",
  model: "deepseek/deepseek-v4.1-flash",
  modelName: "DeepSeek V4.1 Flash",
  license: "MIT",
  licenseVerified: true,
  licenseUrl: "https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash",
  sourceUrl: null,
  mode: "live",
  baseUrlHost: "api.tryalan.ai",
  maxInputChars: 60_000,
  maxOutputTokens: 2_400,
  timeoutMs: 35_000,
  deadlineMs: 45_000,
  maxPromptChars: 24_000,
  reason: null,
  credentialSource: "ALAN_API_KEY",
};

const sampleTests: TestResult = {
  summary: "Focused suggestions.",
  framework: "Vitest",
  mode: "sample",
  provider,
  warnings: [],
  cases: [
    {
      title: "20% coupon reduces a 10000-cent cart to 8000",
      testType: "unit",
      setup: "Return a 10000-cent cart and a 20% coupon.",
      expected: "The total is 8000.",
      finding: "Discount treats a percentage as a fraction",
    },
  ],
};

function props(overrides: Partial<ReviewSidebarProps> = {}): ReviewSidebarProps {
  return {
    review: null,
    messages: [],
    question: "",
    onQuestionChange: vi.fn(),
    onAsk: vi.fn(),
    asking: false,
    askError: null,
    onRetryAsk: vi.fn(),
    tests: null,
    testing: false,
    testsError: null,
    onRetryTests: vi.fn(),
    onGenerateTests: vi.fn(),
    report: "",
    onDownloadReport: vi.fn(),
    tab: "tests",
    onTabChange: vi.fn(),
    canAsk: true,
    providerMode: "live",
    providerLabel: "Alan harness",
    ...overrides,
  };
}

describe("Generate Tests UI recovery", () => {
  it("shows a recoverable inline error and keeps the previous suggestions", () => {
    const onRetryTests = vi.fn();
    render(
      <ReviewSidebar
        {...props({
          tests: sampleTests,
          testsError: "The model provider timed out. Retry or use a smaller submission.",
          onRetryTests,
        })}
      />,
    );

    expect(screen.getByRole("alert").textContent).toMatch(/timed out/i);
    expect(screen.getByText("20% coupon reduces a 10000-cent cart to 8000")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetryTests).toHaveBeenCalledTimes(1);
  });

  it("shows a spinner state while generating and clears the error", () => {
    render(<ReviewSidebar {...props({ testing: true })} />);

    expect(screen.queryByRole("alert")).toBeNull();
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy();
    const button = screen.getByRole("button", { name: /generate tests/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("shows the error with an enabled generate action and no stuck spinner", () => {
    render(
      <ReviewSidebar
        {...props({
          testing: false,
          testsError: "The request took too long. Retry or use a smaller submission.",
        })}
      />,
    );

    expect(screen.getByRole("alert").textContent).toMatch(/took too long/i);
    const buttons = screen.getAllByRole("button", {
      name: /generate tests/i,
    }) as HTMLButtonElement[];
    expect(buttons.every((button) => !button.disabled)).toBe(true);
    expect(document.querySelector(".animate-spin")).toBeNull();
  });
});