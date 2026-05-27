import { describe, expect, it, vi } from "vitest";

const { listLogsMock } = vi.hoisted(() => ({
  listLogsMock: vi.fn(),
}));

vi.mock("../repositories/metrcPackageRepository.js", () => ({
  listMetrcPackageRequestLogs: listLogsMock,
}));

import { listEvaluationFinishedPackageLabels } from "./metrcEvaluationFinishedPackages.js";

describe("listEvaluationFinishedPackageLabels", () => {
  it("includes labels from successful evaluation_finish logs", async () => {
    listLogsMock.mockResolvedValue([
      {
        action: "evaluation_finish",
        httpStatus: 200,
        requestPayloadJson: JSON.stringify({
          package: { packageLabel: "AAA00090000196B000000005" },
        }),
        responsePayloadJson: JSON.stringify({ ok: true, alreadyFinished: true }),
        createdAt: new Date(),
      },
    ]);

    const labels = await listEvaluationFinishedPackageLabels("c1");
    expect(labels.has("AAA00090000196B000000005")).toBe(true);
  });
});
