const username = process.env.GITHUB_USERNAME ?? "igorwfaoro";
const token = process.env.GITHUB_TOKEN;
const apiBase = "https://api.github.com";
const maxSearchResults = 1_000;
const maxDisplayedPullRequests = 8;
const startMarker = "<!-- OPEN_SOURCE_CONTRIBUTIONS_START -->";
const endMarker = "<!-- OPEN_SOURCE_CONTRIBUTIONS_END -->";

async function githubGet(path, allowNotFound = false) {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${apiBase}${path}`, { headers });
  if (response.status === 404 && allowNotFound) return null;
  if (!response.ok) {
    throw new Error(`GitHub API request failed (${response.status}): ${path}`);
  }

  return response.json();
}

async function findMergedPullRequests() {
  const query = `author:${username} type:pr is:merged -user:${username}`;
  const firstPageUrl = new URL(`${apiBase}/search/issues`);
  firstPageUrl.search = new URLSearchParams({
    q: query,
    sort: "updated",
    order: "desc",
    per_page: "100",
    page: "1",
  });

  const firstPage = await githubGet(`${firstPageUrl.pathname}${firstPageUrl.search}`);
  if (firstPage.incomplete_results) {
    throw new Error("GitHub returned an incomplete pull request search result.");
  }

  const pageCount = Math.ceil(Math.min(firstPage.total_count, maxSearchResults) / 100);
  const items = [...firstPage.items];

  for (let page = 2; page <= pageCount; page += 1) {
    const pageUrl = new URL(firstPageUrl);
    pageUrl.searchParams.set("page", String(page));
    const result = await githubGet(`${pageUrl.pathname}${pageUrl.search}`);
    if (result.incomplete_results) {
      throw new Error("GitHub returned an incomplete pull request search result.");
    }
    items.push(...result.items);
  }

  return items
    .filter((item) => item.pull_request?.merged_at && item.repository_url)
    .map((item) => {
      const repository = new URL(item.repository_url);
      const match = repository.pathname.match(/^\/repos\/([^/]+)\/([^/]+)$/);

      return {
        title: item.title,
        url: item.html_url,
        owner: match?.[1],
        repository: match?.[2],
        mergedAt: item.pull_request.merged_at,
      };
    })
    .filter((item) => item.owner && item.repository && item.url);
}

async function findLicensedPullRequests(pullRequests) {
  const repositoryLicenses = new Map();
  const eligiblePullRequests = [];
  const sortedPullRequests = [...pullRequests].sort(
    (left, right) => Date.parse(right.mergedAt) - Date.parse(left.mergedAt),
  );

  for (const pullRequest of sortedPullRequests) {
    const fullName = `${pullRequest.owner}/${pullRequest.repository}`;

    if (!repositoryLicenses.has(fullName)) {
      const repository = await githubGet(
        `/repos/${encodeURIComponent(pullRequest.owner)}/${encodeURIComponent(pullRequest.repository)}`,
        true,
      );
      const spdxId = repository?.license?.spdx_id;

      repositoryLicenses.set(
        fullName,
        repository?.private === false && spdxId && spdxId !== "NOASSERTION" ? repository.html_url : null,
      );
    }

    const repositoryUrl = repositoryLicenses.get(fullName);
    if (repositoryUrl) eligiblePullRequests.push({ ...pullRequest, repositoryUrl });
    if (eligiblePullRequests.length === maxDisplayedPullRequests) break;
  }

  return eligiblePullRequests;
}

function escapeMarkdown(value) {
  return value.replaceAll("\\", "\\\\").replaceAll("[", "\\[").replaceAll("]", "\\]").replaceAll("\n", " ");
}

function formatMonth(date) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(date));
}

function renderContributions(pullRequests) {
  if (pullRequests.length === 0) {
    return "_No qualifying merged contributions found yet._";
  }

  return pullRequests
    .map((pullRequest) => {
      const fullName = `${pullRequest.owner}/${pullRequest.repository}`;
      const title = escapeMarkdown(pullRequest.title.replaceAll(/\s+/g, " ").trim());

      return `- [${fullName}](${pullRequest.repositoryUrl}) · [${title}](${pullRequest.url}) · ${formatMonth(pullRequest.mergedAt)}`;
    })
    .join("\n");
}

async function updateReadme(contributions) {
  const readmeFile = Bun.file("README.md");
  if (!(await readmeFile.exists())) throw new Error("README.md was not found.");

  const original = await readmeFile.text();
  const startIndex = original.indexOf(startMarker);
  const endIndex = original.indexOf(endMarker);

  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    throw new Error("Contribution markers are missing or out of order in README.md.");
  }

  const contentStart = startIndex + startMarker.length;
  const updated = `${original.slice(0, contentStart)}\n${contributions}\n${original.slice(endIndex)}`;
  await Bun.write(readmeFile, updated);
}

try {
  const pullRequests = await findMergedPullRequests();
  const licensedPullRequests = await findLicensedPullRequests(pullRequests);
  const contributions = renderContributions(licensedPullRequests);

  await updateReadme(contributions);
  console.log(`Updated the README with ${licensedPullRequests.length} recent open-source pull requests.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Failed to update open-source contributions.");
  process.exitCode = 1;
}
