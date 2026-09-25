const username = process.env.GITHUB_USERNAME ?? "igorwfaoro";
const token = process.env.GITHUB_TOKEN;
const apiBase = "https://api.github.com";
const outputPath = "top-languages.svg";
const maxLanguages = 5;
const width = 360;
const height = 150;
const backgroundColor = "#282a36";
const textColor = "#f8f8f2";
const remainderColor = "#44475a";

const languageColors = {
  "C#": "#178600",
  C: "#555555",
  "C++": "#f34b7d",
  CSS: "#663399",
  Dart: "#00b4ab",
  Dockerfile: "#384d54",
  Go: "#00add8",
  HTML: "#e34c26",
  Java: "#b07219",
  JavaScript: "#f1e05a",
  Kotlin: "#a97bff",
  PHP: "#4f5d95",
  Python: "#3572a5",
  Ruby: "#701516",
  Rust: "#dea584",
  Shell: "#89e051",
  Swift: "#f05138",
  TypeScript: "#3178c6",
  Vue: "#41b883",
};

const fallbackColors = ["#ff79c6", "#8be9fd", "#50fa7b", "#bd93f9", "#ffb86c"];

async function githubGet(path) {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${apiBase}${path}`, { headers });
  if (!response.ok) {
    throw new Error(`GitHub API request failed (${response.status}): ${path}`);
  }

  return response.json();
}

function escapeXml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function colorForLanguage(language, index) {
  return languageColors[language] ?? fallbackColors[index % fallbackColors.length];
}

function renderCard(languageTotals) {
  const entries = Object.entries(languageTotals)
    .filter(([, bytes]) => bytes > 0)
    .sort((left, right) => right[1] - left[1]);
  const totalBytes = entries.reduce((total, [, bytes]) => total + bytes, 0);
  const topLanguages = entries.slice(0, maxLanguages);
  const otherBytes = totalBytes - topLanguages.reduce((total, [, bytes]) => total + bytes, 0);
  const barX = 20;
  const barY = 44;
  const barWidth = width - 40;
  const barHeight = 8;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title description">`;
  svg += `<title id="title">Most Used Languages</title><desc id="description">Top programming languages across ${escapeXml(username)}'s public repositories</desc>`;
  svg += `<rect width="${width}" height="${height}" rx="4" fill="${backgroundColor}"/>`;
  svg += `<text x="20" y="27" fill="${textColor}" font-family="Arial, sans-serif" font-size="16" font-weight="600">Most Used Languages</text>`;

  if (totalBytes === 0) {
    svg += `<text x="20" y="78" fill="${textColor}" font-family="Arial, sans-serif" font-size="13">No language data available</text></svg>`;
    return svg;
  }

  let barOffset = 0;
  topLanguages.forEach(([language, bytes], index) => {
    const segmentWidth = (bytes / totalBytes) * barWidth;
    svg += `<rect x="${(barX + barOffset).toFixed(2)}" y="${barY}" width="${segmentWidth.toFixed(2)}" height="${barHeight}" fill="${colorForLanguage(language, index)}"/>`;
    barOffset += segmentWidth;
  });

  if (otherBytes > 0) {
    const segmentWidth = (otherBytes / totalBytes) * barWidth;
    svg += `<rect x="${(barX + barOffset).toFixed(2)}" y="${barY}" width="${segmentWidth.toFixed(2)}" height="${barHeight}" fill="${remainderColor}"/>`;
  }

  topLanguages.forEach(([language, bytes], index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const x = column === 0 ? 20 : 190;
    const y = 77 + row * 25;
    const percent = `${((bytes / totalBytes) * 100).toFixed(1)}%`;

    svg += `<circle cx="${x + 5}" cy="${y - 4}" r="5" fill="${colorForLanguage(language, index)}"/>`;
    svg += `<text x="${x + 16}" y="${y}" fill="${textColor}" font-family="Arial, sans-serif" font-size="12">${escapeXml(language)}</text>`;
    svg += `<text x="${x + 150}" y="${y}" fill="${textColor}" font-family="Arial, sans-serif" font-size="12" text-anchor="end">${percent}</text>`;
  });

  return `${svg}</svg>`;
}

try {
  const repositories = await githubGet(`/users/${encodeURIComponent(username)}/repos?type=owner&sort=pushed&per_page=100`);
  const ownedRepositories = repositories.filter((repository) => !repository.fork && !repository.private);
  const languageMaps = await Promise.all(
    ownedRepositories.map((repository) => {
      const path = `/repos/${encodeURIComponent(username)}/${encodeURIComponent(repository.name)}/languages`;
      return githubGet(path);
    }),
  );
  const languageTotals = {};

  for (const languageMap of languageMaps) {
    for (const [language, bytes] of Object.entries(languageMap)) {
      languageTotals[language] = (languageTotals[language] ?? 0) + bytes;
    }
  }

  await Bun.write(outputPath, `${renderCard(languageTotals)}\n`);
  console.log(`Updated ${outputPath} from ${ownedRepositories.length} public repositories.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Failed to update the top languages card.");
  process.exitCode = 1;
}
