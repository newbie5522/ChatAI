/** @jest-environment node */
import {
  mkdtempSync,
  readdirSync,
  unlinkSync,
  rmdirSync,
  writeFileSync,
} from "fs";
import { createHash } from "crypto";
import os from "os";
import path from "path";
import {
  createAttachmentAnalysisSession,
  readAttachmentAnalysisSession,
  deleteAttachmentAnalysisSessions,
} from "../app/config/attachment-analysis-store";
jest.mock("server-only", () => ({}));

const root = mkdtempSync(path.join(os.tmpdir(), "newbie-archive-test-"));
const previous = process.env.NEWBIE_ADMIN_CONFIG_PATH;
beforeAll(() => {
  process.env.NEWBIE_ADMIN_CONFIG_PATH = path.join(root, "admin.json");
});
afterAll(() => {
  if (previous === undefined) delete process.env.NEWBIE_ADMIN_CONFIG_PATH;
  else process.env.NEWBIE_ADMIN_CONFIG_PATH = previous;
  const archive = path.join(root, "attachment-analysis");
  for (const file of readdirSync(archive)) unlinkSync(path.join(archive, file));
  rmdirSync(archive);
  rmdirSync(root);
});
test("analysis survives memory loss, remains account-isolated and can be deleted", () => {
  createAttachmentAnalysisSession({
    id: "document",
    accountId: "owner",
    name: "report",
    kind: "document",
    mode: "document_index",
    bytes: 10,
    chunks: [],
  });
  globalThis.newbieAttachmentAnalysisStore?.clear();
  expect(readAttachmentAnalysisSession("other", "document")).toBeUndefined();
  expect(readAttachmentAnalysisSession("owner", "document")?.name).toBe(
    "report",
  );
  deleteAttachmentAnalysisSessions("other", ["document"]);
  expect(readAttachmentAnalysisSession("owner", "document")).toBeDefined();
  deleteAttachmentAnalysisSessions("owner", ["document"]);
  expect(readAttachmentAnalysisSession("owner", "document")).toBeUndefined();
});
test("expired documents are not returned after restart", () => {
  createAttachmentAnalysisSession({
    id: "expired",
    accountId: "owner",
    name: "report",
    kind: "document",
    mode: "document_index",
    bytes: 10,
    chunks: [],
  });
  globalThis.newbieAttachmentAnalysisStore?.clear();
  const now = jest
    .spyOn(Date, "now")
    .mockReturnValue(Date.now() + 31 * 86400000);
  expect(readAttachmentAnalysisSession("owner", "expired")).toBeUndefined();
  now.mockRestore();
});

test.each(["broken-json", "null", '{"mode":"invalid"}'])(
  "corrupt archive %s produces a safe actionable error",
  (content) => {
    const id = "broken";
    const key = createHash("sha256")
      .update(JSON.stringify(["owner", id]))
      .digest("hex");
    writeFileSync(
      path.join(root, "attachment-analysis", `${key}.json`),
      content,
    );
    expect(() => readAttachmentAnalysisSession("owner", id)).toThrow(
      /重新上传/,
    );
  },
);
