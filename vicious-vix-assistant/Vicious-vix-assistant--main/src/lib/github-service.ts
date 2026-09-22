
export async function createGitHubIssue(token: string, repoOwner: string, repoName: string, title: string, body: string) {
  const response = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}/issues`, {
    method: "POST",
    headers: {
      "Authorization": `token ${token}`,
      "Content-Type": "application/json",
      "Accept": "application/vnd.github.v3+json"
    },
    body: JSON.stringify({ title, body })
  });
  return await response.json();
}
