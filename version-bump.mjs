import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SEMVER_PATTERN =
	/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?$/;

export function normalizeVersion(rawVersion) {
	const version = rawVersion?.trim().replace(/^v/, "");
	if (!version || !SEMVER_PATTERN.test(version)) {
		throw new Error(
			`Invalid version "${rawVersion ?? ""}". Expected a semantic version such as 1.2.3 or v1.2.3.`,
		);
	}

	return version;
}

function readJson(rootDirectory, filename) {
	return JSON.parse(readFileSync(resolve(rootDirectory, filename), "utf8"));
}

function writeJson(rootDirectory, filename, value) {
	writeFileSync(
		resolve(rootDirectory, filename),
		`${JSON.stringify(value, null, "\t")}\n`,
	);
}

export function syncVersions(rawVersion, rootDirectory = process.cwd()) {
	const version = normalizeVersion(rawVersion);
	const packageJson = readJson(rootDirectory, "package.json");
	const packageLock = readJson(rootDirectory, "package-lock.json");
	const manifest = readJson(rootDirectory, "manifest.json");
	const versions = readJson(rootDirectory, "versions.json");

	packageJson.version = version;
	packageLock.version = version;
	if (packageLock.packages?.[""]) {
		packageLock.packages[""].version = version;
	}
	manifest.version = version;
	versions[version] = manifest.minAppVersion;

	writeJson(rootDirectory, "package.json", packageJson);
	writeJson(rootDirectory, "package-lock.json", packageLock);
	writeJson(rootDirectory, "manifest.json", manifest);
	writeJson(rootDirectory, "versions.json", versions);

	return version;
}

const isMainModule =
	process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
	const version = syncVersions(
		process.argv[2] ?? process.env.RELEASE_TAG ?? process.env.npm_package_version,
	);
	console.log(`Synchronized project version to ${version}.`);
}
