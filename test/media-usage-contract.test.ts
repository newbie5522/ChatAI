/** @jest-environment node */

import { mkdir, readFile, rm } from "fs/promises";
import path from "path";
import type { SafeAccountRecord } from "../app/config/admin-store";

import {
  confirmCategoryQuota,
  readUsageRecords,
  releaseCategoryQuota,
  reserveCategoryQuota,
} from "../app/config/usage";

const dataDir = path.join(process.cwd(), ".tmp", "media-usage-contract");
const logPath = path.join(dataDir, "usage.json");
const account: SafeAccountRecord = {
  id: "account-15",
  username: "media-user",
  name: "Media User",
  role: "employee",
  status: "active",
  quotaUnlimited: false,
  monthlyChatTurns: 10,
  monthlySearchTurns: 10,
  monthlyImageCount: 10,
  monthlyVideoCount: 10,
  allowedModelIds: [],
  allowedCategories: ["chat", "search", "image", "video"],
  createdAt: "2026-09-15T00:00:00.000Z",
  updatedAt: "2026-09-15T00:00:00.000Z",
};

beforeEach(async () => {
  process.env.NEWBIE_USAGE_LOG_PATH = logPath;
  await rm(dataDir, { recursive: true, force: true });
  await mkdir(dataDir, { recursive: true });
});

afterAll(async () => {
  delete process.env.NEWBIE_USAGE_LOG_PATH;
  await rm(dataDir, { recursive: true, force: true });
});

function reservation(requestId: string) {
  return reserveCategoryQuota(account, {
    requestId,
    accountId: account.id,
    username: account.username,
    role: account.role,
    provider: "openai",
    modelId: "image",
    model: "gpt-image-2",
    category: "image",
    promptPreview: "draw",
    inputTokens: 1,
  });
}

test("releases reserved image quota when no artifact exists", async () => {
  await reservation("empty-media");
  await releaseCategoryQuota(
    "empty-media",
    "failed",
    "MEDIA_EMPTY_RESPONSE",
    502,
  );
  expect((await readUsageRecords())[0]).toMatchObject({
    status: "failed",
    usageUnits: 0,
    quotaUnits: 0,
  });
});

test("settles successful media usage exactly once", async () => {
  await reservation("valid-media");
  await confirmCategoryQuota("valid-media", 200);
  await confirmCategoryQuota("valid-media", 200);
  await releaseCategoryQuota("valid-media", "failed", "late failure", 502);
  const records = await readUsageRecords();
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({
    status: "success",
    usageUnits: 1,
    quotaUnits: 1,
  });
  expect(JSON.parse(await readFile(logPath, "utf8")).records).toHaveLength(1);
});
