import {
  getLatestReleaseStepInput,
  type GetLatestReleaseStepOutput,
  setLatestReleaseStepOutput,
  getDeployStepInput,
} from "@levibostian/decaf-sdk";
import $ from "@david/dax";
import { parseArgs } from "@std/cli";

interface ScriptDataSavedToFile {
  githubReleaseAssets: string[];
}
const getFileToSaveScriptDataTo = (): string => {
  const tempDir = Deno.env.get("TMPDIR") || Deno.env.get("TMP") || "/tmp";
    const assetsFilePath = `${tempDir}/decaf-script-github-releases-release-branch-assets.json`;
  return assetsFilePath;
}

export const getLatestReleaseFromGitHubReleases = async (
  releaseBranch: string,
): Promise<GetLatestReleaseStepOutput | null> => {
  const input = getLatestReleaseStepInput();

  const latestReleasesGitHubJsonString =
    Deno.env.get("MOCK_GITHUB_RELEASES") ||
    await $`gh release list --exclude-drafts --order desc --json name,tagName`
      .text();
  const latestReleasesGitHub = JSON.parse(latestReleasesGitHubJsonString) as {
    name: string;
    tagName: string;
  }[];

  if (!latestReleasesGitHub.length) {
    console.log(
      "No GitHub Releases found in the GitHub repository.",
    );
    return null;
  }

  const latestRelease = latestReleasesGitHub[0];

  console.log(
    `Latest GitHub release: ${latestRelease.name} (${latestRelease.tagName})`,
  );

  // Get the commits for the release branch
  const releaseBranchCommits =
    input.gitCommitsAllLocalBranches[releaseBranch];

  if (!releaseBranchCommits || releaseBranchCommits.length === 0) {
    console.log(
      `Could not find commits for release branch: ${releaseBranch}. Cannot determine latest release.`,
    );
    return null;
  }

  // Find the commit for the latest release tag on the release branch
  const releaseCommitIndex = releaseBranchCommits.findIndex((commit) =>
    commit.tags?.includes(latestRelease.tagName)
  );

  if (releaseCommitIndex === -1) {
    console.log(
      `Could not find commit for tag ${latestRelease.tagName} on release branch ${releaseBranch}.`,
    );
    return null;
  }

  const releaseCommit = releaseBranchCommits[releaseCommitIndex];
  console.log(
    `Found release commit on branch ${releaseBranch}: ${releaseCommit.sha}`,
  );

  // Build a set of SHAs from the current branch for quick lookup
  const currentBranchShas = new Set(
    input.gitCommitsCurrentBranch.map((c) => c.sha),
  );

  // Starting at the release commit, walk backwards (older) through release branch commits
  // to find the first commit that also exists on the current branch
  for (let i = releaseCommitIndex; i < releaseBranchCommits.length; i++) {
    const releaseBranchCommit = releaseBranchCommits[i];
    if (currentBranchShas.has(releaseBranchCommit.sha)) {
      console.log(
        `Found common commit between release branch and current branch: ${releaseBranchCommit.sha}`,
      );
      return {
        versionName: latestRelease.name,
        commitSha: releaseBranchCommit.sha,
      };
    }
  }

  console.log(
    "Could not find a common commit between the release branch and the current branch.",
  );
  return null;
};

export const createGitHubRelease = async (args: string[] = []): Promise<void> => {
  const input = getDeployStepInput();
  const releaseInput = getLatestReleaseStepInput();

  // --release-branch is required; all other args are forwarded to `gh release create`
  const parsed = parseArgs(args, {
    string: ["release-branch"],
    alias: { "release-branch": "r" },
  });

  const releaseBranch = parsed["release-branch"];
  if (!releaseBranch) {
    console.error("Error: --release-branch is required for the set command");
    console.error("Usage: script.ts set --release-branch <branch> [gh args...]");
    Deno.exit(1);
  }

  // Get the latest commit on the release branch from the input data
  const releaseBranchCommits = releaseInput.gitCommitsAllLocalBranches[releaseBranch];
  if (!releaseBranchCommits || releaseBranchCommits.length === 0) {
    console.error(`Could not find commits for release branch: ${releaseBranch}. Cannot determine target commit.`);
    Deno.exit(1);
  }
  const latestReleaseBranchCommit = releaseBranchCommits[0].sha;

  // Build gh passthrough args from parsed, simply by dropping the release-branch key
  const { "release-branch": _rb, r: _r, _: positionals, ...ghFlags } = parsed;
  const ghArgs = [
    ...Object.entries(ghFlags).flatMap(([key, val]) =>
      val === true ? [`--${key}`] : [`--${key}`, String(val)]
    ),
    ...positionals.map(String),
  ];

  // Get assets from temp file created by set-assets command
  let githubReleaseAssets: string[] = [];
  try {
    const assetsFilePath = getFileToSaveScriptDataTo();
    const assetsData: ScriptDataSavedToFile = JSON.parse(await Deno.readTextFile(assetsFilePath));
    githubReleaseAssets = assetsData.githubReleaseAssets || [];
  } catch {
    // No temp file or error reading it, continue with empty assets
  }

  // Use caller-supplied args, or fall back to sensible defaults
  const baseArgs = ghArgs.length > 0 ? ghArgs : ["--generate-notes", "--latest"];

  // Append --target <latest-release-branch-commit> unless the caller already supplied it
  const hasTarget = parsed["target"] !== undefined;

  const targetArgs = hasTarget ? [] : ["--target", latestReleaseBranchCommit];
  if (!hasTarget) {
    console.log(`Targeting latest commit on branch ${releaseBranch}: ${latestReleaseBranchCommit}`);
  }

  const argsToCreateGithubRelease = [
    "release",
    "create",
    input.nextVersionName,
    ...baseArgs,
    ...targetArgs,
    ...githubReleaseAssets,
  ];

  if (input.testMode) {
    console.log("Running in test mode, skipping creating GitHub release.");
    console.log(`Command to create GitHub release: gh ${argsToCreateGithubRelease.join(" ")}`);
  } else {
    await $`gh ${argsToCreateGithubRelease}`.printCommand();
  }
}

