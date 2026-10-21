---
name: pi-web-search
description: "Unified web search and URL fetch. Tools: web_search (search with AI answers) and web_fetch (extract page content)."
---

# Pi Web Search

Use when the user asks about current events, recent information, or anything requiring real-time web data.

## Tools

| Tool | When to use |
|------|-------------|
| `web_search` | General web research, news, facts, comparisons — anything that needs search |
| `web_fetch` | Reading full page content after finding an interesting link |

## Configuration

API keys are set in `~/.pi/agent/extensions/pi-web-search/config.json`:

```json
{
  "provider": "auto",
  "grokApiUrl": "",
  "grokApiKey": "",
  "grokModel": "",
  "tavilyApiUrl": "",
  "tavilyApiKey": "",
  "context7ApiKey": "",
  "anysearchApiKey": ""
}
```

- `provider`: `"auto"` (try Grok first), `"grok"`, or `"anysearch"`
- At least one API key is needed for the tools to work
