// Security controls and the full export's zip writer. Run: DATABASE_URL=... npm test
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { eq } from "drizzle-orm";
import { changes } from "./security";
import { safeName, ZipWriter } from "./zip";

const ORG = "org_security_controls";

test("the audit detail names only what changed", () => {
  const labels = { aiEnabled: "AI answers", aiInstructions: "What the AI should know", aiOverageMonthlyLimit: "Overage limit" };
  assert.equal(changes({ aiEnabled: true, aiInstructions: "a", aiOverageMonthlyLimit: null }, { aiEnabled: false, aiInstructions: "a", aiOverageMonthlyLimit: 50 }, labels), "AI answers: on → off; Overage limit: none → 50");
  // The AI notes can be long, so the log only says they were edited.
  assert.equal(changes({ aiInstructions: "old" }, { aiInstructions: "new" }, labels), "What the AI should know edited");
  assert.equal(changes({ aiEnabled: true }, { aiEnabled: true }, labels), "");
});

test("archive file names can't climb out of their folder", () => {
  assert.ok(!/[/\\]/.test(safeName("../../etc/passwd")) && !safeName("../x").startsWith("."));
  assert.equal(safeName("invoice:march?.pdf"), "invoice_march_.pdf");
  assert.equal(safeName(""), "file");
});

test("the zip writer makes an archive other tools can read", () => {
  const zip = new ZipWriter();
  const parts = [...zip.file("tickets.json", "[]"), ...zip.file("attachments/12/ab-ünïcode.txt", Buffer.from("hello")), zip.finish()];
  const buf = Buffer.concat(parts);
  // End record: two entries.
  assert.equal(buf.readUInt32LE(buf.length - 22), 0x06054b50);
  assert.equal(buf.readUInt16LE(buf.length - 12), 2);
  // Stored, so the bytes sit right after the second local header.
  const second = 30 + "tickets.json".length + 2;
  assert.equal(buf.readUInt32LE(second), 0x04034b50);
  const nameLen = buf.readUInt16LE(second + 26);
  assert.equal(buf.subarray(second + 30, second + 30 + nameLen).toString("utf8"), "attachments/12/ab-ünïcode.txt");
  assert.equal(buf.subarray(second + 30 + nameLen, second + 35 + nameLen).toString(), "hello");
  // Where python is around, check it the way a real unzip would (CRC included).
  try {
    const dir = mkdtempSync(join(tmpdir(), "fdzip-"));
    writeFileSync(join(dir, "a.zip"), buf);
    const out = execFileSync("python3", ["-c", "import sys,zipfile;z=zipfile.ZipFile(sys.argv[1]);print(z.testzip());print(z.read('attachments/12/ab-ünïcode.txt').decode())", join(dir, "a.zip")]).toString();
    assert.equal(out, "None\nhello\n");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
});

test("database: with AI processing off, nothing reaches the AI provider", { skip: !process.env.DATABASE_URL }, async () => {
  const { db, schema, pool } = await import("@/db");
  after(() => pool.end());
  const { draftAnswer } = await import("./ai");
  const { structuredCall } = await import("./llm");
  const { AiOffError, audit, auditLog } = await import("./security");
  const { z } = await import("zod");

  await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
  await db.insert(schema.orgs).values({ id: ORG, name: "Careful team", inboundKey: "secctl0001", aiProcessing: false });
  // No API key is needed to prove it: the check comes before any request is built.
  const prev = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "sk-test-not-used";
  try {
    await assert.rejects(draftAnswer({ id: ORG, name: "Careful team", aiInstructions: "" }, [], { from: "a@b.c", subject: "Hi", body: "Hi", attached: [] }), AiOffError);
    await assert.rejects(structuredCall(ORG, z.object({ a: z.string() }), "sys", "user"), AiOffError);
  } finally {
    if (prev === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prev;
  }

  await audit(ORG, { userId: "user_1", name: "Ana" }, "settings.ai_processing", "AI processing off");
  await audit(ORG, { userId: "user_1", name: "Ana" }, "export.archive", "0 attachments");
  const log = await auditLog(ORG);
  assert.deepEqual(log.map((e) => e.action), ["export.archive", "settings.ai_processing"]);
  // A bad org id is logged and swallowed, never thrown into the change it describes.
  await audit("org_does_not_exist", { userId: null, name: "System" }, "member.joined");
  await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
});
