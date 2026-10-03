import { cp, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const repository = process.env.PRIVATE_CONTENT_REPOSITORY?.trim();
const ref = process.env.PRIVATE_CONTENT_REF?.trim() || "master";
const contentPath = process.env.PRIVATE_CONTENT_PATH?.trim() || "posts";
const token = process.env.PRIVATE_CONTENT_TOKEN?.trim();
const destination = resolve("src/content/posts");

function run(
	command: string,
	args: string[],
	env = process.env,
): Promise<void> {
	return new Promise((resolvePromise, reject) => {
		const child = spawn(command, args, { stdio: "inherit", env });
		child.on("error", reject);
		child.on("exit", (code) => {
			if (code === 0) resolvePromise();
			else
				reject(new Error(`${command} exited with code ${code ?? "unknown"}`));
		});
	});
}

if (!repository) {
	console.log(
		"[PRIVATE-CONTENT] PRIVATE_CONTENT_REPOSITORY is not configured; skipping.",
	);
	process.exit(0);
}

const worktree = await mkdtemp(join(tmpdir(), "lettery-private-content-"));
const checkoutDir = join(worktree, "repository");

try {
	const repositoryUrl =
		repository.startsWith("http://") || repository.startsWith("https://")
			? repository
			: `https://github.com/${repository}.git`;

	const gitEnv = { ...process.env };
	if (token) {
		gitEnv.GIT_CONFIG_COUNT = "1";
		gitEnv.GIT_CONFIG_KEY_0 = "http.https://github.com/.extraheader";
		gitEnv.GIT_CONFIG_VALUE_0 = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
	}

	console.log(`[PRIVATE-CONTENT] Fetching ${repository} at ${ref}.`);
	await run(
		"git",
		[
			"clone",
			"--depth",
			"1",
			"--branch",
			ref,
			"--single-branch",
			repositoryUrl,
			checkoutDir,
		],
		gitEnv,
	);

	const source = resolve(checkoutDir, contentPath);
	const sourceStat = await stat(source).catch(() => undefined);
	if (!sourceStat?.isDirectory()) {
		throw new Error(`Private content directory does not exist: ${contentPath}`);
	}

	// Merge private articles into the public content tree without deleting public files.
	await cp(source, destination, { recursive: true, force: true });
	console.log(
		`[PRIVATE-CONTENT] Merged ${contentPath} into src/content/posts.`,
	);
} finally {
	await rm(worktree, { recursive: true, force: true });
}