export const setGitHubReleaseAssets = async (assets: string[]): Promise<void> => {  
  // Verify all asset paths exist
  for (const asset of assets) {
    const assetPath = asset.split("#")[0];
    try {
      const stat = await Deno.stat(assetPath);
      if (!stat.isFile) {
        console.error(`Given asset, ${assetPath}, is not a file. Cannot proceed.`);
        Deno.exit(1);
      }
    } catch {
      console.error(`Given asset, ${assetPath}, file does not exist. Cannot proceed.`);
      Deno.exit(1);
    }
  }

  // Get the temporary directory
  const assetsFilePath = getFileToSaveScriptDataTo();
  
  // Create the assets data
  const assetsData: ScriptDataSavedToFile = {
    githubReleaseAssets: assets
  };
  
  // Write to temp file
  try {
    await Deno.writeTextFile(assetsFilePath, JSON.stringify(assetsData, null, 2));
    console.log(`GitHub Release assets: ${assets.join(", ")} saved to be referenced later when creating a release.`);
  } catch (error) {
    console.error(`Failed to write assets file: ${error instanceof Error ? error.message : String(error)}`);
    Deno.exit(1);
  }
}

function showHelp() {
  console.log(`
Usage: 
  script.ts get --release-branch <branch>              # Get the latest release
  script.ts set --release-branch <branch> [args...]    # Set/create a GitHub release
  script.ts set-assets <asset1> [asset2...]            # Set GitHub release assets
  script.ts get-latest-release --release-branch <branch>            # Alias for 'get'
  script.ts set-latest-release --release-branch <branch> [args...]  # Alias for 'set'
  script.ts set-github-release-assets <asset1> [asset2...]          # Alias for 'set-assets'

Commands:
  get, get-latest-release                Get the latest common GitHub release between the release branch and the current branch
  set, set-latest-release                Create a new GitHub release targeting the latest remote commit on the release branch
  set-assets, set-github-release-assets  Set GitHub release assets for future release creation

Required flags for get and set:
  --release-branch, -r <branch>  The release branch to use

Notes for set:
  --target is automatically set to the latest remote commit on the release branch.
  You may override it by passing --target explicitly.

Examples:
  # Get latest release
  script.ts get --release-branch release/v1
  script.ts get-latest-release --release-branch release/v1

  # Create release with default settings
  script.ts set --release-branch release/v1
  script.ts set-latest-release --release-branch release/v1

  # Create release with custom arguments (--target auto-appended unless provided)
  script.ts set --release-branch release/v1 --generate-notes --latest
  script.ts set --release-branch release/v1 --draft --notes "Custom release notes"
  script.ts set --release-branch release/v1 --target my-sha  # explicit --target, not overridden

  # Set assets for future release
  script.ts set-assets "dist/binary-linux#Linux Binary" "dist/binary-mac#Mac Binary"
  script.ts set-github-release-assets "docs/manual.pdf#User Manual"
`);
}

if (import.meta.main) {
  // Check for help flag
  if (Deno.args.includes("--help") || Deno.args.includes("-h")) {
    showHelp();
    Deno.exit(0);
  }

  const command = Deno.args.length > 0 ? Deno.args[0] : "";
  const commandArgs = Deno.args.slice(1);

  switch (command) {
    case "get":
    case "get-latest-release": {
      const parsedArgs = parseArgs(commandArgs, {
        string: ["release-branch"],
        alias: { "release-branch": "r" },
      });

      const releaseBranch = parsedArgs["release-branch"];
      if (!releaseBranch) {
        console.error(
          "Error: --release-branch is required for the get command",
        );
        console.error(
          "Usage: script.ts get --release-branch <branch>",
        );
        Deno.exit(1);
      }

      const latestRelease = await getLatestReleaseFromGitHubReleases(
        releaseBranch,
      );
      if (latestRelease) {
        setLatestReleaseStepOutput(latestRelease);
      }
      break;
    }
    case "set":
    case "set-latest-release": {
      await createGitHubRelease(commandArgs);
      break;
    }
    case "set-assets":
    case "set-github-release-assets": {
      if (commandArgs.length === 0) {
        console.error("Error: set-assets command requires at least one asset argument");
        console.error("Usage: script.ts set-assets <asset1> [asset2...]");
        console.error("Asset format: path#name (e.g., 'dist/binary#Binary File')");
        
        Deno.exit(1);
      }
      await setGitHubReleaseAssets(commandArgs);
      break;
    }
    default: {
      console.error(`Unknown command: ${command}`);
      showHelp();
      Deno.exit(1);
    }
  }
}