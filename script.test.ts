import type {
  GetLatestReleaseStepInput,
  DeployStepInput,
  GitCommit,
} from "@levibostian/decaf-sdk";
import {
  runGetLatestReleaseScript,
  runDeployScript,
} from "@levibostian/decaf-sdk/testing";
import { mockBin } from "@levibostian/mock-a-bin";
import { assertEquals, assertStringIncludes } from "@std/assert";

// Helper: join stdout lines into a single string for partial-match assertions.
function stdoutText(lines: string[]): string {
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// tests not for a specific command
// ---------------------------------------------------------------------------

Deno.test(
  "no command specified should exit with error about missing command",
  async () => {
    const input: GetLatestReleaseStepInput = {
      gitCurrentBranch: "main",
      gitRepoOwner: "levibostian",
      gitRepoName: "decaf-script-github-releases-release-branch",
      gitCommitsCurrentBranch: [] as unknown as GitCommit[],
      gitCommitsAllLocalBranches: {},
    } as unknown as GetLatestReleaseStepInput;

    const { code, stdout } = await runGetLatestReleaseScript(
      "deno run --allow-all script.ts",
      input,
    );

    assertEquals(code, 1);
    assertStringIncludes(stdoutText(stdout), "Unknown command");
  },
);

// ---------------------------------------------------------------------------
// get command - release-branch logic
// ---------------------------------------------------------------------------

Deno.test(
  "get command without --release-branch should exit with error",
  async () => {
    const input: GetLatestReleaseStepInput = {
      gitCurrentBranch: "main",
      gitRepoOwner: "levibostian",
      gitRepoName: "decaf-script-github-releases-release-branch",
      gitCommitsCurrentBranch: [],
      gitCommitsAllLocalBranches: {},
    } as unknown as GetLatestReleaseStepInput;

    const { code, stdout } = await runGetLatestReleaseScript(
      "deno run --allow-all script.ts get",
      input,
    );

    assertEquals(code, 1);
    assertStringIncludes(stdoutText(stdout), "--release-branch is required");
  },
);

Deno.test(
  "given no GitHub releases, expect null for latest release",
  async () => {
    const input: GetLatestReleaseStepInput = {
      gitCurrentBranch: "main",
      gitRepoOwner: "levibostian",
      gitRepoName: "decaf-script-github-releases-release-branch",
      gitCommitsCurrentBranch: [
        { sha: "abc1", title: "Initial commit", tags: [], message: "Initial commit" },
      ] as unknown as GitCommit[],
      gitCommitsAllLocalBranches: {
        "release/v1": [
          { sha: "def1", title: "Release commit", tags: ["v1.0.0"], message: "Release" },
        ] as unknown as GitCommit[],
      },
    } as unknown as GetLatestReleaseStepInput;

    const { code, output } = await runGetLatestReleaseScript(
      "deno run --allow-all script.ts get --release-branch release/v1",
      input,
      { extraEnvVariables: { MOCK_GITHUB_RELEASES: JSON.stringify([]) } },
    );

    assertEquals(code, 0);
    assertEquals(output, null);
  },
);

Deno.test(
  "given latest GitHub release tag not found on release branch, expect null with log message",
  async () => {
    const input: GetLatestReleaseStepInput = {
      gitCurrentBranch: "main",
      gitRepoOwner: "levibostian",
      gitRepoName: "decaf-script-github-releases-release-branch",
      gitCommitsCurrentBranch: [
        { sha: "abc1", title: "main commit", tags: [], message: "main" },
      ] as unknown as GitCommit[],
      gitCommitsAllLocalBranches: {
        "release/v1": [
          { sha: "def1", title: "old release", tags: ["v1.0.0"], message: "old" },
        ] as unknown as GitCommit[],
      },
    } as unknown as GetLatestReleaseStepInput;

    const { code, output, stdout } = await runGetLatestReleaseScript(
      "deno run --allow-all script.ts get --release-branch release/v1",
      input,
      {
        extraEnvVariables: {
          MOCK_GITHUB_RELEASES: JSON.stringify([
            { name: "Release v2.0.0", tagName: "v2.0.0" },
          ]),
        },
      },
    );

    assertEquals(code, 0);
    assertEquals(output, null);
    assertStringIncludes(
      stdoutText(stdout),
      "Could not find commit for tag v2.0.0 on release branch release/v1",
    );
  },
);

Deno.test(
  "given release branch not in gitCommitsAllLocalBranches, expect null with log message",
  async () => {
    const input: GetLatestReleaseStepInput = {
      gitCurrentBranch: "main",
      gitRepoOwner: "levibostian",
      gitRepoName: "decaf-script-github-releases-release-branch",
      gitCommitsCurrentBranch: [
        { sha: "abc1", title: "main commit", tags: [], message: "main" },
      ] as unknown as GitCommit[],
      gitCommitsAllLocalBranches: {},
    } as unknown as GetLatestReleaseStepInput;

    const { code, output, stdout } = await runGetLatestReleaseScript(
      "deno run --allow-all script.ts get --release-branch release/v1",
      input,
      {
        extraEnvVariables: {
          MOCK_GITHUB_RELEASES: JSON.stringify([
            { name: "Release v1.0.0", tagName: "v1.0.0" },
          ]),
        },
      },
    );

    assertEquals(code, 0);
    assertEquals(output, null);
    assertStringIncludes(
      stdoutText(stdout),
      "Could not find commits for release branch: release/v1",
    );
  },
);

Deno.test(
  "given release commit is also on the current branch, expect that commit as result",
  async () => {
    const input: GetLatestReleaseStepInput = {
      gitCurrentBranch: "main",
      gitRepoOwner: "levibostian",
      gitRepoName: "decaf-script-github-releases-release-branch",
      gitCommitsCurrentBranch: [
        { sha: "abc2", title: "main ahead commit", tags: [], message: "ahead" },
        { sha: "shared1", title: "shared base commit", tags: [], message: "shared" },
      ] as unknown as GitCommit[],
      gitCommitsAllLocalBranches: {
        "release/v1": [
          { sha: "shared1", title: "shared base commit", tags: ["v1.0.0"], message: "shared" },
          { sha: "older1", title: "older release commit", tags: [], message: "older" },
        ] as unknown as GitCommit[],
      },
    } as unknown as GetLatestReleaseStepInput;

    const { code, output } = await runGetLatestReleaseScript(
      "deno run --allow-all script.ts get --release-branch release/v1",
      input,
      {
        extraEnvVariables: {
          MOCK_GITHUB_RELEASES: JSON.stringify([
            { name: "Release v1.0.0", tagName: "v1.0.0" },
          ]),
        },
      },
    );

    assertEquals(code, 0);
    assertEquals(output, {
      versionName: "Release v1.0.0",
      commitSha: "shared1",
    });
  },
);

Deno.test(
  "given release commit is NOT on current branch but an older release branch commit is, expect the older common commit",
  async () => {
    const input: GetLatestReleaseStepInput = {
      gitCurrentBranch: "main",
      gitRepoOwner: "levibostian",
      gitRepoName: "decaf-script-github-releases-release-branch",
      gitCommitsCurrentBranch: [
        { sha: "mainOnly", title: "main-only commit", tags: [], message: "main only" },
        { sha: "common1", title: "common ancestor", tags: [], message: "common" },
      ] as unknown as GitCommit[],
      gitCommitsAllLocalBranches: {
        "release/v1": [
          { sha: "releaseOnly", title: "release-only tag commit", tags: ["v1.0.0"], message: "release tag" },
          { sha: "common1", title: "common ancestor", tags: [], message: "common" },
          { sha: "oldest1", title: "oldest", tags: [], message: "oldest" },
        ] as unknown as GitCommit[],
      },
    } as unknown as GetLatestReleaseStepInput;

    const { code, output, stdout } = await runGetLatestReleaseScript(
      "deno run --allow-all script.ts get --release-branch release/v1",
      input,
      {
        extraEnvVariables: {
          MOCK_GITHUB_RELEASES: JSON.stringify([
            { name: "Release v1.0.0", tagName: "v1.0.0" },
          ]),
        },
      },
    );

    assertEquals(code, 0);
    assertEquals(output, {
      versionName: "Release v1.0.0",
      commitSha: "common1",
    });
    assertStringIncludes(
      stdoutText(stdout),
      "Found common commit between release branch and current branch: common1",
    );
  },
);

Deno.test(
  "given no common commit between release branch and current branch, expect null with log message",
  async () => {
    const input: GetLatestReleaseStepInput = {
      gitCurrentBranch: "main",
      gitRepoOwner: "levibostian",
      gitRepoName: "decaf-script-github-releases-release-branch",
      gitCommitsCurrentBranch: [
        { sha: "mainOnly1", title: "main commit 1", tags: [], message: "main 1" },
        { sha: "mainOnly2", title: "main commit 2", tags: [], message: "main 2" },
      ] as unknown as GitCommit[],
      gitCommitsAllLocalBranches: {
        "release/v1": [
          { sha: "releaseOnly1", title: "release tag commit", tags: ["v1.0.0"], message: "tag" },
          { sha: "releaseOnly2", title: "older release commit", tags: [], message: "older" },
        ] as unknown as GitCommit[],
      },
    } as unknown as GetLatestReleaseStepInput;

    const { code, output, stdout } = await runGetLatestReleaseScript(
      "deno run --allow-all script.ts get --release-branch release/v1",
      input,
      {
        extraEnvVariables: {
          MOCK_GITHUB_RELEASES: JSON.stringify([
            { name: "Release v1.0.0", tagName: "v1.0.0" },
          ]),
        },
      },
    );

    assertEquals(code, 0);
    assertEquals(output, null);
    assertStringIncludes(
      stdoutText(stdout),
      "Could not find a common commit between the release branch and the current branch",
    );
  },
);

Deno.test(
  "get-latest-release alias should work the same as get",
  async () => {
    const input: GetLatestReleaseStepInput = {
      gitCurrentBranch: "main",
      gitRepoOwner: "levibostian",
      gitRepoName: "decaf-script-github-releases-release-branch",
      gitCommitsCurrentBranch: [
        { sha: "shared1", title: "shared commit", tags: [], message: "shared" },
      ] as unknown as GitCommit[],
      gitCommitsAllLocalBranches: {
        "release/v1": [
          { sha: "shared1", title: "shared commit", tags: ["v1.0.0"], message: "shared" },
        ] as unknown as GitCommit[],
      },
    } as unknown as GetLatestReleaseStepInput;

    const mockReleases = {
      extraEnvVariables: {
        MOCK_GITHUB_RELEASES: JSON.stringify([
          { name: "Release v1.0.0", tagName: "v1.0.0" },
        ]),
      },
    };

    const { code: code1, output: output1 } = await runGetLatestReleaseScript(
      "deno run --allow-all script.ts get --release-branch release/v1",
      input,
      mockReleases,
    );
    const { code: code2, output: output2 } = await runGetLatestReleaseScript(
      "deno run --allow-all script.ts get-latest-release --release-branch release/v1",
      input,
      mockReleases,
    );

    assertEquals(code1, 0);
    assertEquals(code2, 0);
    assertEquals(output1, output2);
  },
);

Deno.test(
  "short alias -r should work for --release-branch",
  async () => {
    const input: GetLatestReleaseStepInput = {
      gitCurrentBranch: "main",
      gitRepoOwner: "levibostian",
      gitRepoName: "decaf-script-github-releases-release-branch",
      gitCommitsCurrentBranch: [
        { sha: "shared1", title: "shared commit", tags: [], message: "shared" },
      ] as unknown as GitCommit[],
      gitCommitsAllLocalBranches: {
        "release/v1": [
          { sha: "shared1", title: "shared commit", tags: ["v1.0.0"], message: "shared" },
        ] as unknown as GitCommit[],
      },
    } as unknown as GetLatestReleaseStepInput;

    const { code, output } = await runGetLatestReleaseScript(
      "deno run --allow-all script.ts get -r release/v1",
      input,
      {
        extraEnvVariables: {
          MOCK_GITHUB_RELEASES: JSON.stringify([
            { name: "Release v1.0.0", tagName: "v1.0.0" },
          ]),
        },
      },
    );

    assertEquals(code, 0);
    assertEquals(output, {
      versionName: "Release v1.0.0",
      commitSha: "shared1",
    });
  },
);

// ---------------------------------------------------------------------------
// set command
// ---------------------------------------------------------------------------

// Helper: build a deploy input that also carries the release branch commits
// needed by getLatestReleaseStepInput() inside createGitHubRelease.
function setInput(
  extra: Record<string, unknown>,
  releaseBranchCommits: { sha: string }[],
  releaseBranch = "release/v1",
): DeployStepInput {
  return {
    testMode: true,
    gitCommitsAllLocalBranches: {
      [releaseBranch]: releaseBranchCommits,
    },
    ...extra,
  } as unknown as DeployStepInput;
}

Deno.test(
  "set command without --release-branch should exit with error",
  async () => {
    const { code, stdout } = await runDeployScript(
      "deno run --allow-all script.ts set",
      setInput({ nextVersionName: "v1.0.0" }, []),
    );

    assertEquals(code, 1);
    assertStringIncludes(stdoutText(stdout), "--release-branch is required");
  },
);

Deno.test(
  "set command should use git rev-parse result, not stale input commit array",
  async () => {
    const gitSha = "git-sha-from-rev-parse";
    const inputSha = "stale-sha-from-input";
    const cleanup = await mockBin("git", "bash", `echo "${gitSha}"; exit 0`);
    try {
      const { code, stdout } = await runDeployScript(
        "deno run --allow-all script.ts set --release-branch release/v1",
        setInput({ nextVersionName: "v1.0.0" }, [{ sha: inputSha }]),
      );

      assertEquals(code, 0);
      assertStringIncludes(stdoutText(stdout), `--target ${gitSha}`);
      assertEquals(stdoutText(stdout).includes(inputSha), false);
    } finally {
      cleanup();
    }
  },
);

Deno.test(
  "set command with default arguments should target latest commit on release branch",
  async () => {
    const cleanup = await mockBin("git", "bash", 'echo "abc1234"; exit 0');
    try {
      const { code, stdout } = await runDeployScript(
        "deno run --allow-all script.ts set --release-branch release/v1",
        setInput({ nextVersionName: "v1.0.0" }, []),
      );

      assertEquals(code, 0);
      assertStringIncludes(stdoutText(stdout), "Running in test mode, skipping creating GitHub release.");
      assertStringIncludes(stdoutText(stdout), "gh release create v1.0.0 --generate-notes --latest --target abc1234");
    } finally {
      cleanup();
    }
  },
);

Deno.test(
  "set command with custom gh args should append --target unless already provided",
  async () => {
    const cleanup = await mockBin("git", "bash", 'echo "def5678"; exit 0');
    try {
      const { code, stdout } = await runDeployScript(
        "deno run --allow-all script.ts set --release-branch release/v1 --draft",
        setInput({ nextVersionName: "v2.0.0" }, []),
      );

      assertEquals(code, 0);
      assertStringIncludes(stdoutText(stdout), "Running in test mode, skipping creating GitHub release.");
      assertStringIncludes(stdoutText(stdout), "gh release create v2.0.0 --draft --target def5678");
    } finally {
      cleanup();
    }
  },
);

Deno.test(
  "set command with explicit --target should not be overridden",
  async () => {
    const cleanup = await mockBin("git", "bash", 'echo "should-not-appear"; exit 0');
    try {
      const { code, stdout } = await runDeployScript(
        "deno run --allow-all script.ts set --release-branch release/v1 --target my-custom-sha",
        setInput({ nextVersionName: "v3.0.0" }, []),
      );

      assertEquals(code, 0);
      assertStringIncludes(stdoutText(stdout), "gh release create v3.0.0 --target my-custom-sha");
      assertEquals(stdoutText(stdout).includes("should-not-appear"), false);
    } finally {
      cleanup();
    }
  },
);

Deno.test(
  "set command with -r short alias for --release-branch",
  async () => {
    const cleanup = await mockBin("git", "bash", 'echo "abc1234"; exit 0');
    try {
      const { code, stdout } = await runDeployScript(
        "deno run --allow-all script.ts set -r release/v1",
        setInput({ nextVersionName: "v1.0.0" }, []),
      );

      assertEquals(code, 0);
      assertStringIncludes(stdoutText(stdout), "gh release create v1.0.0 --generate-notes --latest --target abc1234");
    } finally {
      cleanup();
    }
  },
);

Deno.test(
  "set command with GitHub release assets should include them in command",
  async () => {
    const tempDir = await Deno.makeTempDir();
    const linuxBinary = `${tempDir}/binary-linux`;
    const macBinary = `${tempDir}/binary-mac`;

    await Deno.writeTextFile(linuxBinary, "linux binary content");
    await Deno.writeTextFile(macBinary, "mac binary content");

    // First, set up assets using set-assets
    await runDeployScript(
      `deno run --allow-all script.ts set-assets '${linuxBinary}#Linux Binary' '${macBinary}#Mac Binary'`,
      {} as unknown as DeployStepInput,
    );

    const cleanup = await mockBin("git", "bash", 'echo "cafe9876"; exit 0');
    try {
      const { code, stdout } = await runDeployScript(
        "deno run --allow-all script.ts set --release-branch release/v1",
        setInput({ nextVersionName: "v1.2.0" }, []),
      );

      assertEquals(code, 0);
      assertStringIncludes(stdoutText(stdout), "Running in test mode, skipping creating GitHub release.");
      assertStringIncludes(stdoutText(stdout), "gh release create v1.2.0 --generate-notes --latest --target cafe9876");
      assertStringIncludes(stdoutText(stdout), `${linuxBinary}#Linux Binary`);
      assertStringIncludes(stdoutText(stdout), `${macBinary}#Mac Binary`);
    } finally {
      cleanup();
    }
  },
);

Deno.test(
  "set-latest-release alias should work the same as set",
  async () => {
    const input = setInput({ nextVersionName: "v1.0.0" }, []);

    const cleanup = await mockBin("git", "bash", 'echo "abc1234"; exit 0');
    try {
      const { stdout: setOutput } = await runDeployScript(
        "deno run --allow-all script.ts set --release-branch release/v1",
        input,
      );
      const { stdout: aliasOutput } = await runDeployScript(
        "deno run --allow-all script.ts set-latest-release --release-branch release/v1",
        input,
      );

      assertEquals(setOutput, aliasOutput);
    } finally {
      cleanup();
    }
  },
);

Deno.test(
  "set command in test mode should NOT call gh",
  async () => {
    const ghCleanup = await mockBin("gh", "bash", 'echo "gh-was-called"; exit 0');
    const gitCleanup = await mockBin("git", "bash", 'echo "abc1234"; exit 0');
    try {
      const { code, stdout } = await runDeployScript(
        "deno run --allow-all script.ts set --release-branch release/v1",
        setInput({ nextVersionName: "v1.0.0", testMode: true }, []),
      );

      assertEquals(code, 0);
      assertStringIncludes(stdoutText(stdout), "Running in test mode, skipping creating GitHub release.");
      assertEquals(stdoutText(stdout).includes("gh-was-called"), false);
    } finally {
      ghCleanup();
      gitCleanup();
    }
  },
);

Deno.test(
  "set command NOT in test mode DOES call gh",
  async () => {
    const ghCleanup = await mockBin("gh", "bash", 'echo "gh-was-called: $*"; exit 0');
    const gitCleanup = await mockBin("git", "bash", 'echo "abc1234"; exit 0');
    try {
      const { code, stdout } = await runDeployScript(
        "deno run --allow-all script.ts set --release-branch release/v1",
        setInput({ nextVersionName: "v1.0.0", testMode: false }, []),
      );

      assertEquals(code, 0);
      assertStringIncludes(stdoutText(stdout), "gh-was-called:");
      assertStringIncludes(stdoutText(stdout), "release create");
      assertStringIncludes(stdoutText(stdout), "v1.0.0");
    } finally {
      ghCleanup();
      gitCleanup();
    }
  },
);

// ---------------------------------------------------------------------------
// set-assets command
// ---------------------------------------------------------------------------

Deno.test(
  "set-assets command should save assets to temp file",
  async () => {
    const tempDir = await Deno.makeTempDir();
    const linuxBinary = `${tempDir}/binary-linux`;
    const macBinary = `${tempDir}/binary-mac`;

    await Deno.writeTextFile(linuxBinary, "linux binary content");
    await Deno.writeTextFile(macBinary, "mac binary content");

    const { code, stdout } = await runDeployScript(
      `deno run --allow-all script.ts set-assets '${linuxBinary}#Linux Binary' '${macBinary}#Mac Binary'`,
      {} as unknown as DeployStepInput,
    );

    assertEquals(code, 0);
    assertStringIncludes(stdoutText(stdout), "GitHub Release assets:");
    assertStringIncludes(stdoutText(stdout), `${linuxBinary}#Linux Binary`);
    assertStringIncludes(stdoutText(stdout), `${macBinary}#Mac Binary`);
  },
);

Deno.test(
  "set-github-release-assets alias should work the same as set-assets",
  async () => {
    const tempDir = await Deno.makeTempDir();
    const testFile = `${tempDir}/test`;

    await Deno.writeTextFile(testFile, "test content");

    const { code: code1, stdout: stdout1 } = await runDeployScript(
      `deno run --allow-all script.ts set-assets '${testFile}#Test File'`,
      {} as unknown as DeployStepInput,
    );
    const { code: code2, stdout: stdout2 } = await runDeployScript(
      `deno run --allow-all script.ts set-github-release-assets '${testFile}#Test File'`,
      {} as unknown as DeployStepInput,
    );

    assertEquals(code1, 0);
    assertEquals(code2, 0);
    assertStringIncludes(stdoutText(stdout1), "GitHub Release assets:");
    assertStringIncludes(stdoutText(stdout2), "GitHub Release assets:");
  },
);

Deno.test(
  "set-assets command should require at least one asset",
  async () => {
    const { code, stdout } = await runDeployScript(
      "deno run --allow-all script.ts set-assets",
      {} as unknown as DeployStepInput,
    );

    assertEquals(code, 1);
    assertStringIncludes(stdoutText(stdout), "Error: set-assets command requires at least one asset argument");
  },
);

Deno.test(
  "set-assets should verify asset files exist before saving",
  async () => {
    const tempDir = await Deno.makeTempDir();
    const validFile1 = `${tempDir}/valid-file-1.txt`;
    const validFile2 = `${tempDir}/valid-file-2.bin`;
    const nonExistentFile = `${tempDir}/non-existent.txt`;

    await Deno.writeTextFile(validFile1, "test content 1");
    await Deno.writeTextFile(validFile2, "test content 2");

    const { code: validCode, stdout: validStdout } = await runDeployScript(
      `deno run --allow-all script.ts set-assets '${validFile1}' '${validFile2}#Binary File'`,
      {} as unknown as DeployStepInput,
    );

    assertEquals(validCode, 0);
    assertStringIncludes(stdoutText(validStdout), "GitHub Release assets:");
    assertStringIncludes(stdoutText(validStdout), validFile1);
    assertStringIncludes(stdoutText(validStdout), `${validFile2}#Binary File`);

    const { code: invalidCode, stdout: invalidStdout } = await runDeployScript(
      `deno run --allow-all script.ts set-assets '${nonExistentFile}'`,
      {} as unknown as DeployStepInput,
    );

    assertEquals(invalidCode, 1);
    assertStringIncludes(
      stdoutText(invalidStdout),
      `Given asset, ${nonExistentFile}, file does not exist. Cannot proceed.`,
    );

    const { code: dirCode, stdout: dirStdout } = await runDeployScript(
      `deno run --allow-all script.ts set-assets '${tempDir}'`,
      {} as unknown as DeployStepInput,
    );

    assertEquals(dirCode, 1);
    assertStringIncludes(
      stdoutText(dirStdout),
      `Given asset, ${tempDir}, is not a file. Cannot proceed.`,
    );
  },
);

Deno.test(
  "set-assets should handle mixed asset formats (with and without hash)",
  async () => {
    const tempDir = await Deno.makeTempDir();
    const binaryFile = `${tempDir}/app.exe`;
    const docFile = `${tempDir}/readme.txt`;
    const configFile = `${tempDir}/config.json`;

    await Deno.writeTextFile(binaryFile, "binary content");
    await Deno.writeTextFile(docFile, "documentation");
    await Deno.writeTextFile(configFile, '{"version": "1.0"}');

    const { code, stdout } = await runDeployScript(
      `deno run --allow-all script.ts set-assets '${binaryFile}' '${docFile}#Documentation' '${configFile}' '${configFile}#Configuration File'`,
      {} as unknown as DeployStepInput,
    );

    assertEquals(code, 0);
    assertStringIncludes(stdoutText(stdout), "GitHub Release assets:");
    assertStringIncludes(stdoutText(stdout), binaryFile);
    assertStringIncludes(stdoutText(stdout), `${docFile}#Documentation`);
    assertStringIncludes(stdoutText(stdout), configFile);
    assertStringIncludes(stdoutText(stdout), `${configFile}#Configuration File`);
  },
);
