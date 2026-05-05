import { beforeEach, describe, expect, it, vi } from "vitest";

const listByCreatedAtRange = vi.fn().mockResolvedValue([]);

vi.mock("../config/prisma.js", () => ({
  prisma: {
    $queryRaw: vi.fn(),
    companyMembership: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("../lib/mailer.js", () => ({
  sendHtmlEmail: vi.fn(),
}));

vi.mock("./cashLogService.js", () => ({
  CashLogService: class {
    listByCreatedAtRange = listByCreatedAtRange;
  },
}));

const denverPrefs = {
  enabled: true,
  weekdays: [1, 2, 3, 4, 5],
  sendTime: "11:18",
  window: "LAST_24H" as const,
  timezone: "America/Denver",
};

describe("cashLogEodJobService DB marker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listByCreatedAtRange.mockResolvedValue([]);
  });

  it("does not write cashLogEodLastSentAt when sendHtmlEmail rejects", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-05T17:21:30.000Z"));

    try {
      const prisma = (await import("../config/prisma.js")).prisma;
      const { sendHtmlEmail } = await import("../lib/mailer.js");
      prisma.$queryRaw = vi.fn().mockResolvedValue([{ id: "mem1" }]);
      prisma.companyMembership.findMany = vi.fn().mockResolvedValue([
        {
          id: "mem1",
          userId: "u1",
          companyId: "c1",
          cashLogEodPrefs: denverPrefs,
          cashLogEodLastSentAt: null,
          cashLogEodScheduleGeneration: 11,
          cashLogEodDigestSentScheduleGeneration: null,
          company: { name: "Acme" },
          user: { email: "a@b.co", isActive: true },
        },
      ]);
      prisma.companyMembership.update = vi.fn();
      vi.mocked(sendHtmlEmail).mockRejectedValueOnce(new Error("transport down"));

      const { runCashLogEodJob } = await import("./cashLogEodJobService.js");
      await runCashLogEodJob({ trigger: "cron" });

      expect(prisma.companyMembership.update).not.toHaveBeenCalled();
      expect(sendHtmlEmail).toHaveBeenCalledTimes(1);
      expect(sendHtmlEmail.mock.calls[0][0].logContext).toBe("cash_log_eod:c1");
    } finally {
      vi.useRealTimers();
    }
  });

  it("writes cashLogEodLastSentAt only after sendHtmlEmail succeeds", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-05T17:21:30.000Z"));

    try {
      const prisma = (await import("../config/prisma.js")).prisma;
      const { sendHtmlEmail } = await import("../lib/mailer.js");
      prisma.$queryRaw = vi.fn().mockResolvedValue([{ id: "mem2" }]);
      prisma.companyMembership.findMany = vi.fn().mockResolvedValue([
        {
          id: "mem2",
          userId: "u2",
          companyId: "c2",
          cashLogEodPrefs: denverPrefs,
          cashLogEodLastSentAt: null,
          cashLogEodScheduleGeneration: 3,
          cashLogEodDigestSentScheduleGeneration: null,
          company: { name: "Beta" },
          user: { email: "b@b.co", isActive: true },
        },
      ]);
      prisma.companyMembership.update = vi.fn().mockResolvedValue({});
      vi.mocked(sendHtmlEmail).mockResolvedValueOnce(undefined);

      const { runCashLogEodJob } = await import("./cashLogEodJobService.js");
      const out = await runCashLogEodJob({ trigger: "cron" });

      expect(sendHtmlEmail).toHaveBeenCalledTimes(1);
      expect(prisma.companyMembership.update).toHaveBeenCalledTimes(1);
      expect(prisma.companyMembership.update).toHaveBeenCalledWith({
        where: { id: "mem2" },
        data: {
          cashLogEodLastSentAt: expect.any(Date),
          cashLogEodDigestSentScheduleGeneration: 3,
        },
      });
      expect(out.sent).toBe(1);
      expect(out.skipReasons.email_send_failed).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("outside-window mocked run skips without update or mail", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-05T14:00:00.000Z"));

    try {
      const prisma = (await import("../config/prisma.js")).prisma;
      const { sendHtmlEmail } = await import("../lib/mailer.js");
      prisma.$queryRaw = vi.fn().mockResolvedValue([{ id: "mem3" }]);
      prisma.companyMembership.findMany = vi.fn().mockResolvedValue([
        {
          id: "mem3",
          userId: "u3",
          companyId: "c3",
          cashLogEodPrefs: denverPrefs,
          cashLogEodLastSentAt: null,
          cashLogEodScheduleGeneration: 0,
          cashLogEodDigestSentScheduleGeneration: null,
          company: { name: "Gamma" },
          user: { email: "g@b.co", isActive: true },
        },
      ]);
      prisma.companyMembership.update = vi.fn();

      const { runCashLogEodJob } = await import("./cashLogEodJobService.js");
      await runCashLogEodJob({ trigger: "cron" });

      expect(sendHtmlEmail).not.toHaveBeenCalled();
      expect(prisma.companyMembership.update).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
