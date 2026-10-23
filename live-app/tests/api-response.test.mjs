import assert from "node:assert/strict";
import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import ts from "../node_modules/typescript/lib/typescript.js";

const sourcePath = new URL("../lib/api-response.mts", import.meta.url);
const source = await readFile(sourcePath, "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const tempDir = await mkdtemp(path.join(os.tmpdir(), "api-response-tests-"));
const modulePath = path.join(tempDir, "api-response.mjs");
await writeFile(modulePath, output, "utf8");
const { readApiJson, ApiResponseError } = await import(pathToFileURL(modulePath).href);

test.after(async () => rm(tempDir, { recursive: true, force: true }));

test("reads successful JSON and JSON API error bodies without changing their shape", async () => {
  const success = await readApiJson(new Response(JSON.stringify({ value: 42 }), {
    status: 200, headers: { "Content-Type": "application/json" },
  }));
  assert.deepEqual(success, { value: 42 });

  const apiError = await readApiJson(new Response(JSON.stringify({ error: "Account not found" }), {
    status: 404, headers: { "Content-Type": "application/json" },
  }));
  assert.deepEqual(apiError, { error: "Account not found" });
});

for (const status of [401, 403, 200, 502]) {
  test(`turns HTML response at HTTP ${status} into a safe error retaining status`, async () => {
    const html = "<!DOCTYPE html><html><body>private proxy diagnostic</body></html>";
    await assert.rejects(
      readApiJson(new Response(html, { status, headers: { "Content-Type": "text/html" } })),
      (error) => {
        assert.ok(error instanceof ApiResponseError);
        assert.equal(error.status, status);
        assert.ok(error.message.length > 0);
        assert.equal(error.message.includes("<!DOCTYPE"), false);
        assert.equal(error.message.includes("<html"), false);
        assert.equal(error.message.includes("private proxy diagnostic"), false);
        return true;
      },
    );
  });
}

test("recognizes HTML bodies even when the content type is missing", async () => {
  await assert.rejects(
    readApiJson(new Response("  <!doctype html><html>gateway login</html>", { status: 403 })),
    (error) => error instanceof ApiResponseError
      && error.status === 403
      && !error.message.includes("gateway login"),
  );
});

for (const status of [200, 502]) {
  test(`reports malformed JSON safely at HTTP ${status}`, async () => {
    const malformed = "{\"secret\": <html>upstream debug</html>";
    await assert.rejects(
      readApiJson(new Response(malformed, { status, headers: { "Content-Type": "application/json" } })),
      (error) => {
        assert.ok(error instanceof ApiResponseError);
        assert.equal(error.status, status);
        assert.ok(error.message.length > 0);
        assert.equal(error.message.includes("upstream debug"), false);
        assert.equal(error.message.includes("<html"), false);
        return true;
      },
    );
  });
}

test("page reads both state and trade responses through the safe parser", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /import\s*\{\s*readApiJson\s*\}\s*from\s*["']@\/lib\/api-response\.mjs["']/);
  assert.equal((page.match(/await readApiJson</g) ?? []).length, 2);
  assert.equal(/response\.json\s*\(/.test(page), false);
});
