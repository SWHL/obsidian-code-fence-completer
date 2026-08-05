import { deepEqual, equal, throws } from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { normalizeVersion, syncVersions } from "./version-bump.mjs";

function writeJson(directory, filename, value) {
	writeFileSync(join(directory, filename), JSON.stringify(value));
}

function readJson(directory, filename) {
	return JSON.parse(readFileSync(join(directory, filename), "utf8"));
}

test("normalizes supported tag versions and rejects invalid tags", () => {
	equal(normalizeVersion("v1.2.3"), "1.2.3");
	equal(normalizeVersion("2.0.0-beta.1"), "2.0.0-beta.1");
	throws(() => normalizeVersion("release-1.2.3"), /Invalid version/);
	throws(() => normalizeVersion("1.2"), /Invalid version/);
});

test("synchronizes every project version file", (context) => {
	const directory = mkdtempSync(join(tmpdir(), "version-bump-"));
	context.after(() => rmSync(directory, { recursive: true, force: true }));
	writeJson(directory, "package.json", { name: "plugin", version: "1.0.0" });
	writeJson(directory, "package-lock.json", {
		name: "plugin",
		version: "1.0.0",
		packages: { "": { name: "plugin", version: "1.0.0" } },
	});
	writeJson(directory, "manifest.json", {
		version: "1.0.0",
		minAppVersion: "1.13.0",
	});
	writeJson(directory, "versions.json", { "1.0.0": "0.15.0" });

	equal(syncVersions("v1.2.3", directory), "1.2.3");
	equal(readJson(directory, "package.json").version, "1.2.3");
	equal(readJson(directory, "package-lock.json").version, "1.2.3");
	equal(readJson(directory, "package-lock.json").packages[""].version, "1.2.3");
	equal(readJson(directory, "manifest.json").version, "1.2.3");
	deepEqual(readJson(directory, "versions.json"), {
		"1.0.0": "0.15.0",
		"1.2.3": "1.13.0",
	});
});
